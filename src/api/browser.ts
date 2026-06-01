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
 * @module bxc/browser
 *
 * Public high-level API for Bxc.  Provides a `Browser` singleton and a
 * `Page` class that mirrors the Puppeteer surface, backed by an in-process CDP
 * transport so no external binary is required for static-DOM workloads.
 *
 * For full JavaScript-execution support (SPAs, JS challenges) pass
 * `{ mode: "full" }` to `Browser.newPage()`, which spawns Lightpanda via
 * `SocketPairTransport` instead.
 *
 * @example
 * ```ts
 * import { Browser } from "bxc/browser";
 *
 * const page = await Browser.newPage();
 * await page.goto("https://example.com");
 * console.log(await page.title());
 * await page.close();
 * ```
 *
 * @example
 * ```ts
 * // Puppeteer-compatible: connect puppeteer-core to the in-process transport
 * import puppeteer from "puppeteer-core";
 * import { Browser } from "bxc/browser";
 *
 * const puppeteerBrowser = await puppeteer.connect({
 *   transport: Browser.transport(),
 * });
 * const page = await puppeteerBrowser.newPage();
 * await page.goto("data:text/html,<h1>hi</h1>");
 * ```
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";
import {
	buildCookieHeader,
	injectCookies,
} from "../cookies/cookie-injector.ts";
import type { Cookie } from "../cookies/cookie-loader.ts";
import { loadCookieJar } from "../cookies/cookie-loader.ts";
import type { ImpersonatedClientOptions } from "../ffi/curl-impersonate.ts";
import { cdpCall as cdpCallShared } from "../internal/cdp-call.ts";
import type { WebSocketTransportOptions } from "../transport/WebSocketTransport.ts";
import { StaticDomTransport } from "../transport/StaticDomTransport.js";
import { Locator } from "./Locator.ts";
import { Frame } from "./Frame.ts";
import { BrowserContext } from "./BrowserContext.ts";
import type { AnyPage } from "./types.ts";
export { Locator, Frame, BrowserContext };
export { Actor, KeyValueStore, Dataset, ProxyConfiguration, type ProxyConfigurationOptions } from "../sdk/Actor.ts";

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

/** Options for `Browser.newPage()`. */
export interface PageOptions {
	/**
	 * Execution mode.
	 *
	 * - `"static"` (default): in-process, DOM-only, no binary required.
	 * - `"full"`: spawns the engine and connects via CDP WebSocket.
	 */
	mode?: "static" | "full";
	/**
	 * Headless override:
	 * - Default on Linux: `true` (Headless Dominance).
	 * - Default on Windows: `false` (Native Power - UI/GPU active).
	 */
	headless?: boolean;
	/**
	 * Bxc profile name.  When set, takes precedence over `mode`.
	 *
	 * - `"static"` -> in-process StaticDomTransport
	 * - `"fast"` / `"stealth"` / `"max"` -> WebSocketTransport spawning Chrome/bxc-engine
	 * - `"http"`   -> ImpersonatedClient (curl-impersonate) — TLS-fingerprinted
	 *                 HTTP only; no DOM, no JS execution, no binary required.
	 */
	profile?: "static" | "fast" | "http" | "stealth" | "max";
	/** Viewport dimensions (informational in static mode, forwarded in full mode). */
	viewport?: { width: number; height: number };
	/** User-agent override (forwarded as fetch header in static mode). */
	userAgent?: string;
	/** Options forwarded to `WebSocketTransport` in full mode. */
	spawnOpts?: WebSocketTransportOptions;
	/**
	 * Options for the `"http"` profile (curl-impersonate).
	 * `profile` defaults to `"chrome131"`, `timeoutMs` to `30_000`.
	 */
	httpOpts?: ImpersonatedClientOptions;
	/** Bypass TLS certificate validation. */
	insecure?: boolean;
	/**
	 * Pre-authenticated cookies to inject before any navigation.
	 *
	 * Accepts either a path to a cookie file (JSON Playwright/CDP format,
	 * Chrome DevTools JSON, or Netscape `cookies.txt`) or an in-memory
	 * `Cookie[]` array.
	 *
	 * Used to bypass Cloudflare challenges and login flows by reusing a
	 * session already validated in a real browser.
	 *
	 * Behaviour by profile:
	 * - `"static"` / `"fast"` → `Network.setCookies` via CDP (best-effort
	 *   on `static` since the in-process transport has no network stack).
	 * - `"http"` → cookies become a `Cookie:` header on every fetch (RFC
	 *   6265 domain/path-matched).
	 * - (forbidden engines) → fed into the patchright/Camoufox context
	 *   via `addCookies()` (in addition to the existing `cookieJar`
	 *   round-trip persistence).
	 *
	 * @example
	 * ```ts
	 * const page = await Browser.newPage({
	 *   profile: "http",
	 *   cookies: "./cookies/private/challonge.json",
	 *   httpOpts: { profile: "chrome131" },
	 * });
	 * await page.goto("https://challonge.com/fr/B_TS5");
	 * ```
	 */
	cookies?: string | Cookie[];
	/** Upstream proxy server URL (e.g. http://proxy.example.com:8080) */
	proxy?: string;
	/** Proxy authentication credentials (e.g. username:password) */
	proxyAuth?: string;
}

/**
 * CDP `Network.ResourceType` values that callers can pass to
 * `Page.blockResources(...)`.  Mirrors the protocol's `ResourceType` enum.
 */
export type ResourceType =
	| "Document"
	| "Stylesheet"
	| "Image"
	| "Media"
	| "Font"
	| "Script"
	| "TextTrack"
	| "XHR"
	| "Fetch"
	| "EventSource"
	| "WebSocket"
	| "Manifest"
	| "SignedExchange"
	| "Ping"
	| "CSPViolationReport"
	| "Preflight"
	| "Other";

/** Aliases accepted by `Page.blockResources()` (lowercase, friendly names). */
export type ResourceFamily =
	| "image"
	| "stylesheet"
	| "font"
	| "media"
	| "script"
	| "xhr"
	| "fetch"
	| "websocket"
	| "ping"
	| "manifest"
	| "other";

