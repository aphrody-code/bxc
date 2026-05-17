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
 * @module bxc/profiles/fingerprint
 *
 * Coherent browser fingerprint generator — a TypeScript implementation of the
 * fingerprint-generation logic originally provided by daijro/browserforge.
 *
 * The `browserforge` npm package on npm (v0.1.1) is an unrelated browser-session
 * recorder tool; this module provides the actual fingerprint generation that the
 * stealth/max profiles require.
 *
 * Generates UA, Accept-Language, platform, WebGL renderer/vendor, screen
 * resolution, device pixel ratio, and navigator fields as a coherent set so
 * anti-bot systems cannot detect mismatches.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedOS = "windows" | "macos" | "linux" | "android" | "ios";
export type SupportedBrowser = "chrome" | "firefox" | "safari" | "edge";

export interface FingerprintOptions {
	os?: SupportedOS;
	browser?: SupportedBrowser;
	/** Major browser version (e.g. 130 for Chrome 130). */
	version?: number;
	/** Random seed — omit for non-deterministic fingerprint. */
	seed?: number;
	/** Custom User-Agent to override generated one. */
	customUserAgent?: string;
	/** Custom platform to override generated one. */
	customPlatform?: string;
	/** Custom timezone to override generated one. */
	customTimezone?: string;
}

export interface BrowserFingerprint {
	userAgent: string;
	platform: string;
	/** navigator.language */
	language: string;
	/** navigator.languages */
	languages: string[];
	/** navigator.hardwareConcurrency */
	hardwareConcurrency: number;
	/** navigator.deviceMemory */
	deviceMemory: number;
	screen: {
		width: number;
		height: number;
		availWidth: number;
		availHeight: number;
		colorDepth: number;
		pixelDepth: number;
	};
	devicePixelRatio: number;
	/** UNMASKED_VENDOR_WEBGL */
	webglVendor: string;
	/** UNMASKED_RENDERER_WEBGL */
	webglRenderer: string;
	timezone: string;
	/** HTTP Accept-Language header value. */
	acceptLanguage: string;
	/** HTTP Accept header value. */
	accept: string;
	/** sec-ch-ua header value (Chrome/Edge only). */
	secChUa: string | null;
	/** sec-ch-ua-mobile header value. */
	secChUaMobile: string | null;
	/** sec-ch-ua-platform header value. */
	secChUaPlatform: string | null;
}

// ---------------------------------------------------------------------------
// Data pools
// ---------------------------------------------------------------------------

const CHROME_VERSIONS = [128, 129, 130, 131, 132, 133, 147] as const;
const FIREFOX_VERSIONS = [132, 133, 134, 135] as const;

