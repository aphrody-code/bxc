// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/next-playwright/context
 *
 * The CDP cookie adapter. `@next/playwright`'s `instant()` talks to a
 * structural `PlaywrightBrowserContext` exposing `addCookies` / `cookies` /
 * `clearCookies`. bxc drives Chrome (and its `static` in-process DOM) over CDP
 * rather than Playwright's `BrowserContext`, so this module provides that exact
 * surface on top of a bxc page's CDP dispatch (`_send`), mapping the three
 * cookie ops onto `Network.setCookies` / `Network.getCookies` /
 * `Network.deleteCookies` (`src/cdp/domains/Network.ts`).
 *
 * It depends only on a `_send` seam, so it works with the `static` (offline)
 * transport, the `fast` (Lightpanda) transport, or a real Chrome target — any
 * CDP-backed bxc page.
 */

/** The narrow CDP dispatch seam a bxc page exposes (`src/api/browser.ts`). */
export interface CdpSend {
	_send(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** A cookie as returned to the caller (Playwright `cookies()` element). */
export interface PwCookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
}

/** A cookie to set (Playwright `addCookies` element / CDP `CookieParam`). */
export interface PwCookieParam {
	name: string;
	value: string;
	url?: string;
	domain?: string;
	path?: string;
}

/**
 * The structural `BrowserContext` surface consumed by `instant()`. Matches
 * `@next/playwright`'s `PlaywrightBrowserContext` byte-for-byte so the ported
 * `instant()` is unmodified.
 */
export interface PlaywrightBrowserContext {
	addCookies(cookies: PwCookieParam[]): Promise<void>;
	cookies(): Promise<PwCookie[]>;
	clearCookies(options?: {
		name?: string;
		domain?: string;
		path?: string;
	}): Promise<void>;
}

/**
 * A `PlaywrightBrowserContext` backed by a bxc CDP page. Construct directly
 * from a `_send` seam, or via {@link adaptPage} from a bxc `TestPage`.
 */
export class CdpCookieContext implements PlaywrightBrowserContext {
	readonly #send: CdpSend;

	constructor(send: CdpSend) {
		this.#send = send;
	}

	/** Maps onto `Network.setCookies` (the bxc shared cookie jar). */
	async addCookies(cookies: PwCookieParam[]): Promise<void> {
		await this.#send._send("Network.setCookies", { cookies });
	}

	/** Maps onto `Network.getCookies` with no URL filter (whole jar). */
	async cookies(): Promise<PwCookie[]> {
		const result = (await this.#send._send("Network.getCookies", {})) as {
			cookies?: PwCookie[];
		};
		return result.cookies ?? [];
	}

	/**
	 * Maps onto `Network.deleteCookies` / `Network.clearBrowserCookies`.
	 * - no options → wipe the jar;
	 * - `name` set → delete by name (+ optional domain/path scope);
	 * - domain/path only → enumerate the jar and delete each match by name.
	 */
	async clearCookies(options?: {
		name?: string;
		domain?: string;
		path?: string;
	}): Promise<void> {
		if (!options || (!options.name && !options.domain && !options.path)) {
			await this.#send._send("Network.clearBrowserCookies", {});
			return;
		}
		if (options.name) {
			await this.#send._send("Network.deleteCookies", {
				name: options.name,
				...(options.domain ? { domain: options.domain } : {}),
				...(options.path ? { path: options.path } : {}),
			});
			return;
		}
		// Scope without a name: enumerate and delete each matching entry.
		const all = await this.cookies();
		for (const c of all) {
			if (options.domain && c.domain !== options.domain) continue;
			if (options.path && c.path !== options.path) continue;
			await this.#send._send("Network.deleteCookies", {
				name: c.name,
				...(c.domain ? { domain: c.domain } : {}),
			});
		}
	}
}

/** A bxc page the adapter understands: a URL getter plus a CDP `_send` seam. */
export interface BxcPageLike {
	url(): string;
	/** bxc `TestPage` exposes this getter; falls back to a raw `_send`. */
	_cdp?: CdpSend;
	_send?: CdpSend["_send"];
}

/**
 * The structural `PlaywrightPage` consumed by `instant()`:
 * `{ url(), context() }`.
 */
export interface PlaywrightPage {
	url(): string;
	context(): PlaywrightBrowserContext;
}

/**
 * Wraps a bxc page (e.g. `@aphrody/bxc-test`'s `TestPage`) as the
 * structural `PlaywrightPage` that {@link instant} expects, bridging its
 * cookie context onto CDP. The returned context is memoised so nesting
 * detection (a single shared jar) behaves like Playwright's context scope.
 */
export function adaptPage(page: BxcPageLike): PlaywrightPage {
	const send: CdpSend =
		page._cdp ??
		(page._send
			? { _send: page._send.bind(page) }
			: (() => {
					throw new TypeError(
						"adaptPage: page exposes neither `_cdp` nor `_send` — pass a bxc TestPage or a CDP-backed page.",
					);
				})());
	const ctx = new CdpCookieContext(send);
	return {
		url: () => page.url(),
		context: () => ctx,
	};
}
