# Bunlight Troubleshooting Guide

Reference: [FAQ](./FAQ.md) | [Profiles](./PROFILES.md) | [curl-impersonate](./CURL-IMPERSONATE.md) | [Anti-bot stack](./ANTI-BOT-STACK.md)

---

## 1. Lightpanda binary not found

**Symptom**

```
Error: Lightpanda binary not found at vendor/lightpanda/lightpanda
Could not spawn Lightpanda process
```

**Causes and fixes**

The `postinstall` hook downloads the binary automatically on `bun install`. If it was skipped or the network was unavailable:

```bash
# Re-run the postinstall hook manually
bun scripts/postinstall.ts

# Check the vendor path
ls -lh vendor/lightpanda/lightpanda
```

If you store the binary in a custom location, set the environment variable before running:

```bash
LIGHTPANDA_BINARY=/opt/lightpanda/lightpanda bun run your-script.ts
```

The binary resolution order in `src/profiles/fast/`:

1. `LIGHTPANDA_BINARY` env var (absolute path)
2. `vendor/lightpanda/lightpanda` relative to the package root
3. `lightpanda` on `$PATH`

**Verify the binary is executable:**

```bash
chmod +x vendor/lightpanda/lightpanda
vendor/lightpanda/lightpanda --version
```

---

## 2. CDP connection timeout

**Symptom**

```
TimeoutError: CDP connection to ws://127.0.0.1:9222 timed out after 5000ms
Error: connect ECONNREFUSED 127.0.0.1:9222
```

**Causes and fixes**

**Port collision** — another process already listens on the default port:

```bash
# Check what holds the port
lsof -i :9222
# or
ss -tlnp | grep 9222

# Use a different port
bunlight serve --cdp-port 9333
```

**Firewall blocking loopback** — unusual but possible on hardened environments:

```bash
# Verify loopback is not firewalled
curl -v http://127.0.0.1:9222/json/version
```

**Lightpanda process not ready** — the boot race on slow machines. Increase the connect timeout:

```typescript
const page = await Browser.newPage({
  profile: "fast",
  connectTimeout: 10_000, // ms — default is 5000
});
```

**Multiple `bunlight serve` instances** — each must use a distinct `--cdp-port`:

```bash
bunlight serve --cdp-port 9222 --profile fast &
bunlight serve --cdp-port 9223 --profile fast &
```

---

## 3. Profile `static` fails on JS-rendered pages

**Symptom**

`page.content()` returns skeleton HTML without the rendered content. Selectors return `null` or empty arrays.

**Explanation**

Profile `static` uses zigquery in-process (no V8, no Lightpanda). It parses the raw HTML document exactly as the server sends it. Single-page applications (React, Vue, Next.js, Nuxt) require JavaScript execution to populate the DOM.

**Fix: escalate to `fast` or `stealth`**

```typescript
// Instead of:
const page = await Browser.newPage({ profile: "static" });

// Use:
const page = await Browser.newPage({ profile: "fast" });
// or let the router decide:
const page = await Browser.newPage({ profile: "auto", escalate: true });
```

**Use `detectFromPage` to confirm JS requirement before escalating:**

```typescript
import { suggestStrategy } from "bunlight/router/framework-strategy";

const html = await fetch(url).then(r => r.text());
const strategy = await suggestStrategy(html, url);
// strategy.profile === "fast" | "stealth" | "max" | "static"
const page = await Browser.newPage({ profile: strategy.profile });
```

**Profile choice by page type:**

| Page type | Recommended profile |
|---|---|
| Static HTML / SSR / RSS | `static` |
| React / Vue / Next.js SPA | `fast` |
| Cloudflare IUAM JS challenge | `stealth` |
| Cloudflare Turnstile interactive | `max` |

---

## 4. FFI loading error (zigquery)

**Symptom**

```
Error: dlopen failed: vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so: cannot open shared object file
FFIError: symbol not found: bl_init
```

**Causes and fixes**

The shared library is not present or was not compiled. Check first:

```bash
ls -lh vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so
```

If the file is missing, rebuild the Zig cdylib:

```bash
cd vendor/zigquery-wrapper
zig build -Doptimize=ReleaseSafe
# output: zig-out/lib/liblightpanda_dom.so (1.7 MB expected)
```

To point at a custom path without rebuilding:

```bash
BUNLIGHT_LIGHTPANDA_DOM_LIB=/absolute/path/to/liblightpanda_dom.so bun run your-script.ts
```

**Architecture mismatch** — the `.so` is built for Linux x86_64. If you are on a different architecture:

```bash
file vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so
# Must show: ELF 64-bit LSB shared object, x86-64
```

**Missing glibc symbols** — ensure glibc >= 2.31:

