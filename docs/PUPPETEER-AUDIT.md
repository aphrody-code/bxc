# Puppeteer Stack Audit — Patterns and Features for Bunlight

Date: 2026-05-10. Status: read-only audit. Output: feature shortlist + porting recommendations.

This document audits four upstream packages and identifies what is worth porting into `@aphrody-code/bunlight` (~/vps/packages/bunlight/) given the current 5-profile architecture (static / fast / http / stealth / max).

| Package | Version audited | License | Local source |
|---|---|---|---|
| puppeteer (puppeteer-core) | 24.43.0 | Apache-2.0 | ~/bunmium/references/puppeteer/packages/puppeteer-core |
| puppeteer-extra | 3.3.6 | MIT | ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra |
| puppeteer-extra-plugin-stealth | 2.11.2 | MIT | ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra-plugin-stealth |
| rebrowser-puppeteer-core | 23.10.3 | Apache-2.0 | ~/vps/node_modules/rebrowser-puppeteer-core |

License compatibility note: every package above ships under a permissive license (Apache-2.0 or MIT). Bunlight is 0BSD; Apache-2.0 and MIT are downstream-compatible (no copyleft, no GPL anywhere). The only obligation when porting code is to retain copyright notices in `THANKS.md` (already standard practice in bunmium). No legal blockers.

---

## 1. puppeteer 24.43

### 1.1 Architecture in one paragraph

`puppeteer-core` is the canonical Chrome DevTools Protocol client. It exposes a high-level abstract API (`Browser`, `BrowserContext`, `Page`, `Frame`, `ElementHandle`, `Locator`, `HTTPRequest`, `HTTPResponse`) under `src/api/`, and ships two concrete backends under `src/cdp/` (legacy CDP transport) and `src/bidi/` (WebDriver BiDi). The `Connection` multiplexes CDP messages, `CDPSession` represents a per-target attached session, and `FrameManager` tracks the frame tree and execution contexts. Every Page operation eventually maps to a CDP RPC call.

### 1.2 Patterns to study

- Abstract API + multiple transports (CDP and BiDi): the same `Page` interface backed by two completely different protocols. Bunlight already does the same with `static / fast / http / stealth / max` but only `static` and `fast` reach the CDP surface, the others bypass it.
- `EventEmitter` everywhere: every domain forwards events upward through typed emitters (`PageEvent.Request`, `PageEvent.Response`, `BrowserEvent.TargetCreated`, etc).
- `Locator` API (Page.ts:1133, Frame.ts:528, locators/locators.ts): retry-with-conditions abstraction that auto-waits for `visible / enabled / stable / inViewport`. RxJS-based pipeline. This is the modern replacement for `page.$(...).click()` and is missing in bunlight.
- `Realm` / `IsolatedWorld`: every page exposes a main-world realm and a utility-world realm with `puppeteerUtil` helpers injected into a private isolated world (UTILITY_WORLD_NAME). This is what the rebrowser patches preserve while avoiding `Runtime.enable`.
- Network interception priority queue (`HTTPRequest`): cooperative interception via `interceptResolutionPriority`, `continueRequestOverrides`, and `finalizeInterceptions`. Multiple interceptors can stack without conflicting.

### 1.3 Page features candidates for bunlight