/**
 * Object passed to a route handler — either continue the request
 * unchanged or abort it.  Calling neither leaves the request hanging until
 * the navigation timeout fires.
 */
export interface InterceptedRoute {
	/** Original request URL. */
	url: string;
	/** HTTP method (GET, POST, ...). */
	method: string;
	/** CDP-classified resource type (best-effort). */
	resourceType: ResourceType | string;
	/** CDP-internal interception id (opaque). */
	interceptionId: string;
	/** Continue the request unmodified. */
	continue(): Promise<void>;
	/** Abort the request with the given reason (default: `Failed`). */
	abort(reason?: string): Promise<void>;
}

/** Handler signature for `Page.route(...)`. */
export type RouteHandler = (route: InterceptedRoute) => void | Promise<void>;

/** Options for `Page.goto()`. */
export interface GotoOptions {
	/** Network idle strategy.  Only `"domcontentloaded"` and `"load"` are
	 *  meaningful in static mode. */
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	/** Navigation timeout in milliseconds (default: 30 000). */
	timeoutMs?: number;
	/** HTTP Referer header. */
	referer?: string;
}

/** Options accepted by `Page.screenshot()`. */
export interface ScreenshotOptions {
	/** Image format (default: png). */
	format?: "png" | "jpeg";
	/** JPEG quality 0-100 (ignored for png). */
	quality?: number;
	/** Capture beyond the viewport when supported by the engine. */
	fullPage?: boolean;
}

/** Options for PDF generation (lightpanda-bin/chrome only). */
export interface PDFOptions {
	path?: string;
	scale?: number;
	displayHeaderFooter?: boolean;
	headerTemplate?: string;
	footerTemplate?: string;
	printBackground?: boolean;
	landscape?: boolean;
	pageRanges?: string;
	format?: string;
	width?: string | number;
	height?: string | number;
	margin?: {
		top?: string | number;
		right?: string | number;
		bottom?: string | number;
		left?: string | number;
	};
	preferCSSPageSize?: boolean;
	omitBackground?: boolean;
	timeout?: number;
}

/** Minimal HTTP-response-like object returned by `Page.goto()`. */
export interface NavigationResponse {
	/** Final URL after redirects. */
	url: string;
	/** HTTP status code (`0` for `data:` URIs and `about:blank`). */
	status: number;
	/** HTTP status text. */
	statusText: string;
	/** Whether the navigation was successful (2xx). */
	ok: boolean;
}

// ---------------------------------------------------------------------------
// CDP message helpers (used internally by Page)
// ---------------------------------------------------------------------------

interface CDPMessage {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * A browser page backed by a `StaticDomTransport` (or `SocketPairTransport` in
 * full mode).  Implements the `AsyncDisposable` protocol so `await using` works.
 *
 * Methods that require a JS engine in static mode return sensible stubs or
 * throw a descriptive error.
 */
export class Page implements AnyPage {
	readonly #transport: ConnectionTransport;
	readonly #sessionId: string;
	readonly #targetId: string;
	#url = "about:blank";
	#closed = false;

	#context: BrowserContext | null = null;
	#profile: string = "static";
	#mainFrame: Frame | null = null;

	/** @internal */
	_traceRecorder?: any;

	// Pending CDP call resolution table
	readonly #pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();
	#nextCdpId = 1;

	// Request interception state — registered routes (pattern + handler).
	readonly #routes: Array<{
		pattern: string | RegExp;
		handler: RouteHandler;
	}> = [];
	#interceptionEnabled = false;

	/** @internal — Bxc-private accessors (used by the singleton to wire cookies, etc.) */
	get _internalTransport(): ConnectionTransport {
		return this.#transport;
	}
	/** @internal */
	get _internalSessionId(): string {
		return this.#sessionId;
	}

