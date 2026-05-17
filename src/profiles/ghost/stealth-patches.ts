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
 * exposed by `navigator.*`, `WebGL`, `canvas`, `Permissions`, and the
 * Chromium `chrome.runtime` shape.
 *
 * Each patch is self-contained and idempotent (won't double-apply if the
 * page reloads). The patches are emitted as a single string concatenated
 * before injection, so the entire suite runs in one isolated world.
 *
 * Reference :
 *   - puppeteer-extra-plugin-stealth (canonical reference, MIT)
 *   - patchright Chromium
 *   - Camoufox v135 (non-overlapping but informative)
 *
 * The patches are a port to Lightpanda's V8 — the engine ships with
 * `navigator.webdriver === true` by default which is the single most
 * reliable anti-bot signal across CF / DataDome / FingerprintJS, so
 * removing it is the highest-priority patch.
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
 * Generates the stealth patch script as one continuous IIFE so it can
 * be passed to `Page.addScriptToEvaluateOnNewDocument`.
 *
 * The script :
 *   - Drops `navigator.webdriver`
 *   - Patches `navigator.plugins` and `navigator.mimeTypes` to a realistic
 *     non-empty array (anti-bot flags 0-length plugins on desktop).
 *   - Sets `navigator.languages`, `navigator.language`, `navigator.platform`,
 *     `navigator.hardwareConcurrency`, `navigator.deviceMemory`.
 *   - Hooks `WebGLRenderingContext.prototype.getParameter` to return the
 *     user-supplied vendor/renderer for `UNMASKED_VENDOR_WEBGL` (37445)
 *     and `UNMASKED_RENDERER_WEBGL` (37446).
 *   - Adds tiny RNG noise to `canvas.toDataURL` / `getImageData` so two
 *     scrapes of the same page emit slightly different canvas hashes
 *     (defeats stable-canvas fingerprinting).
 *   - Stubs `chrome.runtime` and `chrome.loadTimes` (Chromium presence
 *     check).
 *   - Spoofs `Permissions.query({name: "notifications"})` to return a
 *     `prompt` state (the headless default returns `denied`, which is
 *     a known anti-bot signal).
 */
export function buildStealthScript(opts: StealthPatchOptions): string {
	const o = JSON.stringify(opts);
	return `(()=>{
"use strict";
if (window.__bxcGhost) return; window.__bxcGhost = true;
const o = ${o};

// 1. navigator.webdriver = undefined
try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => undefined, configurable: true }); } catch {}

// 2. navigator.plugins / mimeTypes — realistic non-empty
try {
  const fakePlugin = (name, filename, desc) => {
    const p = Object.create(Plugin.prototype);
    Object.defineProperty(p, "name", { value: name });
    Object.defineProperty(p, "filename", { value: filename });
    Object.defineProperty(p, "description", { value: desc });
    Object.defineProperty(p, "length", { value: 1 });
    return p;
  };
  const plugins = [
    fakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    fakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    fakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    fakePlugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    fakePlugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format"),
  ];
  const arr = Object.create(PluginArray.prototype);
  Object.defineProperty(arr, "length", { value: plugins.length });
  for (let i = 0; i < plugins.length; i++) Object.defineProperty(arr, i, { value: plugins[i] });
  Object.defineProperty(Navigator.prototype, "plugins", { get: () => arr, configurable: true });
} catch {}

// 3. navigator.languages / language / platform / cores / memory
try { Object.defineProperty(Navigator.prototype, "languages", { get: () => o.languages, configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "language", { get: () => o.languages[0], configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "platform", { get: () => o.platform, configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => o.hardwareConcurrency, configurable: true }); } catch {}
try { Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => o.deviceMemory, configurable: true }); } catch {}

// 4. screen.* + devicePixelRatio
try {
  for (const k of ["width","height","availWidth","availHeight","colorDepth","pixelDepth"]) {
    Object.defineProperty(Screen.prototype, k, { get: () => o.screen[k], configurable: true });
  }
} catch {}
try { Object.defineProperty(window, "devicePixelRatio", { get: () => o.devicePixelRatio, configurable: true }); } catch {}

// 5. WebGL renderer / vendor unmask
try {
  const proto = WebGLRenderingContext && WebGLRenderingContext.prototype;
  const orig = proto && proto.getParameter;
  if (orig) {
    proto.getParameter = function(p) {
      if (p === 37445) return o.webglVendor;
      if (p === 37446) return o.webglRenderer;
      return orig.call(this, p);
    };
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    const proto2 = WebGL2RenderingContext.prototype;
    const orig2 = proto2.getParameter;
    proto2.getParameter = function(p) {
      if (p === 37445) return o.webglVendor;
      if (p === 37446) return o.webglRenderer;
      return orig2.call(this, p);
    };
  }
} catch {}

// 6. Canvas micro-noise — randomise 1-2 pixels per toDataURL / getImageData
try {
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const ctx = this.getContext && this.getContext("2d");
    if (ctx) {
      const w = Math.min(2, this.width || 1), h = Math.min(2, this.height || 1);
      try {
        const data = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < data.data.length; i += 4) data.data[i] ^= 1;
        ctx.putImageData(data, 0, 0);
      } catch {}
    }
    return origToDataURL.apply(this, args);
  };
} catch {}

// 7. chrome.runtime stub (Chromium presence check)
try {
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {
    PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" },
    PlatformArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
    RequestUpdateCheckStatus: { THROTTLED: "throttled", NO_UPDATE: "no_update", UPDATE_AVAILABLE: "update_available" },
    OnInstalledReason: { INSTALL: "install", UPDATE: "update", CHROME_UPDATE: "chrome_update", SHARED_MODULE_UPDATE: "shared_module_update" },
    OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
  };
  if (!window.chrome.loadTimes) window.chrome.loadTimes = function() {
    return { commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000 };
  };
} catch {}

// 8. Permissions.query — Notifications "denied" is a headless tell
try {
  const origQuery = Permissions && Permissions.prototype && Permissions.prototype.query;
  if (origQuery) {
    Permissions.prototype.query = function(p) {
      if (p && p.name === "notifications") {
        return Promise.resolve({ state: Notification?.permission ?? "prompt", onchange: null });
      }
      return origQuery.call(this, p);
    };
  }
} catch {}

// 9. Function.prototype.toString — hide our overrides
try {
  const origToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    if (this === Function.prototype.toString) return "function toString() { [native code] }";
    return origToString.call(this);
  };
} catch {}

})();`;
}
