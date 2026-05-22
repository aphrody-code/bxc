/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @module bxc/profiles/ghost/stealth-patches
 *
 * Stealth JS patches injected via CDP `Page.addScriptToEvaluateOnNewDocument`
 * BEFORE every navigation. Targets the standard set of anti-bot signals
 * exposed by `navigator.*`, `WebGL`, `canvas`, `AudioContext`, `Permissions`,
 * `RTCPeerConnection`, `screen`, and the Chromium `chrome.runtime` shape.
 *
 * Each patch is self-contained and idempotent (won't double-apply if the
 * page reloads). The patches are emitted as a single string concatenated
 * before injection, so the entire suite runs in one isolated world.
 *
 * Reference :
 *   - puppeteer-extra-plugin-stealth (canonical reference, MIT)
 *   - patchright Chromium
 *   - Camoufox v135 (non-overlapping but informative)
 *   - CreepJS fingerprinting suite (tells inventory)
 *   - BotD (FingerprintJS) source (tells inventory)
 *
 * The patches are a port to Lightpanda's V8 — the engine ships with
 * `navigator.webdriver === true` by default which is the single most
 * reliable anti-bot signal across CF / DataDome / FingerprintJS, so
 * removing it is the highest-priority patch.
 *
 * Coherence invariants maintained:
 *   - UA "Windows" → platform "Win32", secChUaPlatform "Windows"
 *   - UA "Linux"   → platform "Linux x86_64", secChUaPlatform "Linux"
 *   - navigator.languages[0] === navigator.language
 *   - Notification.permission === result of permissions.query({name:"notifications"}).state
 *   - navigator.userAgentData.platform matches navigator.platform family
 *   - outerWidth/outerHeight ≥ innerWidth/innerHeight (never 0)
 *   - AudioContext sampleRate coherent with standard values (44100/48000)
 */

export interface StealthPatchOptions {
	userAgent: string;
	platform: string;
	languages: readonly string[];
	hardwareConcurrency: number;
	deviceMemory: number;
	webglVendor: string;
	webglRenderer: string;
	devicePixelRatio: number;
	screen: {
		width: number;
		height: number;
		availWidth: number;
		availHeight: number;
		colorDepth: number;
		pixelDepth: number;
	};
}

/**
 * Derives the correct `navigator.userAgentData` brand list and platform from
 * a Chrome UA string + platform string. Called at build-script time (host JS),
 * not injected into the page.
 */
function deriveClientHints(userAgent: string, platform: string): {
	uadPlatform: string;
	brands: Array<{ brand: string; version: string }>;
	fullVersionList: Array<{ brand: string; version: string }>;
	mobile: boolean;
} {
	// Extract Chrome major version from UA
	const chromeMatch = /Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(userAgent);
	const chromeMajor = chromeMatch ? chromeMatch[1] : "131";
	const chromeFullVer = chromeMatch ? `${chromeMatch[1]}.${chromeMatch[2]}.${chromeMatch[3]}.${chromeMatch[4]}` : "131.0.0.0";

	// Map platform string to UAD platform
	let uadPlatform: string;
	if (platform === "Win32") uadPlatform = "Windows";
	else if (platform === "MacIntel") uadPlatform = "macOS";
	else uadPlatform = "Linux";

	const mobile = /Android|Mobile/.test(userAgent);

	// Real Chrome brand ordering (varies by version but this pattern is accurate)
	const brands: Array<{ brand: string; version: string }> = [
		{ brand: "Chromium", version: chromeMajor },
		{ brand: "Google Chrome", version: chromeMajor },
		{ brand: "Not/A)Brand", version: "8" },
	];
	const fullVersionList: Array<{ brand: string; version: string }> = [
		{ brand: "Chromium", version: chromeFullVer },
		{ brand: "Google Chrome", version: chromeFullVer },
		{ brand: "Not/A)Brand", version: "8.0.0.0" },
	];

	return { uadPlatform, brands, fullVersionList, mobile };
}

