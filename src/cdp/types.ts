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
 * Shared types for the modular CDP domain handlers.
 *
 * Each domain (Page, Target, Browser, DOM, Runtime, ...) exposes a
 * `DomainHandler` that receives a CDP method name, its params and a
 * `DispatchContext` that gives access to page state and event emission.
 *
 * Returning `null` from a `DomainHandler` signals "this domain does not own
 * this method - try the next one".  Returning any non-null value (including
 * `{}`) signals that the method was handled.
 */

import type { CDPEvent } from "../transport/InProcessTransport.js";
import type { StaticDomTransport } from "../transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// CDPHandlerResult
// ---------------------------------------------------------------------------

/**
 * The result type for a domain handler call.
 *
 * - `null`     : this domain does not handle the requested method
 * - `unknown`  : a valid CDP result (will be serialised by InProcessTransport)
 */
export type CDPHandlerResult = unknown | null;

// ---------------------------------------------------------------------------
// NetworkState - shared cookie jar, response body cache, extra headers
// ---------------------------------------------------------------------------

/**
 * A single cookie entry matching the CDP Network.Cookie shape.
 */
export interface CdpCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	size: number;
	httpOnly: boolean;
	secure: boolean;
	session: boolean;
	sameSite?: string;
	priority?: string;
}

/**
 * A cookie source parameter from Network.setCookies, matching CDP
 * Network.CookieParam shape.
 */
export interface CdpCookieParam {
	name: string;
	value: string;
	url?: string;
	domain?: string;
	path?: string;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: string;
	expires?: number;
	priority?: string;
}

/**
 * A single in-flight or completed request tracked by the Network domain.
 */
export interface RequestState {
	requestId: string;
	url: string;
	method: string;
	headers: Record<string, string>;
	/** Raw response body bytes, stored for Network.getResponseBody. */
	responseBody: Uint8Array | null;
	/** Response content type. */
	mimeType: string;
	/** Whether the response body is base64-encoded. */
	base64Encoded: boolean;
	/** Response status code. */
	status: number;
	/** Response headers. */
	responseHeaders: Record<string, string>;
	/** Whether the request has completed. */
	finished: boolean;
}

/**
 * Network conditions for throttling (emulateNetworkConditions).
 */
export interface NetworkConditions {
	offline: boolean;
	latency: number;
	downloadThroughput: number;
	uploadThroughput: number;
	connectionType?: string;
}

// ---------------------------------------------------------------------------
// FetchInterception - per-session request interception state
// ---------------------------------------------------------------------------

/**
 * A Fetch interception filter pattern from Fetch.enable.
 */
export interface RequestPattern {
	urlPattern?: string;
	resourceType?: string;
	requestStage?: "Request" | "Response";
}

/**
 * The action taken on a paused Fetch request.
 */
export type FetchAction =
	| {
			type: "continue";
			headers?: Record<string, string>;
			method?: string;
			postData?: string;
			url?: string;
	  }
	| { type: "fail"; errorReason: string }
	| {
			type: "fulfill";
			responseCode: number;
			responseHeaders: Array<{ name: string; value: string }>;
			body?: string;
	  }
	| {
			type: "auth";
			authChallengeResponse: {
				response: string;
				username?: string;
				password?: string;
			};
	  };

/**
 * A paused request waiting for a Fetch.continueRequest / failRequest /
 * fulfillRequest / continueWithAuth response.
 */
export interface PausedRequest {
	requestId: string;
	frameId: string;
	resourceType: string;
	request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		postData?: string;
	};
	networkId?: string;
	/** Resolves the underlying fetch with the action taken. */
	resolve: (action: FetchAction) => void;
}

/**
 * Per-session Fetch interception state.
 */
export interface FetchInterceptionState {
	enabled: boolean;
	patterns: RequestPattern[];
	/** In-flight paused requests keyed by requestId. */
	pendingRequests: Map<string, PausedRequest>;
}

// ---------------------------------------------------------------------------
// IOStream - in-memory stream handles for IO.read / IO.close
// ---------------------------------------------------------------------------

/**
 * An in-memory stream registered for IO.read / IO.close usage.
 */
export interface IOStream {
	handle: string;
	data: Uint8Array;
	position: number;
}

// ---------------------------------------------------------------------------
// NetworkContext - shared between Network, Fetch, IO domain handlers
// ---------------------------------------------------------------------------

/**
 * Shared mutable state for all network-related domain handlers.
 * One instance per `StaticDomHandler`.
 */
