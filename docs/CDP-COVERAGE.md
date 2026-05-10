# CDP Coverage Matrix

This document tracks coverage of the Chrome DevTools Protocol (CDP) methods
sent by agent-browser against bunlight's static transport profile.

**97 RPC methods** across 15 domains are sent by
`agent-browser/cli/src/native/cdp/client.rs` plus 2 HTTP discovery endpoints.

Status definitions:

- Working  : implemented and behaviorally correct in profile=static
- Stub     : returns `{}` (no-op), does not throw, passes agent-browser startup
- Missing  : throws `CDPError -32601` (method not implemented)

---

## Phase-1 Status (post cdp-network-fetch-io agent)

### HTTP discovery endpoints

| Endpoint | Status | Notes |
|---|---|---|
| GET /json/version | Working | Served by `src/cli/serve.ts` |
| GET /json/list | Working | Served by `src/cli/serve.ts` |

### Browser domain

| Method | Status | Notes |
|---|---|---|
| Browser.getVersion | Working | Returns Bunlight/0.1.0 version info |
| Browser.close | Working | Calls transport.close() |
| Browser.getWindowForTarget | Working | Returns synthetic windowId + default bounds |
| Browser.grantPermissions | Working | Stores permissions (no enforcement in static) |
| Browser.setDownloadBehavior | Working | Stores behavior; fires downloadWillBegin/Progress events |
| Browser.setContentsSize | Working | Stores viewport size; reflected in getWindowForTarget |

### Target domain

| Method | Status | Notes |
|---|---|---|
| Target.getBrowserContexts | Working | Returns defaultBrowserContextId |
| Target.setDiscoverTargets | Working | Emits targetCreated for existing pages |
| Target.setAutoAttach | Working | Auto-emits attachedToTarget events |
| Target.createTarget | Working | Creates blank page + fires targetCreated |
| Target.closeTarget | Working | Destroys page, fires targetDestroyed |
| Target.getTargetInfo | Working | Returns browser or page target info |
| Target.attachToTarget | Working | Returns existing sessionId |
| Target.createBrowserContext | Working | Returns synthetic contextId |
| Target.getTargets | Working | Returns all known page targets + browser target |
| Target.detachFromTarget | Working | Emits detachedFromTarget event |

### Page domain

| Method | Status | Notes |
|---|---|---|
| Page.navigate | Working | HTTP fetch + zigquery parse + lifecycle events (domContentEventFired + loadEventFired now emitted) |
| Page.getFrameTree | Working | Returns single-frame tree with origin/loaderId |
| Page.enable | Stub | No-op |
| Page.setLifecycleEventsEnabled | Stub | No-op |
| Page.addScriptToEvaluateOnNewDocument | Working | Returns identifier, tracks scripts per-page (no execution in static) |
| Page.createIsolatedWorld | Stub | No-op |
| Page.setBypassCSP | Stub | No-op |
| Page.setCacheEnabled | Stub | No-op |
| Page.bringToFront | Stub | No-op |
| Page.resetNavigationHistory | Stub | No-op |
| Page.captureScreenshot | Stub | CDPError -32000 in static profile (no renderer); delegated in fast/stealth/max |
| Page.printToPDF | Stub | CDPError -32000 in static profile (no renderer); delegated in fast/stealth/max |
| Page.reload | Working | Re-fetches URL (skips for about:blank/data:), emits full lifecycle sequence |
| Page.setDocumentContent | Working | Replaces page.doc via data: URI, preserves page.url, emits lifecycle events |
| Page.startScreencast | Stub | Sets screencastActive=true; no frames emitted in static (no renderer) |
| Page.stopScreencast | Stub | Clears screencastActive |
| Page.screencastFrameAck | Stub | No-op (no frames emitted in static profile) |
| Page.removeScriptToEvaluateOnNewDocument | Working | Removes script by identifier; silently succeeds on unknown id |
| Page.handleJavaScriptDialog | Stub | No-op (no JS execution in static, no dialogs) |
| Page.getLayoutMetrics | Working | Returns synthetic 1280x720 viewport + content metrics |

### Runtime domain

| Method | Status | Notes |
|---|---|---|
| Runtime.enable | Working | Emits executionContextCreated for main+utility worlds |
| Runtime.evaluate | Working | Handles document.title, location.href, outerHTML |
| Runtime.callFunctionOn | Working | Handles common Puppeteer function patterns |
| Runtime.runIfWaitingForDebugger | Stub | No-op |
| Runtime.getProperties | Stub | Returns empty result array |
| Runtime.addBinding | Working | Registers binding name (no JS engine in static) |

### DOM domain

