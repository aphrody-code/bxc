#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * x-premium-dump — harvest X Premium / Blue / subscriptions GraphQL for the logged-in user.
 *
 * Primary surface: https://x.com/i/premium → query **Upsells** (`viewer_v2.upsell_config_for_surfaces`)
 *
 * Usage:
 *   bun run scripts/x-premium-dump.ts
 *   bun run scripts/x-premium-dump.ts --out ~/yoyo/data/premium-dump
 *   bun run scripts/x-premium-dump.ts --also-store  # upsert raw_snapshots into yoyo.sqlite
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { XClient, XSession } from "@aphrody/x";

const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/x/src/config/x-graphql-catalog.json",
);

/** GraphQL ops tied to x.com/i/premium, subscriptions, or Blue Verified (2026 catalog). */
const PREMIUM_OPS = [
  "Upsells",
  "Viewer",
  "UserByScreenName",
  "UserCreatorSubscriptions",
  "CreatorSubscriptionsTimeline",
  "UserCreatorSubscribers",
  "SuperFollowers",
  "BlueVerifiedFollowers",
  "UserArticlesTweets",
  "UsersVerifiedAvatars",
] as const;

interface CliOpts {
  outDir: string;
  handle?: string;
  alsoStore: boolean;
  dbPath: string;
  blueFollowersCount: number;
}

function parseArgv(argv: string[]): CliOpts {
  const home = homedir() || ".";
  const opts: CliOpts = {
    outDir: join(home, "yoyo", "data", "premium-dump"),
    alsoStore: false,
    dbPath: join(home, ".aphrody", "yoyo.sqlite"),
    blueFollowersCount: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.outDir = argv[++i] ?? opts.outDir;
    else if (a === "--handle") opts.handle = argv[++i]?.replace(/^@/, "");
    else if (a === "--also-store") opts.alsoStore = true;
    else if (a === "--db") opts.dbPath = argv[++i] ?? opts.dbPath;
    else if (a === "--blue-followers") opts.blueFollowersCount = parseInt(argv[++i], 10) || opts.blueFollowersCount;
    else if (a === "-h" || a === "--help") {
      console.log(`x-premium-dump — dump Premium GraphQL payloads

  --out <dir>           Output directory (default: ~/yoyo/data/premium-dump)
  --also-store          INSERT raw_snapshots into yoyo.sqlite
  --db <path>           SQLite path when --also-store
  --blue-followers <n>  Sample size for BlueVerifiedFollowers
`);
      process.exit(0);
    }
  }
  return opts;
}

function storeSnapshot(db: Database, account: string, key: string, data: unknown): void {
  db.run(
    `INSERT INTO raw_snapshots (account, key, json) VALUES (?1, ?2, ?3)
     ON CONFLICT(account, key) DO UPDATE SET json = excluded.json, fetched_at = strftime('%s','now')`,
    [account, key, JSON.stringify(data)],
  );
}

