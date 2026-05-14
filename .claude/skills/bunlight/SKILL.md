---
name: bunlight
description: This skill should be used when the user asks to "scrape a website", "crawl URLs", "extract data from a page", "detect a framework", "bypass Cloudflare", "handle cookies for auth", or builds any browser automation workflow on Bun. Covers Bunlight (Bun + Lightpanda fused): 5 profiles (static, fast, http, stealth, max), page pools, request queues, framework detection, cookie injection, and 10 production-ready cookbook recipes. Triggers on: bunlight, scrape, crawl, browser automation, headless, Cloudflare, Turnstile, page pool, RequestQueue, wappalyzer, cookie jar, CDP, Lightpanda.
---

# Bunlight

Bun + Lightpanda fused: a single-process browser automation engine. In-process CDP, 5 profiles, sub-millisecond latency, 50 KB binary footprint.

**Current phase**: Phase 2 (npm package `@bunmium/bunlight`). Phase 3 ships builtin `bun:browser`.

## What is Bunlight?

Bunlight replaces the traditional spawn-a-subprocess-and-talk-CDP pattern with a simpler model: **one Bun process, one browser engine, function call interface**.

Traditional:
```
┌─ Node process ─────────────────────┐
│ const browser = await puppeteer     │
│   .launch({ headless: true })       │  spawn chrome/firefox (300 MB RAM)
│ const page = await browser.newPage()│  talk CDP over TCP/WebSocket
└───────────────────────────────────┘  ~50 ms latency per call
```

Bunlight:
```
┌─ Bun process ──────────────────────────────────────┐
│ import { Browser } from "@bunmium/bunlight"        │
│ const page = await Browser.newPage()               │  in-process Lightpanda
│ await page.goto(url)                               │  function call interface
└────────────────────────────────────────────────────┘  <1 ms latency per call
```

## Profiles (when to use what)

Bunlight offers 5 profiles, each with a different latency/capability trade-off:

| Profile | JS | TLS FP | Browser patches | Latency | Use case |
|---------|----|----|---|---|---|
| `static` | No | No | No | 2 ms | Static HTML, fast path, no JS needed |
| `fast` | Yes (Lightpanda V8) | No | No | 150 ms | SPAs, React/Vue, generic sites |
| `http` | No | Yes (curl-impersonate) | No | 20 ms | Cloudflare basic, Akamai; cookie-based auth |
| `stealth` | Yes | No | Yes (patchright) | 800 ms | Cloudflare IUAM, browser fingerprint detection (60-80% success) |
| `max` | Yes | No | Yes (Camoufox) | 1500 ms | Maximum stealth, Turnstile solving (90-95% success) |

**Decision tree**: See the `/bunlight:profiles` skill for the detailed decision tree.

## Quick start

### 1. Scrape a single URL

```ts
import { Browser } from "@bunmium/bunlight";

const page = await Browser.newPage({ profile: "fast" });
await page.goto("https://example.com");
console.log(await page.title());
await page.close();
```

### 2. Scrape 100 URLs in parallel

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const pool = new PagePool({ 
  profile: "fast", 
  concurrency: 10,    // 10 pages in parallel
  maxPages: 5         // reuse max 5 pages
});

const results = await pool.run(
  urls,
  async (page, url) => {
    await page.goto(url);
    return page.title();
  }
);

await pool.close();
```

### 3. Resume after crash

```ts
import { RequestQueue } from "@bunmium/bunlight/queue/RequestQueue";

const queue = new RequestQueue("crawl.db");

// Load all URLs into queue
for (const url of allUrls) {
  if (!await queue.has(url)) {
    await queue.add({ url, retries: 0 });
  }
}

// Process queue (safe to restart anytime)
while (const req = await queue.shift()) {
  const page = await Browser.newPage();
  try {
    await page.goto(req.url);
    // process...
    await queue.markDone(req.url);
  } catch (err) {
    await queue.markFailed(req.url, req.retries + 1);
  }
}
```

### 4. Detect framework & choose profile

```ts
import { detectFromPage } from "@bunmium/bunlight/detect";
import { suggestProfile } from "@bunmium/bunlight/router/framework-strategy";