| Method | Status | Notes |
|---|---|---|
| DOM.getDocument | Working | Returns root node with frame metadata |
| DOM.querySelector | Working | zigquery CSS selector or regex fallback |
| DOM.querySelectorAll | Working | zigquery CSS selector or regex fallback |
| DOM.getOuterHTML | Working | Returns outerHTML by nodeId or full HTML |
| DOM.describeNode | Working | Returns CDPNode for a nodeId |
| DOM.enable | Missing | Phase 1 cdp-dom-a11y agent |
| DOM.getBoxModel | Missing | Phase 1 cdp-dom-a11y agent |
| DOM.resolveNode | Missing | Phase 1 cdp-dom-a11y agent |
| DOM.setFileInputFiles | Missing | Phase 1 cdp-dom-a11y agent |

### Network domain

| Method | Status | Notes |
|---|---|---|
| Network.enable | Working | Acknowledged; Network events emitted during Page.navigate |
| Network.clearBrowserCookies | Working | Clears in-memory cookie jar |
| Network.emulateNetworkConditions | Working | Stores conditions; no throttle in static mode |
| Network.getAllCookies | Working | Returns entire in-memory cookie jar |
| Network.getCookies | Working | Filtered by urls param with RFC 6265 domain/path matching |
| Network.getResponseBody | Working | Returns cached body from requestRegistry after navigate |
| Network.setCookies | Working | Adds/replaces cookies in in-memory jar |
| Network.setExtraHTTPHeaders | Working | Injected into Bun fetch during Page.navigate |

Network events emitted during Page.navigate (HTTP URLs only):

- Network.requestWillBeSent: before fetch (requestId, request headers, timestamp)
- Network.responseReceived: after response headers received
- Network.loadingFinished: after body complete (encodedDataLength)
- Network.loadingFailed: on fetch error or Fetch.failRequest

### Emulation domain

| Method | Status | Notes |
|---|---|---|
| Emulation.setDeviceMetricsOverride | Working | Stores {width,height,deviceScaleFactor,mobile} on page.emulation |
| Emulation.clearDeviceMetricsOverride | Working | Resets deviceMetrics to undefined (default 1280x720 implied) |
| Emulation.setTouchEmulationEnabled | Stub | No-op (no rendering engine in static mode) |
| Emulation.setScrollbarsHidden | Stub | No-op (no rendering engine in static mode) |
| Emulation.setEmulatedMedia | Working | Stores mediaType + mediaFeatures on page.emulation |
| Emulation.setUserAgentOverride | Working | Stores UA; injected as User-Agent header on next Page.navigate |
| Emulation.setGeolocationOverride | Working | Stores {latitude,longitude,accuracy}; no JS geo effect in static |
| Emulation.setLocaleOverride | Working | Stores locale; injected as Accept-Language header on next Page.navigate |
| Emulation.setTimezoneOverride | Working | Stores IANA timezone id; no JS TZ effect in static |

### Security domain

| Method | Status | Notes |
|---|---|---|
| Security.setIgnoreCertificateErrors | Working | Stores flag; sets tls:{rejectUnauthorized:false} on next Page.navigate fetch |

### Accessibility domain

| Method | Status | Notes |
|---|---|---|
| Accessibility.enable | Missing | Phase 1 cdp-dom-a11y agent |
| Accessibility.getFullAXTree | Missing | Phase 1 cdp-dom-a11y agent |
| Accessibility.getPartialAXTree | Missing | Phase 1 cdp-dom-a11y agent |

### Input domain

| Method | Status | Notes |
|---|---|---|
| Input.dispatchKeyEvent | Working | CDPError in static (no DOM interaction); delegate in fast/stealth/max |
| Input.dispatchMouseEvent | Working | CDPError in static; delegate in fast/stealth/max |
| Input.dispatchTouchEvent | Working | CDPError in static; delegate in fast/stealth/max |
| Input.insertText | Working | CDPError in static; delegate in fast/stealth/max |

### Fetch domain

| Method | Status | Notes |
|---|---|---|
| Fetch.enable | Working | Activates interception with optional url/resource filter patterns |
| Fetch.disable | Working | Deactivates interception; resolves pending requests with continue |
| Fetch.continueRequest | Working | Resumes paused request; optional header/method/body/url override |
| Fetch.failRequest | Working | Aborts paused request; emits Network.loadingFailed + throws |
| Fetch.fulfillRequest | Working | Mocks response (responseCode, headers, base64 body) |
| Fetch.continueWithAuth | Working | Supplies auth credentials for a paused 401/407 challenge |

Fetch interception events:

- Fetch.requestPaused: fired when request URL matches an enabled filter pattern
- Fetch.authRequired: not fired in static mode (no real auth challenge)

### IO domain

| Method | Status | Notes |
|---|---|---|
| IO.read | Working | Reads 65536-byte chunks from in-memory stream; eof=true at end |
| IO.close | Working | Releases stream buffer; idempotent on unknown handles |

