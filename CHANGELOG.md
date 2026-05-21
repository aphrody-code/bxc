# Changelog

All notable changes to Bxc will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Removed

- Module `depot_tools` (`src/depot_tools/`, `python-bridge/depot_manager.py`, sous-module `vendor/depot_tools`) — depot_tools extrait en installation standalone hors du paquet

## [0.1.0-alpha.1] - 2026-05-12

### Added

- Trinity Architecture: integration native Rust (`rust-bridge`) et Python (`python-bridge`) via FFI
- Spécialisation Google: détection avancée, DNS, rate-limiting et stratégies spécifiques pour l'écosystème Google
- Support des sous-modules `depot_tools` pour la gestion des dépendances Chromium

## [0.2.0] - 2026-05-10

### Added — Phase 1 (CDP coverage)

- CDP dispatcher refactor: monolithic switch (~395 LOC) split into 16 modular domain handlers under `src/cdp/domains/` (Page, Target, Browser, DOM, Runtime, Network, Emulation, Security, Accessibility, Input, Fetch, IO, Tracing, Audits, Performance, Log) — chain-of-responsibility via `DomainHandler` interface in `src/cdp/types.ts`
- CDP coverage extended from 25 working / 17 stubs to **76 working methods** across all 15 agent-browser domains (97 RPC matrix in `docs/CDP-COVERAGE.md`)
- Target domain complete: `createBrowserContext`, `getTargets`, `detachFromTarget` + `detachedFromTarget` event (10/10 methods)
- Browser domain complete: `getWindowForTarget`, `grantPermissions`, `setDownloadBehavior`, `setContentsSize` + download events (6/6 methods)
- Runtime domain complete: `addBinding` + `consoleAPICalled` / `exceptionThrown` event helpers (6/6 methods)
- Tracing domain new: `Tracing.start` / `Tracing.end` + `dataCollected` (8 synthetic TEF events) + `tracingComplete` event (2/2 methods)
- Network domain complete: in-memory cookie jar (RFC 6265 matching), response body cache, extra headers injection. Events `requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed` emitted during `Page.navigate` (8/8 methods + 4 events)
- Fetch domain new: request interception via URL pattern, `fulfillRequest` (mock response), `failRequest` (abort), `continueRequest` (resume), `continueWithAuth` (credentials) + `requestPaused` event (6/6 methods)
- IO domain new: `IO.read` returns base64 chunks (65536 bytes default), `IO.close` releases buffer + `registerIOStream()` helper (2/2 methods)
- Page CDP coverage: `addScriptToEvaluateOnNewDocument`, `getLayoutMetrics`, `captureScreenshot`, `printToPDF`, `setDocumentContent`, `startScreencast` / `stopScreencast`, `handleJavaScriptDialog`, `bringToFront` + `domContentEventFired` / `loadEventFired` / `frameNavigated` / `javascriptDialogOpening` events
- DOM CDP coverage: `getBoxModel`, `resolveNode`, `setFileInputFiles` and Accessibility `enable` / `getFullAXTree` (with LRU 64-entry cache, hit <0.5 ms p50, invalidated on `Page.navigate` / `reload` / `setDocumentContent`)
- Input domain new: `dispatchKeyEvent`, `dispatchMouseEvent`, `dispatchTouchEvent`, `insertText`
- Emulation extended: `setUserAgentOverride`, `setEmulatedMedia`, `setGeolocationOverride`, `setLocaleOverride`, `setTimezoneOverride`

### Added — Phase 1.5 (profile wiring)

- All 5 profiles wired in `src/cli/serve.ts` and bootable via `bxc serve --profile {static,fast,http,stealth,max}`
- Profile `http` exposed in CLI (was unwired); profiles `stealth` and `max` no longer exit with "not implemented in CLI mode"
- `test/profile-wiring.test.ts` — 5/5 boot smoke tests pass

### Added — Phase 2 (performance)

