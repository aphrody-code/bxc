#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * x-pro-recon — bxc + Gryphon bundle recon for X Pro / Decks (pro.x.com).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser } from "../src/api/browser.ts";
import { HarRecorder } from "../src/recorder/HarRecorder.ts";

const BXC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(homedir(), "bxc", "storage", "x-pro-recon");
const DECK_URL = "https://pro.x.com/i/decks/1823398034933199077";
const PRO_HOME = "https://pro.x.com";

const GRYPHON_MAIN =
  "https://abs.twimg.com/gryphon-client/client-web/main.a4ab919a.js";
const RESPONSIVE_MAIN =
  "https://abs.twimg.com/responsive-web/client-web/main.6426ebaa.js";

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
  const { auth_token, ct0, handle, user_id } = JSON.parse(
    readFileSync(path, "utf-8"),
  ) as {
    auth_token?: string;
    ct0?: string;
    handle?: string;
    user_id?: string;
  };
  if (!auth_token || !ct0) return null;
  const domains = [".x.com", ".pro.x.com", "pro.x.com", "x.com"];
  const out: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
  }> = [];
  for (const domain of domains) {
    const base = { domain, path: "/", secure: true, httpOnly: false };
    out.push(
      { ...base, name: "auth_token", value: auth_token, httpOnly: true },
      { ...base, name: "ct0", value: ct0 },
    );
  }
  void handle;
  void user_id;
  return out;
}

function xSessionMeta(): { handle?: string; user_id?: string } | null {
  const path = join(homedir(), ".aphrody", "x-session.json");
  if (!existsSync(path)) return null;
  const { handle, user_id } = JSON.parse(readFileSync(path, "utf-8")) as {
    handle?: string;
    user_id?: string;
  };
  return { handle, user_id };
}

function buildCookieJar(
  cookies: NonNullable<ReturnType<typeof xSessionToCookies>>,
): void {
  const jarDir = join(homedir(), ".bxc", "cookies");
  mkdirSync(jarDir, { recursive: true });
  writeFileSync(
    join(jarDir, "x-pro.json"),
    JSON.stringify(cookies, null, 2),
  );
}

async function scrapeBundle(
  url: string,
  label: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  const js = await res.text();
  const routes = new Set<string>();
  for (const m of js.matchAll(/["'`](\/i\/[a-zA-Z0-9_/-]+)["'`]/g))
    routes.add(m[1]);
  for (const m of js.matchAll(/["'`](\/decks?[^"'`]*)["'`]/gi))
    routes.add(m[1]);
  const deckRoutes = [...routes].filter((r) =>
    /deck|pro|gryphon|column|panel/i.test(r),
  );

  const graphqlOps = new Map<string, string>();
  for (const m of js.matchAll(
    /queryId:"([A-Za-z0-9_-]+)",operationName:"([A-Za-z0-9_]+)"/g,
  )) {
    graphqlOps.set(m[2], m[1]);
  }
  for (const m of js.matchAll(/operationName:"([A-Za-z0-9_]+)"/g)) {
    if (!graphqlOps.has(m[1])) graphqlOps.set(m[1], "");
  }

  const deckOps = [...graphqlOps.entries()].filter(([name]) =>
    /deck|Deck|Pro|Gryphon|Column|Panel|TweetDeck|Dashboard/i.test(name),
  );

  const proHosts = new Set<string>();
  for (const m of js.matchAll(
    /https:\/\/[a-z0-9.-]+\.(x\.com|pro\.x\.com|twimg\.com)[a-zA-Z0-9./_-]*/gi,
  )) {
    const u = m[0].replace(/\\u002F/g, "/");
    if (/pro\.|deck|gryphon|graphql|\/i\/api/i.test(u))
      proHosts.add(u.split(/["'`]/)[0]!);
  }

  const deckStrings = new Set<string>();
  for (const m of js.matchAll(
    /"(deck[s]?|Deck[s]?|pro\.x\.com|X Pro|TweetDeck|Gryphon[^"]{0,40})"/gi,
  )) {
    deckStrings.add(m[1]);
  }

  return {
    label,
    bundle_url: url,
    http_status: res.status,
    bytes: js.length,
    deck_routes: deckRoutes.sort(),
    deck_related_strings: [...deckStrings].sort().slice(0, 120),
    graphql_deck_ops: Object.fromEntries(deckOps.sort(([a], [b]) => a.localeCompare(b))),
    graphql_total_ops: graphqlOps.size,
    pro_and_api_hosts: [...proHosts].sort().slice(0, 100),
    has_pro_x_com: /pro\.x\.com/i.test(js),
    has_gryphon: /gryphon/i.test(js),
    has_tweetdeck: /tweetdeck|TweetDeck/i.test(js),
  };
}

