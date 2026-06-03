#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * x-premium-recon — full bxc + @aphrody/x recon for X Premium surfaces.
 *
 * - bxc recon/detect (profile `max` for SPA) on known premium URLs
 * - Bundle scrape: routes, SKUs, GraphQL ops, payment/CDN hosts
 * - Authenticated network harvest (CDP) when ~/.aphrody/x-session.json exists
 * - GraphQL dump via x-premium-dump
 *
 * Usage:
 *   bun run scripts/x-premium-recon.ts
 *   bun run scripts/x-premium-recon.ts --profile max --out ~/bxc/storage/premium-recon
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BXC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
import { Browser } from "../src/api/browser.ts";
import { runXSurfaceRecon } from "../packages/x/src/tools/bxc-recon.ts";
import { syncCatalogFromBundles } from "../packages/x/src/tools/bundle-catalog.ts";

const PREMIUM_URLS = [
  "https://x.com/i/premium",
  "https://x.com/i/premium_sign_up",
  "https://x.com/i/twitter_blue_sign_up",
  "https://x.com/settings/subscriptions",
  "https://x.com/settings/verified",
  "https://x.com/settings/account",
  "https://pay.x.com",
  "https://money.x.com",
] as const;

const MAIN_BUNDLE =
  "https://abs.twimg.com/responsive-web/client-web/main.6426ebaa.js";

interface CliOpts {
  outDir: string;
  profile: "static" | "fast" | "http" | "stealth" | "max";
  skipBrowserHarvest: boolean;
  skipDump: boolean;
}

function parseArgv(argv: string[]): CliOpts {
  const home = homedir() || ".";
  const opts: CliOpts = {
    outDir: join(home, "bxc", "storage", "premium-recon"),
    profile: "max",
    skipBrowserHarvest: false,
    skipDump: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.outDir = argv[++i] ?? opts.outDir;
    else if (a === "--profile") opts.profile = (argv[++i] as CliOpts["profile"]) ?? opts.profile;
    else if (a === "--skip-harvest") opts.skipBrowserHarvest = true;
    else if (a === "--skip-dump") opts.skipDump = true;
    else if (a === "-h" || a === "--help") {
      console.log(`x-premium-recon — bxc max recon + bundle + GraphQL dump

  --out <dir>       Report directory (default: ~/bxc/storage/premium-recon)
  --profile <name>  bxc profile (default: max)
  --skip-harvest    Skip authenticated CDP network log
  --skip-dump       Skip x-premium-dump GraphQL harvest
`);
      process.exit(0);
    }
  }
  return opts;
}

function slugUrl(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

function xSessionToCookies(): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}> | null {
  const path = join(homedir(), ".aphrody", "x-session.json");
  if (!existsSync(path)) return null;
  const { auth_token, ct0 } = JSON.parse(readFileSync(path, "utf-8")) as {
    auth_token?: string;
    ct0?: string;
  };
  if (!auth_token || !ct0) return null;
  const base = { domain: ".x.com", path: "/", secure: true, httpOnly: false };
  return [
    { ...base, name: "auth_token", value: auth_token, httpOnly: true },
    { ...base, name: "ct0", value: ct0 },
  ];
}

