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
 * StaticDomTransport — 100% in-process CDP transport that implements a DOM-only
 * subset of the Chrome DevTools Protocol using Bun's built-in `fetch` for
 * navigation, and a minimal HTML parser for selector queries.
 *
 * The monolithic switch dispatcher has been refactored into 16 modular domain
 * handlers under `src/cdp/domains/*.ts`.  Each handler returns `null` when it
 * does not recognise a method, causing the dispatcher to fall through to the
 * next handler in the chain.
 *
 * Supported CDP methods (Phase L0 / static mode):
 *
 *   Browser.getVersion
 *   Target.getBrowserContexts
 *   Target.setDiscoverTargets
 *   Target.setAutoAttach
 *   Target.createTarget
 *   Target.closeTarget
 *   Target.getTargetInfo
 *   Page.navigate
 *   Page.getFrameTree
 *   Page.enable
 *   Page.setLifecycleEventsEnabled
 *   Runtime.enable
 *   Runtime.evaluate
 *   Runtime.callFunctionOn
 *   DOM.getDocument
 *   DOM.querySelector
 *   DOM.querySelectorAll
 *   DOM.getOuterHTML
 *   DOM.describeNode
 *   Network.enable
 *   Emulation.setDeviceMetricsOverride
 *
 * Anything else throws a clear `CDPNotImplementedError` listing the supported
 * methods.
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";
import { AccessibilityHandler } from "../cdp/domains/Accessibility.js";
import { AuditsHandler } from "../cdp/domains/Audits.js";
// Domain handlers
import { BrowserHandler } from "../cdp/domains/Browser.js";
import { DOMHandler } from "../cdp/domains/DOM.js";
import { EmulationHandler } from "../cdp/domains/Emulation.js";
import { FetchHandler } from "../cdp/domains/Fetch.js";
import { InputHandler } from "../cdp/domains/Input.js";
import { IOHandler } from "../cdp/domains/IO.js";
import { LogHandler } from "../cdp/domains/Log.js";
import { NetworkHandler } from "../cdp/domains/Network.js";
import { PageHandler } from "../cdp/domains/Page.js";
import { PerformanceHandler } from "../cdp/domains/Performance.js";
import { RuntimeHandler } from "../cdp/domains/Runtime.js";
import { SecurityHandler } from "../cdp/domains/Security.js";
import { TargetHandler } from "../cdp/domains/Target.js";
import { TracingHandler } from "../cdp/domains/Tracing.js";
import { WebMCPHandler } from "../cdp/domains/WebMCP.js";
import type {
	DispatchContext,
	DOMNode,
	FetchAction,
	NetworkContext,
	PageState,
	ParsedDocumentLike,
	ParsedNodeLike,
} from "../cdp/types.js";
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
import {
	CDPError,
	type CDPEvent,
	type CDPHandler,
	InProcessTransport,
} from "./InProcessTransport.js";

// ---------------------------------------------------------------------------
// Supported methods list (used in error messages)
// ---------------------------------------------------------------------------

const SUPPORTED_METHODS = [
	"Browser.getVersion",
	"Browser.close",
	"Target.getBrowserContexts",
	"Target.setDiscoverTargets",
	"Target.setAutoAttach",
	"Target.createTarget",
	"Target.closeTarget",
	"Target.getTargetInfo",
	"Target.attachToTarget",
	"Target.createBrowserContext",
	"Target.getTargets",
	"Target.detachFromTarget",
	"Page.navigate",
	"Page.getFrameTree",
	"Page.enable",
	"Page.setLifecycleEventsEnabled",
	"Page.addScriptToEvaluateOnNewDocument",
	"Page.createIsolatedWorld",
	"Page.setBypassCSP",
	"Page.setCacheEnabled",
	"Page.bringToFront",
	"Page.resetNavigationHistory",
	"Runtime.enable",
	"Runtime.evaluate",
	"Runtime.callFunctionOn",
	"Runtime.runIfWaitingForDebugger",
	"Runtime.getProperties",
	"Runtime.addBinding",
	"Browser.getWindowForTarget",
	"Browser.grantPermissions",
	"Browser.setDownloadBehavior",
	"Browser.setContentsSize",
	"Tracing.start",
	"Tracing.end",
	"DOM.getDocument",
	"DOM.querySelector",
	"DOM.querySelectorAll",
	"DOM.getOuterHTML",
	"DOM.describeNode",
	"Network.enable",
	"Network.clearBrowserCookies",
	"Network.emulateNetworkConditions",
	"Network.getAllCookies",
	"Network.getCookies",
	"Network.getResponseBody",
	"Network.setCookies",
	"Network.setExtraHTTPHeaders",
	"Fetch.enable",
	"Fetch.disable",
	"Fetch.continueRequest",
	"Fetch.failRequest",
	"Fetch.fulfillRequest",
	"Fetch.continueWithAuth",
	"IO.read",
	"IO.close",
	"Emulation.setDeviceMetricsOverride",
	"Security.setIgnoreCertificateErrors",
	"Audits.enable",
	"Performance.enable",
	"Log.enable",
	"WebMCP.enable",
] as const;