async function fetchOp(
  client: XClient,
  op: string,
  vars: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const data = await client.graphqlWaiting(op, vars);
    return { ok: true, data };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });

  const session = XSession.loadOrEnv();
  const client = new XClient(session);
  const me = await client.whoami();
  const handle = opts.handle ?? me.screen_name;
  const uid = me.id;

  const vars: Record<string, Record<string, unknown>> = {
    Upsells: {},
    Viewer: { withCommunitiesMemberships: true },
    UserByScreenName: { screen_name: handle, withSafetyModeUserFields: true },
    UserCreatorSubscriptions: { userId: uid, count: 50, includePromotedContent: false },
    CreatorSubscriptionsTimeline: { userId: uid, count: 50, includePromotedContent: false },
    UserCreatorSubscribers: { userId: uid, count: 50, includePromotedContent: false },
    SuperFollowers: { userId: uid, count: 50, includePromotedContent: false },
    BlueVerifiedFollowers: {
      userId: uid,
      count: opts.blueFollowersCount,
      includePromotedContent: false,
    },
    UserArticlesTweets: {
      userId: uid,
      count: 20,
      includePromotedContent: true,
      withVoice: true,
    },
    UsersVerifiedAvatars: { userIds: [uid] },
  };

  /** UI / checkout SKU strings embedded in main.*.js (not separate GraphQL ops). */
  const BUNDLE_PRODUCT_SKUS = [
    "BlueVerified",
    "BlueVerified3Months",
    "BlueVerified6Months",
    "BlueVerifiedPlus",
    "BlueVerifiedPlus3Months",
    "BlueVerifiedPlus6Months",
    "PremiumBasic",
  ] as const;

  const report: Record<string, unknown> = {
    fetched_at: new Date().toISOString(),
    account: handle,
    user_id: uid,
    premium_page: "https://x.com/i/premium",
    primary_graphql_op: "Upsells",
    catalog_ops: PREMIUM_OPS,
    results: {} as Record<string, unknown>,
    notes: [
      "/i/premium bundles expose Upsells + UserCreatorSubscriptions; no separate PremiumPage op in 2026 catalog.",
      "Subscription state fields live on Viewer / UserByScreenName (is_blue_verified, upsell_config_for_surfaces).",
      "product_category enum seen: BlueVerified; charge_interval: Month | Year.",
    ],
  };

  for (const op of PREMIUM_OPS) {
    const r = await fetchOp(client, op, vars[op] ?? {});
    const key = op === "BlueVerifiedFollowers" ? "BlueVerifiedFollowers" : op;
    if (r.ok) {
      writeFileSync(join(opts.outDir, `${key}.json`), JSON.stringify(r.data, null, 2));
      (report.results as Record<string, unknown>)[op] = {
        ok: true,
        bytes: JSON.stringify(r.data).length,
        top_keys: r.data && typeof r.data === "object" && "data" in (r.data as object)
          ? Object.keys((r.data as { data: Record<string, unknown> }).data)
          : [],
      };
    } else {
      (report.results as Record<string, unknown>)[op] = { ok: false, error: r.error };
    }
    console.error(r.ok ? `✓ ${op}` : `✗ ${op}: ${r.error}`);
  }

  writeFileSync(join(opts.outDir, "whoami.json"), JSON.stringify(me, null, 2));
  writeFileSync(join(opts.outDir, "_report.json"), JSON.stringify(report, null, 2));

  const gap = await buildGapReport(
    opts.outDir,
    PREMIUM_OPS,
    report.results as Record<string, { ok: boolean }>,
  );
  gap.bundle_product_skus = [...BUNDLE_PRODUCT_SKUS];
  gap.notes = [
    ...(gap.notes as string[]),
    "2026 responsive-web main bundle embeds 157 operationName entries; none named PremiumHub* / PremiumPaywall*.",
    "/i/premium loads Upsells (viewer_v2.upsell_config_for_surfaces) + nav SKU routing client-side.",
    "bxc @aphrody/x premium.ts ProductCategory is narrower than live SKUs — extend when mapping checkout.",
  ];
  writeFileSync(join(opts.outDir, "_gap_report.json"), JSON.stringify(gap, null, 2));

  // Premium page HTML shell (no auth) for bundle reference
  try {
    const res = await fetch("https://x.com/i/premium", {
      headers: { "user-agent": client.session ? "Mozilla/5.0" : "Mozilla/5.0" },
    });
    const html = await res.text();
    const bundles = [...html.matchAll(/abs\.twimg\.com\/responsive-web\/client-web\/[^"']+\.js/g)].map((m) => `https://${m[0]}`);
    writeFileSync(
      join(opts.outDir, "_premium_page_meta.json"),
      JSON.stringify({ status: res.status, bundle_count: bundles.length, bundles: bundles.slice(0, 20) }, null, 2),
    );
  } catch {
    /* optional */
  }

  if (opts.alsoStore && existsSync(opts.dbPath)) {
    const db = new Database(opts.dbPath);
    for (const op of PREMIUM_OPS) {
      const p = join(opts.outDir, `${op === "BlueVerifiedFollowers" ? "BlueVerifiedFollowers" : op}.json`);
      if (existsSync(p)) {
        storeSnapshot(db, handle, `premium_${op}`, JSON.parse(readFileSync(p, "utf-8")));
      }
    }
    storeSnapshot(db, handle, "premium_report", report);
    storeSnapshot(db, handle, "premium_gap_report", gap);
    db.close();
    console.error(`[store] snapshots → ${opts.dbPath}`);
  }

  console.log(JSON.stringify({ out: opts.outDir, report, gap_summary: gap.summary }, null, 2));
}

/** Walk JSON for GraphQL __typename values (missed type hints for mappers). */
function collectTypenames(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) collectTypenames(x, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.__typename === "string") out.add(o.__typename);
    for (const v of Object.values(o)) collectTypenames(v, out, depth + 1);
  }
}

