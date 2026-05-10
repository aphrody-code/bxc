/**
 * @module bunlight/profiles
 *
 * Lazy profile router.
 *
 * bunlight is Lightpanda-first by design. Forbidden engines on Linux/macOS :
 * Chrome, Chromium, Firefox, Edge, Safari, and any derivative (patchright,
 * Playwright Chromium, Camoufox Firefox, Puppeteer-bundled chromium).
 *
 * On Windows, the `real-browser` profile attaches to the user's locally
 * installed Chrome (cf. `./real-browser/`), reusing their existing profile
 * (cookies, history, sessions) via `--remote-debugging-port` + puppeteer-extra
 * stealth plugins. This is opt-in and only available when the host platform
 * is Windows.
 *
 * Usage :
 *   const { StaticDomTransport } = await loadStaticProfile();
 *   const transport = StaticDomTransport.create();
 *
 * For server-grade anti-detection on top of Lightpanda, use
 * `launchGhostBrowser` from `./ghost/index.ts`.
 */

/** Human-readable profile identifiers. */
export type BunlightProfile = "static" | "fast" | "http" | "real-browser";

/** Lazily loads the `StaticDomTransport` class. */
export async function loadStaticProfile(): Promise<
	typeof import("../transport/StaticDomTransport.ts")
> {
	return import("../transport/StaticDomTransport.ts");
}

/** Lazily loads the `HttpProfileTransport` (curl-impersonate FFI). */
export async function loadHttpProfile(): Promise<
	typeof import("../transport/HttpProfileTransport.ts")
> {
	return import("../transport/HttpProfileTransport.ts");
}

/** Lazily loads the Lightpanda subprocess transport (`profile: "fast"`). */
export async function loadFastProfile(): Promise<
	typeof import("../transport/SocketPairTransport.ts")
> {
	return import("../transport/SocketPairTransport.ts");
}

/** Lazily loads the ghost helper (Lightpanda + CDP stealth injects). */
export async function loadGhostProfile(): Promise<typeof import("./ghost/index.ts")> {
	return import("./ghost/index.ts");
}

/**
 * Lazily loads the `real-browser` profile (Windows-only at the time of
 * writing). This profile attaches to a locally installed Chrome via
 * `--remote-debugging-port` and mounts the user's existing profile —
 * giving full access to their cookies, history, sessions, extensions
 * and saved logins. Combined with `puppeteer-extra` + stealth plugins
 * for the parts of the agent flow that need it.
 *
 * Throws on non-Windows hosts unless `BUNLIGHT_REAL_BROWSER_ANYHOST=1`
 * is set (escape hatch for macOS/Linux developers with Chrome installed
 * who accept the privacy implications).
 */
export async function loadRealBrowserProfile(): Promise<typeof import("./real-browser/index.ts")> {
	if (process.platform !== "win32" && process.env.BUNLIGHT_REAL_BROWSER_ANYHOST !== "1") {
		throw new Error(
			"profile=real-browser is Windows-only. Set BUNLIGHT_REAL_BROWSER_ANYHOST=1 to override on macOS/Linux.",
		);
	}
	return import("./real-browser/index.ts");
}
