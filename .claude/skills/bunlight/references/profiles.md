---
description: Decision tree for choosing Bunlight profiles. Covers static, fast, http, stealth, and max with latency, capability, and use-case comparisons.
---

# Bunlight Profiles

Choose the right profile based on your target site and requirements.

## Overview

| Profile | JS | TLS FP | Browser patches | Latency | Bypass rate | Notes |
|---------|----|----|---|---|---|
| `static` | No | No | No | 2 ms | 0% | In-process, no spawn |
| `fast` | Yes | No | No | 150 ms | 0% | Lightpanda, cold start ok |
| `http` | No | Yes | No | 20 ms | ~30% | TLS fingerprint only |
| `stealth` | Yes | No | Yes | 800 ms | 60-80% | patchright patches |
| `max` | Yes | No | Yes | 1500 ms | 90-95% | Camoufox + CapSolver |

## Decision tree

Start at the top and follow the branches:

```
Does the target have JavaScript?
│
├─ NO: Is it behind Cloudflare / Akamai / WAF?
│   │
│   ├─ NO → use profile: "static"  (fastest: 2 ms)
│   │
│   └─ YES: Can you get pre-auth cookies from a real browser?
│       │
│       ├─ YES → use profile: "http" with cookies
│       │        (TLS fingerprinting, no spawn needed)
│       │
│       └─ NO → use profile: "static" and hope for the best
│                (or try stealth if JS is secretly required)
│
└─ YES: Is it behind Cloudflare / Akamai / WAF?
    │
    ├─ NO → use profile: "fast"  (150 ms, includes JS)
    │
    └─ YES: Do you have CapSolver token for Turnstile?
        │
        ├─ YES → use profile: "max"  (Camoufox, 90-95% success)
        │
        └─ NO: Try profile: "stealth" first
               (patchright, 60-80% success)
               If fails, escalate to "max"
```

## Profile details

### Profile: static

**Transport**: StaticDomTransport (in-process, no spawn)

**Capabilities**:
- DOM parsing (Lightpanda)
- CSS selectors (`$`, `$$`)
- HTML content extraction
- Screenshot (DOM-based)

**Limitations**:
- No JavaScript execution
- No page.evaluate()
- No SPA rendering
- No dynamic content

**Latency**: ~2 ms per page.goto() call

**Use cases**:
- Static HTML sites (blogs, docs, repos)
- Content extraction without JS
- SEO crawling
- Sitemaps, RSS feeds

**Example**:
```ts
const page = await Browser.newPage({ profile: "static" });
await page.goto("https://example.com");
const title = await page.title();
// Fast, no spawn, works offline
```

### Profile: fast

**Transport**: SocketPairTransport (Lightpanda subprocess via stdin/stdout)

**Capabilities**:
- DOM parsing
- CSS selectors
- JavaScript execution via Lightpanda V8
- SPA rendering (React, Vue, Svelte, Angular)
- page.evaluate()
- page.$eval() / page.$$eval()

**Limitations**:
- No TLS fingerprinting (bot detection possible)
- No browser emulation patches (Cloudflare IUAM fails)
- Requires lightpanda binary on $PATH or LIGHTPANDA_BIN env

**Latency**: ~150 ms cold start, ~50-100 ms warm

**Use cases**:
- SPAs (React, Next.js, Vue, Svelte)
- JavaScript-heavy sites
- Generic crawling (no WAF)
- Testing web apps

**Example**:
```ts
const page = await Browser.newPage({ profile: "fast" });
await page.goto("https://react.dev");
const content = await page.evaluate(() => document.body.textContent);
```

### Profile: http

**Transport**: ImpersonatedClient (curl-impersonate, TLS fingerprinting)

**Capabilities**:
- TLS fingerprinting (Chrome 99-133, Firefox 144+)
- HTTP/2 frame fingerprinting
- Cookie-based auth
- Sub-20 ms latency

**Limitations**:
- No DOM rendering (raw HTML only)
- No JavaScript execution
- No screenshot
- No event handling

**Use cases**:
- Cloudflare basic (IP + cookie check)
- Akamai bot detection
- API requests with TLS fingerprinting
- Fast crawling with pre-auth cookies