const WINDOWS_UAS: Record<number, string> = {
	130: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	131: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	132: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
	133: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
	147: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

const LINUX_CHROME_UAS: Record<number, string> = {
	128: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	129: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
	130: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	131: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	132: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
	133: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
};

const LINUX_FIREFOX_UAS: Record<number, string> = {
	132: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
	133: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
	134: "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
	135: "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0",
};

const WINDOWS_FIREFOX_UAS: Record<number, string> = {
	132: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
	133: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	134: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
	135: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
};

const WEBGL_VENDORS = [
	"Google Inc. (NVIDIA)",
	"Google Inc. (AMD)",
	"Google Inc. (Intel)",
	"Google Inc.",
] as const;

const WEBGL_RENDERERS = [
	"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
	"ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
	"ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
	"ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)",
	"ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
	"Mesa/X.org",
] as const;

const LINUX_FIREFOX_WEBGL_VENDORS = ["Mesa/X.org", "VMware, Inc."] as const;
const LINUX_FIREFOX_WEBGL_RENDERERS = [
	"llvmpipe (LLVM 15.0.7, 256 bits)",
	"NV206 (NVIDIA GeForce RTX 3060/PCIe/SSE2)",
	"AMD Radeon RX 6600 XT (navi23, LLVM 15.0.7, DRM 3.54.0, 6.1.0-21-amd64)",
] as const;

const SCREEN_SIZES = [
	{ width: 1920, height: 1080 },
	{ width: 2560, height: 1440 },
	{ width: 1440, height: 900 },
	{ width: 1366, height: 768 },
	{ width: 1536, height: 864 },
	{ width: 2560, height: 1080 },
	{ width: 3840, height: 2160 },
] as const;

const TIMEZONES = [
	"America/New_York",
	"America/Chicago",
	"America/Los_Angeles",
	"America/Denver",
	"Europe/London",
	"Europe/Paris",
	"Europe/Berlin",
	"Europe/Amsterdam",
	"Asia/Tokyo",
	"Asia/Singapore",
] as const;

const LANGUAGES = [
	{ lang: "en-US", accept: "en-US,en;q=0.9" },
	{ lang: "en-GB", accept: "en-GB,en;q=0.9,en-US;q=0.8" },
	{ lang: "fr-FR", accept: "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7" },
	{ lang: "de-DE", accept: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7" },
	{ lang: "es-ES", accept: "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7" },
	{ lang: "ja-JP", accept: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" },
] as const;

// ---------------------------------------------------------------------------
// Seeded RNG (xorshift32 — no crypto needed, just diversity)
// ---------------------------------------------------------------------------

class SeededRandom {
	#state: number;

	constructor(seed: number) {
		this.#state = seed >>> 0 || 0xdeadbeef;
	}

	next(): number {
		let x = this.#state;
		x ^= x << 13;
		x ^= x >> 17;
		x ^= x << 5;
		this.#state = x >>> 0;
		return this.#state / 0x100000000;
	}

	pick<T>(arr: readonly T[]): T {
		return arr[Math.floor(this.next() * arr.length)];
	}

	pickN<T>(arr: readonly T[], n: number): T[] {
		const copy = [...arr];
		const result: T[] = [];
		for (let i = 0; i < n && copy.length > 0; i++) {
			const idx = Math.floor(this.next() * copy.length);
			result.push(copy[idx]);
			copy.splice(idx, 1);
		}
		return result;
	}

	integer(min: number, max: number): number {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generates a coherent browser fingerprint for stealth/max profiles.
 *
 * All fields (UA, WebGL, screen, languages, platform) are picked from the same
 * consistent profile so anti-bot systems cannot detect cross-field mismatches.
 */
export function generateFingerprint(opts: FingerprintOptions = {}): BrowserFingerprint {
	const seed = opts.seed ?? Date.now() ^ (Math.random() * 0x100000000);
	const rng = new SeededRandom(seed);

	const os = opts.os ?? (rng.next() < 0.6 ? "windows" : rng.next() < 0.7 ? "linux" : "macos");
	const browser = opts.browser ?? (rng.next() < 0.7 ? "chrome" : "firefox");

	const langEntry = rng.pick(LANGUAGES);
	const screen = rng.pick(SCREEN_SIZES);
	const dpr = rng.next() < 0.6 ? 1 : rng.next() < 0.7 ? 1.25 : 2;
	const tz = rng.pick(TIMEZONES);
	const cores = rng.pick([2, 4, 6, 8, 12, 16] as const);
	const memGb = rng.pick([2, 4, 8] as const);

	// User-Agent + platform + WebGL
	let userAgent: string;
	let platform: string;
	let webglVendor: string;
	let webglRenderer: string;
	let secChUa: string | null = null;
	let secChUaMobile: string | null = null;
	let secChUaPlatform: string | null = null;
	let accept: string;

	if (browser === "chrome" || browser === "edge") {
		const versionPool = CHROME_VERSIONS;
		const ver = opts.version ?? rng.pick(versionPool);
		const clampedVer = versionPool.includes(ver as (typeof versionPool)[number])
			? ver
			: versionPool[versionPool.length - 1];

		if (os === "windows") {
			userAgent = WINDOWS_UAS[clampedVer] ?? WINDOWS_UAS[133];
			platform = "Win32";
		} else if (os === "macos") {
			userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${clampedVer}.0.0.0 Safari/537.36`;
			platform = "MacIntel";
		} else {
			userAgent = LINUX_CHROME_UAS[clampedVer] ?? LINUX_CHROME_UAS[133];
			platform = "Linux x86_64";
		}

		webglVendor = rng.pick(WEBGL_VENDORS);
		webglRenderer = rng.pick(WEBGL_RENDERERS);
		secChUa = `"Google Chrome";v="${clampedVer}", "Chromium";v="${clampedVer}", "Not A(Brand";v="24"`;
		secChUaMobile = "?0";
		secChUaPlatform = `"${os === "windows" ? "Windows" : os === "macos" ? "macOS" : "Linux"}"`;
		accept =
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
	} else {
		// firefox
		const versionPool = FIREFOX_VERSIONS;
		const ver = opts.version ?? rng.pick(versionPool);
		const clampedVer = versionPool.includes(ver as (typeof versionPool)[number])
			? ver
			: versionPool[versionPool.length - 1];

		if (os === "windows") {
			userAgent = WINDOWS_FIREFOX_UAS[clampedVer] ?? WINDOWS_FIREFOX_UAS[135];
			platform = "Win32";
		} else {
			userAgent = LINUX_FIREFOX_UAS[clampedVer] ?? LINUX_FIREFOX_UAS[135];
			platform = "Linux x86_64";
		}

		webglVendor = rng.pick(LINUX_FIREFOX_WEBGL_VENDORS);
		webglRenderer = rng.pick(LINUX_FIREFOX_WEBGL_RENDERERS);
		accept =
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
	}

	return {
		userAgent: opts.customUserAgent ?? userAgent,
		platform: opts.customPlatform ?? platform,
		language: langEntry.lang,
		languages: langEntry.accept.split(",").map((l) => l.split(";")[0].trim()),
		hardwareConcurrency: cores,
		deviceMemory: memGb,
		screen: {
			width: screen.width,
			height: screen.height,
			availWidth: screen.width,
			availHeight: screen.height - rng.integer(24, 60),
			colorDepth: 24,
			pixelDepth: 24,
		},
		devicePixelRatio: dpr,
		webglVendor,
		webglRenderer,
		timezone: opts.customTimezone ?? tz,
		acceptLanguage: langEntry.accept,
		accept,
		secChUa,
		secChUaMobile,
		secChUaPlatform,
	};
}

/**
 * Returns the Playwright `extraHTTPHeaders` map derived from a fingerprint.
 * Use this with `context.setExtraHTTPHeaders(...)`.
 */
export function fingerprintToHeaders(fp: BrowserFingerprint): Record<string, string> {
	const headers: Record<string, string> = {
		"accept-language": fp.acceptLanguage,
		accept: fp.accept,
	};
	if (fp.secChUa) headers["sec-ch-ua"] = fp.secChUa;
	if (fp.secChUaMobile) headers["sec-ch-ua-mobile"] = fp.secChUaMobile;
	if (fp.secChUaPlatform) headers["sec-ch-ua-platform"] = fp.secChUaPlatform;
	return headers;
}

/**
 * Returns a `page.addInitScript` payload that overwrites browser APIs
 * with values from the fingerprint so JS-based probes return consistent data.
 *
 * Call this BEFORE navigating to any page.
 */
export function fingerprintToInitScript(fp: BrowserFingerprint): string {
	return `
(function() {
  // Overwrite navigator properties (only writable ones; webdriver is handled by patchright)
  const navOverrides = {
    platform:            ${JSON.stringify(fp.platform)},
    language:            ${JSON.stringify(fp.language)},
    languages:           ${JSON.stringify(fp.languages)},
    hardwareConcurrency: ${fp.hardwareConcurrency},
    deviceMemory:        ${fp.deviceMemory},
  };
  for (const [key, val] of Object.entries(navOverrides)) {
    try {
      Object.defineProperty(navigator, key, {
        get: () => val,
        configurable: true,
      });
    } catch {}
  }

  // Screen overrides
  const screenOverrides = {
    width:       ${fp.screen.width},
    height:      ${fp.screen.height},
    availWidth:  ${fp.screen.availWidth},
    availHeight: ${fp.screen.availHeight},
    colorDepth:  ${fp.screen.colorDepth},
    pixelDepth:  ${fp.screen.pixelDepth},
  };
  for (const [key, val] of Object.entries(screenOverrides)) {
    try {
      Object.defineProperty(screen, key, { get: () => val, configurable: true });
    } catch {}
  }

  // devicePixelRatio
  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      get: () => ${fp.devicePixelRatio},
      configurable: true,
    });
  } catch {}

  // WebGL unmasked vendor/renderer
  const origGetParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return ${JSON.stringify(fp.webglVendor)};
    if (param === 37446) return ${JSON.stringify(fp.webglRenderer)};
    return origGetParam.call(this, param);
  };
  const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return ${JSON.stringify(fp.webglVendor)};
    if (param === 37446) return ${JSON.stringify(fp.webglRenderer)};
    return origGetParam2.call(this, param);
  };
})();
`;
}