async function buildGapReport(
  outDir: string,
  ops: readonly string[],
  results: Record<string, { ok: boolean }>,
): Promise<Record<string, unknown>> {
  const catalog = (await Bun.file(CATALOG_PATH).json()) as {
    operations: Record<string, { queryId: string }>;
  };

  const prem = (s: string) =>
    /(premium|blue|upsell|subscription|gift|paywall|verified|creator)/i.test(s);
  const catalogPremium = Object.keys(catalog.operations ?? {}).filter(prem);

  const bundleQids: Record<string, string> = {};
  try {
    const res = await fetch("https://abs.twimg.com/responsive-web/client-web/main.6426ebaa.js");
    const js = await res.text();
    for (const op of catalogPremium) {
      const i = js.indexOf(`operationName:"${op}"`);
      if (i < 0) continue;
      const m = js.slice(Math.max(0, i - 80), i + 40).match(/queryId:"([^"]+)"/);
      if (m) bundleQids[op] = m[1];
    }
  } catch {
    /* optional */
  }

  const staleQueryIds: { op: string; catalog: string; bundle: string }[] = [];
  for (const [op, bundleId] of Object.entries(bundleQids)) {
    const catId = catalog.operations?.[op]?.queryId;
    if (catId && catId !== bundleId) staleQueryIds.push({ op, catalog: catId, bundle: bundleId });
  }

  const typenameSets: Record<string, string[]> = {};
  for (const op of ops) {
    if (!results[op]?.ok) continue;
    const p = join(outDir, `${op}.json`);
    if (!existsSync(p)) continue;
    const set = new Set<string>();
    collectTypenames(JSON.parse(readFileSync(p, "utf-8")), set);
    typenameSets[op] = [...set].sort();
  }

  const ok = ops.filter((o) => results[o]?.ok);
  const failed = ops.filter((o) => results[o] && !results[o].ok);
  const notDumpedFromCatalog = catalogPremium.filter((o) => !ops.includes(o as (typeof ops)[number]));

  return {
    generated_at: new Date().toISOString(),
    summary: {
      dumped_ok: ok.length,
      dumped_failed: failed.length,
      catalog_premium_ops: catalogPremium.length,
      stale_query_ids: staleQueryIds.length,
      missing_premium_hub_graphql: true,
    },
    catalog_premium_ops: catalogPremium,
    catalog_ops_not_in_dump: notDumpedFromCatalog,
    dumped_ops: ops,
    fetch_ok: ok,
    fetch_failed: failed,
    stale_query_ids: staleQueryIds,
    ui_only_identifiers: [
      "PremiumPaywallOnLoad",
      "FETCH_UPSELLS",
      "Subscriptions",
      "PremiumNav",
    ],
    notes: [] as string[],
    typename_sets: typenameSets,
  };
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});