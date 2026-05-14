/**
 * HttpProfileTransport — degraded CDP server backed by curl-impersonate for
 * HTTP navigation and zigquery for DOM queries.
 *
 * Supported CDP methods:
 *   Browser.getVersion
 *   Target.{createTarget, attachToTarget, getTargetInfo, setDiscoverTargets,
 *            setAutoAttach, getBrowserContexts, closeTarget}
 *   Page.{enable, navigate, getFrameTree, setLifecycleEventsEnabled,
 *          addScriptToEvaluateOnNewDocument, bringToFront, reload}
 *   DOM.{getDocument, querySelector, querySelectorAll, getOuterHTML, describeNode}
 *   Runtime.{enable, evaluate}
 *   Network.enable
 *   Emulation.*  (no-op stubs)
 *   Security.*   (no-op stubs)
 *   Audits.enable, Performance.enable, Log.enable  (no-op stubs)
 *
 * All other methods return CDPError -32601 "not supported in http profile".
 *
 * Architecture:
 *   The transport is a `ConnectionTransport`-compatible object (same interface
 *   used by Puppeteer / agent-browser).  `send()` receives a raw CDP JSON string,
 *   dispatches to the internal handler, and enqueues the response via
 *   `onmessage` in the next microtask.  This mirrors `InProcessTransport`.
 *
 * Navigation:
 *   `Page.navigate` calls `ImpersonatedClient.fetch(url)` with the configured
 *   TLS impersonation profile (default: chrome131).  The response body is
 *   stored as the current page's HTML and parsed lazily by zigquery (or the
 *   regex fallback).
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";
import type { ImpersonatedClientOptions } from "../ffi/curl-impersonate.ts";
import {
	isZigQueryAvailable,
	type ZigDoc,
	parseHtml as zigParseHtml,
} from "../ffi/zigquery.js";
import {
	extractTitle,
	openingTagOf,
	parseAttributes,
	stripTags,
} from "../internal/html-utils.ts";

// ---------------------------------------------------------------------------
// Minimal parsed-document model (same shape as StaticDomTransport internals)
// ---------------------------------------------------------------------------

interface ParsedNode {
	nodeId: number;
	tagName: string;
	outerHTML: string;
	textContent: string;
	attributes: Record<string, string>;
}

class ParsedDocument {
	readonly rawHtml: string;
	readonly url: string;
	readonly title: string;
	readonly rootId: number;

	readonly #nodes = new Map<number, ParsedNode>();
	#nextId = 1;
	readonly #zigDoc: ZigDoc | null;
	readonly #useZig: boolean;

	constructor(html: string, url = "about:blank") {
		this.rawHtml = html;
		this.url = url;
		this.title = extractTitle(html);
		this.rootId = this.#allocId();
		this.#nodes.set(this.rootId, {
			nodeId: this.rootId,
			tagName: "#document",
			outerHTML: html,
			textContent: stripTags(html),
			attributes: {},
		});

		if (isZigQueryAvailable()) {
			try {
				this.#zigDoc = zigParseHtml(html);
				this.#useZig = true;
			} catch {
				this.#zigDoc = null;
				this.#useZig = false;
			}
		} else {
			this.#zigDoc = null;
			this.#useZig = false;
		}
	}

	destroy(): void {
		this.#zigDoc?.destroy();
	}

	#allocId(): number {
		return this.#nextId++;
	}

	querySelectorAll(selector: string): ParsedNode[] {
		if (this.#useZig && this.#zigDoc) {
			const sel = this.#zigDoc.find(selector);
			const out: ParsedNode[] = [];
			for (let i = 0; i < sel.count; i++) {
				const el = sel.at(i);
				if (!el) continue;
				const id = this.#allocId();
				const outerHTML = el.outerHTML();
				const node: ParsedNode = {
					nodeId: id,
					tagName: el.tagName().toLowerCase(),
					outerHTML,
					textContent: el.textContent(),
					attributes: parseAttributes(openingTagOf(outerHTML)),
				};
				this.#nodes.set(id, node);
				out.push(node);
			}
			sel.destroy();
			return out;
		}
		return [];
	}

	querySelector(selector: string): ParsedNode | undefined {
		return this.querySelectorAll(selector)[0];
	}

	getNodeById(nodeId: number): ParsedNode | undefined {
		return this.#nodes.get(nodeId);
	}
}

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

interface HttpPageState {
	targetId: string;
	sessionId: string;
	frameId: string;
	url: string;
	title: string;
	doc: ParsedDocument | null;
	loaderId: string;
	loaderCounter: number;
}

// ---------------------------------------------------------------------------
// CDP message types (subset used internally)
// ---------------------------------------------------------------------------

interface CDPRequest {
	id: number;
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
}

interface CDPResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
	sessionId?: string;
}

interface CDPEvent {
	method: string;
	params?: unknown;
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// HttpProfileTransport
// ---------------------------------------------------------------------------

const HTTP_PROFILE_VERSION = "Bunlight/0.1.0 (http; curl-impersonate)";
const HTTP_PROFILE_PRODUCT = "Bunlight/0.1.0 HttpProfile";

const NOT_SUPPORTED_MSG =
	"not supported in http profile (HTTP-only, no JS engine, no input layer)";

/** Methods that return {} as a no-op stub. */
const NOOP_METHODS = new Set<string>([
	"Page.enable",
	"Page.setLifecycleEventsEnabled",
	"Page.addScriptToEvaluateOnNewDocument",
	"Page.createIsolatedWorld",
	"Page.setBypassCSP",
	"Page.setCacheEnabled",
	"Page.bringToFront",
	"Page.resetNavigationHistory",
	"Runtime.enable",
	"Runtime.runIfWaitingForDebugger",
	"Network.enable",
	"Network.setExtraHTTPHeaders",
	"Network.setCookies",
	"Network.setRequestInterception",
	"Emulation.setDeviceMetricsOverride",
	"Emulation.clearDeviceMetricsOverride",
	"Emulation.setTouchEmulationEnabled",
	"Emulation.setScrollbarsHidden",
	"Emulation.setEmulatedMedia",
	"Emulation.setUserAgentOverride",
	"Emulation.setGeolocationOverride",
	"Emulation.setLocaleOverride",
	"Emulation.setTimezoneOverride",
	"Security.setIgnoreCertificateErrors",
	"Audits.enable",
	"Performance.enable",
	"Log.enable",
	"Target.setDiscoverTargets",
	"Target.setAutoAttach",
	"Target.getBrowserContexts",
]);

