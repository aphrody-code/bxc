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
 * @module bxc/profiles
 *
 * Lazy profile router.
 *
 * bxc is Lightpanda-only by design. Forbidden engines : Chrome,
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
export type BxcProfile = "static" | "fast" | "http";

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

/** Lazily loads the Chrome subprocess transport (`profile: "fast"`). */
export async function loadFastProfile(): Promise<
	typeof import("../transport/WebSocketTransport.ts")
> {
	return import("../transport/WebSocketTransport.ts");
}

/** Lazily loads the ghost helper (Lightpanda + CDP stealth injects). */
export async function loadGhostProfile(): Promise<typeof import("./ghost/index.ts")> {
	return import("./ghost/index.ts");
}