export interface NetworkContext {
	/** In-memory cookie jar.  Keyed by "domain|path|name". */
	cookies: Map<string, CdpCookie>;
	/** Response body cache keyed by requestId. */
	requestRegistry: Map<string, RequestState>;
	/** Extra headers to inject on every outgoing request (Network.setExtraHTTPHeaders). */
	extraHeaders: Record<string, string>;
	/** Current network conditions (Network.emulateNetworkConditions). */
	networkConditions: NetworkConditions | null;
	/** Per-session fetch interception state.  Key: sessionId (or ""). */
	fetchSessions: Map<string, FetchInterceptionState>;
	/** Active IO streams keyed by handle. */
	ioStreams: Map<string, IOStream>;
}

// ---------------------------------------------------------------------------
// DispatchContext
// ---------------------------------------------------------------------------

/**
 * Context object injected into every domain handler call.
 * Provides access to per-page state management and event emission without
 * leaking the full `StaticDomHandler` class internals.
 */
export interface DispatchContext {
	/**
	 * Returns the `PageState` associated with the given `sessionId`.
	 * Creates a new page on demand if the session is unknown (same behaviour as
	 * the original monolithic switch - Puppeteer may call Page.navigate before
	 * Target.createTarget in some flows).
	 */
	pageBySession(sessionId: string | undefined): PageState;

	/**
	 * Like `pageBySession` but returns `null` instead of creating a new page
	 * when the session is unknown.
	 */
	pageBySessionSoft(sessionId: string): PageState | null;

	/**
	 * Creates a new blank page and registers it in the page registry.
	 */
	createPage(): PageState;

	/**
	 * Emits an unsolicited CDP event (e.g. `Target.targetCreated`) to all
	 * connected Puppeteer sessions.
	 */
	emitEvent(event: CDPEvent): void;

	/**
	 * Emits `Runtime.executionContextCreated` for both the main world and the
	 * Puppeteer utility world on the given page's session.  Must be called
	 * after each navigation.
	 */
	emitExecutionContexts(page: PageState): void;

	/**
	 * Returns the target-info shape for the given page (used by
	 * `Target.targetCreated` / `Target.attachedToTarget` events).
	 */
	pageTargetInfo(page: PageState): PageTargetInfo;

	/**
	 * The underlying transport instance, exposed so `Browser.close` can call
	 * `transport.close()`.
	 */
	transport: StaticDomTransport | null;

	/**
	 * Navigates the given page to the specified URL.
	 * Handles data: URIs, about:blank, and HTTP fetches.
	 * Lives in the transport because it needs access to the ParsedDocument
	 * constructor which uses the zigquery FFI.
	 */
	navigate(page: PageState, url: string): Promise<void>;

	/**
	 * Registry of all open pages keyed by `targetId`.
	 * Domain handlers may iterate over it (read-only; mutations must go through
	 * `createPage` / the transport's own close logic).
	 */
	pages: ReadonlyMap<string, PageState>;

	/**
	 * Set of sessionIds that have called `Target.setAutoAttach`.  Mutated by
	 * the Target domain handler.
	 */
	autoAttachSessions: Set<string>;

	/**
	 * Shared network state: cookie jar, request registry, extra headers,
	 * fetch interception, IO streams.  Owned by `StaticDomHandler` and shared
	 * across Network, Fetch, and IO domain handlers.
	 */
	networkCtx: NetworkContext;
}

// ---------------------------------------------------------------------------
// PageState
// ---------------------------------------------------------------------------

/** Minimal DOM node stored in the in-process DOM tree. */
export interface DOMNode {
	nodeId: number;
	backendNodeId: number;
	nodeType: number;
	nodeName: string;
	localName: string;
	nodeValue: string;
	childNodeCount: number;
	children?: DOMNode[];
	attributes?: string[];
	frameId?: string;
	documentURL?: string;
	baseURL?: string;
}

/** Target info shape used in Target.targetCreated / Target.attachedToTarget events. */
export interface PageTargetInfo {
	targetId: string;
	type: "page";
	title: string;
	url: string;
	attached: boolean;
	canAccessOpener: boolean;
	browserContextId: string;
}

// ---------------------------------------------------------------------------
// EmulationState - per-page emulation overrides
// ---------------------------------------------------------------------------

/**
 * Emulated device metrics set by `Emulation.setDeviceMetricsOverride`.
 */