/**
 * A degraded CDP server that uses curl-impersonate for HTTP navigation and
 * zigquery for DOM queries.  No JavaScript engine, no input layer.
 *
 * Implements the `ConnectionTransport` interface so it can be bridged through
 * the same `Bun.serve` WebSocket layer used by `startStatic` in `serve.ts`.
 *
 * @example
 * ```ts
 * const transport = await HttpProfileTransport.create({ profile: "chrome131" });
 * // Wire into Bun.serve websocket handler
 * transport.onmessage = (msg) => ws.send(msg);
 * transport.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));
 * ```
 */
export class HttpProfileTransport implements ConnectionTransport {
	onmessage?: (message: string) => void;
	onclose?: () => void;

	readonly #client: import("../ffi/curl-impersonate.ts").ImpersonatedClient;
	readonly #pages = new Map<string, HttpPageState>();
	#pageCounter = 0;
	#closed = false;

	/** @internal — use `HttpProfileTransport.create()` */
	constructor(client: import("../ffi/curl-impersonate.ts").ImpersonatedClient) {
		this.#client = client;
	}

	/**
	 * Creates a new `HttpProfileTransport` with the given curl-impersonate options.
	 */
	static async create(
		opts: ImpersonatedClientOptions = {},
	): Promise<HttpProfileTransport> {
		const { ImpersonatedClient } = await import("../ffi/curl-impersonate.ts");
		const client = new ImpersonatedClient({ profile: "chrome131", ...opts });
		return new HttpProfileTransport(client);
	}