async function harvestWithHar(
  url: string,
  cookies: NonNullable<ReturnType<typeof xSessionToCookies>>,
  harPath: string,
): Promise<string[]> {
  const page = await Browser.newPage({
    profile: "max",
    cookies,
    spawnOpts: { logLevel: "error", readyTimeoutMs: 20_000 },
  });
  const recorder = new HarRecorder(page);
  try {
    recorder.start();
    await page.goto(url, { timeoutMs: 90_000 });
    await Bun.sleep(8000);
    await recorder.save(harPath);
    const urls = await page
      .evaluate(() => {
        const perf = performance.getEntriesByType(
          "resource",
        ) as PerformanceResourceTiming[];
        return perf.map((e) => e.name);
      })
      .catch(() => [] as string[]);
    return [...new Set(urls)].sort();
  } finally {
    await page.close().catch(() => {});
    await Browser.close().catch(() => {});
  }
}

function extractHarGraphql(harPath: string): Record<string, unknown> {
  const har = JSON.parse(readFileSync(harPath, "utf-8")) as {
    log?: { entries?: Array<{ request?: { url?: string; method?: string } }> };
  };
  const entries = har.log?.entries ?? [];
  const graphql: Array<{
    url: string;
    method: string;
    operation?: string;
    queryId?: string;
  }> = [];
  const rest: string[] = [];
  for (const e of entries) {
    const url = e.request?.url ?? "";
    if (!url.includes("x.com") && !url.includes("pro.x.com")) continue;
    if (url.includes("/i/api/graphql/")) {
      const parts = url.split("/i/api/graphql/")[1]?.split("/") ?? [];
      graphql.push({
        url: url.split("?")[0]!,
        method: e.request?.method ?? "GET",
        queryId: parts[0],
        operation: parts[1]?.split("?")[0],
      });
    } else if (url.includes("/i/api/")) {
      rest.push(url.split("?")[0]!);
    }
  }
  const uniqGraphql = [
    ...new Map(graphql.map((g) => [`${g.operation}:${g.queryId}`, g])).values(),
  ];
  return {
    entry_count: entries.length,
    graphql: uniqGraphql.sort((a, b) =>
      (a.operation ?? "").localeCompare(b.operation ?? ""),
    ),
    rest_endpoints: [...new Set(rest)].sort(),
  };
}