	/** @internal — use `Page.create()` instead. */
	constructor(
		transport: ConnectionTransport,
		targetId: string,
		sessionId: string,
		context: BrowserContext | null = null,
		profile = "static",
	) {
		this.#transport = transport;
		this.#targetId = targetId;
		this.#sessionId = sessionId;
		this.#context = context;
		this.#profile = profile;

		// Hook into the transport message stream to route responses to pending calls
		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			this.#handleMessage(raw);
		};
	}

	// ---------------------------------------------------------------------------
	// Factory
	// ---------------------------------------------------------------------------

	/** @internal */
	static async create(
		transport: ConnectionTransport,
		opts: PageOptions = {},
		context: BrowserContext | null = null,
	): Promise<Page> {
		void opts; // forward viewport / userAgent in future phases
		const profile = opts.profile ?? (opts.mode === "full" ? "fast" : "static");

		// Ask the transport to create a new target and get back its targetId
		const result = (await Page.#cdpDirect(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };

		// Attach to get a sessionId
		const attached = (await Page.#cdpDirect(
			transport,
			"Target.attachToTarget",
			{
				targetId: result.targetId,
				flatten: true,
			},
		)) as { sessionId: string };

		const page = new Page(
			transport,
			result.targetId,
			attached.sessionId,
			context,
			profile,
		);

		// Enable page lifecycle events
		await page._send("Page.enable", {});
		await page._send("Runtime.enable", {});
		await page._send("Network.enable", {});

		if (opts.insecure) {
			await page._send("Security.setIgnoreCertificateErrors", { ignore: true });
		}

		return page;
	}

	/** Direct CDP call without a session (used during construction). */
	static #cdpDirect(
		transport: ConnectionTransport,
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		return cdpCallShared(transport, method, params);
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	context(): BrowserContext | null {
		return this.#context;
	}

	profile(): string {
		return this.#profile;
	}

	async upgradeProfile(
		newProfile: string,
		options?: PageOptions,
	): Promise<import("./types.ts").AnyPage> {
		this.#assertOpen();

		// In a full implementation, we'd need to migrate cookies via CDP
		// For now, Browser.newPage will share context cookies if #context exists

		let newPage: import("./types.ts").AnyPage;
		if (this.#context) {
			newPage = await this.#context.newPage({
				...options,
				profile: newProfile as any,
			});
		} else {
			newPage = await Browser.newPage({
				...options,
				profile: newProfile as any,
			});
		}

		if (this.#url !== "about:blank") {
			await newPage.goto(this.#url);
		}

		await this.close();
		return newPage;
	}

	/**
	 * Navigates the page to `url`.  In static mode, performs a `fetch()` and

	 * parses the HTML body.  Returns a minimal `NavigationResponse`.
	 */
	async goto(url: string, _opts?: GotoOptions): Promise<NavigationResponse> {
		this.#assertOpen();
		this._traceRecorder?.recordAction({ type: "goto", target: url });
		const result = (await this._send("Page.navigate", { url })) as {
			frameId: string;
			status?: number;
		};
		void result;
		this.#url = url;
		// In static mode the transport resolves to the final URL
		return {
			url,
			status:
				result.status ??
				(url.startsWith("data:") || url === "about:blank" ? 0 : 200),
			statusText: result.status === 200 ? "OK" : "Error",
			ok: result.status ? result.status >= 200 && result.status < 300 : true,
		};
	}

	/** Returns the document `<title>`. */
	async title(): Promise<string> {
		this.#assertOpen();
		try {
			const { result } = (await this._send("Runtime.evaluate", {
				expression: "document.title",
				returnByValue: true,
			})) as { result: { value?: string } };
			return (result.value as string) ?? "";
		} catch {
			return "";
		}
	}

	/** Returns the full `outerHTML` of the document root. */
	async content(): Promise<string> {
		this.#assertOpen();
		try {
			const doc = (await this._send("DOM.getDocument", { depth: 0 })) as {
				root: { nodeId: number };
			};
			const { outerHTML } = (await this._send("DOM.getOuterHTML", {
				nodeId: doc.root.nodeId,
			})) as { outerHTML: string };
			return outerHTML;
		} catch {
			// Fallback to Runtime.evaluate if DOM domain nodes are in transition
			try {
				const { result } = (await this._send("Runtime.evaluate", {
					expression: "document.documentElement.outerHTML",
					returnByValue: true,
				})) as { result: { value?: string } };
				return (result.value as string) ?? "";
			} catch {
				return "";
			}
		}
	}

	/**
	 * Returns the page content as clean GFM Markdown.
	 */
	async markdown(): Promise<string> {
		this.#assertOpen();
		const html = await this.content();
		const { htmlToMarkdown } = await import("../internal/html-utils.ts");
		return htmlToMarkdown(html);
	}

	/**
	 * Replaces the current page document with the provided HTML.
	 */
	async setContent(html: string): Promise<void> {
		this.#assertOpen();
		const frameTree = (await this._send("Page.getFrameTree", {})) as {
			frameTree: { frame: { id: string } };
		};
		await this._send("Page.setDocumentContent", {
			frameId: frameTree.frameTree.frame.id,
			html,
		});
	}

	locator(selector: string): Locator {
		return new Locator(this, selector);
	}

	mainFrame(): Frame {
		if (!this.#mainFrame) {
			const { Frame } = require("./Frame.ts");
			this.#mainFrame = new Frame(this, "");
		}
		return this.#mainFrame!;
	}

	frames(): Frame[] {
		return [this.mainFrame()];
	}

	/** Returns the current page URL. */
	url(): string {
		return this.#url;
	}

	/**
	 * Adds cookies to the current browser session via `Network.setCookies`.
	 * Each entry mirrors Playwright's `context.addCookies` shape: `name`,
	 * `value`, optional `url` / `domain` / `path` / `expires` / `secure` /
	 * `httpOnly` / `sameSite`.
	 */
	async addCookies(
		cookies: Array<{
			name: string;
			value: string;
			url?: string;
			domain?: string;
			path?: string;
			expires?: number;
			secure?: boolean;
			httpOnly?: boolean;
			sameSite?: "Strict" | "Lax" | "None";
		}>,
	): Promise<void> {
		this.#assertOpen();
		await this._send("Network.setCookies", { cookies });
	}

	/**
	 * Returns all cookies for the given URLs (defaults to the current page).
	 */
	async getCookies(urls?: string[]): Promise<
		Array<{
			name: string;
			value: string;
			domain: string;
			path: string;
			expires?: number;
			size: number;
			httpOnly: boolean;
			secure: boolean;
			session: boolean;
			sameSite?: string;
		}>
	> {
		this.#assertOpen();
		const params = urls ? { urls } : {};
		const result = (await this._send("Network.getCookies", params)) as {
			cookies: Array<Record<string, unknown>>;
		};
		return result.cookies as ReturnType<Page["getCookies"]> extends Promise<
			infer T
		>
			? T
			: never;
	}

	/**
	 * Clears cookies matching the optional filter (`name` / `domain` / `path` /
	 * `url`). When called with no args, clears all cookies in the session.
	 */
	async clearCookies(filter?: {
		name?: string;
		domain?: string;
		path?: string;
		url?: string;
	}): Promise<void> {
		this.#assertOpen();
		if (!filter) {
			await this._send("Network.clearBrowserCookies", {});
			return;
		}
		// CDP `Network.deleteCookies` requires `name`. When `name` is missing,
		// loop over all cookies and delete each that matches the other filters.
		if (filter.name) {
			await this._send("Network.deleteCookies", filter);
			return;
		}
		const all = await this.getCookies();
		for (const c of all) {
			if (filter.domain && c.domain !== filter.domain) continue;
			if (filter.path && c.path !== filter.path) continue;
			await this._send("Network.deleteCookies", {
				name: c.name,
				domain: c.domain,
			});
		}
	}

	/**
	 * Captures a PNG (default) or JPEG screenshot of the current page.
	 *
	 * Backed by CDP `Page.captureScreenshot`. Only profiles that bundle a
	 * rendering engine (`fast` Lightpanda, or `ghost`
	 * Camoufox) implement this. Profile=`static` throws CDPError -32000
	 * directing the caller to use a JS-capable profile.
	 *
	 * @param options.format `"png"` (default) or `"jpeg"`
	 * @param options.quality 0-100, only honored for jpeg
	 * @param options.fullPage when supported by the engine, captures beyond viewport
	 * @returns the screenshot as a `Uint8Array` (decoded base64)
	 *
	 * @example
	 * ```ts
	 * const png = await page.screenshot();
	 * await Bun.write("page.png", png);
	 * ```
	 */
	async screenshot(options: ScreenshotOptions = {}): Promise<Uint8Array> {
		this.#assertOpen();
		const params: Record<string, unknown> = {
			format: options.format ?? "png",
		};
		if (options.format === "jpeg" && typeof options.quality === "number") {
			params["quality"] = Math.max(0, Math.min(100, options.quality));
		}
		if (options.fullPage) {
			params["captureBeyondViewport"] = true;
		}
		const result = (await this._send("Page.captureScreenshot", params)) as {
			data: string;
		};
		// CDP returns base64-encoded PNG/JPEG; decode to Uint8Array (Bun-native).
		return Uint8Array.fromBase64(result.data);
	}

	/**
	 * Evaluates `fn` in the page context.  In static mode only trivial
	 * expressions are supported; for real JS execution use `mode: "full"`.
	 */
	async evaluate<T, R = unknown>(fn: (arg: R) => T, arg?: R): Promise<T> {
		this.#assertOpen();
		const expression = fn.toString();
		const { result } = (await this._send("Runtime.evaluate", {
			expression: `(${expression})(${arg !== undefined ? JSON.stringify(arg) : ""})`,
			returnByValue: true,
		})) as { result: { value?: unknown } };
		return result.value as T;
	}

	async pdf(_options?: PDFOptions): Promise<Uint8Array> {
		this.#assertOpen();
		throw new Error(
			"Page.pdf() is not fully implemented in static profile. Use fast profile for PDF.",
		);
	}

	/**
	 * Returns the first element matching `selector`, or `null`.
	 */
	async $<E = unknown>(sel: string): Promise<E | null> {
		this.#assertOpen();
		try {
			const doc = (await this._send("DOM.getDocument", { depth: 0 })) as {
				root: { nodeId: number };
			};
			const { nodeId } = (await this._send("DOM.querySelector", {
				nodeId: doc.root.nodeId,
				selector: sel,
			})) as { nodeId: number };
			if (!nodeId) return null;
			// Return a lightweight handle object (not a real DOM Element reference)
			return this.#makeHandle<E>(nodeId);
		} catch {
			return null;
		}
	}

	/**
	 * Returns all elements matching `selector`.
	 */
	async $$<E = unknown>(sel: string): Promise<E[]> {
		this.#assertOpen();
		try {
			const doc = (await this._send("DOM.getDocument", { depth: 0 })) as {
				root: { nodeId: number };
			};
			const { nodeIds } = (await this._send("DOM.querySelectorAll", {
				nodeId: doc.root.nodeId,
				selector: sel,
			})) as { nodeIds: number[] };
			return nodeIds.map((id) => this.#makeHandle<E>(id));
		} catch {
			return [];
		}
	}

	// ---------------------------------------------------------------------------
	// Request interception (Network.setRequestInterception / Fetch domain)
	// ---------------------------------------------------------------------------

	/**
	 * Registers a route handler that intercepts every request whose URL
	 * matches `pattern`.  The handler must call `route.continue()` or
	 * `route.abort()` to release the request.  Multiple routes may match the
	 * same request — handlers run in registration order, and the first one
	 * that resolves the route wins.
	 *
	 * Only effective on profiles that drive a real CDP-capable browser
	 * (`fast`, `ghost`).  In `static` mode this method is a no-op
	 * because there is no network stack to intercept.
	 *
	 * @example
	 * ```ts
	 * await page.route(/\.(png|jpg|gif)$/, route => route.abort());
	 * await page.route("**\/ads/*", route => route.abort());
	 * ```
	 */
	async route(pattern: string | RegExp, handler: RouteHandler): Promise<void> {
		this.#assertOpen();
		this.#routes.push({ pattern, handler });
		await this.#enableInterception();
	}

	/**
	 * Removes one route (matched by pattern reference) or every route when
	 * called with no arguments.
	 */
	async unroute(pattern?: string | RegExp): Promise<void> {
		this.#assertOpen();
		if (!pattern) {
			this.#routes.length = 0;
		} else {
			for (let i = this.#routes.length - 1; i >= 0; i--) {
				const route = this.#routes[i];
				if (route !== undefined && route.pattern === pattern)
					this.#routes.splice(i, 1);
			}
		}
		if (this.#routes.length === 0 && this.#interceptionEnabled) {
			this.#interceptionEnabled = false;
			await this._send("Network.setRequestInterception", {
				patterns: [],
			}).catch(() => undefined);
		}
	}

	/**
	 * Convenience: aborts every request whose CDP `resourceType` is in the
	 * given set.  Common families:
	 *   - `["image", "media", "font"]` — kill all rendering-only assets
	 *   - `["xhr", "fetch"]` — kill API calls (rarely useful)
	 *
	 * @example
	 * ```ts
	 * await page.blockResources(["image", "font", "media"]);
	 * ```
	 */
	async blockResources(families: ResourceFamily[]): Promise<void> {
		const blocked = new Set(families.map((f) => f.toLowerCase()));
		await this.route(/.*/i, async (route) => {
			const family = route.resourceType.toLowerCase();
			if (
				blocked.has(family) ||
				blocked.has(family.replace(/stylesheet/, "stylesheet"))
			) {
				await route.abort();
			} else {
				await route.continue();
			}
		});
	}

	/**
	 * Clicks the first element matching `selector`.
	 */
	async click(sel: string): Promise<void> {
		this.#assertOpen();
		const handle = await this.$(sel);
		if (!handle) throw new Error(`Element not found: ${sel}`);

		try {
			// Get element coordinates for a real click
			const { model } = (await this._send("DOM.getBoxModel", {
				nodeId: (handle as any).nodeId,
			})) as {
				model: { content: number[] };
			};
			const x = ((model.content[0] ?? 0) + (model.content[2] ?? 0)) / 2;
			const y = ((model.content[1] ?? 0) + (model.content[5] ?? 0)) / 2;

			await this._send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x,
				y,
				button: "left",
				clickCount: 1,
			});
			await this._send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x,
				y,
				button: "left",
				clickCount: 1,
			});
		} catch (err: any) {
			throw new Error(`Failed to click element '${sel}': ${err.message}`);
		}
	}

	/**
	 * Types `text` into the first element matching `selector`.
	 */
	async type(
		sel: string,
		text: string,
		options: { noClick?: boolean } = {},
	): Promise<void> {
		this.#assertOpen();
		if (!options.noClick) {
			await this.click(sel);
		}
		for (const char of text) {
			await this._send("Input.dispatchKeyEvent", {
				type: "keyDown",
				text: char,
			});
			await this._send("Input.dispatchKeyEvent", {
				type: "keyUp",
				text: char,
			});
		}
	}

	/**
	 * Waits for an element matching `selector` to appear in the DOM.
	 */
	async waitForSelector(sel: string, timeoutMs = 30_000): Promise<void> {
		this.#assertOpen();
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				const handle = await this.$(sel);
				if (handle) return;
			} catch {
				// Ignore errors like "Cannot find context with specified id" during navigation
			}
			await Bun.sleep(100);
		}
		throw new Error(`Timeout waiting for selector: ${sel}`);
	}

	/** Closes this page and releases its target. */
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		try {
			await Page.#cdpDirect(this.#transport, "Target.closeTarget", {
				targetId: this.#targetId,
			});
		} catch {
			// best-effort
		}
	}

	/** `AsyncDisposable` support — enables `await using page = ...`. */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/** Send a CDP command on this page's session and await the response. */
	_send(method: string, params: Record<string, unknown>): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const id = this.#nextCdpId++;
			this.#pending.set(id, { resolve, reject });
			this.#transport.send(
				JSON.stringify({ id, method, params, sessionId: this.#sessionId }),
			);
		});
	}

	#handleMessage(raw: string): void {
		let msg: CDPMessage;
		try {
			msg = JSON.parse(raw) as CDPMessage;
		} catch {
			return;
		}
		// Unsolicited event — used for request interception.
		if (msg.id === undefined) {
			if (
				msg.method === "Network.requestIntercepted" &&
				msg.sessionId === this.#sessionId &&
				this.#routes.length > 0
			) {
				this.#dispatchInterception(msg.params ?? {}).catch(() => undefined);
			}
			return;
		}
		const pending = this.#pending.get(msg.id);
		if (!pending) return;
		this.#pending.delete(msg.id);
		if (msg.error) {
			pending.reject(
				new Error(`CDP ${msg.method ?? "?"} error: ${msg.error.message}`),
			);
		} else {
			pending.resolve(msg.result);
		}
	}

	async #enableInterception(): Promise<void> {
		if (this.#interceptionEnabled) return;
		this.#interceptionEnabled = true;
		// Network.enable is already called in Page.create, but we re-issue it so
		// the interception registration is honoured even on transports where the
		// initial enable was a no-op.
		await this._send("Network.enable", {}).catch(() => undefined);
		await this._send("Network.setRequestInterception", {
			patterns: [{ urlPattern: "*" }],
		}).catch((err: Error) => {
			// Some transports (StaticDomTransport) do not implement interception —
			// silently disable rather than crash so the API remains uniform.
			this.#interceptionEnabled = false;
			void err;
		});
	}

	async #dispatchInterception(params: Record<string, unknown>): Promise<void> {
		const interceptionId = String(params["interceptionId"] ?? "");
		const request = (params["request"] ?? {}) as {
			url?: string;
			method?: string;
		};
		const url = String(request.url ?? "");
		const method = String(request.method ?? "GET");
		const resourceType = String(params["resourceType"] ?? "Other");

		let resolved = false;
		const route: InterceptedRoute = {
			url,
			method,
			resourceType,
			interceptionId,
			continue: async () => {
				if (resolved) return;
				resolved = true;
				await this._send("Network.continueInterceptedRequest", {
					interceptionId,
				}).catch(() => undefined);
			},
			abort: async (reason = "Failed") => {
				if (resolved) return;
				resolved = true;
				await this._send("Network.continueInterceptedRequest", {
					interceptionId,
					errorReason: reason,
				}).catch(() => undefined);
			},
		};

		// Run routes in order; the first one that resolves the route wins.
		for (const r of this.#routes) {
			if (!matchesPattern(url, r.pattern)) continue;
			try {
				await r.handler(route);
			} catch {
				/* swallow handler errors */
			}
			if (resolved) return;
		}
		// No route resolved — fall back to continue so the page keeps loading.
		if (!resolved) {
			await route.continue();
		}
	}

	/** Creates a minimal element-handle-like object for a given nodeId. */
	#makeHandle<E>(nodeId: number): E {
		const transport = this.#transport;
		const sessionId = this.#sessionId;

		const send = (
			method: string,
			params: Record<string, unknown>,
		): Promise<unknown> =>
			new Promise<unknown>((resolve, reject) => {
				const id = this.#nextCdpId++;
				this.#pending.set(id, { resolve, reject });
				transport.send(JSON.stringify({ id, method, params, sessionId }));
			});

		return {
			nodeId,
			/** Returns the outer HTML of this element. */
			async outerHTML(): Promise<string> {
				const { outerHTML } = (await send("DOM.getOuterHTML", { nodeId })) as {
					outerHTML: string;
				};
				return outerHTML;
			},
			/** Returns the inner text of this element (stripped of tags). */
			async textContent(): Promise<string> {
				const { outerHTML } = (await send("DOM.getOuterHTML", { nodeId })) as {
					outerHTML: string;
				};
				return outerHTML.replace(/<[^>]+>/g, "").trim();
			},
			/** Returns the value of an attribute. */
			async getAttribute(name: string): Promise<string | null> {
				const { node } = (await send("DOM.describeNode", { nodeId })) as {
					node: { attributes?: string[] };
				};
				const attrs = node.attributes ?? [];
				for (let i = 0; i < attrs.length - 1; i += 2) {
					if (attrs[i] === name) return attrs[i + 1] ?? null;
				}
				return null;
			},
		} as unknown as E;
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error("Page is closed");
	}
}