```bash
ldd --version
ldd vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so
```

---

## 5. Cookie injection silently ignored

**Symptom**

Cookies are loaded without error but the target site still shows an unauthenticated session. Requests do not carry the expected `Cookie` header.

**Causes and fixes**

**Format mismatch** — `cookie-loader.ts` auto-detects three formats: Playwright/CDP JSON, DevTools raw JSON, and Netscape `cookies.txt`. If the file is malformed the loader silently returns an empty array.

Validate the file manually:

```typescript
import { loadCookieJar } from "bunlight/cookies/cookie-loader";

const cookies = await loadCookieJar("./cookies/my-site.json");
console.log(`Loaded ${cookies.length} cookies`);
// If 0, the format is not recognized or all cookies are expired
```

**Expired cookies** — the loader filters cookies whose `expires` timestamp is in the past. Re-export fresh cookies from your browser.

**Domain mismatch** — cookies injected for `example.com` are not sent to `sub.example.com` unless the domain field starts with `.`:

```json
{ "domain": ".example.com", "name": "session", "value": "abc123", "path": "/" }
```

**Wrong profile** — the `http` (curl-impersonate) profile injects cookies via the `Cookie` header, not CDP `Network.setCookies`. If you injected CDP cookies and then switched to profile `http`, the cookies are not carried over. Use `cookieJar` option consistently:

```typescript
const page = await Browser.newPage({
  profile: "http",
  httpOpts: { cookies: rawCookieHeaderString },
});
```

**Netscape format tip** — the tab-separated format must have exactly 7 columns. Lines starting with `#` are comments:

```
# Netscape HTTP Cookie File
.example.com	TRUE	/	FALSE	1893456000	session_id	abc123
```

---

## 6. curl-impersonate JA4 fingerprint mismatch

**Symptom**

`tls.peet.ws` or `browserleaks.com` reports a JA4 hash that does not match the expected browser value. Cloudflare or Akamai still blocks requests despite using the `http` profile.

**Root cause: outdated profile name**

The profile names changed between curl-impersonate versions. Bunlight ships **lexiforest v1.5.6**. Old names from earlier forks are not valid:

| Old (invalid) | New (v1.5.6 valid) |
|---|---|
| `safari18` | `safari18_0` |
| `chrome133` | `chrome133a` |
| `firefox91esr` | Not available in v1.5.6 |

Full profile list: [CURL-IMPERSONATE.md](./CURL-IMPERSONATE.md).

**Verify the active fingerprint:**

```typescript
import { ImpersonatedClient } from "bunlight/ffi/curl-impersonate";

const client = new ImpersonatedClient({ profile: "chrome131" });
const data = await client.fetchJSON<{ tls: { ja4: string } }>(
  "https://tls.peet.ws/api/all"
);
console.log(data.tls.ja4);
// Expected: t13d1516h2_8daaf6152771_02713d6af862
client.close();
```

**Expected JA4 values per profile:**

| Profile | Expected JA4 |
|---|---|
| `chrome131` | `t13d1516h2_8daaf6152771_02713d6af862` |
| `firefox135` | `t13d1717h2_5b57614c22b0_3cbfd9057e0d` |
| `safari18_0` | `t13d2014h2_a09f3c656075_7f0f34a4126d` |

**Library path issue** — if `LIBCURL_IMPERSONATE_PATH` points to an older `.so`, the profile enum may not include new entries. Verify the library version:

```bash
ls -lh vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0
```

---

## 7. Camoufox launch fails

**Symptom**

```
Error: Failed to launch Camoufox: binary not found at vendor/camoufox/camoufox
SpawnError: vendor/camoufox/camoufox: no such file or directory
```

**Causes and fixes**

Camoufox v135 binaries are large (~30 files, ~400 MB total) and are not bundled in the npm package. They must be installed separately:

```bash
# Install via the managed downloader
bunx camoufox fetch --browser-version 135

# Or copy an existing Camoufox installation
# Set the binary path via env var
CAMOUFOX_BINARY=/opt/camoufox/camoufox bun run your-script.ts
```

**Binary resolution order:**

1. `CAMOUFOX_BINARY` env var
2. `vendor/camoufox/camoufox`
3. `camoufox` on `$PATH`

**Check the binary architecture:**

```bash
file vendor/camoufox/camoufox
# Expected: ELF 64-bit LSB executable, x86-64
```

**Missing shared libraries** — Camoufox requires `libxul` and NSS. On a minimal server environment:

```bash
ldd vendor/camoufox/camoufox | grep "not found"
# Install missing libs, e.g. on Ubuntu:
apt-get install libgtk-3-0 libdbus-glib-1-2 libxt6
```