export interface DeviceMetrics {
	width: number;
	height: number;
	deviceScaleFactor: number;
	mobile: boolean;
}

/**
 * Emulated media feature set by `Emulation.setEmulatedMedia`.
 */
export interface EmulatedMediaFeature {
	name: string;
	value: string;
}

/**
 * Per-page emulation state.  All fields are optional - undefined means "use
 * the transport default".
 */
export interface EmulationState {
	/** Override viewport dimensions and scale factor. */
	deviceMetrics?: DeviceMetrics;
	/** Emulated media type, e.g. "screen" | "print" | "". */
	mediaType?: string;
	/** Emulated CSS media features, e.g. [{name:"prefers-color-scheme",value:"dark"}]. */
	mediaFeatures?: EmulatedMediaFeature[];
	/** User-Agent string to send in HTTP request headers. */
	userAgent?: string;
	/** Geolocation override (latitude, longitude, accuracy). */
	geolocation?: { latitude: number; longitude: number; accuracy?: number };
	/** BCP-47 locale string, used for Accept-Language header. */
	locale?: string;
	/** IANA timezone identifier, e.g. "America/New_York". */
	timezone?: string;
}

// ---------------------------------------------------------------------------
// SecurityState - per-page TLS override
// ---------------------------------------------------------------------------

/**
 * Per-page security state.
 */
export interface SecurityState {
	/** When true, TLS certificate errors are ignored on next fetch. */
	ignoreCertificateErrors: boolean;
}

// ---------------------------------------------------------------------------
// PageState
// ---------------------------------------------------------------------------

/**
 * A script registered via Page.addScriptToEvaluateOnNewDocument.
 * In static mode these are tracked but not actually executed (no JS engine).
 */
export interface RegisteredScript {
	identifier: string;
	source: string;
}

/**
 * Runtime state for a single "tab" (page target) managed by
 * `StaticDomHandler`.
 */
export interface PageState {
	targetId: string;
	sessionId: string;
	frameId: string;
	url: string;
	title: string;
	/** Parsed document - null until the first navigation. */
	doc: ParsedDocumentLike | null;
	/** Current CDP loader ID (incremented on each navigation). */
	loaderId: string;
	/** Counter used to generate unique loader IDs. */
	loaderCounter: number;
	/** Emulation overrides set via Emulation.* commands. */
	emulation: EmulationState;
	/** TLS security overrides set via Security.* commands. */
	security: SecurityState;
	/**
	 * Scripts registered via Page.addScriptToEvaluateOnNewDocument.
	 * Keyed by identifier.  In static mode these are tracked but not executed.
	 */
	scripts: Map<string, RegisteredScript>;
	/** Counter used to generate unique script identifiers. */
	scriptCounter: number;
	/** Whether a screencast is currently active on this page. */
	screencastActive: boolean;
	/** HTTP status code of the last navigation. */
	lastStatus?: number;
	/** The expected name for the isolated utility world. */
	utilityWorldName: string;
}

/**
 * Minimal interface exposing the parts of `ParsedDocument` that domain
 * handlers need.  The full implementation lives in `StaticDomTransport.ts`.
 */
export interface ParsedDocumentLike {
	readonly rawHtml: string;
	readonly url: string;
	readonly title: string;
	readonly rootId: number;
	querySelectorAll(selector: string): Promise<ParsedNodeLike[]>;
	querySelector(selector: string): Promise<ParsedNodeLike | undefined>;
	getNodeById(nodeId: number): ParsedNodeLike | undefined;
	toCDPNode(node: ParsedNodeLike): DOMNode;
	destroy(): void;
}

/** Minimal node shape used by DOM domain handlers. */
export interface ParsedNodeLike {
	nodeId: number;
	tagName: string;
	outerHTML: string;
	textContent: string;
	attributes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// DomainHandler
// ---------------------------------------------------------------------------

/**
 * Signature for a domain handler function.
 *
 * @param method   - full CDP method name, e.g. `"Page.navigate"`
 * @param params   - raw params object from the CDP request
 * @param ctx      - dispatch context (page access + event emission)
 * @param sessionId - CDP session ID (undefined for the root connection)
 * @returns a resolved result object, or `null` if this domain does not handle
 *          the method (causes the dispatcher to try the next handler in the
 *          chain).
 */
export type DomainHandler = (
	method: string,
	params: Record<string, unknown>,
	ctx: DispatchContext,
	sessionId: string | undefined,
) => Promise<CDPHandlerResult>;