const page = await Browser.newPage({ profile: "static" });
await page.goto(url);
const tech = await detectFromPage(page);
const suggested = suggestProfile(tech);

if (suggested !== "static") {
  console.log(`Try profile: ${suggested}`);
}
```

### 5. Bypass Cloudflare with cookies

```ts
import { loadCookieJar } from "@bunmium/bunlight/cookies";

const cookies = await loadCookieJar("./cookies/cf-session.json");
const page = await Browser.newPage({ 
  profile: "stealth",
  cookies  // inject pre-auth cookies
});
await page.goto("https://cloudflare-protected.com");
```

## References in this skill

For deeper coverage, load these reference files as needed:

- **`references/browser-basics.md`** — Core `Browser` and `Page` API surface.
- **`references/profiles.md`** — Decision tree for picking a profile.
- **`references/detect.md`** — Framework detection via wappalyzergo.
- **`references/cookies.md`** — Cookie formats and injection.
- **`references/pool.md`** — `PagePool`, `SessionPool`, `ProxyPool`.
- **`references/queue.md`** — `RequestQueue` for massive crawls.
- **`references/storage.md`** — `Dataset` (JSONL append-only).
- **`references/cookbook.md`** — 10 complete recipes.
- **`references/api.md`** — Full API reference for all classes.
- **`references/troubleshooting.md`** — Common errors and fixes.

## Companion components

- Agents: `bunlight-scraper`, `bunlight-crawler`, `bunlight-debugger`, `bunlight-cookie-extractor`, `bunlight-test-runner`, `bunlight-profile-router`, `bunlight-bench-runner`, `bunlight-publisher`.
- Commands: `/bunlight-init`, `/bunlight-scrape`, `/bunlight-crawl`, `/bunlight-detect`, `/bunlight-test`, `/bunlight-bench`, `/bunlight-cookie-import`, `/bunlight-doctor`.
- MCP server: `bunlight-mcp` (4 tools: `bunlight_scrape`, `bunlight_detect`, `bunlight_extract_cookies`, `bunlight_pool_run`).

## Common patterns

See `/bunlight:cookbook` for 10 recipes:

1. **Scrape a single URL** (static HTML)
2. **Scrape 100 URLs** with page pool
3. **Login with session cookies** (bypass auth)
4. **Crawl a sitemap** (massive crawl with RequestQueue)
5. **Detect framework** (wappalyzergo integration)
6. **Bypass Cloudflare** (stealth profile + patchright)
7. **Solve Turnstile** (max profile + CapSolver)
8. **Resume after crash** (RequestQueue checkpoint)
9. **Export to CSV/JSON** (Dataset append-only)
10. **Puppeteer compatibility** (zero-spawn via transport)

## Architecture

```
Browser API (src/api/browser.ts)
     |
  static  fast  http  stealth  max
     |     |     |      |       |
StaticDOM Socket curl patchright camoufox
Transport Transport Client
     |
Lightpanda (Zig cdylib)
  - DOM parsing
  - CSS selectors
  - V8 JS execution
  - Network stack
```

## Code style for Bunlight projects

- **Always use Bun-native APIs**: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.$`, `Bun.Cookie`, `bun:sqlite`, `bun:ffi`, `bun:test`
- **Never** use Node stdlib (`node:fs`, `node:child_process`, etc.) unless explicitly required
- **TypeScript**: strict mode, no `any` types
- **No emojis** in code or docs
- **Single binary**: all scripts produce one executable or use Bun-native APIs

## Next steps

- First time? Load `references/browser-basics.md`.
- Need examples? Load `references/cookbook.md`.
- Choosing a profile? Load `references/profiles.md`.
- Having trouble? Load `references/troubleshooting.md`.
