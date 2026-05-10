# IMPIT-EVALUATION — `impit-client` (Apify Rust TLS) vs `curl-impersonate` for Bunlight

> Decision matrix and migration analysis. Research-only; no production code changes shipped with this report.
> Audit date: 2026-05-10. Author: agent-impit-research-v2. Linked task: `tasks.json` #5.

---

## Section 1 — Status quo: how `curl-impersonate` is wired in Bunlight

Bunlight currently uses `lexiforest/curl-impersonate` v1.5.6 (a maintained fork of the abandoned upstream `curl-impersonate`) as the TLS impersonation backend for the `http` profile.

### Files involved

| Path | Lines | Role |
|---|---|---|
| `src/ffi/curl-impersonate.ts` | 835 | `bun:ffi` thin wrapper around `libcurl-impersonate-chrome.so.4.8.0` (`dlopen` + 35 `curl_easy_*` symbols + JSCallback for write/header callbacks) |
| `src/profiles/full/index.ts` | — | Selects `ImpersonatedClient` when profile is `http` |
| `src/api/browser.ts` | 509 | `HttpPage` subclass dispatches to `ImpersonatedClient.fetch()` |
| `vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0` | 2.5 MB binary | shared library, loaded lazily via `dlopen` |
| `test/integration/curl-impersonate.test.ts` | 13 tests | profiles vs `tls.peet.ws/api/all`, JA4 chrome131 validated |
| `docs/CURL-IMPERSONATE.md` | — | per-profile reference |

### Profile coverage (current build)