	/**
	 * Receives a raw CDP JSON message (from Puppeteer / agent-browser / a
	 * WebSocket bridge) and enqueues the response via `onmessage`.
	 */
	send(message: string): void {
		if (this.#closed) return;

		let req: CDPRequest;
		try {
			req = JSON.parse(message) as CDPRequest;
		} catch {
			return;
		}

		this.#handle(req).then(
			(result) => {
				this.#dispatch({
					id: req.id,
					result,
					sessionId: req.sessionId,
				} satisfies CDPResponse);
			},
			(err: unknown) => {
				const error =
					err instanceof CDPError
						? { code: err.code, message: err.message }
						: {
								code: -32000,
								message: err instanceof Error ? err.message : String(err),
							};
				this.#dispatch({
					id: req.id,
					error,
					sessionId: req.sessionId,
				} satisfies CDPResponse);
			},
		);
	}

	/** Closes the transport and the underlying curl-impersonate client. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		try {
			this.#client.close();
		} catch {
			// best effort
		}
		// Destroy any parsed documents to release zigquery memory.
		for (const page of this.#pages.values()) {
			page.doc?.destroy();
		}
		this.#pages.clear();
		queueMicrotask(() => {
			this.onclose?.();
		});
	}

	get closed(): boolean {
		return this.#closed;
	}

	// ---------------------------------------------------------------------------
	// Private — CDP dispatch
	// ---------------------------------------------------------------------------

	async #handle(req: CDPRequest): Promise<unknown> {
		const { method, params = {}, sessionId } = req;

		// No-op stubs
		if (NOOP_METHODS.has(method)) return {};

		switch (method) {
			// --- Browser domain ---
			case "Browser.getVersion":
				return {
					protocolVersion: "1.3",
					product: HTTP_PROFILE_PRODUCT,
					revision: "bunlight-http",
					userAgent: HTTP_PROFILE_VERSION,
					jsVersion: "0.0.0",
				};

			case "Browser.close":
				this.close();
				return {};

			case "Browser.getWindowForTarget":
				return {
					windowId: 1,
					bounds: {
						left: 0,
						top: 0,
						width: 1280,
						height: 720,
						windowState: "normal",
					},
				};

			case "Browser.grantPermissions":
			case "Browser.setDownloadBehavior":
			case "Browser.setContentsSize":
				return {};

			// --- Target domain ---
			case "Target.createTarget": {
				const page = this.#createPage();
				return { targetId: page.targetId };
			}

			case "Target.attachToTarget": {
				const { targetId } = params as { targetId?: string };
				const page = targetId
					? (this.#pages.get(targetId) ?? this.#createPage())
					: this.#firstOrCreate();
				// Override sessionId if the caller supplied one
				const suppliedSessionId = (params as { sessionId?: string }).sessionId;
				if (suppliedSessionId) {
					this.#pages.delete(page.targetId);
					page.sessionId = suppliedSessionId;
					this.#pages.set(page.targetId, page);
				}
				return { sessionId: page.sessionId };
			}

			case "Target.getTargetInfo": {
				const { targetId } = params as { targetId?: string };
				const page = targetId
					? this.#pages.get(targetId)
					: this.#firstOrCreate();
				if (!page) throw new CDPError("Target not found", -32000);
				return {
					targetInfo: {
						targetId: page.targetId,
						type: "page",
						title: page.title,
						url: page.url,
						attached: true,
						canAccessOpener: false,
						browserContextId: "defaultBrowserContextId",
					},
				};
			}

			case "Target.getTargets": {
				const targets = Array.from(this.#pages.values()).map((p) => ({
					targetId: p.targetId,
					type: "page",
					title: p.title,
					url: p.url,
					attached: true,
					canAccessOpener: false,
					browserContextId: "defaultBrowserContextId",
				}));
				return { targetInfos: targets };
			}

			case "Target.closeTarget": {
				const { targetId } = params as { targetId?: string };
				if (targetId) {
					const page = this.#pages.get(targetId);
					page?.doc?.destroy();
					this.#pages.delete(targetId ?? "");
				}
				return { success: true };
			}

			case "Target.createBrowserContext":
				return { browserContextId: "defaultBrowserContextId" };

			case "Target.disposeBrowserContext":
				return {};

			// --- Page domain ---
			case "Page.navigate": {
				const { url } = params as { url: string };
				const page = this.#pageBySession(sessionId);
				await this.#navigate(page, url);

				page.loaderId = `${page.frameId}-loader-${++page.loaderCounter}`;
				const loaderId = page.loaderId;
				const ts = Date.now() / 1000;

				// Emit events so agent-browser / Puppeteer lifecycle watchers advance.
				this.#emit({
					method: "Page.frameNavigated",
					sessionId: page.sessionId,
					params: {
						frame: {
							id: page.frameId,
							loaderId,
							url: page.url,
							domainAndRegistry: "",
							securityOrigin:
								url === "about:blank" || url.startsWith("data:")
									? "null"
									: (() => {
											try {
												return new URL(page.url).origin;
											} catch {
												return "null";
											}
										})(),
							mimeType: "text/html",
							adFrameStatus: { adFrameType: "none" },
							crossOriginIsolatedContextType: "none",
							gatedAPIFeatures: [],
						},
						type: "Navigation",
					},
				});
				this.#emit({
					method: "Page.lifecycleEvent",
					sessionId: page.sessionId,
					params: {
						frameId: page.frameId,
						loaderId,
						name: "init",
						timestamp: ts,
					},
				});
				this.#emit({
					method: "Page.lifecycleEvent",
					sessionId: page.sessionId,
					params: {
						frameId: page.frameId,
						loaderId,
						name: "DOMContentLoaded",
						timestamp: ts,
					},
				});
				this.#emit({
					method: "Page.lifecycleEvent",
					sessionId: page.sessionId,
					params: {
						frameId: page.frameId,
						loaderId,
						name: "load",
						timestamp: ts,
					},
				});

				return { frameId: page.frameId, loaderId };
			}

			case "Page.reload": {
				const page = this.#pageBySession(sessionId);
				if (page.url && page.url !== "about:blank") {
					await this.#navigate(page, page.url);
				}
				return {};
			}

			case "Page.getFrameTree": {
				const page = this.#pageBySession(sessionId);
				let origin = "null";
				try {
					if (
						page.url &&
						!page.url.startsWith("data:") &&
						page.url !== "about:blank"
					) {
						origin = new URL(page.url).origin;
					}
				} catch {
					// non-standard URL
				}
				return {
					frameTree: {
						frame: {
							id: page.frameId,
							loaderId: page.loaderId,
							url: page.url,
							domainAndRegistry: "",
							securityOrigin: origin,
							mimeType: "text/html",
							adFrameStatus: { adFrameType: "none" },
							crossOriginIsolatedContextType: "none",
							gatedAPIFeatures: [],
						},
					},
				};
			}

			// --- DOM domain ---
			case "DOM.getDocument": {
				const page = this.#pageBySession(sessionId);
				const doc = page.doc;
				const rootHTML = doc?.rawHtml ?? "<html></html>";
				const rootTitle = doc?.title ?? "";
				const rootId = doc?.rootId ?? 1;
				return {
					root: {
						nodeId: rootId,
						backendNodeId: rootId,
						nodeType: 9, // DOCUMENT_NODE
						nodeName: "#document",
						localName: "",
						nodeValue: "",
						documentURL: page.url,
						baseURL: page.url,
						xmlVersion: "",
						childNodeCount: 1,
						children: [
							{
								nodeId: rootId + 1,
								backendNodeId: rootId + 1,
								nodeType: 1,
								nodeName: "HTML",
								localName: "html",
								nodeValue: "",
								childNodeCount: 0,
								children: [],
								attributes: [],
								frameId: page.frameId,
								documentURL: page.url,
								baseURL: page.url,
								title: rootTitle,
								outerHTML: rootHTML,
							},
						],
					},
				};
			}

			case "DOM.querySelector": {
				const { nodeId: _docNodeId, selector } = params as {
					nodeId: number;
					selector: string;
				};
				const page = this.#pageBySession(sessionId);
				if (!page.doc) return { nodeId: 0 };
				const node = page.doc.querySelector(selector);
				if (!node) return { nodeId: 0 };
				return { nodeId: node.nodeId };
			}

			case "DOM.querySelectorAll": {
				const { nodeId: _docNodeId, selector } = params as {
					nodeId: number;
					selector: string;
				};
				const page = this.#pageBySession(sessionId);
				if (!page.doc) return { nodeIds: [] };
				const nodes = page.doc.querySelectorAll(selector);
				return { nodeIds: nodes.map((n) => n.nodeId) };
			}

			case "DOM.getOuterHTML": {
				const { nodeId } = params as { nodeId: number };
				const page = this.#pageBySession(sessionId);
				const node = page.doc?.getNodeById(nodeId);
				if (!node) {
					throw new CDPError("Node not found", -32000);
				}
				return { outerHTML: node.outerHTML };
			}

			case "DOM.describeNode": {
				const { nodeId } = params as { nodeId?: number };
				const page = this.#pageBySession(sessionId);
				const node =
					nodeId !== undefined ? page.doc?.getNodeById(nodeId) : undefined;
				return {
					node: {
						nodeId: nodeId ?? 0,
						backendNodeId: nodeId ?? 0,
						nodeType: 1,
						nodeName: (node?.tagName ?? "").toUpperCase(),
						localName: node?.tagName ?? "",
						nodeValue: "",
						attributes: node ? this.#flattenAttributes(node.attributes) : [],
					},
				};
			}

			case "DOM.enable":
				return {};

			case "DOM.resolveNode": {
				const { nodeId } = params as { nodeId?: number };
				return {
					object: {
						type: "object",
						subtype: "node",
						className: "HTMLElement",
						description: "HTMLElement",
						objectId: `dom-node-${nodeId ?? 0}`,
					},
				};
			}

			// --- Runtime domain (minimal) ---
			case "Runtime.evaluate": {
				// No JS engine in http profile.  Return a stub so agent-browser
				// doesn't crash when it evaluates simple expressions.
				const { expression } = params as { expression?: string };
				void expression;
				return {
					result: {
						type: "undefined",
						value: undefined,
					},
				};
			}

			case "Runtime.callFunctionOn":
				return { result: { type: "undefined", value: undefined } };

			case "Runtime.addBinding":
				return {};

			case "Runtime.getProperties":
				return { result: [] };

			default:
				throw new CDPError(`${NOT_SUPPORTED_MSG}: "${method}"`, -32601);
		}
	}

	// ---------------------------------------------------------------------------
	// Navigation (curl-impersonate)
	// ---------------------------------------------------------------------------

	async #navigate(page: HttpPageState, url: string): Promise<void> {
		if (!url || url === "about:blank") {
			page.url = "about:blank";
			page.title = "";
			page.doc?.destroy();
			page.doc = null;
			return;
		}

		if (url.startsWith("data:")) {
			const dataBody = url.slice(url.indexOf(",") + 1);
			const html = decodeURIComponent(dataBody);
			page.url = url;
			page.doc?.destroy();
			page.doc = new ParsedDocument(html, url);
			page.title = page.doc.title;
			return;
		}

		const res = await this.#client.fetch(url, {
			method: "GET",
			followRedirects: true,
			timeoutMs: 30_000,
		});
		const html = await res.text();
		page.url = res.effectiveUrl || url;
		page.doc?.destroy();
		page.doc = new ParsedDocument(html, page.url);
		page.title = page.doc.title;
	}

	// ---------------------------------------------------------------------------
	// Page state helpers
	// ---------------------------------------------------------------------------

	#createPage(): HttpPageState {
		const id = `http-page-${++this.#pageCounter}`;
		const page: HttpPageState = {
			targetId: id,
			sessionId: `http-session-${id}`,
			frameId: `http-frame-${id}`,
			url: "about:blank",
			title: "",
			doc: null,
			loaderId: `http-frame-${id}-loader-0`,
			loaderCounter: 0,
		};
		this.#pages.set(id, page);
		return page;
	}

	#firstOrCreate(): HttpPageState {
		const first = this.#pages.values().next().value as
			| HttpPageState
			| undefined;
		return first ?? this.#createPage();
	}

	#pageBySession(sessionId: string | undefined): HttpPageState {
		if (!sessionId) return this.#firstOrCreate();
		for (const page of this.#pages.values()) {
			if (page.sessionId === sessionId) return page;
		}
		const page = this.#createPage();
		this.#pages.delete(page.targetId);
		page.sessionId = sessionId;
		this.#pages.set(page.targetId, page);
		return page;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	#flattenAttributes(attrs: Record<string, string>): string[] {
		const out: string[] = [];
		for (const [k, v] of Object.entries(attrs)) {
			out.push(k, v);
		}
		return out;
	}

	#emit(event: CDPEvent): void {
		if (this.#closed) return;
		queueMicrotask(() => {
			if (!this.#closed) {
				this.onmessage?.(JSON.stringify(event));
			}
		});
	}

	#dispatch(msg: CDPResponse): void {
		queueMicrotask(() => {
			if (!this.#closed) {
				this.onmessage?.(JSON.stringify(msg));
			}
		});
	}
}

// ---------------------------------------------------------------------------
// CDPError
// ---------------------------------------------------------------------------

class CDPError extends Error {
	readonly code: number;

	constructor(message: string, code = -32000) {
		super(message);
		this.name = "CDPError";
		this.code = code;
	}
}