/**
 * Matches a URL against a glob-or-regexp pattern.  Globs support `*` (anything
 * not a `/`) and `**` (anything including `/`).
 */
function matchesPattern(url: string, pattern: string | RegExp): boolean {
	if (pattern instanceof RegExp) return pattern.test(url);
	if (pattern === "" || pattern === "*" || pattern === "**") return true;
	const re = globToRegExp(pattern);
	return re.test(url);
}

function globToRegExp(glob: string): RegExp {
	let out = "^";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i] ?? "";
		if (c === "*") {
			if (glob[i + 1] === "*") {
				out += ".*";
				i++;
			} else {
				out += "[^/]*";
			}
		} else if ("\\^$.|?+()[]{}".includes(c)) {
			out += `\\${c}`;
		} else {
			out += c;
		}
	}
	out += "$";
	return new RegExp(out);
}

// ---------------------------------------------------------------------------
// HttpPage — curl-impersonate backed page (no DOM, TLS-fingerprinted HTTP)
// ---------------------------------------------------------------------------

/**
 * A lightweight page backed by `ImpersonatedClient` (curl-impersonate).
 *
 * This profile performs pure HTTP/HTTPS requests with a spoofed TLS
 * fingerprint (JA3/JA4), bypassing bot-detection stacks that fingerprint
 * the TLS handshake.  It does **not** execute JavaScript or parse a DOM.
 *
 * Use `profile: "http"` in `Browser.newPage()`:
 *
 * ```ts
 * const page = await Browser.newPage({
 *   profile: "http",
 *   httpOpts: { profile: "chrome131" },
 * });
 * await page.goto("https://example.com");
 * const html = await page.content();
 * await page.close();
 * ```
 *
 * Or use `ImpersonatedClient` directly for full control:
 *
 * ```ts
 * import { ImpersonatedClient } from "bxc/ffi/curl-impersonate";
 * const client = new ImpersonatedClient({ profile: "chrome131" });
 * const res = await client.fetch("https://example.com");
 * console.log(await res.text());
 * client.close();
 * ```
 */