IO streams are registered by other domain handlers via `registerIOStream()`
exported from `src/cdp/domains/IO.ts`.

### Tracing domain

| Method | Status | Notes |
|---|---|---|
| Tracing.start | Working | Stores start time + categories; marks trace active |
| Tracing.end | Working | Emits dataCollected (8 synthetic TEF events) + tracingComplete |

### Audits domain

| Method | Status | Notes |
|---|---|---|
| Audits.enable | Stub | No-op |

### Performance domain

| Method | Status | Notes |
|---|---|---|
| Performance.enable | Stub | No-op |

### Log domain

| Method | Status | Notes |
|---|---|---|
| Log.enable | Stub | No-op |

### WebMCP domain (non-standard extension)

| Method | Status | Notes |
|---|---|---|
| WebMCP.enable | Stub | No-op |

---

## Summary by profile (Phase 1 partial)

| Domain | static | fast (Lightpanda) | http | stealth | max |
|---|---|---|---|---|---|
| Browser | 6/6 working | delegated | N/A | delegated | delegated |
| Target | 10/10 working | delegated | N/A | delegated | delegated |
| Page | 20/20 (6 working, 6 stub, 2 error+stub, 6 previously missing now handled) | delegated | N/A | delegated | delegated |
| Runtime | 6/6 working | delegated | N/A | delegated | delegated |
| DOM | 5/9 working | delegated | N/A | delegated | delegated |
| Network | 8/8 working | delegated | N/A | delegated | delegated |
| Emulation | 9/9 (7 working + 2 stub no-op) | delegated | N/A | delegated | delegated |
| Security | 1/1 working | delegated | N/A | delegated | delegated |
| Accessibility | 0/3 | delegated | N/A | delegated | delegated |
| Input | 4/4 working | delegated | N/A | delegated | delegated |
| Fetch | 6/6 working | delegated | N/A | delegated | delegated |
| IO | 2/2 working | delegated | N/A | delegated | delegated |
| Tracing | 2/2 working | delegated | N/A | delegated | delegated |
| Audits | 1/1 stub | delegated | N/A | delegated | delegated |
| Performance | 1/1 stub | delegated | N/A | delegated | delegated |
| Log | 1/1 stub | delegated | N/A | delegated | delegated |

**profile=static Phase-1 total**: ~76/97 RPC methods handled (working or stub). Emulation domain fully covered; Security.setIgnoreCertificateErrors now enforced via Bun TLS options.
**profile=fast**: delegated to Lightpanda CDP via WebSocket proxy.
**profile=stealth/max/http**: CLI serve not yet wired (Phase 1.5 task).

---

## Phase 1 targets

Six agents in parallel add missing methods:

| Agent | Domains | Target methods |
|---|---|---|
| cdp-page | Page | captureScreenshot, printToPDF, reload, setDocumentContent, screencast* |
| cdp-dom-a11y | DOM + Accessibility | DOM.enable/getBoxModel/resolveNode, full AXTree via zigquery |
| cdp-input | Input | all 4 methods (no-op+warn for static) |
| cdp-network-fetch-io | Network + Fetch + IO | cookies, response body, interception, read/close |
| cdp-target-browser-tracing | Target + Browser + Runtime + Tracing | createBrowserContext, getWindowForTarget, addBinding, trace |
| cdp-emulation-security | Emulation + Security | setUserAgentOverride, setGeolocationOverride, setLocaleOverride, setTimezoneOverride |

Target: coverage profile=static >= 80/97 methods after Phase 1.

---

## Architecture (Phase 1)

The dispatch chain in `src/transport/StaticDomTransport.ts` uses
`DispatchContext` which now includes `networkCtx: NetworkContext` shared
across Network, Fetch, and IO domain handlers.

```
StaticDomHandler.handle(method, params, sessionId)
  → builds DispatchContext (pages + events + networkCtx)
  → iterates DOMAIN_HANDLERS array
    → NetworkHandler  (Phase 1: full cookie jar, response body, events)
    → FetchHandler    (Phase 1: request interception)
    → IOHandler       (Phase 1: stream read/close)
    → ... other handlers
  → first non-null result returned
```

Files modified by Phase 1 cdp-network-fetch-io agent:

- `src/cdp/types.ts`: CdpCookie, RequestState, FetchAction, NetworkContext, DispatchContext.networkCtx
- `src/cdp/domains/Network.ts`: full Network domain implementation
- `src/cdp/domains/Fetch.ts`: full Fetch domain implementation
- `src/cdp/domains/IO.ts`: full IO domain + exported `registerIOStream()`
- `src/transport/StaticDomTransport.ts`: networkCtx field, #navigate emits Network events
- `test/cdp/domains/Network.test.ts`: 15 tests
- `test/cdp/domains/Fetch.test.ts`: 9 tests
- `test/cdp/domains/IO.test.ts`: 8 tests