async function scrapeBundle(): Promise<Record<string, unknown>> {
  const res = await fetch(MAIN_BUNDLE);
  const js = await res.text();
  const routes = new Set<string>();
  for (const m of js.matchAll(/["'`](\/i\/[a-zA-Z0-9_/-]+)["'`]/g)) routes.add(m[1]);
  for (const m of js.matchAll(/["'`](\/settings\/[a-zA-Z0-9_/-]+)["'`]/g)) routes.add(m[1]);
  const premiumRoutes = [...routes].filter((r) =>
    /premium|blue|subscription|verified|pay|gift|billing|twitter_blue/i.test(r),
  );

  const skus = new Set<string>();
  for (const m of js.matchAll(
    /"(BlueVerified[^"]*|PremiumBasic|Premium[A-Za-z0-9]+)"/g,
  )) {
    skus.add(m[1]);
  }

  const graphqlOps = new Set<string>();
  for (const m of js.matchAll(/operationName:"([A-Za-z0-9_]+)"/g)) graphqlOps.add(m[1]);
  const premiumOps = [...graphqlOps].filter((o) =>
    /premium|blue|upsell|subscription|gift|verified|creator/i.test(o),
  );

  const apiHosts = new Set<string>();
  for (const m of js.matchAll(
    /https:\/\/[a-z0-9.-]+\.(x\.com|twimg\.com)[a-zA-Z0-9./_-]*/gi,
  )) {
    const u = m[0].replace(/\\u002F/g, "/");
    if (/pay|money|payment|api|graphql|ton/i.test(u)) apiHosts.add(u.split(/["'`]/)[0]!);
  }

  return {
    bundle_url: MAIN_BUNDLE,
    bytes: js.length,
    premium_routes: premiumRoutes.sort(),
    product_skus: [...skus].sort(),
    graphql_operation_count: graphqlOps.size,
    graphql_premium_ops: premiumOps.sort(),
    payment_and_api_hosts: [...apiHosts].sort().slice(0, 80),
  };
}

async function harvestNetwork(
  url: string,
  cookies: NonNullable<ReturnType<typeof xSessionToCookies>>,
): Promise<string[]> {
  const page = await Browser.newPage({
    profile: "max",
    cookies,
    spawnOpts: { logLevel: "error", readyTimeoutMs: 15_000 },
  });
  try {
    await page.goto(url, { timeoutMs: 60_000 });
    await Bun.sleep(5000);
    const evalUrls = await page
      .evaluate(() => {
        const perf = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        return perf
          .map((e) => e.name)
          .filter((n) => /graphql|\/i\/api\/|pay\.|money\.|premium|subscription|upsell/i.test(n));
      })
      .catch(() => [] as string[]);
    return [...new Set(evalUrls)].sort();
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });

  console.error("[bundle] scraping main.js …");
  const bundle = await scrapeBundle();
  writeFileSync(join(opts.outDir, "bundle-scan.json"), JSON.stringify(bundle, null, 2));

  console.error("[catalog] sync queryIds from live bundles …");
  const catalogSync = await syncCatalogFromBundles({
    rustCatalogPath: join(BXC_ROOT, "rust-bridge/crates/x-client/data/x-graphql-catalog.json"),
  });
  writeFileSync(join(opts.outDir, "catalog-sync.json"), JSON.stringify(catalogSync, null, 2));

  console.error(`[recon] bxc profile=${opts.profile} on premium URLs …`);
  const bxcRecon = await runXSurfaceRecon(opts.profile, PREMIUM_URLS);
  writeFileSync(join(opts.outDir, "recon-all.json"), JSON.stringify(bxcRecon, null, 2));

  const networkHarvest: Record<string, string[]> = {};
  const cookies = xSessionToCookies();
  if (!opts.skipBrowserHarvest && cookies) {
    console.error("[harvest] authenticated CDP on /i/premium …");
    try {
      networkHarvest["https://x.com/i/premium"] = await harvestNetwork(
        "https://x.com/i/premium",
        cookies,
      );
    } catch (err: unknown) {
      networkHarvest.error = [err instanceof Error ? err.message : String(err)];
    }
    writeFileSync(join(opts.outDir, "network-harvest.json"), JSON.stringify(networkHarvest, null, 2));
  }

  const endpoints = {
    graphql_base: "https://x.com/i/api/graphql/{queryId}/{OperationName}",
    rest_v1_1: "https://x.com/i/api/1.1/",
    api_v2: "https://api.x.com/",
    pay: ["https://pay.x.com", "https://pay.twitter.com"],
    money: ["https://money.x.com", "https://money-dev.x.com", "https://money-staging.x.com"],
    payments_wasm: [
      "https://payments-prod.x.com/customer/wasm/forward-with-v1.wasm",
      "https://money.x.com/customer/wasm/forward-with-v1.wasm",
    ],
    cdn: [
      "https://abs.twimg.com/responsive-web/client-web/",
      "https://pbs.twimg.com",
      "https://video.twimg.com",
    ],
    csp_connect_src_sample: [
      "https://api.x.com",
      "https://pay.x.com",
      "https://ton.x.com",
      "https://ads-api.x.com",
    ],
  };

  if (!opts.skipDump) {
    console.error("[dump] x-premium-dump …");
    const proc = Bun.spawn({
      cmd: ["bun", "run", join(BXC_ROOT, "scripts/x-premium-dump.ts"), "--also-store"],
      cwd: BXC_ROOT,
      stdout: "pipe",
      stderr: "inherit",
    });
    await proc.exited;
  }

  const report = {
    generated_at: new Date().toISOString(),
    tool: "bxc x-premium-recon",
    bxc_profile: opts.profile,
    premium_urls: PREMIUM_URLS,
    framework: {
      frontend: "React + Redux SPA (Webpack)",
      bundles: "abs.twimg.com/responsive-web/client-web/main.*.js",
      backend_headers: "Express (x-powered-by), Cloudflare CDN",
    },
    endpoints,
    bundle,
    network_harvest_keys: Object.keys(networkHarvest),
    catalog_sync: catalogSync,
    recon_summary: Object.fromEntries(
      Object.entries(bxcRecon.results).map(([u, r]) => [
        u,
        r.error ?? { status: r.httpStatus, cdn: r.cdn },
      ]),
    ),
    npm_notes: {
      official_api: "twitter-api-v2 (OAuth2 portal — not cookie GraphQL)",
      community_cookie: "@aphrody/x / aphrody-x-client (this repo)",
      transaction_id: "xclienttransaction / twitter-api-client (optional header)",
    },
  };

  writeFileSync(join(opts.outDir, "PREMIUM_RECON.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(opts.outDir, "PREMIUM_RECON.md"),
    renderMarkdown(report),
  );
  console.log(JSON.stringify({ out: opts.outDir, report }, null, 2));
}

function renderMarkdown(report: Record<string, unknown>): string {
  const b = report.bundle as Record<string, unknown>;
  const routes = (b.premium_routes as string[]) ?? [];
  const ops = (b.graphql_premium_ops as string[]) ?? [];
  return `# X Premium recon (${report.generated_at})

## Stack
- **Frontend:** React + Redux, Webpack bundles on \`abs.twimg.com/responsive-web/client-web/\`
- **API:** \`https://x.com/i/api/graphql/{queryId}/{OperationName}\`
- **Payments:** \`pay.x.com\`, \`money.x.com\`, Plaid/Stripe/Adyen (CSP)

## Premium routes (bundle)
${routes.map((r) => `- \`${r}\``).join("\n")}

## GraphQL (premium-related)
${ops.map((o) => `- \`${o}\``).join("\n")}

## Product SKUs (client-side)
${((b.product_skus as string[]) ?? []).map((s) => `- \`${s}\``).join("\n")}

## bxc profile
\`${report.bxc_profile}\` on ${(report.premium_urls as string[]).length} URLs — see \`recon-all.json\`.

## Packages
- **@aphrody/x** — cookie GraphQL (this monorepo)
- **aphrody-x-client** — Rust twin
- **twitter-api-v2** — official API v2 (different auth model)
`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});