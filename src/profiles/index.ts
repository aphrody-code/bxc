/**
 * @module bunlight/profiles
 *
 * Lazy profile router.
 *
 * bunlight is Lightpanda-only by design. Forbidden engines : Chrome,
 * Chromium, Firefox, Edge, Safari, and any derivative (patchright,
 * Playwright Chromium, Camoufox Firefox, Puppeteer-bundled chromium).
 *
 * Usage :
 *   const { StaticDomTransport } = await loadStaticProfile();
 *   const transport = StaticDomTransport.create();
 *
 * For server-grade anti-detection on top of Lightpanda, use
 * `launchGhostBrowser` from `./ghost/index.ts`.
 */

/** Human-readable profile identifiers. */
export type BunlightProfile = "static" | "fast" | "http";

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