async function curlSnapshot(
  url: string,
  outName: string,
): Promise<Record<string, unknown>> {
  const sessionPath = join(homedir(), ".aphrody", "x-session.json");
  const { auth_token, ct0 } = JSON.parse(readFileSync(sessionPath, "utf-8")) as {
    auth_token: string;
    ct0: string;
  };
  const cookie = `auth_token=${auth_token}; ct0=${ct0}`;
  const proc = Bun.spawn({
    cmd: [
      "curl",
      "-sS",
      "-D",
      "-",
      "-o",
      join(OUT, `${outName}.body.html`),
      "-H",
      `Cookie: ${cookie}`,
      "-H",
      `x-csrf-token: ${ct0}`,
      "-H",
      "x-twitter-auth-type: OAuth2Session",
      "-H",
      "x-twitter-active-user: yes",
      "-H",
      "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      url,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const headers = await new Response(proc.stdout).text();
  const code = headers.match(/^HTTP\/[\d.]+ (\d+)/m)?.[1];
  writeFileSync(join(OUT, `${outName}.headers.txt`), headers);
  const bodyPath = join(OUT, `${outName}.body.html`);
  const body = existsSync(bodyPath) ? readFileSync(bodyPath, "utf-8") : "";
  const mainMatch = body.match(
    /gryphon-client\/client-web\/main\.([a-f0-9]+)\.js/,
  );
  const responsiveMatch = body.match(
    /responsive-web\/client-web\/main\.([a-f0-9]+)\.js/,
  );
  return {
    url,
    http_status: code ? Number(code) : null,
    bytes: body.length,
    gryphon_main_hash: mainMatch?.[1] ?? null,
    responsive_main_hash: responsiveMatch?.[1] ?? null,
    has_initial_state: body.includes("__INITIAL_STATE__"),
    title_snippet: body.match(/<title[^>]*>([^<]*)</i)?.[1] ?? null,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const meta = xSessionMeta();
  const cookies = xSessionToCookies();
  if (!cookies) {
    console.error("No ~/.aphrody/x-session.json — aborting authenticated paths");
    process.exit(1);
  }
  buildCookieJar(cookies);

  console.error("[bundle] gryphon + responsive main.js …");
  const gryphon = await scrapeBundle(GRYPHON_MAIN, "gryphon");
  const responsive = await scrapeBundle(RESPONSIVE_MAIN, "responsive-web");
  const bundleScan = {
    generated_at: new Date().toISOString(),
    gryphon,
    responsive_web: responsive,
  };
  writeFileSync(
    join(OUT, "bundle-scan.json"),
    JSON.stringify(bundleScan, null, 2),
  );

  console.error("[curl] authenticated HTML snapshots …");
  const curlDeck = await curlSnapshot(DECK_URL, "curl-deck");
  const curlPro = await curlSnapshot(PRO_HOME, "curl-pro-home");
  writeFileSync(
    join(OUT, "curl-snapshots.json"),
    JSON.stringify({ deck: curlDeck, pro_home: curlPro }, null, 2),
  );

  console.error("[har] authenticated deck page …");
  const harPath = join(OUT, "pro-deck.har");
  let networkUrls: string[] = [];
  try {
    networkUrls = await harvestWithHar(DECK_URL, cookies, harPath);
  } catch (err: unknown) {
    writeFileSync(
      join(OUT, "har-error.json"),
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    );
  }

  const harSummary = existsSync(harPath)
    ? extractHarGraphql(harPath)
    : { error: "har missing" };
  writeFileSync(join(OUT, "har-summary.json"), JSON.stringify(harSummary, null, 2));

  const graphqlOps = {
    from_gryphon_bundle: gryphon.graphql_deck_ops,
    from_responsive_bundle: responsive.graphql_deck_ops,
    from_har: harSummary,
  };
  writeFileSync(
    join(OUT, "graphql-ops.json"),
    JSON.stringify(graphqlOps, null, 2),
  );

  const catalogPath = join(
    BXC_ROOT,
    "rust-bridge/crates/x-client/data/x-graphql-catalog.json",
  );
  const catalog = existsSync(catalogPath)
    ? (JSON.parse(readFileSync(catalogPath, "utf-8")) as Record<
        string,
        { queryId: string; operationType: string }
      >)
    : {};
  const allOpNames = new Set([
    ...Object.keys(gryphon.graphql_deck_ops as Record<string, string>),
    ...Object.keys(responsive.graphql_deck_ops as Record<string, string>),
    ...(harSummary as { graphql?: Array<{ operation?: string }> }).graphql?.map(
      (g) => g.operation!,
    ) ?? [],
  ]);
  const catalogHits: Record<string, unknown> = {};
  for (const op of allOpNames) {
    if (catalog[op]) catalogHits[op] = catalog[op];
  }

  const networkFiltered = networkUrls.filter((u) =>
    /graphql|\/i\/api\/|pro\.x|deck|gryphon/i.test(u),
  );

  const endpointsMd = `# X Pro / Decks — endpoints

Generated: ${new Date().toISOString()}
Account: @${meta?.handle ?? "unknown"} (${meta?.user_id ?? "?"})

## Surfaces
| URL | Notes |
|-----|-------|
| \`${DECK_URL}\` | Deck deep link (Gryphon SPA) |
| \`${PRO_HOME}\` | X Pro home |
| \`https://x.com\` | Main site (shared GraphQL gateway) |

## Stack
- **Host:** \`pro.x.com\` (Cloudflare → Express)
- **Frontend:** Gryphon client — \`abs.twimg.com/gryphon-client/client-web/\`
- **Shared API:** \`https://x.com/i/api/graphql/{queryId}/{OperationName}\` (cookies on \`.x.com\`)

## GraphQL (deck/pro-related)
${[...allOpNames]
  .sort()
  .map((op) => {
    const fromHar = (
      harSummary as { graphql?: Array<{ operation?: string; queryId?: string }> }
    ).graphql?.find((g) => g.operation === op);
    const qid =
      fromHar?.queryId ??
      (gryphon.graphql_deck_ops as Record<string, string>)[op] ??
      (responsive.graphql_deck_ops as Record<string, string>)[op] ??
      (catalog[op] as { queryId?: string } | undefined)?.queryId ??
      "—";
    return `- **${op}** — \`${qid}\``;
  })
  .join("\n")}

## REST / other (from HAR)
${((harSummary as { rest_endpoints?: string[] }).rest_endpoints ?? [])
  .slice(0, 40)
  .map((u) => `- \`${u}\``)
  .join("\n")}

## Auth
- Cookies: \`auth_token\` (httpOnly), \`ct0\` (CSRF) on **\`.x.com\`** (works for \`pro.x.com\` navigations)
- Headers: \`x-csrf-token\`, \`x-twitter-auth-type: OAuth2Session\`, \`x-twitter-active-user: yes\`
- **Premium+ / X Pro** subscription required for deck features (client gates via feature switches)

## Artifacts
- \`detect.json\`, \`recon.json\`, \`bundle-scan.json\`, \`graphql-ops.json\`, \`pro-deck.har\`, \`har-summary.json\`
`;

  writeFileSync(join(OUT, "endpoints.md"), endpointsMd);

  const summary = {
    generated_at: new Date().toISOString(),
    account: meta,
    deck_url: DECK_URL,
    stack: {
      host: "pro.x.com",
      client: "gryphon-client",
      bundle: GRYPHON_MAIN,
      api_gateway: "https://x.com/i/api/graphql/{queryId}/{OperationName}",
    },
    curl: { deck: curlDeck, pro_home: curlPro },
    bundle: {
      gryphon_deck_ops: Object.keys(
        gryphon.graphql_deck_ops as Record<string, string>,
      ).length,
      har_graphql_count: (harSummary as { graphql?: unknown[] }).graphql?.length ?? 0,
    },
    catalog_hits: catalogHits,
    network_harvest_count: networkFiltered.length,
    recommended_modules: {
      rust: "x_pro_deck",
      typescript: "XProDeckService",
    },
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

  const yoyoOut = join(homedir(), "yoyo", "data", "x-pro-recon");
  mkdirSync(yoyoOut, { recursive: true });
  writeFileSync(join(yoyoOut, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(yoyoOut, "endpoints.md"), endpointsMd);

  console.log(JSON.stringify({ out: OUT, summary }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});