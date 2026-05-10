# Bunlight FAQ

Reference: [TROUBLESHOOTING](./TROUBLESHOOTING.md) | [Profiles](./PROFILES.md) | [Benchmarks](./BENCHMARKS.md) | [Anti-bot stack](./ANTI-BOT-STACK.md)

---

## General

### Why Bun and not Node.js?

Three concrete reasons:

1. **Native performance.** Bun's `fetch`, file I/O (`Bun.file`), and subprocess APIs are implemented in Zig and are measurably faster than Node's equivalents. Static HTML scraping at scale benefits from zero-overhead I/O.

2. **First-class FFI.** `bun:ffi` lets Bunlight load `liblightpanda_dom.so` and `libcurl-impersonate.so` directly into the Bun process without a native addon build step. No `node-gyp`, no binding.gyp, no N-API glue.

3. **Single binary target.** `bun build --compile` produces a fully self-contained executable that bundles the TypeScript runtime, your scripts, and optionally the vendor `.so` files. Deployment reduces to copying one file.

Node compatibility is maintained where it matters: Bunlight's `ConnectionTransport` interface is compatible with Puppeteer's, so existing Puppeteer scripts migrate with minimal changes.

---

### Why 5 profiles instead of one universal browser?

Each profile represents a different trade-off between **speed**, **memory**, **anti-bot coverage**, and **cost**. No single browser engine is optimal for all targets:

| Profile | Speed | RAM | Anti-bot bypass | Cost |
|---|---|---|---|---|
| `static` | Fastest (<5 ms) | Minimal (67 MB) | None | Free |
| `fast` | Fast (~50-120 ms) | Low (~76 MB) | Basic (55% CF) | Free |
| `http` | Fast (~100 ms) | Low | Basic TLS spoof | Free |
| `stealth` | Moderate (~800 ms) | Medium (~180 MB) | High (80% CF) | Free + Chromium |
| `max` | Slow (~1500 ms) | High (~400 MB) | Highest (95% CF) | CapSolver + proxy |

Running every request through `max` would cost 30x more per page and burn residential proxy quota. The escalation strategy (start with `static` or `fast`, escalate only on challenge detection) keeps costs proportional to actual site difficulty.

---

### When should I use which profile?

**Quick decision matrix:**

| Target characteristics | Start with | Escalate to |
|---|---|---|
| Known static HTML / RSS / sitemaps | `static` | `fast` if JS content needed |
| SPA (React, Vue, Next.js) without anti-bot | `fast` | `stealth` on 403 |
| Cloudflare IUAM JS challenge | `fast` | `stealth` |
| Cloudflare Turnstile non-interactive | `stealth` | `max` |
| Cloudflare Turnstile interactive | `max` | N/A |
| Akamai Bot Manager | `max` | N/A |
| DataDome | `http` + proxy | `max` |
| PerimeterX / Kasada | `max` | N/A |
| Public API with TLS fingerprint check | `http` | N/A |
| E-commerce product pages (no anti-bot) | `fast` | N/A |

Use `profile: "auto"` with `escalate: true` when scraping a heterogeneous URL list:

```typescript
const page = await Browser.newPage({
  profile: "auto",
  escalate: true,
  budget: { time: 60_000, money: 0.10 },
});
```

---

### How does Bunlight compare to Puppeteer?

| Feature | Bunlight | Puppeteer |
|---|---|---|
| Runtime | Bun (Zig-native) | Node.js |
| Browser engines | Lightpanda, Chromium, Camoufox | Chrome / Chromium only |
| Profile escalation | Built-in (5 profiles) | Manual |
| TLS fingerprint | curl-impersonate via `bun:ffi` | None (uses Chromium TLS) |
| Memory (simple scrape) | ~67-76 MB | ~200-300 MB |
| Cold start (SPA) | ~120 ms (Lightpanda) | ~800 ms (Chromium) |
| In-process DOM (no browser) | Yes (zigquery cdylib) | No |
| `bun:ffi` vendor binaries | Lightpanda, zigquery, curl-impersonate | N/A |
| Puppeteer API compat | `ConnectionTransport` compatible | Native |
| Anti-bot stack | patchright, camoufox, capsolver | puppeteer-extra (deprecated) |

Bunlight is not a drop-in replacement for all Puppeteer use cases. For sites that require the full Chrome DevTools Protocol surface, profile `stealth` uses patchright (Playwright-compat) which covers nearly all Puppeteer patterns.

---

### How does Bunlight compare to Crawlee?

| Feature | Bunlight | Crawlee |
|---|---|---|
| Runtime | Bun | Node.js |
| In-process DOM | zigquery (no browser spawn) | Cheerio (JSDOM optional) |
| Browser engine | Lightpanda (Zig, ~10x faster than Chrome) | Playwright / Puppeteer |
| RequestQueue backend | `bun:sqlite` (zero deps) | In-memory or Redis |
| Dataset storage | Append-only JSONL via `Bun.file().writer()` | Local files or Apify cloud |
| TLS fingerprint | curl-impersonate built-in | Third-party middleware |
| Concurrent pool | `AutoscaledPool` (memory-aware) | `AutoscaledPool` |
| Crawlee patterns | Implemented (49/49 tests pass) | Native |
| License | MIT (see AGPL note for static link) | Apache-2.0 |