/**
 * Ordered list of domain handlers.  The dispatcher iterates through them in
 * sequence and returns the first non-null result.
 */
const DOMAIN_HANDLERS = [
	BrowserHandler,
	TargetHandler,
	PageHandler,
	DOMHandler,
	RuntimeHandler,
	NetworkHandler,
	EmulationHandler,
	SecurityHandler,
	AccessibilityHandler,
	InputHandler,
	FetchHandler,
	IOHandler,
	TracingHandler,
	AuditsHandler,
	PerformanceHandler,
	LogHandler,
	WebMCPHandler,
] as const;

// ---------------------------------------------------------------------------
// Minimal DOM representation
// ---------------------------------------------------------------------------

/** A node stored in the in-process DOM tree. */
interface InternalDOMNode extends DOMNode {}

// ---------------------------------------------------------------------------
// HTML parsing — backed by zigquery FFI (liblightpanda_dom.so) when available,
// with a tiny regex fallback for environments where the library is missing.
// ---------------------------------------------------------------------------

/**
 * Parses raw HTML text into a `ParsedDocument`.  Prefers the Zig-backed parser
 * (real CSS selector engine, full HTML5 tokenizer) and silently falls back to
 * the regex implementation when the cdylib is not available.
 */
async function parseHTML(html: string): Promise<ParsedDocument> {
	const doc = new ParsedDocument(html);
	await doc.initialize();
	return doc;
}

// ---------------------------------------------------------------------------
// ZigDoc WeakRef finalizer — auto-frees native memory if the JS runtime
// garbage-collects a ZigDoc that was not explicitly destroyed.
// ---------------------------------------------------------------------------

/**
 * Cleanup token for the FinalizationRegistry.  This is a separate object from
 * the `ZigDoc` so it can be used as both the held value and the unregister
 * token without violating the spec requirement that the target and held value
 * must not be the same object.
 */
interface ZigDocCleanupToken {
	/** The `ZigDoc` to destroy.  Held as a strong reference by the registry. */
	readonly doc: ZigDoc;
}

/**
 * FinalizationRegistry that calls `doc.destroy()` after V8 garbage-collects
 * the `ZigDoc` that was watched.
 *
 * The held value is a `ZigDocCleanupToken` (a separate object from the target),
 * which keeps a strong reference to the `ZigDoc` alive solely for cleanup
 * purposes.  The unregister token is the same `ZigDocCleanupToken` so callers
 * can cancel the finalizer when destroying the doc explicitly.
 *
 * Note: finalizers are non-deterministic.  Explicit `destroy()` is preferred
 * for predictable latency.
 */
const zigDocFinalizer = new FinalizationRegistry<ZigDocCleanupToken>(
	(token) => {
		try {
			token.doc.destroy();
		} catch {
			// Ignore errors during finalization (library may be unloaded).
		}
	},
);