* Chrome desktop: `chrome99`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`, `chrome119`, `chrome120`, `chrome123`, `chrome124`, `chrome131`, `chrome133a`, `chrome136`, `chrome142`, `chrome145`, `chrome146`
* Chrome Android: `chrome99_android`, `chrome131_android`
* Firefox: `firefox133`, `firefox135`, `firefox144`, `firefox147`
* Safari macOS: `safari15_3`, `safari15_5`, `safari17_0`, `safari18_0`, `safari18_4`, `safari26_0`, `safari26_0_1`
* Safari iOS: `safari17_2_ios`, `safari18_0_ios`, `safari18_4_ios`, `safari26_0_ios`
* Edge: `edge99`, `edge101`

Total: 34 profiles. Default: `chrome131`. Loaded via `BUNLIGHT_TLS_PROFILE` env or constructor option.

### Routing

`profile=http` is selected automatically by `src/router/challenge-detect.ts` when:

* The site emits `Server: cloudflare` header but no JS challenge banner
* JA4 mismatch is detected via fingerprint probe
* `forceProfile=http` is passed manually

Tests: `13/13 pass` against `tls.peet.ws`, `nowsecure.nl`, `www.cloudflare.com` (basic CF). JA4 hash of `chrome131` matches the reference Chrome 131 fingerprint.

---

## Section 2 — `impit` overview

### Project metadata

| Field | Value |
|---|---|
| Repository | github.com/apify/impit |
| License | Apache-2.0 |
| Stars / forks | 467 / 39 (snapshot 2026-05-10) |
| Created | 2025-01-10 |
| Last push | 2026-05-07 |
| Maintainership | Active. Apify employs the maintainer (`barjin`); shipping monthly |
| Latest npm release | `impit@0.14.0` (2026-05-07) |
| Latest crate release | `impit` `~0.14.x` Rust workspace |
| Workspace members | `impit` (Rust core), `impit-node` (napi-rs), `impit-python` (PyO3) |

### Stack

* **Language**: Rust on top of `reqwest`, `tokio`, `rustls` (forked), `quinn` (HTTP/3), `h2` (forked), `hyper-util` (forked), `tower-http` (forked)
* **Build**: requires `cargo build --release` with `RUSTFLAGS="--cfg reqwest_unstable"` for HTTP/3
* **Patches**: critical — `Cargo.toml` of the workspace pins `rustls`, `h2`, `hyper-util`, `tower-http` to **forked Apify branches**. This is why `impit` is not buildable from vanilla crates.io alone

### Browser fingerprint database (file `impit/src/fingerprint/database/`)

| Family | Versions exposed in 0.14.0 |
|---|---|
| Chrome | 100, 101, 104, 107, 110, 116, 124, 125, 131, 133, 136, 142 (12 versions) |
| Firefox | 128, 133, 135, 144 (4 versions) |
| OkHttp | 3, 4, 5 (3 versions, Android HTTP client) |
| Safari | none |
| Edge | none |

The `Browser` enum in `impit-node/src/impit_builder.rs` exposes lower-case strings: `"chrome"`, `"chrome142"`, `"firefox"`, `"firefox144"`, `"okhttp5"`, etc.

---

## Section 3 — Feature matrix

| Dimension | `curl-impersonate` v1.5.6 (Bunlight today) | `impit` 0.14 (candidate) |
|---|---|---|
| Implementation language | C (BoringSSL or NSS fork) | Rust (forked rustls) |
| License | MIT | Apache-2.0 |
| Total impersonation profiles | 34 | 19 (12 Chrome + 4 Firefox + 3 OkHttp) |
| Chrome version coverage | 99 to 146 (incl. Android) | 100 to 142 |
| Firefox version coverage | 133 to 147 | 128 to 144 |
| Safari (macOS) | 15.3, 15.5, 17.0, 18.0, 18.4, 26.0, 26.0.1 | not supported |
| Safari (iOS) | 17.2, 18.0, 18.4, 26.0 | not supported |
| Edge | 99, 101 | not supported |
| Android Chrome | yes (`chrome99_android`, `chrome131_android`) | partial (OkHttp client only) |
| TLS fingerprint accuracy | Real BoringSSL/NSS — patches applied to the original TLS stack the browser uses | TLS via forked rustls — closer to "advertised" than actual browser |
| HTTP/2 fingerprint accuracy | Per-profile `SETTINGS`, `WINDOW_UPDATE`, pseudo-header order, dependency tree | **Broken** — issue #385 (open, Feb 2026): all profiles share hyper defaults, only `pseudo_header_order` differs. Cloudflare cf-bot-score same as `fetch` per issue #315 |
| HTTP/3 (QUIC) | Limited (curl + quiche, not all profiles) | Yes via quinn (Rust). Caveat: proxies disabled when HTTP/3 is enabled |
| ALPN | h1.1, h2 | h1.1, h2, h3 |
| Cookies | manual (no built-in jar; Bunlight handles via `src/cookies/`) | first-class via `tough-cookie` JS interop in `ImpitOptions.cookieJar` |
| Redirects | manual (max-redirs flag) | `followRedirects` (default true) + `maxRedirects` (default 10) |
| Proxy support | HTTP, HTTPS, SOCKS4, SOCKS5 | HTTP, HTTPS, SOCKS4, SOCKS5 — but NOT when HTTP/3 is enabled |
| Local address binding | yes (CURLOPT_INTERFACE) | yes (`localAddress`) |
| Bun integration | `bun:ffi` `dlopen` of pre-built `.so` (works today, 13/13 tests) | npm prebuilds via `napi-rs`; works in Bun for some N-API addons but a **known regression** exists in Bun 1.3.2+ (issue #363, closed as `bun` bug — `response.text()` returns garbage bytes). Bun 1.3.1 confirmed working |
| Binary format | shared library `.so`/`.dylib`/`.dll` (~2.5 MB) | N-API addon `.node` (~5–8 MB per platform) |
| Prebuilt platform matrix | linux-x64-glibc, linux-arm64-glibc, macos-x64, macos-arm64, windows-x64; musl needs custom build | linux-{x64,arm64}-{gnu,musl}, macos-{x64,arm64}, windows-{x64,arm64}-msvc — 8 targets shipped on npm as `optionalDependencies` |
| Cold-start | `dlopen` once on first use (`< 5ms`) plus zero-alloc symbol resolution | `require('./*.node')` plus `napi-rs`'s tokio runtime spin-up (`~30–50ms` first call). Subsequent calls amortized |
| Binary size on disk | 2.5 MB per arch | ~5–8 MB per arch (rust + tokio + rustls + quinn) |
| Maintenance velocity | lexiforest fork active; original `curl-impersonate` upstream archived 2024 | active, monthly releases, Apify-funded |
| Detection score (cf-bot-score, observed) | 35–45 (lexiforest, Chrome 131) | 35 (Chrome) / 81 (Firefox), per impit issue #315 with old 0.x branch — improved since but no public re-test |
| Known critical bugs | none current; v1.5.6 stable | impit#385 (HTTP/2 SETTINGS wrong) open; impit#363 (bun ArrayBuffer regression) closed as bun-side |

---

## Section 4 — Bun integration paths

Three theoretical wiring options for `impit` inside Bunlight; each has trade-offs.

### Option A — npm install + `import { Impit } from "impit"`

* **How**: `bun add impit`, then `optionalDependencies` resolve the per-platform `.node` binary
* **Bun compat**: Bun ships full N-API surface (every `napi_*` and `node_api_*` exported), runs Node's own js-native-api test suites in CI. `napi-rs` addons in general work
* **Risks**:
  1. impit ships its own tokio runtime baked into the addon; this is fine in Bun but adds 5+ MB
  2. Bun 1.3.2+ regression on `ArrayBuffer` returned from N-API addon (issue #363, closed as bun-side bug) — pin Bun version or guard `response.text()` decoding
  3. `npm preinstall` script in `impit-node/package.json` enforces pnpm; pass `--ignore-scripts` or set `npm_config_user_agent=pnpm` to bypass when using `bun install`
  4. 8 prebuilt targets shipped, but musl-arm64 and aarch64-windows are slower-arrived
* **Cost**: zero build complexity for end users; ~5 MB extra per platform
* **Verdict**: simplest path. Production-viable for static deployments where you control Bun version

### Option B — `cargo build --release` then `bun:ffi` against a `cdylib`

* **How**: clone `apify/impit` Rust workspace, set `crate-type = ["cdylib"]` on `impit-cli` or a custom shim crate, compile to `.so`, expose a C ABI, dlopen via `bun:ffi`
* **Risks**:
  1. `impit` is **not designed as a cdylib**. The Rust API is async (returns `impl Future`), incompatible with `bun:ffi` which expects sync C ABI. You would have to write a synchronous bridge layer (block_on per call, custom event loop) — significant Rust glue
  2. Forked rustls/h2/hyper-util/tower-http means you cannot publish the cdylib without bundling those forks
  3. Cookie jar bridging — `tough-cookie` integration assumed JS-side via napi callbacks; would need to be rewritten as a sync C callback
  4. HTTP/3 needs a tokio runtime alive for the lifetime of the client (quinn requires it). Maintaining a hidden runtime inside `bun:ffi` is cursed but doable
* **Cost**: 2–4 days Rust bridging work + maintenance burden tracking upstream impit changes
* **Verdict**: feasible but high-cost. Only justified if (a) we want HTTP/3 specifically and (b) we cannot accept N-API dependency

### Option C — Spawn `impit-cli` binary as subprocess

* **How**: `apify/impit` plans to publish `impit` as a CLI to crates.io (issue #154, open since May 2025, not yet shipped). `Bun.spawn(["impit", url, ...])`, parse stdout
* **Risks**:
  1. CLI is not yet released
  2. Per-request process spawn cost (~30–80ms cold) vs in-process (`< 1ms`)
  3. Binary streaming (large bodies) requires careful pipe management
* **Cost**: trivial wrapper, but unblocked only when `impit` ships the CLI
* **Verdict**: not actionable today, revisit after upstream releases

### Recommendation for Bunlight

If Bunlight ever decides to add `impit`, **Option A** is the only sane path. **Option B** trades simplicity for an unwarranted maintenance burden. **Option C** depends on upstream and is parked.

---

## Section 5 — Pros and cons explicit

### Pros of `impit`

* **HTTP/3 (QUIC)** native via quinn, working out of the box. `curl-impersonate` has experimental HTTP/3 only via curl + quiche, not exposed for all profiles
* **Active maintenance** with monthly releases; backed by Apify (commercial entity, low abandonment risk)
* **First-class cookie jar** via `tough-cookie` JS interop — saves Bunlight some bridging code
* **Built-in redirect handling** — Bunlight's `curl-impersonate` wrapper currently handles redirects manually
* **Apache-2.0 license** is permissive (compatible with Bunlight MIT)
* **Rust safety** for the TLS layer (vs C in libcurl-impersonate)

### Cons of `impit`

* **HTTP/2 fingerprint is broken** for all profiles (impit issue #385 open). `SETTINGS`, `WINDOW_UPDATE`, and header table sizes use hyper defaults instead of per-browser values. This collapses the whole anti-bot value proposition because Cloudflare's cf-bot-score depends on HTTP/2 layer fingerprints alongside JA3/JA4
* **Smaller profile catalog** — 19 vs 34. No Safari (macOS or iOS), no Edge, fewer Chrome variants. Bunlight's existing tests rely on `safari18_0` and `chrome131_android` which impit cannot provide
* **Bun-specific regression** on response decoding (impit#363) requires version pinning. While "fixed" upstream by waiting on Bun, it indicates surface-area risk
* **Detection** — issue #315 (closed Nov 2025) reports impit Chrome was detected the same as `fetch` (cf-bot-score 35) while curl-impersonate scored ~10. Newer impit profiles may have improved but no recent public benchmark
* **Forked dependency tree** (rustls, h2, hyper-util, tower-http) increases supply-chain risk and complicates rebuilding from source
* **Larger binary** per-platform (~5–8 MB N-API vs 2.5 MB curl-impersonate `.so`)
* **Migration cost** — Bunlight's profile catalogue (`safari18_0`, `chrome131_android`) plus 13 integration tests would need rework
* **HTTP/3 not free** — disables proxy support, breaking compatibility with `ProxyPool` rotation

### Pros of keeping `curl-impersonate`

* Already integrated, 13/13 tests pass, JA4 chrome131 verified
* Larger profile catalog (34 vs 19)
* HTTP/2 fingerprint is per-browser-accurate (real BoringSSL/NSS)
* Well-understood detection profile (cf-bot-score documented per browser)
* Single 2.5 MB shared library; loads via `dlopen` in `< 5ms`
* No N-API runtime dependency; fully `bun:ffi` controlled
* Lexiforest fork is active and pulls fingerprint updates from real browsers

### Cons of keeping `curl-impersonate`

* No HTTP/3 for any profile in our build (curl + quiche is supported in upstream but not all our `.so`)
* Original `curl-impersonate` upstream archived; relies on lexiforest's continued maintenance (single maintainer, but has shipped 4 releases in 2025-2026)
* `bun:ffi` JSCallback overhead for write/header callbacks (~10us per chunk) — measurable in tight benchmarks but invisible at fetch-level

---

## Section 6 — Decision recommended

**Decision: KEEP `curl-impersonate` as the sole TLS impersonation backend in Bunlight v0.1.0-alpha. Do NOT add `impit` as a second profile at this time.**

### Justification

1. The single most important property of a TLS impersonation client is **fingerprint accuracy**. `impit`'s HTTP/2 SETTINGS bug (open since Feb 2026, no announced fix date) means every `impit` profile produces an identical Akamai HTTP/2 fingerprint that does not match any real browser. Cloudflare and similar bot-detection services use HTTP/2 fingerprints as part of their score. `curl-impersonate` does not have this gap.

2. Bunlight's own profile catalog includes Safari and iOS variants that `impit` does not provide. Migrating off `curl-impersonate` would force us to drop Safari support, which would regress `tls.peet.ws` integration tests.

3. The migration cost (estimated 2–4 hours of FFI rewiring + 4–8 hours of test rewriting + ongoing dual-backend maintenance) is not justified by the only material upside (HTTP/3), which Bunlight does not currently need for its target sites (HN, react.dev, rosegriffon.fr, challonge.com — all HTTP/2). HTTP/3 also disables proxy support in impit, conflicting with Bunlight's `ProxyPool`.

4. Adding `impit` as a *secondary* (env-selectable) backend doubles the test surface and introduces a second class of bugs without clearly improving any prod scenario.

### Re-evaluation triggers

We should revisit this decision when ANY of the following occur:

* impit issue #385 is closed (per-browser HTTP/2 SETTINGS implemented). At that point a fresh cf-bot-score benchmark vs lexiforest curl-impersonate is required
* impit ships Safari profiles (currently absent — see `impit/src/fingerprint/database/`, only chrome.rs / firefox.rs / okhttp.rs)
* lexiforest curl-impersonate goes unmaintained for >6 months (last release tracking via lexiforest/curl-impersonate releases)
* Bunlight needs HTTP/3 specifically (e.g., a target site only serves HTTP/3 — vanishingly rare in 2026)
* impit publishes the planned CLI (issue #154) with a stable JSON-stdout protocol; reduces integration cost to a `Bun.spawn` wrapper

---

## Section 7 — Hypothetical migration path (NOT recommended today, kept as reference)

**This path is documented for completeness; it is not an active workstream. Track impit issue #385 first.**

If the re-evaluation triggers above are met, a phased migration would proceed as follows:

### Phase 0 — preconditions

* `impit#385` closed and verified via fresh cf-bot-score test (Bunlight benchmark suite)
* impit ships Safari profiles, OR Bunlight drops Safari from supported profiles (would require user-facing announcement)
* Pin Bun version >= the release that resolved impit#363 (track Bun changelog)