- Cold start measured with `scripts/measure-coldstart.ts` (5-10 runs, p50/p95 table, exit 1 on miss)
- Static profile cold start: **p50 = 25.4 ms** (target <50 ms), Fast profile cold start: **p50 = 35.4 ms** (target <80 ms) — both pass
- Lazy imports of `StaticDomTransport` and `HttpProfileTransport` in `serve.ts` (FFI libs not dlopen'd until first WS connection)
- `Bun.serve` port bound *before* Lightpanda spawn in `startFast` (early `/json/version` synthesis)
- Lightpanda + SocketPair waitForReady poll interval reduced from 50 ms to 10 ms
- `WeakRef<ZigDoc>` + `FinalizationRegistry` in `StaticDomTransport.ParsedDocument` — native DOM memory reclaimable by GC
- `Bun.gc(false)` hint added after `Page.navigate` completes in `StaticDomHandler`
- RSS reduction: 67-76 MB peak to ~39 MB idle (47% reduction). Bun runtime floor ~37 MB makes 30 MB target impossible without runtime patch
- Accessibility AX cache LRU (max 64 entries) keyed by `sessionId|loaderId` — cache hit <0.5 ms p50
- Engine comparison benchmark `benchmarks/agent-browser-engine.bench.ts`: bxc is **19-54% faster than Chrome** on cold start, snapshot p50 = 187 ms vs Chrome 1565 ms (8.4x faster)
- 0 regressions: 545 pass / 4 skip / 4 fail (pre-existing)

### Added — Phase 3 (E2E)

- E2E tests against production sites (`test/e2e/agent-browser-stealth.e2e.test.ts`): gemini.google.com, workspace.google.com (Next.js prod custom CDN), challonge.com (anti-bot + cookies persistants)
- Bxc skill for agent-browser usage (`.claude/skill-data/bxc/SKILL.md`)
- Auto-escalation pipeline `src/profiles/auto-escalation.ts` (static -> fast -> stealth -> max)

### Added — Phase 4 (distribution)

- **Multi-platform standalone executables**: `scripts/build-standalone.ts` produces 4 binaries (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`) via `bun build --compile --target=bun-<platform>`
- `BXC_TARGETS=linux-x64,darwin-arm64` env flag for subset builds; `BXC_HOST_ONLY=1` for host arch only
- Output table `target | ok | sizeMB | error` rendered after build; exit 0 if at least one target succeeds, exit 1 if all fail
- CI release matrix `.github/workflows/release.yml`: 4 native runners (ubuntu-latest x2 for linux x64/arm64, macos-latest x2 for darwin x64/arm64); upload-artifact + softprops/action-gh-release on `v*` tags; npm publish job on tagged stable releases
- Note on local builds: only the host target builds reliably on a single VPS; cross-compile darwin/arm64 from linux-x64 may fail at link time (FFI libs are runtime-resolved, but Bun's compile target depends on host capabilities). **Multi-platform builds are produced via the CI matrix** — local builds default to host arch via `BXC_HOST_ONLY=1`.
- `linux-x64` standalone size: ~96 MB ; cold start ~50 ms ; CDP `/json/version` smoke test pass

---

## [0.1.0-alpha.0] - 2026-05-10

### Added (Vague 4 — improvements)

- Bun-native migration: 12 source files migrated from `node:*` to `Bun.file` / `Bun.write` / `Bun.spawn` / `Bun.$` / `Bun.gunzipSync` / `Bun.Cookie` — 140/140 tests pass after migration
- Plugin Claude Code marketplace-ready 0.2.0: 8 agents, 8 slash commands, 1 skill, 10 references, 4 hooks, 1 MCP server (`bxc-mcp`)
- Plugin best-practices fixes: frontmatter `model` + `color`, `argument-hint` on all commands, Style B examples, Claude-instructions tone — 14 fixes total
- MCP server `bxc-mcp` (Bun-native TypeScript) exposing `bxc_scrape`, `bxc_detect`, `bxc_extract_cookies`, `bxc_pool_run`
- `plugin.json` marketplace metadata (semver 0.2.0, SPDX MIT, `.claude-plugin/README.md`)

### Added (Vague 3 — integrations)

- `agent-browser` engine `bxc` in Rust (983 LOC, `cli/src/native/cdp/bxc.rs`), 30 unit tests + 5 integration tests pass; branch `feat/bxc-engine` PR-ready against vercel-labs/agent-browser
- CLI `bxc serve --cdp-port N --profile P` (684 LOC, `src/cli/serve.ts`)
- Wappalyzergo framework detector (`src/detect.ts`): 3000+ technologies via Go binary, 20/20 tests pass; auto-routing via `src/router/{challenge-detect,framework-strategy}.ts`
- 20 modern network CLIs installed system-wide: xh, hurl, oha, k6, httpx, trippy, doggo, jaq, dasel, aria2, gron, bombardier, vegeta, gping, bandwhich, dust, procs, sd, wrk (documented in `MODERN-NET-CLI.md`)
- Cookie injection multi-format (`src/cookies/`): Playwright JSON / CDP / Netscape to CDP `Network.setCookies` + http profile Cookie header; 12/12 challonge.com auth tests pass
- Crawlee patterns (`src/{pool,queue,storage}/`, `src/utils/{sitemap,robots}.ts`): RequestQueue (`bun:sqlite` state machine PENDING/LOCKED/DONE/FAILED with dead-letter queue), AutoScaledPool, ProxyPool, SessionPool, Dataset (append-only JSONL via `Bun.file().writer()`), KeyValueStore (dual-backend: sqlite < 64 KiB / blob > 64 KiB), Sitemap XML parser, robots.txt RFC 9309 — 49/49 tests pass
- Plugin Claude AI onboarding: 4 initial agents (`bxc-scraper`, `bxc-crawler`, `bxc-debugger`, `bxc-cookie-extractor`), 4 slash commands (`/init`, `/scrape`, `/crawl`, `/detect`), 1 skill with 8 references, 8 reference docs
- Google Developers research report on agent/skill best practices (707 LOC, `docs/AGENTS-SKILLS-BEST-PRACTICES.md`, 35 curated sources)
- Brotli decompression fix using `node:zlib.brotliDecompressSync` (Bun does not expose brotli decompress natively)

### Added (Vague 2 — finalisation)

- Fork Bun build validation: codegen confirmed (`ResolvedSourceTag.zig` contains `@"bun:browser" = 512`), commit `a0bf70d` in `forks/bun/`
- Profile `http` (curl-impersonate): 13/13 tests pass, JA4 fingerprint Chrome 131 validated against tls.peet.ws; 34 supported TLS profiles documented in `docs/CURL-IMPERSONATE.md`
- Profile `stealth` + `max` audit: 26 tests pass + 4 skip (Chromium/Firefox not installed); skip with logged reason
- Benchmarks complete: 6 runners (bxc-static, bxc-fast, fetch-native, cheerio, jsdom, puppeteer), 4 scenarios (static-simple, spa-react, cloudflare-basic, parallel-100), results in `benchmarks/results/2026-05-10.{json,md}`
- zigquery wire + pool + interception: 9/9 tests pass

### Added (Vague 1 — initial)

- Profile `fast` (Lightpanda CDP sub-process, `src/transport/SocketPairTransport.ts`): 8 tests pass, goto latency 64-707 ms on 5 SPAs (HackerNews, react.dev, nuxt.com, nextjs.org, svelte.dev)
- Fork Bun architecture (`forks/bun/`): patches to `HardcodedModule.zig` + `ModuleLoader.zig` exposing `bun:browser` builtin; `src/js/bun/browser.ts` (28 KB); codegen valid
- curl-impersonate FFI binding (`src/ffi/curl-impersonate.ts`, 782 LOC): `bun:ffi` binding to `libcurl-impersonate-chrome.so.4.8.0` (2.5 MB, lexiforest v1.5.6, 34 profiles)
- Stealth stack (`src/profiles/stealth/`, `src/profiles/max/`, 1700 LOC): patchright integration, Camoufox v135 Firefox fork, browserforge fingerprint generation, CapSolver Turnstile/reCAPTCHA/hCaptcha solver (mock when `CAPSOLVER_API_KEY` absent)
- Benchmarks scaffolding: `benchmarks/targets/urls-100.json` (100 URLs categorised: static, SPA, Cloudflare, Turnstile, ecommerce)

### Architecture

- 5 profiles: `static` (zigquery in-process), `fast` (Lightpanda CDP), `http` (curl-impersonate FFI), `stealth` (patchright Chromium), `max` (Camoufox v135 + CapSolver)
- cdylib zigquery 1.7 MB (`vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so`, 20 C ABI symbols)
- curl-impersonate 2.5 MB (`vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0`)
- 14 328 LOC TypeScript (src + test + benchmarks)
- 150+ tests pass, 0 fail, ~6 conditional skips
- Bun-native throughout: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.$`, `Bun.Cookie`, `Bun.Glob`, `bun:sqlite`, `bun:ffi`, `bun:test`

### Tested production targets

- HackerNews, react.dev, nuxt.com, nextjs.org, svelte.dev (SPA classics)
- gemini.google.com, workspace.google.com (Next.js prod, custom CDN)
- design.google, developers.google.com (static)
- challonge.com/fr/B_TS5 (anti-bot + persistent cookies)
- nowsecure.nl, tls.peet.ws (JA4 fingerprint validation)
- www.cloudflare.com (CF basic)

---

[Unreleased]: https://github.com/aphrody-code/bxc/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.2.0
[0.1.0-alpha.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.1.0-alpha.0