export class HttpPage implements AnyPage {
	readonly #client: import("../ffi/curl-impersonate.ts").ImpersonatedClient;
	readonly #cookies: Cookie[];
	readonly #userAgent?: string;
	readonly #insecure?: boolean;
	#url = "about:blank";
	#lastBody = "";
	#closed = false;

	readonly #context: BrowserContext | null;
	readonly #profile: string;

	/** @internal — use `Browser.newPage({ profile: "http" })` instead. */
	constructor(
		client: import("../ffi/curl-impersonate.ts").ImpersonatedClient,
		cookies: Cookie[] = [],
		userAgent?: string,
		context: BrowserContext | null = null,
		profile = "http",
		insecure = false,
	) {
		this.#client = client;
		this.#cookies = cookies;
		this.#userAgent = userAgent;
		this.#context = context;
		this.#profile = profile;
		this.#insecure = insecure;
	}

	context(): BrowserContext | null {
		return this.#context;
	}

	profile(): string {
		return this.#profile;
	}

	async upgradeProfile(
		newProfile: string,
		options?: PageOptions,
	): Promise<AnyPage> {
		this.#assertOpen();
		let newPage: AnyPage;
		if (this.#context) {
			newPage = await this.#context.newPage({
				...options,
				profile: newProfile as any,
			});
		} else {
			newPage = await Browser.newPage({
				...options,
				profile: newProfile as any,
			});
		}
		if (this.#url !== "about:blank") {
			await newPage.goto(this.#url);
		}
		await this.close();
		return newPage;
	}

	/**
	 * Performs an HTTP GET to `url` and stores the response body.
	 * Returns a minimal `NavigationResponse`.
	 */
	async goto(url: string, opts?: GotoOptions): Promise<NavigationResponse> {
		this.#assertOpen();
		const headers: Record<string, string> = {};
		if (opts?.referer) headers.referer = opts.referer;
		if (this.#userAgent) headers["user-agent"] = this.#userAgent;
		const cookieHeader = buildCookieHeader(this.#cookies, url);
		if (cookieHeader) headers.cookie = cookieHeader;

		const res = await this.#client.fetch(url, {
			method: "GET",
			followRedirects: true,
			timeoutMs: opts?.timeoutMs ?? 30_000,
			headers: Object.keys(headers).length > 0 ? headers : undefined,
			insecure: this.#insecure,
		});
		this.#url = res.effectiveUrl || url;
		this.#lastBody = await res.text();
		return {
			url: this.#url,
			status: res.status,
			statusText: res.statusText,
			ok: res.ok,
		};
	}

	/** Returns the raw response body from the last `goto()` call. */
	async content(): Promise<string> {
		this.#assertOpen();
		return this.#lastBody;
	}

	/** Returns the page content as clean GFM Markdown. */
	async markdown(): Promise<string> {
		this.#assertOpen();
		const html = await this.content();
		const { htmlToMarkdown } = await import("../internal/html-utils.ts");
		return htmlToMarkdown(html);
	}

	/**
	 * Attempts to extract `<title>` from the last response body.
	 * Returns an empty string if not parseable.
	 */
	async title(): Promise<string> {
		this.#assertOpen();
		const match = /<title[^>]*>([^<]*)<\/title>/i.exec(this.#lastBody);
		return match ? (match[1] ?? "").trim() : "";
	}

	/** Returns the current URL (after redirects). */
	url(): string {
		return this.#url;
	}

	async setContent(_html: string, _opts?: GotoOptions): Promise<void> {
		throw new Error("HttpPage does not support setContent()");
	}

	async addCookies(_cookies: any[]): Promise<void> {}

	locator(selector: string): Locator {
		const { Locator } = require("./Locator.ts");
		return new Locator(this as any, selector);
	}

	mainFrame(): Frame {
		const { Frame } = require("./Frame.ts");
		return new Frame(this as any, "");
	}

	frames(): Frame[] {
		return [this.mainFrame()];
	}

	/** Not supported in `http` profile — throws `Error`. */
	async evaluate<T, R = unknown>(_fn: (arg: R) => T, _arg?: R): Promise<T> {
		throw new Error(
			'HttpPage does not support evaluate() — use profile "static" or "fast" for JS execution',
		);
	}

	/** Not supported in `http` profile — returns `null`. */
	async $<E = unknown>(_sel: string): Promise<E | null> {
		throw new Error(
			'HttpPage does not support $() — use profile "static" or "fast" for DOM queries',
		);
	}

	/** Not supported in `http` profile — returns `[]`. */
	async $$<E = unknown>(_sel: string): Promise<E[]> {
		throw new Error(
			'HttpPage does not support $$() — use profile "static" or "fast" for DOM queries',
		);
	}

	async screenshot(_options?: ScreenshotOptions): Promise<Uint8Array> {
		throw new Error(
			'HttpPage does not support screenshot() — use profile "fast"',
		);
	}

	async pdf(_options?: PDFOptions): Promise<Uint8Array> {
		throw new Error('HttpPage does not support pdf() — use profile "fast"');
	}

	async aiExtract(_instruction: string): Promise<{
		data: Record<string, string | string[]>;
		selectors: Record<string, string>;
	}> {
		throw new Error("HttpPage does not support aiExtract()");
	}

	async aiAct(_instruction: string): Promise<void> {
		throw new Error("HttpPage does not support aiAct()");
	}

	/**
	 * Performs a raw fetch with the underlying `ImpersonatedClient`.
	 * Gives full access to method, body, headers, and profile override.
	 */
	async fetch(
		url: string,
		opts?: import("../ffi/curl-impersonate.ts").FetchOptions,
	): Promise<import("../ffi/curl-impersonate.ts").ImpersonatedResponse> {
		this.#assertOpen();
		const cookieHeader = buildCookieHeader(this.#cookies, url);
		if (!cookieHeader) return this.#client.fetch(url, opts);

		// Merge cookie header with existing headers (caller-supplied wins for
		// fields other than `cookie`; we always inject the matched cookie set).
		const merged: Record<string, string> = {};
		if (opts?.headers) {
			if (opts.headers instanceof Headers) {
				opts.headers.forEach((v, k) => {
					merged[k] = v;
				});
			} else {
				Object.assign(merged, opts.headers);
			}
		}
		merged.cookie = cookieHeader;
		return this.#client.fetch(url, { ...opts, headers: merged });
	}

	/** Closes the page and the underlying `ImpersonatedClient`. */
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#client.close();
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error("HttpPage is closed");
	}
}