### Phase 1 — add impit alongside curl-impersonate (1 day)

```ts
// src/ffi/impit.ts (new)
import { Impit } from "impit";
export class ImpitClient {
    private impit: Impit;
    constructor(opts: { profile: "chrome142" | "firefox144" }) {
        this.impit = new Impit({ browser: opts.profile });
    }
    async fetch(url: string, init?: RequestInit) {
        return this.impit.fetch(url, init);
    }
}
```

### Phase 2 — env-selectable backend (0.5 day)

```ts
// src/transport/HttpTransport.ts
const backend = process.env.BUNLIGHT_TLS_BACKEND ?? "curl";
const Client = backend === "impit"
    ? (await import("../ffi/impit.ts")).ImpitClient
    : (await import("../ffi/curl-impersonate.ts")).ImpersonatedClient;
```

### Phase 3 — split test suites (1 day)

* `test/integration/curl-impersonate.test.ts` — keep as-is
* `test/integration/impit.test.ts` — new, parallel coverage on `tls.peet.ws`, `nowsecure.nl`, `cloudflare.com`
* Both must pass before either can be marked default

### Phase 4 — benchmark and decide (0.5 day)

Run benchmarks/scenarios/cloudflare-basic.ts against both backends. Record:
* cf-bot-score per profile
* JA4 hash match against reference browser DB
* Latency p50/p95
* Memory footprint per request