Profile `stealth` and `max` tests skip cleanly when the binary is absent. If you want to run those tests, install the browser first.

---

## 8. High memory usage

**Symptom**

RSS grows beyond expected values during a crawl. Process OOMs on long runs. `AutoscaledPool` or `PagePool` shows degraded throughput.

**Causes and fixes**

**`maxConcurrency` too high** — each Lightpanda sub-process takes ~70-80 MB RSS. Running 20 concurrent pages requires ~1.6 GB:

```typescript
import { AutoscaledPool } from "bunlight/pool/PagePool";

const pool = new AutoscaledPool({
  maxConcurrency: 5,       // tune based on available RAM
  maxMemoryMB: 2048,       // pool will throttle when RSS exceeds this
  runTaskFunction: async (task) => { /* ... */ },
});
```

**Page handles not closed** — always use `await using` or explicit `page.close()`:

```typescript
// Correct — page.close() called at block exit
await using page = await Browser.newPage({ profile: "fast" });
await page.goto(url);
const data = await page.content();
// page auto-closed here

// Wrong — page handle leaks if an exception is thrown mid-block
const page = await Browser.newPage({ profile: "fast" });
await page.goto(url);
// ... if this throws, page is never closed
await page.close(); // never reached
```

**Heavy target pages** — news sites and e-commerce pages with large JS bundles inflate Lightpanda's V8 heap. Use `blockResources` to drop assets you don't need:

```typescript
const page = await Browser.newPage({
  profile: "fast",
  blockResources: ["image", "font", "media", "stylesheet"],
});
```

**StaticDomTransport is not concurrent-safe** — do not share a `static` profile page across parallel tasks. Each parallel worker needs its own page instance.

---

## 9. Test timeouts

**Symptom**

```
error: Test "..." timed out after 5000ms
```

**Fixes**

**Increase the per-test timeout** in your test file:

```typescript
import { test, expect } from "bun:test";

test("slow integration test", async () => {
  // ...
}, { timeout: 30_000 }); // 30 seconds
```

Or globally in `buntest` config (`package.json`):

```json
{
  "buntest": {
    "timeout": 30000
  }
}
```

**Skip network-dependent tests when offline** — follow the pattern used throughout Bunlight's test suite:

```typescript
import { test, expect } from "bun:test";

function logSkip(reason: string) {
  console.log(`[SKIP] ${reason}`);
}

const NETWORK_AVAILABLE = await fetch("https://example.com", {
  method: "HEAD",
  signal: AbortSignal.timeout(3000),
}).then(() => true).catch(() => false);

test.skipIf(!NETWORK_AVAILABLE)("integration test", async () => {
  // ...
});

if (!NETWORK_AVAILABLE) logSkip("Network unavailable — skipping integration tests");
```

**Skip binary-dependent tests when vendor binaries are absent:**

```typescript
import { existsSync } from "node:fs"; // intentional — Bun.file().exists() is async, test guard is sync

const LIGHTPANDA_PRESENT = existsSync("vendor/lightpanda/lightpanda");

test.skipIf(!LIGHTPANDA_PRESENT)("fast profile test", async () => {
  // ...
});

if (!LIGHTPANDA_PRESENT) logSkip("Lightpanda binary missing — run bun scripts/postinstall.ts");
```

---

## 10. Lightpanda crash on heavy pages

**Symptom**

```
Error: Lightpanda process exited with code 1 (signal: SIGSEGV)
BrowserDisconnectedError: Target closed
```

**Causes and fixes**

Lightpanda's V8 integration is partial. Certain JS patterns (complex async chains, WebWorkers, WebRTC, complex CSS animations) can trigger panics on heavy production pages.

**Fallback to `fast` profile with resource blocking:**

```typescript
const page = await Browser.newPage({
  profile: "fast",
  blockResources: ["image", "font", "media", "script"],
  // Blocks all JS — useful if you only need HTML structure
});
```

**Escalate to `stealth` (Chromium) for full V8 compatibility:**

```typescript
const page = await Browser.newPage({ profile: "stealth" });
// Full Chromium V8 — no V8 limitations
```

**Use patchright as a drop-in:**

```typescript
import { Browser } from "bunlight/browser";

const page = await Browser.newPage({
  profile: "stealth",
  patchrightOptions: { headless: true },
});
```

**Identify the crash pattern** by enabling verbose Lightpanda logging:

```bash
LIGHTPANDA_LOG=debug bun run your-script.ts 2>&1 | grep -E "panic|error|crash"
```

If Lightpanda crashes reproducibly on a specific page, report the URL and the stack trace in the Bunlight issue tracker. Workaround in the meantime: fall back to profile `stealth` or `max` for that domain.