// ---------------------------------------------------------------------------
// Note: classes for forbidden engines (Chromium / Firefox / Chrome / Edge /
// Safari) have been removed. bxc is Lightpanda-only. Use the `ghost`
// profile (`profile: "fast"` + stealth patches via CDP) for anti-detection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cookie resolution helper
// ---------------------------------------------------------------------------

/**
 * Normalises the `cookies` field in {@link PageOptions} into an in-memory
 * {@link Cookie}[].  Accepts a path string (loaded from disk) or an existing
 * array (returned as-is, after expiry filtering).
 */
async function resolveCookies(
	input: string | Cookie[] | undefined,
): Promise<Cookie[]> {
	if (!input) return [];
	if (Array.isArray(input)) {
		const now = Math.floor(Date.now() / 1000);
		return input.filter((c) => c.expires <= 0 || c.expires > now);
	}
	return loadCookieJar(input);
}

// ---------------------------------------------------------------------------
// BrowserSingleton
// ---------------------------------------------------------------------------

/**
 * Lazily initialised browser singleton.  A new `StaticDomTransport` is created
 * on first use and reused across calls.  Call `Browser.close()` to tear it down
 * (a new one will be created on the next `newPage()`).
 */
class BrowserSingleton {
	// Lazy fallback transport returned by `Browser.transport()` for callers that
	// want a Puppeteer-compatible `ConnectionTransport` reference (e.g.,
	// `puppeteer.connect({ transport: Browser.transport() })`). It is NOT shared
	// across `Browser.newPage({ profile: "static" })` calls — each page gets its
	// own fresh transport (see `newPage()` below) so concurrent CDP message ids
	// never collide.
	#transport: StaticDomTransport | null = null;
	readonly #pages: Page[] = [];
	// Tracks the StaticDomTransport tied to each static-profile page so it can
	// be torn down when the page closes (no process leak — purely in-process,
	// but releases the zigquery doc handles held by the handler).
	readonly #staticTransports = new Map<Page, StaticDomTransport>();
	// Tracks the SocketPairTransport tied to each fast-profile page so the
	// sub-process is killed when the page is closed.
	readonly #fastTransports = new Map<Page, { closeProcess(): Promise<void> }>();
	readonly #contexts: BrowserContext[] = [];