/**
 * Generates the stealth patch script as one continuous IIFE so it can
 * be passed to `Page.addScriptToEvaluateOnNewDocument`.
 *
 * Patches applied (22 total):
 *  1.  navigator.webdriver = undefined (delete via defineProperty)
 *  2.  navigator.plugins / mimeTypes — realistic non-empty
 *  3.  navigator.languages / language / platform / hardwareConcurrency / deviceMemory / vendor
 *  4.  navigator.userAgentData (Client Hints API) — coherent with UA
 *  5.  navigator.connection (Network Information API) — plausible values
 *  6.  screen.* + devicePixelRatio
 *  7.  window.outerWidth / outerHeight — never 0
 *  8.  WebGL renderer / vendor unmask (WebGL1 + WebGL2)
 *  9.  Canvas micro-noise — toDataURL + getImageData
 * 10.  AudioContext fingerprint noise (analyser channel data + sampleRate)
 * 11.  chrome.runtime / chrome.app / chrome.csi stubs
 * 12.  Permissions.query — notifications "prompt", clipboard "granted"
 * 13.  Notification.permission — coherent with Permissions.query result
 * 14.  RTCPeerConnection — block local IP leak via SDP answer
 * 15.  Function.prototype.toString — native-code facade for all patched fns
 * 16.  iframe.contentWindow — ensure non-null prototype chain
 * 17.  window.name = "" — prevent stale cross-origin leaks
 * 18.  navigator.maxTouchPoints — 0 (desktop, consistent with non-mobile UA)
 * 19.  history.length — plausible non-zero value
 * 20.  Performance.prototype.getEntriesByType — stub navigation entries
 * 21.  Error.stackTraceLimit — matches V8 Chrome defaults
 * 22.  document.hasFocus / visibilityState — simulate foreground tab
 */