/**
 * Document model with two backends:
 *
 *   - **zigquery** (preferred): real HTML5 parser + CSS selector engine via
 *     `liblightpanda_dom.so`.  Full selector spec coverage, accurate text
 *     extraction, sub-millisecond queries.
 *   - **regex fallback**: legacy implementation kept for environments where
 *     the Zig library is not built (e.g., CI without zig toolchain).  Handles
 *     only tag/id/class on flat HTML.
 *
 * The class shape (and `ParsedNode`) is preserved so the rest of the
 * `StaticDomHandler` does not need to care which backend is active.
 *
 * Memory management for the zigquery backend:
 *   The underlying `ZigDoc` is held via a `WeakRef` so the GC can reclaim
 *   native DOM memory when memory pressure is high.  If the `WeakRef` has
 *   been collected before a query arrives, the HTML is re-parsed on demand
 *   from `rawHtml` (which is a plain JS string, already in the V8 heap).
 *   Re-parsing is typically <1 ms for page-sized HTML, so the performance
 *   impact is acceptable.
 */
class ParsedDocument implements ParsedDocumentLike {
	readonly rawHtml: string;
	readonly url: string;
	readonly title: string;
	readonly rootId: number;

	// Node registry keyed by nodeId — entries are created lazily as queries hit.
	readonly #nodes = new Map<number, ParsedNode>();
	#nextId = 1;

	// Whether zigquery FFI is available at all.
	#useZig = false;

	// WeakRef allows the GC to reclaim the ZigDoc (and its native heap) when
	// memory pressure is high.  Queries that arrive after GC re-parse from rawHtml.
	#zigDocRef: WeakRef<ZigDoc> | null = null;