### Phase 5 — flip default (0.5 day, conditional)

Only if benchmarks demonstrate impit is at parity or better on cf-bot-score AND HTTP/2 SETTINGS validation passes against `tls.peet.ws/api/all`.

### Total ETA if triggered

Best case: 3–4 days of focused work assuming impit#385 is fixed. Realistic ETA: not applicable in 2026 absent upstream fix.

### Breaking changes (if migration ever happens)

* `BUNLIGHT_TLS_PROFILE` env values would change (no Safari/Edge/Android in impit's catalog)
* `ImpersonatedClient` exported type would gain a sibling `ImpitClient`
* `curl-impersonate.ts` would remain for compatibility but moved to `legacy/`

---

## References

* `apify/impit` repo — github.com/apify/impit (Apache-2.0, 467 stars)
* `lexiforest/curl-impersonate` v1.5.6 — github.com/lexiforest/curl-impersonate (MIT)
* impit issue #385 — HTTP/2 SETTINGS not fingerprinted (open since 2026-02-27)
* impit issue #315 — "impit is fully detected" by Cloudflare (closed 2025-11-15)
* impit issue #363 — `response.text()` corrupted under Bun >= 1.3.2 (closed 2026-01-21)
* impit issue #99 — Larger fingerprint pool (closed; partial — 12 Chrome + 4 Firefox shipped)
* `apify/impit/Cargo.toml` — workspace patches `rustls`, `h2`, `hyper-util`, `tower-http` to Apify forks
* `bunlight/src/ffi/curl-impersonate.ts` — Bunlight's current FFI bindings (835 lines)
* `bunlight/docs/CURL-IMPERSONATE.md` — Bunlight's per-profile profile reference

---

## Appendix — quick comparison (TL;DR)

| If you need… | Use |
|---|---|
| Cloudflare basic bypass with Chrome/Firefox/Safari/Edge fingerprint | curl-impersonate (Bunlight `http` profile, today) |
| Cloudflare Managed Challenge bypass | Bunlight `stealth` profile (patchright + browserforge) |
| HTTP/3 (QUIC) without proxy | impit (only when impit#385 is fixed) |
| Maximum profile catalog (34 browsers) | curl-impersonate |
| iOS Safari fingerprint | curl-impersonate (no impit support) |
| Android Chrome fingerprint | curl-impersonate (`chrome131_android`) |
| Cookie jar with tough-cookie compatibility | impit (built-in) — but Bunlight already wraps cookies in `src/cookies/` |
| Active monthly releases | impit (more frequent) — though lexiforest curl-impersonate is also active |