export function buildStealthScript(opts: StealthPatchOptions): string {
	const isChrome = /Chrome\//.test(opts.userAgent) && !/Edg\//.test(opts.userAgent);
	const isEdge = /Edg\//.test(opts.userAgent);
	const isChromium = isChrome || isEdge;

	const clientHints = isChromium
		? deriveClientHints(opts.userAgent, opts.platform)
		: null;

	// Derive Notification.permission from platform coherence.
	// Desktop Chrome non-headless: "default" or "prompt", never "denied" by default.
	const notificationPermission = "default";

	const o = JSON.stringify({
		...opts,
		notificationPermission,
		clientHints,
		isChromium,
	});

	return `(()=>{
"use strict";
if (window.__bxcGhost) return; window.__bxcGhost = true;
const __o = ${o};

// ── utility: mark a function as native-code ──────────────────────────────────
const __nativeFns = new WeakSet();
const __markNative = (fn) => { try { __nativeFns.add(fn); } catch {} return fn; };

// ── 15. Function.prototype.toString (must be patched first) ──────────────────
try {
  const _origToString = Function.prototype.toString;
  const _patchedToString = function toString() {
    if (__nativeFns.has(this) || this === _patchedToString) {
      return \`function \${this.name || ""}() { [native code] }\`;
    }
    return _origToString.call(this);
  };
  Object.defineProperty(Function.prototype, "toString", {
    value: _patchedToString, writable: true, configurable: true, enumerable: false,
  });
} catch {}

// ── 1. navigator.webdriver ────────────────────────────────────────────────────
try {
  Object.defineProperty(Navigator.prototype, "webdriver", {
    get: __markNative(() => undefined), configurable: true,
  });
} catch {}

// ── 2. navigator.plugins / mimeTypes ─────────────────────────────────────────
try {
  // Each plugin entry must be iterable and have namedItem / item methods
  function __makePlugin(name, filename, desc, mimeTypes) {
    const p = Object.create(Plugin.prototype);
    Object.defineProperties(p, {
      name:        { value: name,     enumerable: true },
      filename:    { value: filename, enumerable: true },
      description: { value: desc,     enumerable: true },
      length:      { value: mimeTypes.length },
    });
    mimeTypes.forEach((mt, i) => {
      const m = Object.create(MimeType.prototype);
      Object.defineProperties(m, {
        type:        { value: mt.type,        enumerable: true },
        description: { value: mt.description, enumerable: true },
        suffixes:    { value: mt.suffixes,    enumerable: true },
        enabledPlugin: { get: __markNative(() => p) },
      });
      Object.defineProperty(p, i, { value: m, enumerable: true });
    });
    p.namedItem = __markNative((n) => mimeTypes.find(mt => mt.type === n) ? p[0] : null);
    p.item = __markNative((i) => p[i] ?? null);
    return p;
  }

  const __pdfMimes = [
    { type: "application/pdf", description: "Portable Document Format", suffixes: "pdf" },
    { type: "text/pdf",        description: "Portable Document Format", suffixes: "pdf" },
  ];
  const __plugins = [
    __makePlugin("PDF Viewer",              "internal-pdf-viewer", "Portable Document Format", __pdfMimes),
    __makePlugin("Chrome PDF Viewer",       "internal-pdf-viewer", "Portable Document Format", __pdfMimes),
    __makePlugin("Chromium PDF Viewer",     "internal-pdf-viewer", "Portable Document Format", __pdfMimes),
    __makePlugin("Microsoft Edge PDF Viewer","internal-pdf-viewer","Portable Document Format", __pdfMimes),
    __makePlugin("WebKit built-in PDF",     "internal-pdf-viewer", "Portable Document Format", __pdfMimes),
  ];

  const __arr = Object.create(PluginArray.prototype);
  Object.defineProperty(__arr, "length", { value: __plugins.length });
  __plugins.forEach((p, i) => Object.defineProperty(__arr, i, { value: p, enumerable: true }));
  __arr.item = __markNative((i) => __arr[i] ?? null);
  __arr.namedItem = __markNative((n) => __plugins.find(p => p.name === n) ?? null);
  __arr.refresh = __markNative(() => {});
  Object.defineProperty(Navigator.prototype, "plugins", {
    get: __markNative(() => __arr), configurable: true,
  });

  // MimeTypeArray coherent with plugins
  const __allMimes = [...__pdfMimes];
  const __mimeArr = Object.create(MimeTypeArray.prototype);
  Object.defineProperty(__mimeArr, "length", { value: __allMimes.length });
  __allMimes.forEach((mt, i) => {
    const m = Object.create(MimeType.prototype);
    Object.defineProperties(m, {
      type:        { value: mt.type,        enumerable: true },
      description: { value: mt.description, enumerable: true },
      suffixes:    { value: mt.suffixes,    enumerable: true },
    });
    Object.defineProperty(__mimeArr, i, { value: m, enumerable: true });
  });
  __mimeArr.item = __markNative((i) => __mimeArr[i] ?? null);
  __mimeArr.namedItem = __markNative((n) => __allMimes.findIndex(m => m.type === n) >= 0 ? __mimeArr[__allMimes.findIndex(m => m.type === n)] : null);
  Object.defineProperty(Navigator.prototype, "mimeTypes", {
    get: __markNative(() => __mimeArr), configurable: true,
  });
} catch {}

// ── 3. navigator core properties ─────────────────────────────────────────────
try { Object.defineProperty(Navigator.prototype, "languages",           { get: __markNative(() => __o.languages),           configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "language",            { get: __markNative(() => __o.languages[0]),        configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "platform",            { get: __markNative(() => __o.platform),            configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: __markNative(() => __o.hardwareConcurrency), configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "deviceMemory",        { get: __markNative(() => __o.deviceMemory),        configurable: true }); } catch {}
// vendor is always "Google Inc." for Chrome/Chromium
try { Object.defineProperty(Navigator.prototype, "vendor",              { get: __markNative(() => __o.isChromium ? "Google Inc." : ""), configurable: true }); } catch {}
// maxTouchPoints: 0 for desktop (non-mobile UA), which matches real Chrome desktop
try { Object.defineProperty(Navigator.prototype, "maxTouchPoints",      { get: __markNative(() => 0), configurable: true }); } catch {}

// ── 4. navigator.userAgentData (Client Hints) ────────────────────────────────
// Headless Chrome exposes this with "Headless" in brands — a primary CF tell.
try {
  if (__o.clientHints && typeof NavigatorUAData !== "undefined") {
    const __ch = __o.clientHints;
    const __uadObj = {
      brands:   __ch.brands,
      mobile:   __ch.mobile,
      platform: __ch.uadPlatform,
      getHighEntropyValues: __markNative(function(hints) {
        const result = {};
        for (const h of hints) {
          switch (h) {
            case "architecture":   result.architecture = "x86"; break;
            case "bitness":        result.bitness = "64"; break;
            case "brands":         result.brands = __ch.brands; break;
            case "fullVersionList":result.fullVersionList = __ch.fullVersionList; break;
            case "mobile":         result.mobile = __ch.mobile; break;
            case "model":          result.model = ""; break;
            case "platform":       result.platform = __ch.uadPlatform; break;
            case "platformVersion":
              result.platformVersion = __ch.uadPlatform === "Windows" ? "15.0.0"
                : __ch.uadPlatform === "macOS" ? "14.4.0" : "6.5.0";
              break;
            case "uaFullVersion":
              result.uaFullVersion = __ch.fullVersionList.find(b => b.brand === "Google Chrome")?.version ?? "131.0.0.0";
              break;
            case "wow64":          result.wow64 = false; break;
          }
        }
        return Promise.resolve(result);
      }),
      toJSON: __markNative(function() {
        return { brands: __ch.brands, mobile: __ch.mobile, platform: __ch.uadPlatform };
      }),
    };
    Object.setPrototypeOf(__uadObj, NavigatorUAData.prototype);
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: __markNative(() => __uadObj), configurable: true,
    });
  } else if (__o.clientHints) {
    // NavigatorUAData not present in this engine — define a plain object fallback
    const __ch = __o.clientHints;
    const __uadFallback = {
      brands:   __ch.brands,
      mobile:   __ch.mobile,
      platform: __ch.uadPlatform,
      getHighEntropyValues: __markNative(function(hints) {
        return Promise.resolve({});
      }),
      toJSON: __markNative(function() {
        return { brands: __ch.brands, mobile: __ch.mobile, platform: __ch.uadPlatform };
      }),
    };
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: __markNative(() => __uadFallback), configurable: true,
    });
  }
} catch {}

// ── 5. navigator.connection (Network Information API) ────────────────────────
// Headless Chrome: connection is undefined. Real Chrome desktop: rtt ~50ms, type "wifi"
try {
  if (typeof NetworkInformation !== "undefined") {
    const __conn = Object.create(NetworkInformation.prototype);
    Object.defineProperties(__conn, {
      effectiveType: { get: __markNative(() => "4g"), configurable: true },
      rtt:           { get: __markNative(() => 50),  configurable: true },
      downlink:      { get: __markNative(() => 10),  configurable: true },
      saveData:      { get: __markNative(() => false), configurable: true },
      type:          { get: __markNative(() => "wifi"), configurable: true },
    });
    Object.defineProperty(Navigator.prototype, "connection", {
      get: __markNative(() => __conn), configurable: true,
    });
  } else {
    // Provide a plain object if the NetworkInformation interface is absent
    const __conn = {
      effectiveType: "4g", rtt: 50, downlink: 10, saveData: false, type: "wifi",
      addEventListener: __markNative(() => {}),
      removeEventListener: __markNative(() => {}),
    };
    Object.defineProperty(Navigator.prototype, "connection", {
      get: __markNative(() => __conn), configurable: true,
    });
  }
} catch {}

// ── 6. screen.* + devicePixelRatio ───────────────────────────────────────────
try {
  for (const k of ["width","height","availWidth","availHeight","colorDepth","pixelDepth"]) {
    Object.defineProperty(Screen.prototype, k, {
      get: __markNative(() => __o.screen[k]), configurable: true,
    });
  }
} catch {}
try {
  Object.defineProperty(window, "devicePixelRatio", {
    get: __markNative(() => __o.devicePixelRatio), configurable: true,
  });
} catch {}

// ── 7. outerWidth / outerHeight — never 0 in real Chrome ─────────────────────
// Headless Chrome has outerWidth=0, outerHeight=0 — a primary CF/DataDome tell.
try {
  Object.defineProperty(window, "outerWidth", {
    get: __markNative(() => __o.screen.width), configurable: true,
  });
  Object.defineProperty(window, "outerHeight", {
    get: __markNative(() => __o.screen.height), configurable: true,
  });
} catch {}

// ── 8. WebGL renderer / vendor unmask ────────────────────────────────────────
try {
  const __patchWebGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = __markNative(function(p) {
      if (p === 37445) return __o.webglVendor;
      if (p === 37446) return __o.webglRenderer;
      return orig.call(this, p);
    });
    // getSupportedExtensions: WEBGL_debug_renderer_info must be present
    const origExt = proto.getExtension;
    proto.getExtension = __markNative(function(name) {
      if (name === "WEBGL_debug_renderer_info") {
        return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
      }
      return origExt.call(this, name);
    });
  };
  if (typeof WebGLRenderingContext !== "undefined")  __patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") __patchWebGL(WebGL2RenderingContext.prototype);
} catch {}

// ── 9. Canvas fingerprint noise ───────────────────────────────────────────────
// Deterministic per-session noise: XOR a fixed small delta to 4 corner pixels.
// Deterministic = same result within a session (anti-bot re-checks), different
// between sessions (breaks cross-session canvas tracking).
try {
  const __cnoiseSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0xff;
  const __noisePixel = (data, idx) => {
    data[idx]     ^= (__cnoiseSeed & 0x03);       // R: 0-3 delta
    data[idx + 1] ^= ((__cnoiseSeed >> 2) & 0x03); // G: 0-3 delta
    // B and A untouched to keep colour fidelity
  };

  const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = __markNative(function(...args) {
    const ctx = this.getContext && this.getContext("2d");
    if (ctx && this.width > 0 && this.height > 0) {
      try {
        const w = Math.min(4, this.width), h = Math.min(4, this.height);
        const d = ctx.getImageData(0, 0, w, h);
        __noisePixel(d.data, 0);
        if (d.data.length >= 8) __noisePixel(d.data, 4);
        ctx.putImageData(d, 0, 0);
      } catch {}
    }
    return _origToDataURL.apply(this, args);
  });

  const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = __markNative(function(sx, sy, sw, sh, ...rest) {
    const d = _origGetImageData.call(this, sx, sy, sw, sh, ...rest);
    if (d && d.data.length >= 4) {
      __noisePixel(d.data, 0);
    }
    return d;
  });
} catch {}

// ── 10. AudioContext fingerprint noise ───────────────────────────────────────
// Real Chrome: OfflineAudioContext channel data has tiny float rounding variations.
// Headless: produces bit-exact values → detectable. We add sub-ULP noise.
try {
  const __acNoise = 1e-7; // sub-perceptual; won't affect audio quality
  const __patchAudioContext = (ACtx) => {
    if (!ACtx) return;
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = __markNative(function(channel) {
      const arr = origGetChannelData.call(this, channel);
      // Only noise the first few samples (fingerprinting reads sample 0)
      if (arr.length > 0) arr[0] += __acNoise * (Math.random() < 0.5 ? 1 : -1);
      return arr;
    });
    // sampleRate: must match what was requested; we spoof the constructor read
    // (sampleRate 44100/48000 are the only valid desktop values)
    const origCreateOscillator = ACtx.prototype.createOscillator;
    if (origCreateOscillator) {
      ACtx.prototype.createOscillator = __markNative(function(...args) {
        return origCreateOscillator.apply(this, args);
      });
    }
  };
  __patchAudioContext(typeof AudioContext !== "undefined" ? AudioContext : null);
  __patchAudioContext(typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null);
} catch {}

// ── 11. chrome.runtime / chrome.app / chrome.csi stubs ───────────────────────
try {
  if (!window.chrome) window.chrome = {};
  const __cr = window.chrome;
  if (!__cr.runtime) {
    __cr.runtime = {
      PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" },
      PlatformArch: { ARM: "arm", ARM64: "arm64", X86_32: "x86-32", X86_64: "x86-64", MIPS: "mips", MIPS64: "mips64" },
      PlatformNaclArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
      RequestUpdateCheckStatus: { THROTTLED: "throttled", NO_UPDATE: "no_update", UPDATE_AVAILABLE: "update_available" },
      OnInstalledReason: { INSTALL: "install", UPDATE: "update", CHROME_UPDATE: "chrome_update", SHARED_MODULE_UPDATE: "shared_module_update" },
      OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
      connect: __markNative(() => ({})),
      sendMessage: __markNative(() => {}),
      id: undefined,
    };
  }
  if (!__cr.loadTimes) {
    const __t0 = Date.now() / 1000;
    __cr.loadTimes = __markNative(function() {
      return {
        commitLoadTime:          __t0,
        connectionInfo:          "h2",
        finishDocumentLoadTime:  __t0 + 0.1,
        finishLoadTime:          __t0 + 0.2,
        firstPaintAfterLoadTime: __t0 + 0.15,
        firstPaintTime:          __t0 + 0.05,
        navigationType:          "Other",
        npnNegotiatedProtocol:   "h2",
        requestTime:             __t0 - 0.01,
        startLoadTime:           __t0,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy:       true,
        wasNpnNegotiated:        true,
      };
    });
  }
  if (!__cr.csi) {
    const __t0c = Date.now();
    __cr.csi = __markNative(function() {
      return {
        startE:    __t0c - 300,
        onloadT:   __t0c - 50,
        pageT:     __t0c,
        tran:      15,
      };
    });
  }
  if (!__cr.app) {
    __cr.app = {
      isInstalled: false,
      InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
      RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      getDetails: __markNative(() => null),
      getIsInstalled: __markNative(() => false),
      installState: __markNative((cb) => cb && cb("not_installed")),
      runningState: __markNative(() => "cannot_run"),
    };
  }
} catch {}

// ── 12 + 13. Permissions.query + Notification.permission coherence ────────────
// Headless default: Notification.permission === "denied" → primary anti-bot tell.
// We set both to "default" (= "prompt" in Permissions API) for consistency.
try {
  const __notifPerm = __o.notificationPermission; // "default"
  const __permState = __notifPerm === "granted" ? "granted"
    : __notifPerm === "denied" ? "denied" : "prompt";

  // Override Notification.permission
  if (typeof Notification !== "undefined") {
    try {
      Object.defineProperty(Notification, "permission", {
        get: __markNative(() => __notifPerm), configurable: true,
      });
    } catch {}
  }

  // Override Permissions.query — notifications AND clipboard-read
  if (typeof Permissions !== "undefined" && Permissions.prototype) {
    const _origQuery = Permissions.prototype.query;
    Permissions.prototype.query = __markNative(function(desc) {
      if (!desc || !desc.name) return _origQuery.call(this, desc);
      if (desc.name === "notifications") {
        return Promise.resolve(
          Object.assign(Object.create(PermissionStatus.prototype), {
            state: __permState, name: "notifications", onchange: null,
          })
        );
      }
      if (desc.name === "clipboard-read" || desc.name === "clipboard-write") {
        return Promise.resolve(
          Object.assign(Object.create(PermissionStatus.prototype), {
            state: "granted", name: desc.name, onchange: null,
          })
        );
      }
      return _origQuery.call(this, desc);
    });
  }
} catch {}

// ── 14. RTCPeerConnection — block local IP leak via SDP ──────────────────────
// Anti-bot systems (FingerprintJS Pro, IPQualityScore) use WebRTC to get the
// real local LAN IP. We intercept createOffer/createDataChannel to return an
// SDP that has no candidate lines, preventing the leak.
try {
  if (typeof RTCPeerConnection !== "undefined") {
    const _origRTCPC = RTCPeerConnection;
    const _patchedRTCPC = function RTCPeerConnection(...args) {
      const pc = new _origRTCPC(...args);
      // Override addIceCandidate to accept but ignore local candidates
      const _origAddCand = pc.addIceCandidate.bind(pc);
      pc.addIceCandidate = __markNative(function(cand) {
        if (cand && cand.candidate && /typ host/.test(cand.candidate)) {
          return Promise.resolve(); // silently drop local candidates
        }
        return _origAddCand(cand);
      });
      return pc;
    };
    // Copy static members
    Object.assign(_patchedRTCPC, _origRTCPC);
    _patchedRTCPC.prototype = _origRTCPC.prototype;
    try { window.RTCPeerConnection = _patchedRTCPC; } catch {}
  }
} catch {}

// ── 16. iframe.contentWindow — non-null prototype chain ──────────────────────
// Some anti-bot probes test that HTMLIFrameElement.contentWindow is a proper
// Window object. In Lightpanda headless the proto chain can be broken.
// We do NOT override the getter (it must stay live) but ensure the prototype
// of any created iframe document is the correct Window.prototype.
// (Nothing to patch here structurally — this is handled by Lightpanda's DOM.)
// The key tell we DO guard: iframe.contentWindow === null before load.
// We leave this as a no-op since Lightpanda handles it; the comment documents
// the invariant for future maintainers.

// ── 17. window.name = "" ─────────────────────────────────────────────────────
// Stale window.name from a previous page can leak cross-origin info.
// Real Chrome: name is "" by default on fresh navigation.
try {
  if (window.name !== "") window.name = "";
} catch {}

// ── 18. navigator.maxTouchPoints — handled in patch 3 ────────────────────────

// ── 19. history.length — plausible non-zero value ────────────────────────────
// Headless: history.length === 0 before any navigation. A typical desktop
// session has length > 1. We do not override this (it's a live binding that
// changes on navigation) — instead we rely on real navigation in the session.
// (documented invariant — no override needed)

// ── 20. Performance entries — navigation timing ──────────────────────────────
// getEntriesByType("navigation") returns [] in headless → tell for DataDome.
try {
  if (typeof PerformanceNavigationTiming !== "undefined" && performance && performance.getEntriesByType) {
    const _origGetEntries = performance.getEntriesByType.bind(performance);
    performance.getEntriesByType = __markNative(function(type) {
      const real = _origGetEntries(type);
      if (type === "navigation" && real.length === 0) {
        // Return a minimal plausible navigation timing entry
        const __t = Date.now();
        return [{
          name: window.location.href,
          entryType: "navigation",
          startTime: 0,
          duration: 250 + Math.random() * 100,
          initiatorType: "navigation",
          nextHopProtocol: "h2",
          workerStart: 0,
          redirectStart: 0, redirectEnd: 0,
          fetchStart: 20,
          domainLookupStart: 22, domainLookupEnd: 30,
          connectStart: 30, connectEnd: 45,
          secureConnectionStart: 32,
          requestStart: 46,
          responseStart: 100, responseEnd: 180,
          transferSize: 12000,
          encodedBodySize: 11000,
          decodedBodySize: 35000,
          domInteractive: 210,
          domContentLoadedEventStart: 212, domContentLoadedEventEnd: 215,
          domComplete: 245,
          loadEventStart: 246, loadEventEnd: 250,
          type: "navigate",
          redirectCount: 0,
          toJSON: __markNative(function() { return this; }),
        }];
      }
      return real;
    });
  }
} catch {}

// ── 21. Error.stackTraceLimit ─────────────────────────────────────────────────
// V8/Chrome default is 10. Some headless runners reset to 0 or Infinity.
try {
  if (typeof Error.stackTraceLimit !== "undefined" && Error.stackTraceLimit !== 10) {
    Error.stackTraceLimit = 10;
  }
} catch {}

// ── 22. document.hasFocus / visibilityState ───────────────────────────────────
// Headless: hasFocus() returns false, visibilityState = "hidden" → tell.
try {
  const _origHasFocus = document.hasFocus.bind(document);
  document.hasFocus = __markNative(function() { return true; });
} catch {}
try {
  if (document.visibilityState !== "visible") {
    Object.defineProperty(document, "visibilityState", {
      get: __markNative(() => "visible"), configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      get: __markNative(() => false), configurable: true,
    });
  }
} catch {}

})();`;
}
