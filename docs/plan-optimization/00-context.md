# 00 — Contexte global

À lire AVANT toute mission. Rassemble les invariants, l'audit de l'écart, le baseline performance, et les fichiers critiques.

## Objectif

Faire de bunlight le meilleur engine possible pour `agent-browser` dans notre fork local `~/bunmium/agent-browser/`. Pas de contrainte upstream — on peut casser la compat. Cibles :

1. **Coverage CDP complet** — bunlight serve répond aux 97 RPC CDP qu'agent-browser envoie.
2. **Profiles tous wirés** — static, fast, stealth, max, http démarrent via `bunlight serve --profile X`.
3. **Performance** — battre Chrome/Lightpanda sur cold start, RSS, latency.
4. **Stealth E2E** — bypass Cloudflare/DataDome/JA4 via `agent-browser --engine bunlight --profile {stealth,max,http}`.
5. **Distribution** — install one-shot multi-platform.

## Le contrat invariant

`bunlight serve --cdp-port N --profile P` doit lancer un serveur CDP-WebSocket que `cli/src/native/cdp/bunlight.rs` peut découvrir (`/json/version` → `webSocketDebuggerUrl`) et piloter via le `CdpClient` standard.

## Audit confirmé

### Côté agent-browser : 97 CDP methods sur 15 domains

Source : grep exhaustif de `/home/ubuntu/bunmium/agent-browser/cli/src/native/`.

| Domain | Methods | Events |
|---|---|---|
| Accessibility | enable, getFullAXTree | — |
| Browser | close, getVersion, getWindowForTarget, grantPermissions, setContentsSize, setDownloadBehavior | downloadProgress, downloadWillBegin |
| DOM | describeNode, enable, getBoxModel, getDocument, querySelectorAll, resolveNode, setFileInputFiles | — |
| Emulation | setDeviceMetricsOverride, setEmulatedMedia, setGeolocationOverride, setLocaleOverride, setTimezoneOverride, setUserAgentOverride | — |
| Fetch | continueRequest, continueWithAuth, disable, enable, failRequest, fulfillRequest | authRequired, requestPaused |
| Input | dispatchKeyEvent, dispatchMouseEvent, dispatchTouchEvent, insertText | — |
| IO | close, read | — |
| Network | clearBrowserCookies, emulateNetworkConditions, enable, getAllCookies, getCookies, getResponseBody, setCookies, setExtraHTTPHeaders | loadingFailed, loadingFinished, requestWillBeSent, responseReceived |
| Page | addScriptToEvaluateOnNewDocument, bringToFront, captureScreenshot, enable, getFrameTree, getLayoutMetrics, handleJavaScriptDialog, navigate, printToPDF, reload, removeScriptToEvaluateOnNewDocument, setDocumentContent, startScreencast, stopScreencast | domContentEventFired, downloadProgress, downloadWillBegin, frameNavigated, javascriptDialogClosed, javascriptDialogOpening, loadEventFired, screencastFrame, screencastFrameAck |
| Runtime | addBinding, callFunctionOn, enable, evaluate, runIfWaitingForDebugger | consoleAPICalled, exceptionThrown |
| Security | setIgnoreCertificateErrors | — |
| Target | attachToTarget, closeTarget, createBrowserContext, createTarget, detachFromTarget, getTargets, setAutoAttach, setDiscoverTargets | attachedToTarget, detachedFromTarget, targetCreated, targetDestroyed, targetInfoChanged |
| Tracing | end, start | dataCollected, tracingComplete |

Plus 2 HTTP discovery endpoints : `/json/version`, `/json/list`.

### Côté bunlight : ~37 methods en static, rien en stealth/max/http via CLI

- Profile **static** : 25 working + 17 stubbed dans `src/transport/StaticDomTransport.ts:377-771` (switch monolithique de ~395 lignes).
- Profile **fast** : delegation intégrale à Lightpanda via `SocketPairTransport`.
- Profile **http** : pas exposé dans `src/cli/serve.ts`.
- Profile **stealth** : `src/cli/serve.ts:27-31` exit avec « not implemented in CLI mode ».
- Profile **max** : idem.

Working en static : Browser.{getVersion, close} + Target.{getBrowserContexts, setDiscoverTargets, setAutoAttach, createTarget, closeTarget, getTargetInfo, attachToTarget} + Page.{navigate, getFrameTree} + Runtime.{enable, evaluate, callFunctionOn} + DOM.{getDocument, querySelector, querySelectorAll, getOuterHTML, describeNode}.

Stubs no-op en static : Page.{enable, setLifecycleEventsEnabled, addScriptToEvaluateOnNewDocument, createIsolatedWorld, setBypassCSP, setCacheEnabled, bringToFront, resetNavigationHistory} + Runtime.runIfWaitingForDebugger + Network.enable + Emulation.{setDeviceMetricsOverride, clearDeviceMetricsOverride, setTouchEmulationEnabled, setScrollbarsHidden, setEmulatedMedia} + Security.setIgnoreCertificateErrors + Audits/Performance/Log/WebMCP enable.

### Écart : ~45 RPC critiques manquantes

Tout `Input.*`, tout `Fetch.*`, tout `Tracing.*`, `Page.captureScreenshot/printToPDF/screencast`, `Network.getCookies/getAllCookies/getResponseBody` + tous events réseau, `Accessibility.*`, `Browser.getWindowForTarget/grantPermissions/setDownloadBehavior`, `Emulation.setUserAgentOverride/setGeolocationOverride/etc`.