	/**
	 * Creates a new browser context. Contexts provide isolation between pages.
	 */
	async newContext(): Promise<BrowserContext> {
		const context = new BrowserContext();
		this.#contexts.push(context);
		return context;
	}

	/**
	 * Returns (or lazily creates) a `StaticDomTransport` for callers that need a
	 * Puppeteer-compatible transport reference. This transport is independent
	 * of pages opened via `newPage({ profile: "static" })` — those each get
	 * their own fresh transport instance to avoid concurrent CDP id collisions.
	 */
	transport(): StaticDomTransport {
		if (!this.#transport || this.#transport.closed) {
			this.#transport = StaticDomTransport.create();
		}
		return this.#transport;
	}

	/**
	 * Opens a new page.
	 *
	 * Profile selection:
	 * - `profile: "static"` (or `mode: "static"`, default) uses the shared
	 *   `StaticDomTransport`.
	 * - `profile: "fast"` (or `mode: "full"`) spawns a Lightpanda sub-process
	 *   via `SocketPairTransport` for full SPA support.
	 * - `profile: "http"` uses `ImpersonatedClient` (curl-impersonate) for
	 *   TLS-fingerprinted HTTP fetches with no DOM or binary spawn required.
	 *
	 * Forbidden engines : Chrome / Chromium / Firefox / Edge / Safari and
	 * derivatives (patchright, Camoufox, Playwright Chromium, Puppeteer).
	 * For server-grade anti-detection use the `ghost` helper in
	 * `src/profiles/ghost/` (profile=fast + CDP stealth injects).
	 */
	async newPage(
		opts: PageOptions = {},
		context: BrowserContext | null = null,
	): Promise<AnyPage> {
		const profile = opts.profile ?? (opts.mode === "full" ? "fast" : "static");

		// Resolve cookies once up-front so all profiles share the same input.
		const cookies = await resolveCookies(opts.cookies);

		// "http" profile — TLS-fingerprinted HTTP via curl-impersonate (no DOM)
		if (profile === "http") {
			const { ImpersonatedClient } = await import("../ffi/curl-impersonate.ts");
			const curlClient = new ImpersonatedClient(
				opts.httpOpts ?? { profile: "chrome131" },
			);
			const page = new HttpPage(
				curlClient,
				cookies,
				opts.userAgent,
				context,
				"http",
				opts.insecure,
			);
			return page;
		}

		if (profile === "fast" || profile === "stealth" || profile === "max") {
			const { WebSocketTransport } = await import(
				"../transport/WebSocketTransport.ts"
			);
			const fullTransport = await WebSocketTransport.create({
				headless: opts.headless,
				insecure: opts.insecure,
				proxy: opts.proxy,
				proxyAuth: opts.proxyAuth,
				...opts.spawnOpts,
			});
			const page = await Page.create(fullTransport, opts, context);
			this.#pages.push(page);
			this.#fastTransports.set(page, fullTransport as any);

			if (cookies.length > 0) {
				await injectCookies(
					page._internalTransport,
					cookies,
					page._internalSessionId,
				).catch(() => undefined);
			}

			const originalClose = page.close.bind(page);
			(page as unknown as { close: () => Promise<void> }).close = async () => {
				try {
					await originalClose();
				} finally {
					const transport = this.#fastTransports.get(page) as any;
					this.#fastTransports.delete(page);
					if (transport && typeof transport.closeProcess === "function") {
						await transport.closeProcess().catch(() => undefined);
					}
				}
			};
			return page;
		}

		// "static" profile — each page gets its own transport instance so the
		// per-page CDP id counter (Page#nextCdpId) and the transport's pending
		// table cannot collide with sibling pages running concurrently. This
		// fixes the race documented in docs/BENCHMARKS.md (parallel-100).
		// Best-effort cookie injection (StaticDomTransport has no real network
		// stack so injectCookies will degrade silently).
		const t = StaticDomTransport.create();
		const page = await Page.create(t, opts, context);
		this.#pages.push(page);
		this.#staticTransports.set(page, t);
		if (cookies.length > 0) {
			await injectCookies(
				page._internalTransport,
				cookies,
				page._internalSessionId,
			).catch(() => undefined);
		}
		// Wrap close() so the per-page transport is torn down with the page.
		const originalStaticClose = page.close.bind(page);
		(page as unknown as { close: () => Promise<void> }).close = async () => {
			try {
				await originalStaticClose();
			} finally {
				const transport = this.#staticTransports.get(page);
				this.#staticTransports.delete(page);
				transport?.close();
			}
		};
		return page;
	}

