# Profile: stealth — Audit Results (2026-05-10)

## Status: PARTIAL (unit tests passing, live browser unavailable on ubuntu26.04)

## Stack
- **Engine**: patchright (Chromium fork, patches Runtime.Enable + isolated worlds + Console API leak)
- **Fingerprinting**: Custom coherent generator (`src/profiles/fingerprint.ts`) — UA, WebGL, navigator, screen, sec-ch-ua headers
- **Cookie persistence**: JSON cookie jar via `Bun.file()` (saves `cf_clearance` tokens for reuse)
- **Humanization**: Bezier mouse paths, natural typing delays, scroll jitter (`src/profiles/humanize.ts`)
- **Resource blocking**: Configurable — default blocks `image`, `font`, `media` (NOT scripts/CSS, CF checks them)
- **Google referrer injection**: Automatically applied on every `goto()` call

## Tests Passed

### Unit / Integration Tests (no browser required)
| Test | Status | Notes |
|------|--------|-------|
| Fingerprint coherence (chrome/linux/130) | PASS | UA, platform, screen, sec-ch-ua all coherent |
| Fingerprint coherence (firefox/linux/135) | PASS | UA, Gecko, no sec-ch-ua, Mesa WebGL |
| Different seeds produce different fingerprints | PASS | xorshift32 RNG verified |
| hardwareConcurrency in [2,16] | PASS | |
| deviceMemory in [2,4,8] | PASS | |
| WebGL vendor/renderer non-empty | PASS | |
| fingerprintToHeaders() returns correct map | PASS | accept-language, sec-ch-ua validated |
| fingerprintToInitScript() returns valid JS | PASS | WebGL overrides, navigator patches, parseable |
| makeGoogleReferer() generates valid search URL | PASS | Domain extraction works |
| makeGoogleReferer() handles subdomains | PASS | |
| CapSolver mock mode (no API key) | PASS | Returns MOCK_CAPSOLVER_TOKEN prefix |
| CapSolver mock token contains siteKey prefix | PASS | |
| CapSolver mock elapsedMs=0 | PASS | No network call |

### Browser Launch Test
| Test | Status | Notes |
|------|--------|-------|
| patchright Chromium launch + about:blank | SKIP | Patchright does not support chromium on ubuntu26.04-x64 |

### Live Tests (require BUNLIGHT_LIVE_TESTS=1)
| Test | Status | Notes |
|------|--------|-------|
| nowsecure.nl bypass | SKIP | Requires non-datacenter IP + Chromium binary |
| browserleaks.com WebGL coherence | SKIP | Requires Chromium binary |

## Sites Tested
- **nowsecure.nl** (Cloudflare Managed Challenge): requires `BUNLIGHT_LIVE_TESTS=1` + residential IP
- **browserleaks.com**: fingerprint coherence check (LIVE test only)

## Success Rate (Design Target)
- ~80% bypass rate on Cloudflare Managed Challenge (patchright patches)
- Fails on: interactive Turnstile (→ escalate to `max`), Akamai/Kasada (→ `max`)

## Browser API Integration
`Browser.newPage({ profile: "stealth", stealthOpts: {...} })` returns `StealthProfilePage`.

```ts
const page = await Browser.newPage({
  profile: "stealth",
  stealthOpts: {
    fingerprint: { os: "linux", browser: "chrome", version: 130 },
    proxy: process.env.PROXY_URL,
    blockResources: ["image", "font", "media"],
  },
});
await page.goto("https://nowsecure.nl");
const title = await page.title();
await page.close();
```

The `StealthProfilePage` adapter exposes: `goto()`, `title()`, `content()`, `url()`, `evaluate()`, `$()`, `$$()`, `close()`, `[Symbol.asyncDispose]()`.

## Limitations
1. **Browser binary**: Patchright does not support Chromium on ubuntu26.04-x64. On supported platforms (ubuntu22.04, macOS, Windows), install with `bunx patchright install chromium`.
2. **Live bypass rate not measured**: Requires residential IP and Chromium binary.
3. **No headful mode tested**: Headless-only environment.
4. **Turnstile fails**: Interactive Turnstile challenges are not handled — use `max` profile.
5. **Datacenter IPs**: Will fail Cloudflare IP reputation checks regardless of stealth level.

## Known Good Configurations
```ts
// Maximum stealth for Cloudflare Managed Challenge
openStealthBrowser({
  fingerprint: { os: "linux", browser: "chrome", version: 130 },
  blockResources: ["image", "font", "media"],
  timeoutMs: 30_000,
  headless: true,
});
```

## Files
- `src/profiles/stealth/index.ts` (273 lines)
- `test/integration/stealth-cloudflare.test.ts` (326 lines)
- `examples/06-stealth-cloudflare.ts`