**Example**:
```ts
import { loadCookieJar } from "@bunmium/bunlight/cookies";

const cookies = await loadCookieJar("./cookies/cloudflare.json");
const page = await Browser.newPage({
  profile: "http",
  cookies,
  httpOpts: { profile: "chrome131" }
});

// This fetches HTML with TLS fingerprints matching Chrome 131
await page.goto("https://cloudflare-protected.com");
const html = await page.content();
```

### Profile: stealth

**Transport**: patchright (Chromium fork with runtime patches)

**Capabilities**:
- JavaScript execution
- Browser emulation patches (Runtime.Enable, WebGL, Canvas)
- Coherent fingerprints (browserforge)
- Cloudflare IUAM bypass (~60-80%)

**Limitations**:
- Slower than fast/http (~800 ms)
- May still fail on DataDome + Turnstile
- Requires patchright npm package

**Latency**: ~800 ms cold start

**Use cases**:
- Cloudflare IUAM challenge
- Browser fingerprint detection
- Most bot-protected sites

**Example**:
```ts
const page = await Browser.newPage({
  profile: "stealth",
  stealthOpts: {
    fingerprint: {
      source: "browserforge",
      os: "linux",
      browser: "chrome",
      version: 131
    }
  }
});

await page.goto("https://cloudflare-protected.com");
```

### Profile: max

**Transport**: camoufox (Firefox fork with C++ stealth patches + CapSolver)

**Capabilities**:
- Maximum stealth (90-95% Cloudflare bypass)
- Turnstile captcha solving (CapSolver integration)
- Full JavaScript support
- Canvas fingerprinting evasion

**Limitations**:
- Slowest (~1500 ms)
- Requires CapSolver API key for Turnstile
- Higher cost per request

**Latency**: ~1500 ms cold start

**Use cases**:
- Maximum stealth requirement
- Turnstile captcha challenge
- DataDome + Cloudflare combo
- Final fallback when stealth fails

**Example**:
```ts
const page = await Browser.newPage({
  profile: "max",
  maxOpts: {
    capsolverApiKey: process.env.CAPSOLVER_TOKEN,
    proxy: {
      rotation: "per-session",
      pool: process.env.PROXY_POOL
    }
  }
});

await page.goto("https://extreme-protection.com");
```

## Choosing between stealth and max

| Aspect | stealth | max |
|--------|---------|-----|
| Success rate | 60-80% | 90-95% |
| Speed | 800 ms | 1500 ms |
| Cost | Free | $0.8 per 1k Turnstiles |
| When to use | Most sites | Last resort, Turnstile |

**Strategy**: Try `stealth` first. If it fails:
```ts
let profile = "stealth";

try {
  const page = await Browser.newPage({ profile });
  await page.goto(url);
  // success
} catch {
  console.log("Stealth failed, trying max...");
  const page = await Browser.newPage({ profile: "max" });
  await page.goto(url);
}
```

Or use auto-routing:
```ts
const page = await Browser.newPage({
  profile: "auto",      // starts at "fast"
  escalate: true        // escalate on challenge
});
```

## Performance comparison

Measured on a local mock server, single request:

| Profile | Latency | Peak RSS | Cold vs Warm |
|---------|---------|----------|---|
| static | 2 ms | 67 MB | N/A |
| fast | 150 ms | 76 MB | 150 ms / 50 ms |
| http | 20 ms | 68 MB | 20 ms / 15 ms |
| stealth | 800 ms | 85 MB | 800 ms / 400 ms |
| max | 1500 ms | 95 MB | 1500 ms / 800 ms |

For real-world URLs where network dominates (>20 ms), the profile overhead is negligible.

## When profiles fail

- **static on SPA**: Will return skeleton only, no rendered content. Switch to `fast`.
- **fast on Cloudflare**: Will see challenge page HTML. Switch to `stealth`.
- **stealth on Turnstile**: Will hang waiting for solve. Switch to `max`.
- **max on timeout**: Increase `maxOpts.timeoutMs` or add retry logic.

## See also

- `references/detect.md` — automated framework detection that feeds `suggestProfile`.
- `references/cookies.md` — pairing `http`/`stealth` profiles with pre-auth cookies.
- `references/troubleshooting.md` — error codes per profile.
- Agent `bunlight-scraper` — picks a profile and writes the scraper.
- Agent `bunlight-debugger` — escalates profiles when scrapes fail.