	/** Returns all open pages managed by this singleton. */
	pages(): Page[] {
		return [...this.#pages];
	}

	/** Returns the Bxc version string. */
	version(): string {
		return "Bxc/0.1.0 (StaticDomTransport; SocketPairTransport; curl-impersonate; ghost)";
	}

	/** Closes the browser singleton, terminating any open pages. */
	async close(): Promise<void> {
		await Promise.all(this.#pages.map((p) => p.close().catch(() => undefined)));
		// Tear down any fast-profile sub-processes
		await Promise.all(
			Array.from(this.#fastTransports.values()).map((t) =>
				t.closeProcess().catch(() => undefined),
			),
		);
		this.#fastTransports.clear();
		// Tear down any leftover per-page static transports (page.close should
		// have already cleaned them up, but be defensive on error paths).
		for (const t of this.#staticTransports.values()) {
			t.close();
		}
		this.#staticTransports.clear();
		this.#pages.length = 0;
		this.#transport?.close();
		this.#transport = null;
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * The default Bxc browser instance.  Lazily initialised on first use and
 * automatically closed at process exit.
 *
 * @example
 * ```ts
 * const page = await Browser.newPage();
 * await page.goto("https://example.com");
 * const title = await page.title();
 * await page.close();
 * ```
 *
 * @example Anti-detection (Lightpanda + ghost stealth injects):
 * ```ts
 * import { launchGhostBrowser } from "@aphrody-code/bxc/profiles/ghost";
 * const ghost = await launchGhostBrowser({
 *   fingerprint: { os: "linux", browser: "chrome", version: 131 },
 *   locale: "fr-FR",
 *   timezone: "Europe/Paris",
 *   cookies: "./cookies/private/challonge.json",
 * });
 * await ghost.page.goto("https://nowsecure.nl");
 * await ghost.close();
 * ```
 */
export const Browser: {
	/**
	 * Opens a new page.  The returned type depends on the `profile` option:
	 * - `"static"` / `"fast"` / default → `Page` (CDP-backed, DOM-capable)
	 * - `"http"` → `HttpPage` (curl-impersonate, TLS-fingerprinted HTTP only)
	 *
	 * Forbidden engines (Chrome / Chromium / Firefox / Edge / Safari and
	 * derivatives) are not exposed. Use `launchGhostBrowser` from
	 * `src/profiles/ghost/` for anti-detection on top of Lightpanda.
	 */
	newPage(
		opts?: PageOptions,
		context?: BrowserContext | null,
	): Promise<AnyPage>;
	/**
	 * Creates a new browser context. Contexts provide isolation between pages.
	 */
	newContext(): Promise<BrowserContext>;
	/** Returns all CDP-backed pages managed by this browser instance. */
	pages(): AnyPage[];
	/** Returns the Bxc version string. */
	version(): string;
	/** Closes all pages and disposes the underlying transport. */
	close(): Promise<void>;
	/**
	 * Returns the underlying `ConnectionTransport` that Puppeteer can connect to.
	 *
	 * @example
	 * ```ts
	 * import puppeteer from "puppeteer-core";
	 * import { Browser } from "bxc/browser";
	 *
	 * const b = await puppeteer.connect({ transport: Browser.transport() });
	 * ```
	 */
	transport(): ConnectionTransport;
} = new BrowserSingleton();

// Auto-close on process exit to avoid fd / memory leaks
process.on("exit", () => {
	Browser.close().catch(() => undefined);
});