| # | Feature | Source | Effort | Profile cible | Notes |
|---|---|---|---|---|---|
| P1 | Locator API (auto-wait for visible/enabled/stable/inViewport) | api/locators/locators.ts | L | all | Big productivity win. Scrapers rewrite less brittle code. Could be ported on top of existing CDP send. |
| P2 | `page.exposeFunction(name, fn)` (bidirectional binding via Runtime.addBinding) | cdp/Page.ts ~exposeFunction | M | fast/stealth/max | bunlight already implements `Runtime.addBinding` (CDP-COVERAGE.md L86). Wire JS-side promise registry. |
| P3 | `page.evaluateOnNewDocument` already wired but no public API surface in bunlight | cdp/Page.ts | S | static/fast | bunlight stealth uses it internally. Add to public Page surface. |
| P4 | `Coverage` (JS + CSS coverage) | cdp/Coverage.ts | M | fast | Useful for benchmarking and dead-code analysis. Lightpanda V8 supports `Profiler.startPreciseCoverage`. |
| P5 | `Tracing.start / stop` with categories | cdp/Tracing.ts | S | fast | Already partial in bunlight (CDP-COVERAGE.md `Tracing.start/end` Working). Wire public API. |
| P6 | `accessibility.snapshot()` | cdp/Accessibility.ts | M | static/fast | `Accessibility.getFullAXTree` currently Missing in bunlight. zigquery already has the DOM tree, only needs ARIA traversal. |
| P7 | `page.pdf({ format, printBackground, margin })` | cdp/Page.ts ~pdf | M | fast | Currently stub. Forward to Lightpanda CDP `Page.printToPDF`. |
| P8 | `page.screencastFrame` events with crop and scale | cdp/Page.ts ~screencast | M | fast | Currently stub. Useful for visual scrape recording / diffing. |
| P9 | `page.waitForFileChooser()` and `Input.fileChooser*` | cdp/Page.ts ~waitForFileChooser | M | fast/stealth | Required for any file-upload flow. |
| P10 | Worker support (`page.workers()`, Worker realm) | cdp/WebWorker.ts | L | fast/stealth | Many SPAs use service workers. bunlight currently treats them as out-of-scope. |
| P11 | `Cooperative` request interception (priority queue) | api/HTTPRequest.ts ~interceptResolutionPriority | M | static/fast | Allows stacking handlers (block-resources + cookie-injector + custom mock). |
| P12 | `page.setBypassCSP(enabled)` | cdp/Page.ts | S | fast/stealth | Currently stub. Critical for evaluating in CSP-locked sites. |
| P13 | `BluetoothEmulation` | api/BluetoothEmulation.ts | L | none | Skip. Niche. |
| P14 | `Extension` API (load Chrome extensions) | api/Extension.ts | L | stealth | Optional; could be wired in stealth/max profiles to load user-agent override extensions. |
| P15 | `page.emulateNetworkConditions({ offline, downloadThroughput, uploadThroughput, latency })` | cdp/Page.ts | S | static/fast | bunlight has `Network.emulateNetworkConditions` Working, but no actual throttle. |
| P16 | Selectors plugins (`p/`, `aria/`, `text/`, XPath) | injected/* | M | all | Modern selectors beyond CSS. ARIA in particular is a CF-friendly fingerprint. |

### 1.4 Recommendation for puppeteer features

Top 4 to port: **P1 Locator**, **P2 exposeFunction**, **P11 cooperative interception**, **P6 accessibility.snapshot**. The first three are needed before bunlight can market itself as a Puppeteer drop-in, and P6 is a low-cost win that closes a known CDP-COVERAGE gap.

---

## 2. puppeteer-extra 3.3.6

### 2.1 Architecture in one paragraph

`puppeteer-extra` is a thin wrapper around `puppeteer` that intercepts `launch()` and `connect()`, runs a plugin lifecycle hook chain, then forwards to vanilla puppeteer. It introduces a `PuppeteerExtraPlugin` base class with hooks: `beforeLaunch(options)`, `beforeConnect(options)`, `afterLaunch(browser)`, `afterConnect(browser)`, `onTargetCreated`, `onPageCreated(page)`, `onTargetDestroyed`, `onTargetChanged`, `onClose`, `onDisconnected`. Plugins declare `dependencies: Set<string>` and `requirements: Set<string>` so `puppeteer-extra` resolves them at launch time. Plugin data is shared via `getDataFromPlugins()`. The wrapper also patches `_createPageInContext` to navigate every fresh page to `about:blank` first, ensuring `evaluateOnNewDocument` runs before the first real navigation.

### 2.2 Patterns to study

- Plugin lifecycle hook chain (~/bunmium/references/puppeteer-extra/packages/puppeteer-extra/src/index.ts:67-280). Each plugin is registered via `puppeteer.use(plugin)`. Dependencies are auto-required on first launch.
- `_patchPageCreationMethods` (index.ts:261): wraps `browser._createPageInContext` so newly created pages always get a fresh `about:blank` navigation, so `addScriptToEvaluateOnNewDocument` reliably fires before user navigation. This is a non-obvious but critical fix.
- Plugin data sharing: the `data` getter on each plugin is collected into a flat array, with `name` filtering. This is how `user-agent-override` feeds preferred languages into `user-preferences`.
- Plugin requirements (`runLast`, `dataFromPlugins`, `headless`): metadata that drives ordering and feature gating.
- `addExtra(puppeteerLikePackage)`: lets you wrap any puppeteer-compatible package (rebrowser-puppeteer-core, puppeteer-firefox, even Playwright-extra). Bunlight could use the same pattern to wrap itself.

### 2.3 Features candidates for bunlight

| # | Feature | Source | Effort | Profile cible | Notes |
|---|---|---|---|---|---|
| E1 | Plugin lifecycle hook system | puppeteer-extra/src/index.ts:67-280 | M | all | Would let bunlight expose `Browser.use(plugin)`. Foundation for E2-E5. Aligns with bunlight's `auto-escalation.ts` pattern (already a per-page hook chain). |
| E2 | `block-resources` (block by resource type: image / stylesheet / font / media / xhr / etc) | puppeteer-extra-plugin-block-resources/index.js:112-152 | S | static/fast | bunlight already has `page.blockResources(families)` (api/browser.ts). Cooperative version stacks with cookie-injector. Mostly already done. |
| E3 | `anonymize-ua` (random User-Agent rotation per page) | puppeteer-extra-plugin-anonymize-ua | S | http/stealth | Plug into existing `httpOpts.profile` rotation. |
| E4 | `recaptcha` (auto-solve via 2captcha) | puppeteer-extra-plugin-recaptcha/src/index.ts | M | stealth/max | bunlight has CapSolver in `src/captcha/capsolver.ts`. Could expose the same plug-and-play hook. |
| E5 | `adblocker` (ghostery EasyList) | puppeteer-extra-plugin-adblocker | M | static/fast | Big win for scraper performance. Ghostery library is actively maintained, MIT, has Bun-compatible builds. |
| E6 | `repl` (interactive console attached to a Page) | puppeteer-extra-plugin-repl | S | dev only | Useful debugging utility. |
| E7 | `devtools` (open DevTools window automatically) | puppeteer-extra-plugin-devtools | S | dev only | Headful only; skip for now. |
| E8 | `proxy-router` (per-request proxy routing) | puppeteer-extra/packages/plugin-proxy-router | M | all | bunlight has ProxyPool round-robin/sticky in `src/pool/`. Per-request routing is a finer-grained variant. |
| E9 | `extract-stealth-evasions` (compile evasions to a single bundle) | puppeteer-extra/packages/extract-stealth-evasions | S | stealth | bunlight already does this manually in `ghost/stealth-patches.ts`. Worth automating if more evasions get added. |

### 2.4 Recommendation for puppeteer-extra

The plugin lifecycle (E1) is the foundational pattern; once it exists, every subsequent plugin (E2-E5) becomes trivial. bunlight already has *implicit* hooks (the `auto-escalation` flow, the cookie-injector, the stealth patches), but they are wired ad-hoc per profile rather than as a generic plugin chain. Formalizing this would mean a single `Browser.use(plugin)` API instead of N profile-specific wirings.

---

## 3. puppeteer-extra-plugin-stealth 2.11.2

### 3.1 Architecture

The stealth plugin is a thin meta-plugin: its job is just to require a configurable subset of "evasions" (one folder per evasion under `evasions/`). Each evasion is itself a `puppeteer-extra` plugin that hooks `onPageCreated(page)` and runs `page.evaluateOnNewDocument(fn, opts)`. A shared `_utils` module provides `replaceWithProxy`, `replaceGetterWithProxy`, `mockWithProxy`, `patchToString`, and `stripProxyFromErrors` — the latter is the reason the stealth Proxies do not show up in error stacks (a major detection vector).

### 3.2 Complete evasion catalog (17)

| # | Evasion | What it does | Code location | bunlight current | Port effort |
|---|---|---|---|---|---|
| S1 | chrome.app | Mock `window.chrome.app.{isInstalled,InstallState,RunningState,getDetails,getIsInstalled,runningState}` with errors that match Chrome's TypeError format | evasions/chrome.app/index.js | partial (chrome.runtime stub only) | S |
| S2 | chrome.csi | Mock `window.chrome.csi()` returning `{onloadT, startE, pageT, tran:15}` | evasions/chrome.csi/index.js | missing | S |
| S3 | chrome.loadTimes | Mock `window.chrome.loadTimes()` returning protocol info from `performance.timing` | evasions/chrome.loadTimes/index.js | partial (returns Date.now stub, lacks performance.timing data) | S |
| S4 | chrome.runtime | Mock `window.chrome.runtime.{id,connect,sendMessage,onConnect,...}` with valid TypeError signatures and 32-char extension ID validation | evasions/chrome.runtime/index.js | partial (PlatformOs/PlatformArch only, no connect/sendMessage) | M |
| S5 | defaultArgs | Strip `--disable-extensions`, `--disable-default-apps`, `--disable-component-extensions-with-background-pages` from launch args | evasions/defaultArgs/index.js | n/a (launch args controlled by patchright/Camoufox) | n/a |
| S6 | iframe.contentWindow | Patch `document.createElement('iframe')` so srcdoc-iframes have a `contentWindow.self === window.top` proxy | evasions/iframe.contentWindow/index.js | missing | M |
| S7 | media.codecs | Patch `HTMLMediaElement.prototype.canPlayType` to return `probably` for `video/mp4 codecs="avc1.42E01E"` and Chrome-specific responses | evasions/media.codecs/index.js | missing | S |
| S8 | navigator.hardwareConcurrency | Override `Navigator.prototype.hardwareConcurrency` with a Proxy getter | evasions/navigator.hardwareConcurrency/index.js | done (stealth-patches.ts L102) | done |
| S9 | navigator.languages | Override `Navigator.prototype.languages` with `['en-US','en']` | evasions/navigator.languages/index.js | done (stealth-patches.ts L99) | done |
| S10 | navigator.permissions | Patch `Permissions.prototype.query({name:'notifications'})` to return `prompt` on secure origins, `denied` on insecure | evasions/navigator.permissions/index.js | done (stealth-patches.ts L168) | done |
| S11 | navigator.plugins | Generate realistic 5-plugin array with cross-referenced MimeTypes, magicArray, functionMocks | evasions/navigator.plugins/index.js + plugins.js + mimeTypes.js + magicArray.js + functionMocks.js | done (stealth-patches.ts L77, simpler than upstream) | done; consider upgrade |
| S12 | navigator.vendor | Override `Navigator.prototype.vendor` with `'Google Inc.'` | evasions/navigator.vendor/index.js | missing | S |
| S13 | navigator.webdriver | Delete `navigator.webdriver` prototype property + add `--disable-blink-features=AutomationControlled` arg | evasions/navigator.webdriver/index.js | done (stealth-patches.ts L47) | done |
| S14 | sourceurl | Strip `//# sourceURL=__puppeteer_evaluation_script__` from every CDP `Runtime.evaluate` and `Runtime.callFunctionOn` (CDP send wrapper) | evasions/sourceurl/index.js | missing | S |
| S15 | user-agent-override | CDP `Network.setUserAgentOverride` with platform/userAgentMetadata.brands (ua-ch). Strips "Headless" suffix, replaces Linux paren with Windows. Also writes Accept-Language preference | evasions/user-agent-override/index.js | partial (no userAgentMetadata.brands ua-ch) | M |
| S16 | webgl.vendor | Patch `WebGLRenderingContext.prototype.getParameter` with proxy for params 37445/37446 | evasions/webgl.vendor/index.js | done (stealth-patches.ts L113) | done |
| S17 | window.outerdimensions | Set `window.outerWidth = innerWidth` and `outerHeight = innerHeight + 85` if missing | evasions/window.outerdimensions/index.js | missing | S |

### 3.3 Bunlight stealth gap analysis

The bunlight `ghost/stealth-patches.ts` already covers ~9 of the 17 stealth evasions. Critical gaps in priority order:

1. **chrome.runtime full mock (S4)**: bunlight only stubs PlatformOs/PlatformArch enums; the upstream version returns valid TypeErrors for `chrome.runtime.connect()` and `chrome.runtime.sendMessage()` which is checked by FingerprintJS, Cloudflare Turnstile, and DataDome. Effort M because of the 250-line error matrix.
2. **user-agent-override with ua-ch brands (S15)**: bunlight sets only `userAgent` via CDP. Without `userAgentMetadata.brands` aka `Sec-CH-UA`, modern Cloudflare detects mismatch between `User-Agent` and `Sec-CH-UA` headers. The upstream code is concise (~40 lines) and the brands generation algorithm is well-documented in chromium source.
3. **iframe.contentWindow (S6)**: required for sites that iframe their challenges (Cloudflare, hCaptcha, Turnstile). Without it `iframe.contentWindow.chrome === undefined` is a leaky signal.
4. **sourceurl strip (S14)**: only relevant if bunlight ever exposes `evaluate()` over CDP transport. Trivial to add to `InProcessTransport.send()`.
5. **navigator.vendor (S12)**: one-liner.
6. **chrome.csi + chrome.loadTimes refinement (S2/S3)**: rewrite the `loadTimes` shim to read from `performance.timing` rather than `Date.now()`.
7. **window.outerdimensions (S17)**: one-liner.
8. **media.codecs (S7)**: relevant only for sites that probe codec support (rare, mostly streaming sites).

### 3.4 Recommendation for stealth integration

Top 3 to port into `bunlight/src/profiles/ghost/stealth-patches.ts` ASAP:

- **chrome.runtime full mock (S4)**: high impact, M effort. Drops bunlight `stealth` profile from "good vs basic CF" to "good vs intermediate CF + DataDome".
- **user-agent-override with ua-ch (S15)**: high impact, M effort. Required for any modern site using Sec-CH-UA fingerprinting.
- **iframe.contentWindow (S6)**: medium impact, M effort. Required to bypass Turnstile iframe-context detection.

Lower priority but quick wins (all S effort, can be a single batch commit): chrome.csi, navigator.vendor, window.outerdimensions, sourceurl strip, media.codecs.

---

## 4. rebrowser-puppeteer-core 23.10.3

### 4.1 Architecture

`rebrowser-puppeteer-core` is `puppeteer-core` with a hot-patch applied by `rebrowser-patches`. It is NOT a fork: it tracks the upstream major.minor and reapplies a small set of patches in the published artifacts. Every patch site is annotated with a `// rebrowser-patches:` comment, making them easy to audit. The packages share the same `Browser`, `Page`, and event surface — drop-in compatibility.

### 4.2 The core problem rebrowser fixes

Mainline puppeteer calls `Runtime.enable` per session as part of `FrameManager.initialize()`. This causes Chromium to emit `Runtime.executionContextCreated` for every existing world, which is observable to in-page JS via the `chrome-extension://[*]/devtools_resources.pak` heuristic and via timing windows. Cloudflare's April 2025 update (ref: rebrowser blog post linked in README) checks for this leak by measuring whether a freshly-loaded JS execution context fires `Runtime.executionContextDestroyed` events under a CDP-attached debugger.

The rebrowser fix removes the `Runtime.enable` call entirely and instead acquires execution context IDs lazily via three alternative strategies (`REBROWSER_PATCHES_RUNTIME_FIX_MODE`):

1. `addBinding` (default): on first `evaluate()` for a frame, call `Runtime.addBinding({name: <random>})`, then either dispatch a CustomEvent in an isolated world (for main world) or fall through `Page.createIsolatedWorld` (for utility world). Listen for `Runtime.bindingCalled` to recover the contextId. (ExecutionContext.js:346-405)
2. `alwaysIsolated`: only ever use isolated worlds, never main world. Web workers unsupported. (ExecutionContext.js:459)
3. `enableDisable`: send `Runtime.enable` then `Runtime.disable` immediately, capturing context IDs in the gap. Less stealthy fallback. (ExecutionContext.js:469-496)

### 4.3 All rebrowser patch sites (audited via grep)

| File | Line(s) | What changed |
|---|---|---|
| cdp/ExecutionContext.js | 100-103 | Keep `frameId` from `contextPayload.auxData.frameId` for later context acquisition |
| cdp/ExecutionContext.js | 106-115 | Skip default `Runtime.executionContextDestroyed` and `Runtime.executionContextsCleared` listeners unless `RUNTIME_FIX_MODE === '0'` |
| cdp/ExecutionContext.js | 339-345 | Add `clear(newId)` method as alternative to dispose, so context can be recreated lazily |
| cdp/ExecutionContext.js | 346-405 | New `__re__getMainWorld()` method using random binding name + isolated-world dispatch |
| cdp/ExecutionContext.js | 407-415 | New `__re__getIsolatedWorld()` method |
| cdp/ExecutionContext.js | 416-506 | New `acquireContextId(tryCount)` with three fix-mode strategies |
| cdp/ExecutionContext.js | 507-513 | `#evaluate` checks if `id < 0` and triggers acquisition |
| cdp/FrameManager.js | 152-159 | Skip default `Runtime.executionContextCreated` handler if fix mode active |
| cdp/FrameManager.js | 181-189 | Skip `Runtime.enable` in `initialize()`, only call `createIsolatedWorld` |
| cdp/FrameManager.js | 200-219 | Manually create main-world `ExecutionContext` with id=-1 (sentinel) and frameId from auxData |
| cdp/FrameManager.js | 388-394 | Do not fully dispose contexts (recreate on demand) |
| cdp/FrameManager.js | 433-435 | Save created context id |
| cdp/Browser.js | 185 | Expose `browser._cdpSession` (was internal) |
| cdp/WebWorker.js | 28-50 | Same `Runtime.enable` skip + manual context creation for workers |
| cdp/IsolatedWorld.js | 79, 128 | Wait for and acquire context id before any operation |
| common/util.js | 265 | Change utility world name from `__puppeteer_utility_world__` to a less identifiable string |
| common/util.js | 276 | Strip `puppeteer_evaluation_script` from sourceURL |

### 4.4 Relevance to bunlight

bunlight's `static` profile speaks CDP to its own InProcessTransport. The `Runtime.enable` leak does not apply: bunlight controls the CDP server side and can emit (or not emit) `Runtime.executionContextCreated` at will. The key insight is that bunlight's CDP server should NOT emit `executionContextCreated` events automatically when `Runtime.enable` is called from the client side, since that is the leaky behavior. Bunlight already has a stub `Runtime.enable` (CDP-COVERAGE.md:81) that "Emits executionContextCreated for main+utility worlds" — this is exactly the leaky behavior, and could optionally be gated behind a `stealthMode` flag.

For the `fast` and `stealth` profiles (Lightpanda subprocess + CDP WebSocket), bunlight is at the mercy of Lightpanda's CDP server. If Lightpanda emits `Runtime.executionContextCreated` on its own (Chromium-style), bunlight's puppeteer client could leak the same way. Mitigations:

- Detect the Lightpanda CDP server version and skip `Runtime.enable` if rebrowser-style lazy acquisition is supported.
- Apply the rebrowser `addBinding` strategy at the bunlight transport layer (intercept `Runtime.enable` and substitute lazy acquisition).
- Eventually upstream the rebrowser-style behavior into Lightpanda's CDP server itself.

### 4.5 rebrowser features candidates for bunlight

| # | Feature | Effort | Profile cible | Notes |
|---|---|---|---|---|
| R1 | Skip `Runtime.enable` in CDP client transport, lazy-acquire context IDs via `Runtime.addBinding` + isolated-world CustomEvent dispatch | L | static/fast/stealth | Major undetectability win. Requires modifying InProcessTransport CDP client logic and/or wrapping puppeteer-core peerDep. |
| R2 | Strip `puppeteer_evaluation_script` sourceURL from `Runtime.evaluate` and `Runtime.callFunctionOn` | S | static/fast | Same as stealth S14. Trivial CDP send wrapper. |
| R3 | Rename utility world from `__puppeteer_utility_world__` to a generic name | S | static/fast | One-liner. Hides bunlight as "puppeteer-driven" from script blacklists. |
| R4 | `REBROWSER_PATCHES_DEBUG` style env-var debug logging | S | dev only | Low value. Skip. |
| R5 | Three fix-mode strategies (`addBinding`, `alwaysIsolated`, `enableDisable`) | M | stealth | If R1 is implemented, expose the three modes as `stealth: { contextAcquireMode: 'addBinding' }`. |

### 4.6 Recommendation for rebrowser

R1 is the single biggest stealth improvement bunlight can ship. It directly addresses the Cloudflare April 2025 detection that defeats vanilla puppeteer / playwright. Effort is L (~300 lines of TypeScript) but the implementation is open-source under Apache-2.0 and can be ported almost verbatim. R2 and R3 are trivial side-improvements that should land in the same PR.

---

## 5. Comparison matrix

Legend: `done` = bunlight has it, `partial` = bunlight has a basic version, `missing` = candidate, `n/a` = not applicable.

| Feature | puppeteer | extra | stealth | rebrowser | bunlight | Priority |
|---|---|---|---|---|---|---|
| Plugin lifecycle hooks | n/a | core | uses | n/a | implicit (auto-escalation) | M |
| Locator API (auto-wait) | done | n/a | n/a | n/a | missing | high |
| Cooperative request interception | done | n/a | n/a | n/a | missing | high |
| Coverage (JS+CSS) | done | n/a | n/a | n/a | missing | low |
| Tracing | done | n/a | n/a | n/a | partial | low |
| Screencast | done | n/a | n/a | n/a | stub | low |
| PDF | done | n/a | n/a | n/a | stub (fast) | medium |
| Accessibility tree | done | n/a | n/a | n/a | missing | medium |
| FileChooser | done | n/a | n/a | n/a | missing | medium |
| Worker realm | done | n/a | n/a | n/a | missing | medium |
| `setBypassCSP` | done | n/a | n/a | n/a | stub | low |
| Network throttling | done | n/a | n/a | n/a | partial (stored only) | low |
| ARIA selectors | done | n/a | n/a | n/a | missing | medium |
| Block resources | n/a | done | n/a | n/a | done (`blockResources`) | done |
| Anonymize UA | n/a | done | partial | n/a | partial (curl-impersonate rotation) | done |
| Adblocker | n/a | done | n/a | n/a | missing | medium |
| 2captcha integration | n/a | done | n/a | n/a | done (CapSolver) | done |
| Per-page proxy router | n/a | done | n/a | n/a | partial (ProxyPool) | low |
| navigator.webdriver delete | n/a | n/a | done | n/a | done | done |
| navigator.languages | n/a | n/a | done | n/a | done | done |
| navigator.platform | n/a | n/a | done (in user-agent-override) | n/a | done | done |
| navigator.hardwareConcurrency | n/a | n/a | done | n/a | done | done |
| navigator.deviceMemory | n/a | n/a | partial (in user-agent) | n/a | done | done |
| navigator.permissions notifications | n/a | n/a | done | n/a | done | done |
| navigator.plugins / mimeTypes | n/a | n/a | done (full) | n/a | done (basic) | low |
| navigator.vendor | n/a | n/a | done | n/a | missing | low |
| webgl.vendor / renderer | n/a | n/a | done | n/a | done | done |
| canvas micro-noise | n/a | n/a | n/a (no native) | n/a | done | done |
| chrome.app | n/a | n/a | done | n/a | missing | medium |
| chrome.csi | n/a | n/a | done | n/a | missing | low |
| chrome.loadTimes | n/a | n/a | done | n/a | partial | low |
| chrome.runtime full mock | n/a | n/a | done | n/a | partial (enums only) | high |
| iframe.contentWindow | n/a | n/a | done | n/a | missing | high |
| media.codecs | n/a | n/a | done | n/a | missing | low |
| sourceurl strip | n/a | n/a | done | done | missing | medium |
| user-agent ua-ch brands | n/a | n/a | done | n/a | partial (no Sec-CH-UA brands) | high |
| Function.prototype.toString hide | n/a | n/a | n/a (per-evasion) | n/a | done | done |
| outerdimensions | n/a | n/a | done | n/a | missing | low |
| `--disable-blink-features=AutomationControlled` | n/a | n/a | done (in webdriver) | n/a | n/a (no Chromium) | n/a |
| Skip `Runtime.enable` (lazy ctx) | n/a | n/a | n/a | done | missing | high |
| Rename utility world | n/a | n/a | n/a | done | unknown | low |

---

## 6. Top 10 prioritized recommendations for bunlight

Ordered by ROI (impact / effort):

1. **chrome.runtime full mock (S4)** — port `evasions/chrome.runtime/index.js` verbatim into `ghost/stealth-patches.ts`. Effort M. Profile: stealth. Impact: critical CF/DataDome bypass.
2. **user-agent ua-ch brands (S15)** — generate `Sec-CH-UA` brands using the chromium algorithm in `evasions/user-agent-override/index.js:99-130` and either inject as `Network.setExtraHTTPHeaders` (http profile) or via `Network.setUserAgentOverride` userAgentMetadata (fast/stealth/max profiles). Effort M. Profile: all.
3. **iframe.contentWindow proxy (S6)** — port `evasions/iframe.contentWindow/index.js` verbatim. Effort M. Profile: stealth. Impact: required for Turnstile and any iframed challenge.
4. **Skip Runtime.enable in CDP client (R1)** — port rebrowser `addBinding` strategy from `cdp/ExecutionContext.js:346-505`. Effort L. Profile: static/fast/stealth. Impact: defeats Cloudflare April 2025 leak.
5. **Locator API (P1)** — port `api/locators/locators.ts` (RxJS-based auto-wait pipeline). Effort L. Profile: all. Impact: modern Puppeteer parity, retry-with-conditions everywhere.
6. **`page.exposeFunction(name, fn)` bidirectional binding (P2)** — wire `Runtime.addBinding` plumbing already present in CDP coverage. Effort M. Profile: fast/stealth/max. Impact: needed for Crawlee/Apify scraper compat.
7. **Plugin lifecycle hooks (E1)** — formalize bunlight's implicit hooks into a `Browser.use(plugin)` API mirroring `puppeteer-extra`. Effort M. Profile: all. Impact: foundation for the rest.
8. **Cooperative request interception (P11)** — add `interceptResolutionPriority` and queueing to bunlight's `route()`. Effort M. Profile: static/fast. Impact: stack block-resources + cookie-injector + custom mocks.
9. **sourceurl strip (S14 / R2)** — wrap `InProcessTransport.send()` to strip `//# sourceURL=__puppeteer_evaluation_script__` from `Runtime.evaluate` and `Runtime.callFunctionOn`. Effort S. Profile: static/fast. Impact: removes bunlight self-identification, low cost.
10. **Stealth quick wins batch (S2 chrome.csi, S3 chrome.loadTimes refinement, S7 media.codecs, S12 navigator.vendor, S17 outerdimensions)** — single commit, ~50 lines total. Effort S. Profile: stealth. Impact: closes minor fingerprint gaps.

---

## 7. License compatibility summary

| Package | License | Permits port to 0BSD bunlight | Required attribution |
|---|---|---|---|
| puppeteer-core 24.43 | Apache-2.0 | yes | retain copyright + Apache-2.0 NOTICE in THANKS.md |
| puppeteer-extra 3.3.6 | MIT | yes | retain MIT copyright in THANKS.md |
| puppeteer-extra-plugin-stealth 2.11.2 | MIT | yes | retain MIT copyright in THANKS.md |
| rebrowser-puppeteer-core 23.10.3 | Apache-2.0 | yes | retain copyright + Apache-2.0 NOTICE in THANKS.md |

No GPL anywhere. No copyleft. All four can be ported into 0BSD bunlight by adding entries to `THANKS.md` (already standard practice). No legal blocker.

---

## 8. Files referenced

- ~/bunmium/references/puppeteer/packages/puppeteer-core/src/api/Page.ts
- ~/bunmium/references/puppeteer/packages/puppeteer-core/src/api/Frame.ts
- ~/bunmium/references/puppeteer/packages/puppeteer-core/src/api/locators/locators.ts
- ~/bunmium/references/puppeteer/packages/puppeteer-core/src/api/HTTPRequest.ts
- ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra/src/index.ts
- ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra-plugin-stealth/index.js
- ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra-plugin-stealth/evasions/{17 evasions}/index.js
- ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra-plugin-block-resources/index.js
- ~/bunmium/references/puppeteer-extra/packages/puppeteer-extra-plugin-recaptcha/src/index.ts
- ~/vps/node_modules/rebrowser-puppeteer-core/lib/cjs/puppeteer/cdp/ExecutionContext.js
- ~/vps/node_modules/rebrowser-puppeteer-core/lib/cjs/puppeteer/cdp/FrameManager.js
- ~/vps/node_modules/rebrowser-puppeteer-core/lib/cjs/puppeteer/cdp/IsolatedWorld.js
- ~/vps/node_modules/rebrowser-puppeteer-core/lib/cjs/puppeteer/common/util.js
- ~/vps/packages/bunlight/src/profiles/ghost/stealth-patches.ts
- ~/vps/packages/bunlight/docs/CDP-COVERAGE.md