Bunlight borrows Crawlee's concurrency and storage patterns (`RequestQueue`, `Dataset`, `KeyValueStore`, `AutoscaledPool`) but implements them on Bun-native APIs. See [CRAWLEE-PATTERNS.md](./CRAWLEE-PATTERNS.md) for the full compatibility matrix.

---

## Development

### How do I add a custom profile?

A profile is any object that implements the `Page` interface from `src/api/browser.ts`. Three steps:

1. **Create the profile file** at `src/profiles/custom/index.ts`:

```typescript
import type { Page } from "../../api/browser.ts";

export class CustomPage implements Page {
  async goto(url: string): Promise<void> { /* your transport */ }
  async content(): Promise<string> { /* return HTML */ }
  async title(): Promise<string> { /* return title */ }
  async close(): Promise<void> { /* cleanup */ }
  // implement remaining Page methods...

  async [Symbol.asyncDispose]() {
    await this.close();
  }
}
```

2. **Register it** in `src/api/browser.ts` inside `Browser.newPage()`:

```typescript
case "custom":
  return new CustomPage(options);
```

3. **Add a type overload** so TypeScript narrows the return type:

```typescript
export function newPage(opts: { profile: "custom" } & CustomOptions): Promise<CustomPage>;
```

The profile receives the same options object as the built-in profiles. Use `blockResources`, `proxy`, `cookieJar`, and `humanize` fields for consistency.

---

### How do I debug a failing scraper in production?

**Step 1 — enable console forwarding on profile `fast`:**

```typescript
const page = await Browser.newPage({ profile: "fast" });

page.on("console", (msg) => {
  console.log(`[browser:${msg.type()}]`, msg.text());
});

page.on("pageerror", (err) => {
  console.error("[browser:pageerror]", err.message);
});

await page.goto("https://failing-site.com");
```

**Step 2 — open CDP DevTools** when using profile `stealth` or `max`:

```bash
# Launch with remote-debugging enabled
BUNLIGHT_DEVTOOLS=1 bun run your-scraper.ts
# Then open chrome://inspect in a browser
```

**Step 3 — snapshot the response at each escalation step:**

```typescript
const page = await Browser.newPage({ profile: "fast" });
await page.goto(url);
const html = await page.content();
await Bun.write("/tmp/debug-fast.html", html);
// Inspect the file to see what Lightpanda received
```

**Step 4 — use the `bunlight-debugger` agent** (Claude Code):

```
Ask Claude Code: "Debug my Bunlight scraper at src/scrapers/my-scraper.ts"
```

---

### What TLS fingerprint does Bunlight impersonate by default?

Profile `http` defaults to `chrome131` (JA4: `t13d1516h2_8daaf6152771_02713d6af862`).

Override per-request or per-client:

```typescript
// Per-client
const client = new ImpersonatedClient({ profile: "firefox135" });

// Per-request override
const res = await client.fetch(url, { profile: "safari18_0" });
```

The 34 supported profiles are listed in [CURL-IMPERSONATE.md](./CURL-IMPERSONATE.md). Common anti-bot use cases:

- **Cloudflare IUAM** — `chrome131` or `chrome136` (most common real-world fingerprint)
- **Akamai Bot Manager** — pair `http` profile with `tls-client` for H2 frame ordering
- **Safari mobile detection** — `safari18_0_ios` or `safari26_0_ios`

---

### Is storage persistent between runs?

Yes, for all queue and storage types backed by `bun:sqlite` or JSONL files.

| Storage type | Backend | Persistence |
|---|---|---|
| `RequestQueue` | `bun:sqlite` | Yes — survives process restart |
| `Dataset` | Append-only JSONL (`Bun.file().writer()`) | Yes |
| `KeyValueStore` (< 64 KB values) | `bun:sqlite` | Yes |
| `KeyValueStore` (>= 64 KB values) | Binary blob files | Yes |
| Page cookies (`cookieJar`) | JSON file | Yes — if path is set |

To resume a crawl after a crash:

```typescript
const queue = await RequestQueue.open("my-crawl"); // opens existing DB if present
// Requests in PENDING or LOCKED state are automatically retried
```

Lock timeout (for LOCKED requests stuck after a crash) defaults to 5 minutes and is configurable:

```typescript
const queue = await RequestQueue.open("my-crawl", { lockTimeoutMs: 60_000 });
```

---

### What is the memory budget and how do I configure it?

By default, `AutoscaledPool` limits memory to 50% of total system RAM. On a 4 GB machine, this means the pool will throttle when RSS exceeds 2 GB.

Override with `maxMemoryMB`:

```typescript
const pool = new AutoscaledPool({
  maxConcurrency: 10,
  maxMemoryMB: 1024, // hard cap at 1 GB regardless of system RAM
  minConcurrency: 1,
  runTaskFunction: async (task) => { /* ... */ },
});
```