## Performance baseline

Source : `bunlight/benchmarks/results/2026-05-10.md`.

| Profile | Cold start | Idle RSS | p50 nav | p95 nav |
|---|---|---|---|---|
| static | 2-5 ms | 67 MB | 1-2 ms | 2 ms |
| fast (Lightpanda) | 120-140 ms | 76 MB | 64 ms | 75 ms |
| http (curl-impersonate) | 10 ms | n/a | 1-2 ms | 2 ms |
| stealth (patchright) | 800-1000 ms | n/a | 50-100 ms | n/a |
| max (Camoufox) | 1500-2000 ms | n/a | 80-150 ms | n/a |

Benchmark Chrome via agent-browser daemon Rust : 617 ms cold start, 8 MB RSS.

## Fichiers critiques (paths absolus)

### Bunlight

- `/home/ubuntu/bunmium/bunlight/src/cli/serve.ts` (684 LOC) — entry point CDP serve, profile routing, HTTP discovery.
- `/home/ubuntu/bunmium/bunlight/src/transport/StaticDomTransport.ts` (1019 LOC) — switch dispatcher (lignes 377-771).
- `/home/ubuntu/bunmium/bunlight/src/transport/SocketPairTransport.ts` (467 LOC) — Lightpanda subprocess + WS proxy.
- `/home/ubuntu/bunmium/bunlight/src/transport/InProcessTransport.ts` (152 LOC) — base handler, JSON dispatch.
- `/home/ubuntu/bunmium/bunlight/src/profiles/stealth/index.ts` — patchright Chromium backend (existe, pas wiré CLI).
- `/home/ubuntu/bunmium/bunlight/src/profiles/max/index.ts` — Camoufox + CapSolver (existe, pas wiré CLI).
- `/home/ubuntu/bunmium/bunlight/src/api/browser.ts` (509 LOC) — public Page/Browser API.
- `/home/ubuntu/bunmium/bunlight/src/ffi/zigquery.ts` (434 LOC) — DOM FFI, hot path static.
- `/home/ubuntu/bunmium/bunlight/src/ffi/curl-impersonate.ts` (782 LOC) — HTTP client TLS-fingerprint.
- `/home/ubuntu/bunmium/bunlight/scripts/build-standalone.ts` — produit `dist/standalone/bunlight-linux-x64` (96 MB).
- `/home/ubuntu/bunmium/bunlight/scripts/postinstall.ts` — auto-download Lightpanda binary.
- `/home/ubuntu/bunmium/bunlight/test/` — 150+ tests existants, doivent rester GREEN.
- `/home/ubuntu/bunmium/bunlight/benchmarks/runner.ts` — bench harness existant.

### Bunlight (à créer durant les phases)

- `bunlight/src/cdp/types.ts` — DispatchContext, DomainHandler interface (Phase 0).
- `bunlight/src/cdp/domains/{Page,Target,Browser,DOM,Runtime,Network,Emulation,Security,Accessibility,Input,Fetch,IO,Tracing,Audits,Performance,Log}.ts` — 16 domain handlers (Phase 0+1).
- `bunlight/test/cdp/domains/<X>.test.ts` — tests CDP par domain (Phase 1).
- `bunlight/test/profile-wiring.test.ts` — tests boot des 5 profiles (Phase 1.5).
- `bunlight/test/e2e/agent-browser-stealth.e2e.test.ts` — E2E via agent-browser CLI (Phase 3).
- `bunlight/benchmarks/agent-browser-engine.bench.ts` — bench comparatif chrome/lightpanda/bunlight (Phase 2).
- `bunlight/docs/CDP-COVERAGE.md` — matrice 97 RPC × 5 profiles (Phase 0).
- `bunlight/.claude/skill-data/bunlight/SKILL.md` — skill agent-browser (Phase 3).
- `bunlight/src/profiles/auto-escalation.ts` — escalation static→fast→stealth→max (Phase 3).

### agent-browser fork (read-only sauf besoin)

- `/home/ubuntu/bunmium/agent-browser/cli/src/native/cdp/bunlight.rs` (983 LOC) — engine Rust, déjà OK.
- `/home/ubuntu/bunmium/agent-browser/cli/src/native/cdp/client.rs` — source des 97 CDP calls.

## Contraintes (rappel)

- **Bun-native obligatoire** (cf `~/bunmium/CLAUDE.md` §3.1).
- **TypeScript strict**, pas de `any`.
- **Pas d'emojis**, pas de double-dash dans markdown.
- **Tests** : `bun test` doit passer après chaque phase. Pas de skip silencieux.
- **Aucune regression** sur les ~344 tests existants.
- **Pas de touch** des fichiers en dehors du scope défini par chaque spec.

## Subagent types disponibles (cf `~/bunmium/CLAUDE.md` §4.4)

| Tâche | subagent_type |
|---|---|
| Multi-fichier TypeScript / refactor | `typescript-pro` |
| Bun runtime / Bun.* / bun:* | `bun-runner`, `bun-native`, `bun-explorer` |
| Performance / benchmark | `performance-engineer` |
| Recherche large / GitHub scan | `general-purpose` ou `Explore` |
| Code review | `bun-reviewer` |
| Plugin Claude (skills) | `claude-code-guide` |