	// Token used to unregister from the FinalizationRegistry.  Kept as a
	// separate object from the ZigDoc so it can serve as the held value.
	#finalizerToken: ZigDocCleanupToken | null = null;

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
	}

	async initialize() {
		if (isZigQueryAvailable()) {
			try {
				const doc = await zigParseHtml(this.rawHtml);
				this.#zigDocRef = new WeakRef(doc);
				// Register for automatic cleanup when GC collects the ZigDoc.
				// The token is a separate object (held value != target) and also
				// serves as the unregister token so we can cancel later.
				const token: ZigDocCleanupToken = { doc };
				zigDocFinalizer.register(doc, token, token);
				this.#finalizerToken = token;
				this.#useZig = true;
			} catch {
				this.#zigDocRef = null;
				this.#finalizerToken = null;
				this.#useZig = false;
			}
		} else {
			this.#zigDocRef = null;
			this.#finalizerToken = null;
			this.#useZig = false;
		}
	}

	/**
	 * Returns the live `ZigDoc` — creates a fresh one from `rawHtml` if the
	 * WeakRef target has been garbage-collected.
	 */
	async #ensureZigDoc(): Promise<ZigDoc | null> {
		if (!this.#useZig) return null;
		const existing = this.#zigDocRef?.deref();
		if (existing) return existing;
		// Re-parse — GC collected the previous doc.
		try {
			const doc = await zigParseHtml(this.rawHtml);
			this.#zigDocRef = new WeakRef(doc);
			const token: ZigDocCleanupToken = { doc };
			zigDocFinalizer.register(doc, token, token);
			this.#finalizerToken = token;
			return doc;
		} catch {
			this.#zigDocRef = null;
			this.#finalizerToken = null;
			return null;
		}
	}

	/**
	 * Explicitly releases the underlying zigquery document, if any.
	 * Unregisters from the FinalizationRegistry so the native handle is
	 * freed synchronously rather than waiting for GC.
	 */
	destroy(): void {
		if (this.#finalizerToken) {
			// Cancel the finalizer before destroying — avoids double-free if GC
			// runs between here and the actual destroy call.
			zigDocFinalizer.unregister(this.#finalizerToken);
			this.#finalizerToken = null;
		}
		const doc = this.#zigDocRef?.deref();
		if (doc) {
			doc.destroy();
		}
		this.#zigDocRef = null;
	}

	#allocId(): number {
		return this.#nextId++;
	}

	async querySelectorAll(selector: string): Promise<ParsedNode[]> {
		const zigDoc = await this.#ensureZigDoc();
		if (zigDoc) {
			const sel = await zigDoc.find(selector);
			const out: ParsedNode[] = [];
			for (let i = 0; i < sel.count; i++) {
				const el = sel.at(i);
				if (!el) continue;
				const id = this.#allocId();
				const outerHTML = el.outerHTML();
				// Parse attributes from outerHTML so DOM.describeNode returns them correctly.
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
		// Regex fallback
		return this.#scanElementsRegex().filter((el) =>
			this.#matchesRegex(el, selector),
		);
	}

	async querySelector(selector: string): Promise<ParsedNode | undefined> {
		const zigDoc = await this.#ensureZigDoc();
		if (zigDoc) {
			const sel = await zigDoc.find(selector);
			if (sel.count === 0) {
				sel.destroy();
				return undefined;
			}
			const el = sel.at(0);
			if (!el) {
				sel.destroy();
				return undefined;
			}
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
			sel.destroy();
			return node;
		}
		return (await this.querySelectorAll(selector))[0];
	}

	getNodeById(nodeId: number): ParsedNode | undefined {
		return this.#nodes.get(nodeId);
	}

	toCDPNode(node: ParsedNodeLike): InternalDOMNode {
		return {
			nodeId: node.nodeId,
			backendNodeId: node.nodeId,
			nodeType: node.tagName === "#document" ? 9 : 1,
			nodeName:
				node.tagName === "#document" ? "#document" : node.tagName.toUpperCase(),
			localName: node.tagName === "#document" ? "" : node.tagName,
			nodeValue: "",
			childNodeCount: 0,
			attributes: Object.entries(node.attributes).flat(),
		};
	}

	// ---------------------------------------------------------------------------
	// Regex fallback (used when zigquery is not available).
	// ---------------------------------------------------------------------------

	#scanElementsRegex(): ParsedNode[] {
		const elements: ParsedNode[] = [];
		const TAG_RE =
			/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>[\s\S]*?(?=<[a-zA-Z]|$)/g;
		let m: RegExpExecArray | null;
		while ((m = TAG_RE.exec(this.rawHtml)) !== null) {
			const tagName = (m[1] ?? "").toLowerCase();
			const attrStr = m[2] ?? "";
			const attrs = parseAttributes(attrStr);
			const afterTag = this.rawHtml.slice(m.index + m[0].indexOf(">") + 1);
			const textMatch = /^([^<]*)/.exec(afterTag);
			const textContent = textMatch ? (textMatch[1] ?? "").trim() : "";
			const outerHTML = m[0].trimEnd();
			const id = this.#allocId();
			const node: ParsedNode = {
				nodeId: id,
				tagName,
				outerHTML,
				textContent,
				attributes: attrs,
			};
			this.#nodes.set(id, node);
			elements.push(node);
		}
		return elements;
	}

	#matchesRegex(node: ParsedNode, selector: string): boolean {
		const parts = selector.trim().split(/\s+/);
		const simple = parts[parts.length - 1] ?? "";
		const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(simple);
		const idMatch = /#([a-zA-Z_-][^\s.#[:]*)/.exec(simple);
		const classMatches = [...simple.matchAll(/\.([a-zA-Z_-][^\s.#[:\s]*)/g)];
		if (tagMatch && node.tagName !== (tagMatch[1] ?? "").toLowerCase())
			return false;
		if (idMatch && node.attributes["id"] !== idMatch[1]) return false;
		for (const [, cls] of classMatches) {
			const nodeClasses = (node.attributes["class"] ?? "").split(/\s+/);
			if (cls !== undefined && !nodeClasses.includes(cls)) return false;
		}
		return true;
	}
}

interface ParsedNode extends ParsedNodeLike {}

// ---------------------------------------------------------------------------
// StaticDomHandler
// ---------------------------------------------------------------------------

const BROWSER_CONTEXT_ID = "defaultBrowserContextId";

/**
 * Stateful handler for the static DOM CDP subset.  One instance is shared
 * across the lifetime of a `StaticDomTransport`.
 *
 * The monolithic switch has been replaced with a chain-of-responsibility
 * pattern: `DOMAIN_HANDLERS` is iterated and the first handler that returns
 * a non-null result wins.
 */
class StaticDomHandler {
	readonly #pages = new Map<string, PageState>();
	#pageCounter = 0;
	#requestCounter = 0;
	#transport: StaticDomTransport | null = null;

	/**
	 * Tracks whether a given session has registered Target.setAutoAttach so we
	 * can auto-emit Target.attachedToTarget when a new page target is created.
	 * Key: sessionId (or "" for root connection).
	 */
	readonly #autoAttachSessions = new Set<string>();

	/**
	 * Shared network state across Network, Fetch, and IO domain handlers.
	 */
	readonly #networkCtx: NetworkContext = {
		cookies: new Map(),
		requestRegistry: new Map(),
		extraHeaders: {},
		networkConditions: null,
		fetchSessions: new Map(),
		ioStreams: new Map(),
	};

	/** Called once the transport is constructed so we can push events. */
	bind(transport: StaticDomTransport): void {
		this.#transport = transport;
	}

	handle: CDPHandler = async (method, params, sessionId) => {
		// Build the dispatch context that domain handlers receive.
		const ctx = this.#buildContext();

		// Chain-of-responsibility: try each domain handler in order.
		for (const handler of DOMAIN_HANDLERS) {
			const result = await handler(method, params, ctx, sessionId);
			if (result !== null) {
				return result;
			}
		}

		// No handler claimed the method.
		throw new CDPError(
			`Method not implemented: "${method}". ` +
				`Supported methods in StaticDomTransport: ${SUPPORTED_METHODS.join(", ")}`,
			-32601,
		);
	};

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	#buildContext(): DispatchContext {
		// We capture `this` once here so all closures share the same handler state.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		return {
			pageBySession: (sessionId) => self.#pageBySession(sessionId),
			pageBySessionSoft: (sessionId) => self.#pageBySessionSoft(sessionId),
			createPage: () => self.#createPage(),
			emitEvent: (event) => self.#emitEvent(event),
			emitExecutionContexts: (page) => self.#emitExecutionContexts(page),
			pageTargetInfo: (page) => self.#pageTargetInfo(page),
			navigate: (page, url) => self.#navigate(page, url),
			get transport() {
				return self.#transport;
			},
			get pages() {
				return self.#pages as ReadonlyMap<string, PageState>;
			},
			get autoAttachSessions() {
				return self.#autoAttachSessions;
			},
			get networkCtx() {
				return self.#networkCtx;
			},
		};
	}

	#createPage(): PageState {
		const id = `page-${++this.#pageCounter}`;
		const page: PageState = {
			targetId: id,
			sessionId: `session-${id}`,
			frameId: `frame-${id}`,
			url: "about:blank",
			title: "",
			doc: null,
			loaderId: `frame-${id}-loader-0`,
			loaderCounter: 0,
			emulation: {},
			security: { ignoreCertificateErrors: false },
			scripts: new Map(),
			scriptCounter: 0,
			screencastActive: false,
			utilityWorldName: "__puppeteer_utility_world__24.43.0",
		};
		this.#pages.set(id, page);
		return page;
	}

	#pageBySession(sessionId: string | undefined): PageState {
		if (!sessionId) {
			// Return the first available page or create one
			const first = this.#pages.values().next().value;
			if (first) return first;
			return this.#createPage();
		}
		for (const page of this.#pages.values()) {
			if (page.sessionId === sessionId) return page;
		}
		// Create on demand (Puppeteer may attach before Target.createTarget)
		const page = this.#createPage();
		// Override the sessionId so it matches what Puppeteer expects
		this.#pages.delete(page.targetId);
		page.sessionId = sessionId;
		this.#pages.set(page.targetId, page);
		return page;
	}

	/** Like #pageBySession but returns null instead of creating a new page. */
	#pageBySessionSoft(sessionId: string): PageState | null {
		for (const page of this.#pages.values()) {
			if (page.sessionId === sessionId) return page;
		}
		return null;
	}

	/**
	 * Emits `Runtime.executionContextCreated` for the main world and the
	 * Puppeteer utility world on the given page's session.  Must be called
	 * after each navigation so Puppeteer can bind evaluation functions.
	 */
	#emitExecutionContexts(page: PageState): void {
		const UTILITY_WORLD_NAME = page.utilityWorldName;
		const ts = Date.now() / 1000;
		void ts;
		// Main world context (isDefault: true)
		this.#emitEvent({
			method: "Runtime.executionContextCreated",
			sessionId: page.sessionId,
			params: {
				context: {
					id: page.loaderCounter * 2 + 1,
					origin:
						page.url.startsWith("data:") || page.url === "about:blank"
							? "null"
							: new URL(page.url).origin,
					name: "",
					uniqueId: `main-${page.frameId}-${page.loaderCounter}`,
					auxData: {
						isDefault: true,
						type: "default",
						frameId: page.frameId,
					},
				},
			},
		});
		// Utility/isolated world context
		this.#emitEvent({
			method: "Runtime.executionContextCreated",
			sessionId: page.sessionId,
			params: {
				context: {
					id: page.loaderCounter * 2 + 2,
					origin:
						page.url.startsWith("data:") || page.url === "about:blank"
							? "null"
							: new URL(page.url).origin,
					name: UTILITY_WORLD_NAME,
					uniqueId: `utility-${page.frameId}-${page.loaderCounter}`,
					auxData: {
						isDefault: false,
						type: "isolated",
						frameId: page.frameId,
					},
				},
			},
		});
	}

	#pageTargetInfo(page: PageState) {
		return {
			targetId: page.targetId,
			type: "page" as const,
			title: page.title,
			url: page.url,
			attached: true,
			canAccessOpener: false,
			browserContextId: BROWSER_CONTEXT_ID,
		};
	}

	async #navigate(page: PageState, url: string): Promise<void> {
		// Release any prior parsed document (releases ZigDoc handle).
		page.doc?.destroy();
		page.url = url;

		// data: URIs are handled inline - no network events needed
		if (url.startsWith("data:")) {
			const commaIndex = url.indexOf(",");
			if (commaIndex === -1) {
				page.doc = await parseHTML("");
				page.title = "";
				return;
			}
			const body = decodeURIComponent(url.slice(commaIndex + 1));
			page.doc = await parseHTML(body);
			page.title = page.doc.title;
			return;
		}

		if (url === "about:blank") {
			page.doc = await parseHTML("");
			page.title = "";
			return;
		}

		// Generate a unique requestId for Network event correlation
		const requestId = `net-${++this.#requestCounter}`;
		const ts = Date.now() / 1000;

		// Build request headers from emulation state.
		const userAgent =
			page.emulation.userAgent ?? "Bxc/0.1.0 StaticDomTransport";
		const headers: Record<string, string> = {
			"User-Agent": userAgent,
			// Merge extra headers set via Network.setExtraHTTPHeaders
			...this.#networkCtx.extraHeaders,
		};
		if (page.emulation.locale) {
			const lang = page.emulation.locale;
			const base = lang.split("-")[0];
			headers["Accept-Language"] =
				base !== lang ? `${lang},${base};q=0.9,en;q=0.8` : `${lang},en;q=0.8`;
		}

		// Register in-flight request for getResponseBody
		this.#networkCtx.requestRegistry.set(requestId, {
			requestId,
			url,
			method: "GET",
			headers,
			responseBody: null,
			mimeType: "text/html",
			base64Encoded: false,
			status: 0,
			responseHeaders: {},
			finished: false,
		});

		// Emit Network.requestWillBeSent
		this.#emitEvent({
			method: "Network.requestWillBeSent",
			sessionId: page.sessionId,
			params: {
				requestId,
				loaderId: page.loaderId,
				documentURL: url,
				request: {
					url,
					method: "GET",
					headers,
					initialPriority: "VeryHigh",
					referrerPolicy: "strict-origin-when-cross-origin",
				},
				timestamp: ts,
				wallTime: ts,
				type: "Document",
				frameId: page.frameId,
			},
		});

		// Check Fetch interception for this session
		const fetchState = this.#networkCtx.fetchSessions.get(page.sessionId);
		if (fetchState?.enabled && fetchState.patterns.length > 0) {
			const matched = fetchState.patterns.some((p) => {
				if (!p.urlPattern) return true;
				// Simple glob: convert "*" to regex ".*"
				const re = new RegExp(
					"^" +
						p.urlPattern
							.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
							.replace(/\*/g, ".*") +
						"$",
				);
				return re.test(url);
			});
			if (matched) {
				// Pause the request and fire Fetch.requestPaused
				const pauseRequestId = `fetch-${requestId}`;
				const actionPromise = new Promise<FetchAction>((resolve) => {
					fetchState.pendingRequests.set(pauseRequestId, {
						requestId: pauseRequestId,
						frameId: page.frameId,
						resourceType: "Document",
						request: { url, method: "GET", headers },
						networkId: requestId,
						resolve,
					});
				});
				this.#emitEvent({
					method: "Fetch.requestPaused",
					sessionId: page.sessionId,
					params: {
						requestId: pauseRequestId,
						request: {
							url,
							method: "GET",
							headers,
							initialPriority: "VeryHigh",
						},
						frameId: page.frameId,
						resourceType: "Document",
						networkId: requestId,
					},
				});

				// Wait for the action (continue/fail/fulfill)
				const action = await actionPromise;
				fetchState.pendingRequests.delete(pauseRequestId);

				if (action.type === "fail") {
					const failReason = action.errorReason;
					this.#emitEvent({
						method: "Network.loadingFailed",
						sessionId: page.sessionId,
						params: {
							requestId,
							timestamp: Date.now() / 1000,
							type: "Document",
							errorText: failReason,
							canceled: false,
						},
					});
					const req = this.#networkCtx.requestRegistry.get(requestId);
					if (req) {
						req.finished = true;
						this.#networkCtx.requestRegistry.set(requestId, req);
					}
					page.doc = await parseHTML("");
					page.title = "";
					// Throw so Page.navigate propagates the error to the CDP client
					throw new Error(`net::ERR_FAILED: ${failReason}`);
				}

				if (action.type === "fulfill") {
					// Mock response
					const bodyText = action.body
						? new TextDecoder().decode(Uint8Array.fromBase64(action.body))
						: "";
					const responseHeaders: Record<string, string> = {};
					for (const { name, value } of action.responseHeaders) {
						responseHeaders[name.toLowerCase()] = value;
					}
					const mimeType = responseHeaders["content-type"] ?? "text/html";
					const bodyBytes = new TextEncoder().encode(bodyText);

					const req = this.#networkCtx.requestRegistry.get(requestId);
					if (req) {
						req.status = action.responseCode;
						req.responseHeaders = responseHeaders;
						req.mimeType = mimeType;
						req.responseBody = bodyBytes;
						req.finished = true;
					}

					this.#emitEvent({
						method: "Network.responseReceived",
						sessionId: page.sessionId,
						params: {
							requestId,
							loaderId: page.loaderId,
							timestamp: Date.now() / 1000,
							type: "Document",
							frameId: page.frameId,
							response: {
								url,
								status: action.responseCode,
								statusText: "OK",
								headers: responseHeaders,
								mimeType,
								connectionReused: false,
								connectionId: 0,
								fromDiskCache: false,
								fromServiceWorker: false,
								encodedDataLength: bodyBytes.byteLength,
								securityState: "secure",
							},
						},
					});
					this.#emitEvent({
						method: "Network.loadingFinished",
						sessionId: page.sessionId,
						params: {
							requestId,
							timestamp: Date.now() / 1000,
							encodedDataLength: bodyBytes.byteLength,
						},
					});

					page.doc = await parseHTML(bodyText);
					page.title = page.doc.title;
					return;
				}

				// action.type === "continue" or "auth" - fall through to real fetch
				// Apply any overridden headers from the continue action
				if (action.type === "continue" && action.headers) {
					Object.assign(headers, action.headers);
				}
			}
		}

		// TLS: ignore certificate errors when Security.setIgnoreCertificateErrors(true)
		const fetchOptions: RequestInit & {
			tls?: { rejectUnauthorized: boolean };
		} = {
			headers,
			redirect: "follow",
		};
		if (page.security.ignoreCertificateErrors) {
			fetchOptions.tls = { rejectUnauthorized: false };
		}

		// Real HTTP fetch via Bun
		try {
			const res = await fetch(url, fetchOptions);
			page.lastStatus = res.status;
			const bodyBytes = new Uint8Array(await res.arrayBuffer());
			const html = new TextDecoder().decode(bodyBytes);
			page.url = res.url; // follow redirects

			// Build response headers map
			const responseHeaders: Record<string, string> = {};
			res.headers.forEach((value, key) => {
				responseHeaders[key.toLowerCase()] = value;
			});
			const mimeType = (
				(responseHeaders["content-type"] ?? "text/html").split(";")[0] ??
				"text/html"
			).trim();

			// Update registry with response data
			const req = this.#networkCtx.requestRegistry.get(requestId);
			if (req) {
				req.status = res.status;
				req.responseHeaders = responseHeaders;
				req.mimeType = mimeType;
				req.responseBody = bodyBytes;
				req.finished = true;
				req.url = res.url; // after redirect
			}

			// Emit Network.responseReceived
			this.#emitEvent({
				method: "Network.responseReceived",
				sessionId: page.sessionId,
				params: {
					requestId,
					loaderId: page.loaderId,
					timestamp: Date.now() / 1000,
					type: "Document",
					frameId: page.frameId,
					response: {
						url: res.url,
						status: res.status,
						statusText: res.statusText,
						headers: responseHeaders,
						mimeType,
						connectionReused: false,
						connectionId: 0,
						fromDiskCache: false,
						fromServiceWorker: false,
						encodedDataLength: bodyBytes.byteLength,
						securityState: "secure",
					},
				},
			});

			// Emit Network.loadingFinished
			this.#emitEvent({
				method: "Network.loadingFinished",
				sessionId: page.sessionId,
				params: {
					requestId,
					timestamp: Date.now() / 1000,
					encodedDataLength: bodyBytes.byteLength,
				},
			});

			page.doc = await parseHTML(html);
			page.title = page.doc.title;

			// Hint to the GC that prior-page objects (ParsedDocument, ZigDoc native
			// memory, response body bytes) are now unreachable.  Using soft GC
			// (false) avoids triggering a full collection on every navigate while
			// still prompting the runtime to schedule a minor GC pass.
			// Only effective in Bun/V8 environments that expose Bun.gc.
			if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
				Bun.gc(false);
			}
		} catch (err) {
			const errorText = err instanceof Error ? err.message : String(err);
			const req = this.#networkCtx.requestRegistry.get(requestId);
			if (req) {
				req.finished = true;
				this.#networkCtx.requestRegistry.set(requestId, req);
			}
			// Emit Network.loadingFailed
			this.#emitEvent({
				method: "Network.loadingFailed",
				sessionId: page.sessionId,
				params: {
					requestId,
					timestamp: Date.now() / 1000,
					type: "Document",
					errorText,
					canceled: false,
				},
			});
			// Re-throw so Page.navigate can handle it appropriately
			throw err;
		}
	}

	#emitEvent(event: CDPEvent): void {
		this.#transport?.emit(event);
	}
}

// ---------------------------------------------------------------------------
// StaticDomTransport (public class)
// ---------------------------------------------------------------------------

/**
 * A `ConnectionTransport` that runs a static DOM-only CDP implementation
 * entirely in-process.  No binary, no spawn, no TCP.
 *
 * Use `StaticDomTransport.create()` to get an instance ready to pass to
 * `puppeteer.connect({ transport })`.
 */
export class StaticDomTransport
	extends InProcessTransport
	implements ConnectionTransport
{
	readonly #domHandler: StaticDomHandler;

	private constructor(handler: StaticDomHandler) {
		super(handler.handle);
		this.#domHandler = handler;
		handler.bind(this);
	}

	/**
	 * Creates a new `StaticDomTransport` instance with a fresh browser state.
	 */
	static create(): StaticDomTransport {
		const handler = new StaticDomHandler();
		return new StaticDomTransport(handler);
	}

	/** Expose the underlying handler for testing / introspection. */
	get handler(): StaticDomHandler {
		return this.#domHandler;
	}
}