Per-profile memory baselines (measured, Linux x64):

| Profile | Idle RSS | Per-page overhead |
|---|---|---|
| `static` | 67 MB | ~0 MB (in-process) |
| `fast` | 67 MB | ~70-80 MB per Lightpanda process |
| `stealth` | ~100 MB | ~150-200 MB per Chromium process |
| `max` | ~120 MB | ~250-350 MB per Camoufox process |

Set `maxConcurrency` accordingly. For profile `fast` on a 4 GB machine: 4000 MB budget / 80 MB per page = ~50 max pages, but leave headroom for OS and data: `maxConcurrency: 30` is a safe default.

---

## Production and licensing

### What is the license?

Bunlight itself is **MIT**. However, it links `liblightpanda_dom.so` statically at compile time. Lightpanda is **AGPL-3.0**, which means any distributed binary that includes the Lightpanda code must also be AGPL-3.0 (or a compatible license with source disclosure).

Practical implications:

- **Internal use / private deployment** — no disclosure required under AGPL.
- **Distributing a compiled binary to third parties** — must provide source or comply with AGPL.
- **SaaS / API service** — AGPL's network use clause applies; check with your legal team.

See [LICENSING.md](./LICENSING.md) for the full breakdown.

---

### Is Bunlight production-ready?

Current status: **alpha 0.1.0**.

Profile readiness:

| Profile | Status | Notes |
|---|---|---|
| `fast` (Lightpanda) | Production-grade for SPAs | 150+ tests, 5 real SPA sites validated |
| `http` (curl-impersonate) | Production-grade | 13/13 tests, JA4 validated |
| `static` (zigquery) | Production-grade for SSR/HTML | 9/9 tests |
| `stealth` (patchright) | Validation in progress | 14 pass + 2 skip (Chromium not installed in CI) |
| `max` (Camoufox) | Validation in progress | 12 pass + 2 skip (Firefox not installed in CI) |

The `RequestQueue`, `Dataset`, `KeyValueStore`, and `AutoscaledPool` APIs have 49/49 Crawlee-pattern tests passing and are stable for production crawls.

API surface may change before 1.0. Pin to an exact version in `package.json`:

```json
{
  "dependencies": {
    "@bunmium/bunlight": "0.1.0-alpha.0"
  }
}
```

---

### How do I update the Lightpanda binary?

**Automatic (recommended):**

Re-run the postinstall hook whenever you update the package:

```bash
bun install        # runs postinstall automatically
# or manually:
bun scripts/postinstall.ts
```

**Manual download:**

```bash
# Check the current version
vendor/lightpanda/lightpanda --version

# Download a specific release from the Lightpanda GitHub releases page
curl -L https://github.com/lightpanda-io/browser/releases/download/vX.Y.Z/lightpanda-linux-x64 \
  -o vendor/lightpanda/lightpanda
chmod +x vendor/lightpanda/lightpanda
```

**Pin a specific version** by setting the version in `scripts/postinstall.ts`:

```typescript
const LIGHTPANDA_VERSION = "v0.4.1"; // pin here
```

---

### How do I bypass Cloudflare Turnstile?

Profile `max` with CapSolver handles Turnstile (both non-interactive and interactive) at approximately 85-90% success rate.

```typescript
const page = await Browser.newPage({
  profile: "max",
  captcha: {
    provider: "capsolver",
    token: process.env.CAPSOLVER_TOKEN,
  },
  proxy: { rotation: "per-session", pool: process.env.PROXY_POOL },
});
await page.goto("https://site-with-turnstile.com");
```

Detailed setup guide: [docs/CLOUDFLARE.md](./CLOUDFLARE.md) (includes sitekey extraction, proxy requirements, and session reuse patterns).

CapSolver pricing: ~$0.8 per 1000 Turnstile solves. Budget accordingly.

If `CAPSOLVER_TOKEN` is not set, the solver runs in mock mode (always returns a fake token). Tests pass in mock mode; real challenges will fail. Set the token in `.env` or your CI secrets.

---

### How do I solve other captcha types?

`captcha/capsolver.ts` supports three challenge types:

| Challenge | CapSolver task type | Profile required |
|---|---|---|
| Cloudflare Turnstile | `AntiTurnstileTaskProxyLess` | `max` |
| reCAPTCHA v2/v3 | `ReCaptchaV2Task` / `ReCaptchaV3Task` | `stealth` or `max` |
| hCaptcha | `HCaptchaTask` | `stealth` or `max` |

```typescript
import { CapSolverClient } from "bunlight/captcha/capsolver";

const solver = new CapSolverClient({ apiKey: process.env.CAPSOLVER_TOKEN! });

// Solve a Turnstile programmatically
const token = await solver.solveTurnstile({
  websiteURL: "https://example.com",
  websiteKey: "0x4AAA...",
});
```

All solvers fall back to mock mode if `apiKey` is absent, so tests run offline without cost.
