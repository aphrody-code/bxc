# bxc Crawler Security & Stealth Review (Fully Integrated)

We have successfully completed the security & stealth review and fully integrated proxy routing, custom headers, User-Agent overrides, cookie jars, and SSL/TLS validation controls across all crawler profiles and transport protocols.

---

## 1. Anti-Fingerprinting, Headers, and Got-Scraping Comparison

| Feature | Crawlee (`got-scraping` / `impit` / `fingerprint-suite`) | bxc (`curl-impersonate` + `fingerprint.ts` + `ghost`) | Integration Status |
| :--- | :--- | :--- | :--- |
| **TLS Fingerprinting (JA3/JA4)** | Mimics browser-like TLS handshakes (cipher suites, extensions) using `impit` or Node TLS options. | Employs `libcurl-impersonate` via a FFI wrapper, which provides native, C-level TLS client hello spoofing. | **Equivalently Strong / Superior** (for HTTP-only). bxc's TLS impersonation mimics real browser handshakes at the binary/protocol level. |
| **Header Generation & Ordering** | Dynamically randomizes and enforces realistic header ordering using `header-generator` based on chosen browser profiles. | `curl-impersonate` automatically constructs correct default headers matching the profile if `defaultHeaders: true` is set. | **Coherent & Flexible**. Custom header overrides can be passed at request time or via httpOpts. |
| **JS-Level Stealth Injection** | Generates coherent fingerprints (resolution, WebGL, navigator API) and injects them into pages via `fingerprint-injector`. | Generates fingerprints via a TS port of `browserforge` (`fingerprint.ts`) and injects them via `Page.addScriptToEvaluateOnNewDocument`. | **Fully Equivalent**. bxc's `stealth-patches.ts` covers the same overrides (hardwareConcurrency, deviceMemory, WebGL vendor/renderer, screen dimensions, etc.). |
| **Proxy Routing** | Streamlined proxy routing via `proxyUrl` option with automatic protocol detection and ALPN negotiation. | Exposed to crawlers and fully forwarded down through `WebSocketTransport` (`--proxy` for Lightpanda, `--proxy-server` for Chrome). | **Fully Operational**. Bxc crawler interfaces and browser/page builders now natively accept proxy configurations. |

---

## 2. Fact-Check: curl-impersonate & Lightpanda Integration

### A. curl-impersonate (`"http"` profile / `HttpPage`)
*   **Stealth Level:** **High**. Since it compiles against `libcurl-impersonate`, it bypasses simple and intermediate TLS fingerprinting checks (such as JA3/JA4 client hellos) that standard Node/Bun HTTP requests fail.
*   **Limitations:** It does not run a browser engine (no DOM, no CSS, no JavaScript execution). It is purely an HTTP downloader. Therefore, it is equivalent to Crawlee's `got-scraping` / `impit`, but is easily stopped by challenges requiring JS execution (e.g., Cloudflare Turnstile, Akamai Sensor Data).

### B. Lightpanda (`"fast"` / `"ghost"` profile)
*   **Stealth Level:** **High (with Upstream Proxies)**.
*   **Resolved: Proxy Forwarding.** Lightpanda processes can now be launched with upstream proxies by passing `--proxy` argument directly down in `WebSocketTransport.ts`. This routes all Lightpanda traffic through external residential/datacenter IPs, masking the VPS server IP.
*   **Stealth Safeguards:** While Lightpanda uses its custom rustls/native-tls stack (which differs from standard Chrome TLS hellos), using high-quality residential proxies combined with the `stealth-patches.ts` CDP injections provides powerful defense against geographical/IP blocks and DOM-level fingerprint audits.

---

## 3. Crawler Configurations & Transport Integrations

All options are now fully exposed to both `CheerioCrawler` and `BrowserCrawler` interfaces.

### A. `CheerioCrawler.ts` Configuration
`CheerioCrawler` initializes pages by passing options directly to `Browser.newPage`:
```typescript
const page = await Browser.newPage({
	profile: "http",
	cookies: this.options.cookies,
	userAgent: this.options.userAgent,
	insecure: this.options.insecure,
	httpOpts: {
		profile: this.options.httpProfile ?? "chrome131",
		proxy: this.options.proxy,
		proxyAuth: this.options.proxyAuth,
		timeoutMs: this.options.timeoutMs ?? 30_000,
		headers: this.options.headers,
	},
});
```

### B. `BrowserCrawler.ts` Configuration
`BrowserCrawler` initializes full browser contexts (including static, fast, stealth, or max profiles) with complete option pass-through:
```typescript
const page = await Browser.newPage({
	profile: this.profile,
	headless: this.headless,
	cookies: this.options.cookies,
	userAgent: this.options.userAgent,
	viewport: this.options.viewport,
	insecure: this.options.insecure,
	proxy: this.options.proxy,
	proxyAuth: this.options.proxyAuth,
	spawnOpts: this.options.spawnOpts,
});
```

### C. `WebSocketTransport.ts` Spawn Arguments
When WebSocketTransport spawns browser/engine subprocesses, it translates the proxy settings:
- **Lightpanda (`isLightpanda`)**: Appends `--proxy <proxyUrl>` to route DOM-evaluation traffic.
- **Chromium / Chrome (`isChrome`)**: Appends `--proxy-server=<proxyUrl>` to route page navigation.

---

## 4. Verification Check

All unit tests and smoke tests compile and run successfully. Proxy variables and cookie jars are fully verified to inject properly on startup.
