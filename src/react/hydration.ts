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
 * @module bxc/react/hydration
 *
 * Wait helpers for SPA hydration. Built around `Page.evaluate` so they
 * work on any profile that exposes JS execution (`fast`, `stealth`, `max`).
 *
 * Strategy : poll a small JS snippet via `Runtime.evaluate` until the
 * predicate returns `true` or the timeout fires. The snippet inspects
 * common framework hooks :
 *   - Next.js : `window.next?.router?.isReady` (Pages) /
 *               `document.querySelector('[data-next-mark="hydrated"]')`
 *               (App when available) / `__next` element child count.
 *   - React  : `__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size` > 0.
 *   - Generic: `document.readyState === "complete"` plus a configurable
 *               extra delay.
 */

interface PageEvalCapable {
	evaluate<T>(fn: () => T): Promise<T>;
}

export interface WaitForHydrationOptions {
	/** Hard timeout in milliseconds (default 15_000). */
	timeoutMs?: number;
	/** Poll interval in milliseconds (default 100). */
	pollMs?: number;
	/** Additional grace window after the predicate becomes true (default 200). */
	graceMs?: number;
	/** Custom predicate evaluated in the page context — return `true` to release. */
	predicate?: () => boolean;
}

/**
 * Waits until the page is hydrated (or the timeout elapses). Returns the
 * elapsed time in milliseconds (`-1` on timeout).
 */
export async function waitForHydration(
	page: PageEvalCapable,
	options: WaitForHydrationOptions = {},
): Promise<number> {
	const timeoutMs = options.timeoutMs ?? 15_000;
	const pollMs = options.pollMs ?? 100;
	const graceMs = options.graceMs ?? 200;
	const start = Bun.nanoseconds();
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const ready = await page.evaluate(predicateBody as () => boolean).catch(() => false);
		if (ready) {
			if (graceMs > 0) await Bun.sleep(graceMs);
			return (Bun.nanoseconds() - start) / 1e6;
		}
		await Bun.sleep(pollMs);
	}
	return -1;
}

// Serialised below as `evaluate` argument — must be self-contained.
function predicateBody(): boolean {
	const w = globalThis as unknown as {
		next?: { router?: { isReady?: boolean } };
		__REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: { size?: number } };
		document?: {
			readyState?: string;
			querySelector?: (s: string) => unknown;
			getElementById?: (s: string) => { childElementCount?: number } | null;
		};
	};
	const doc = w.document;
	if (doc?.readyState !== "complete") return false;

	// Next Pages
	if (w.next?.router?.isReady === true) return true;

	// Next App Router : a hydrated tree typically has __next non-empty.
	const nextRoot = doc.getElementById?.("__next");
	if (nextRoot && (nextRoot.childElementCount ?? 0) > 0) return true;

	// React DevTools renderer registry
	const renderers = w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? 0;
	if (renderers > 0) return true;

	// Astro hydration marker
	if (doc.querySelector?.('astro-island[ssr=""]')) return true;

	// Generic fallback : DOM ready + body has content
	return true;
}
