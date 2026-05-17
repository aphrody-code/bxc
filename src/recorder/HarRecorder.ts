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
 * @module bunlight/recorder/HarRecorder
 *
 * Records network traffic through CDP Network events and exports it as a
 * HAR 1.2 archive. Works with any Bunlight `Page` (static, fast, or any
 * CDP-backed transport) by tapping into the `Network.requestWillBeSent` and
 * `Network.responseReceived` CDP events.
 *
 * Usage:
 * ```ts
 * import { HarRecorder } from "./HarRecorder.ts";
 * import { Browser } from "../api/browser.ts";
 *
 * const page = await Browser.newPage({ profile: "static" });
 * const recorder = new HarRecorder(page);
 * recorder.start();
 * await page.goto("https://google.com");
 * const har = recorder.stop();
 * await recorder.save("/tmp/example.har");
 * await page.close();
 * ```
 */

import type { Page } from "../api/browser.ts";
import type {
	HarCache,
	HarContent,
	HarCookie,
	HarEntry,
	HarLog,
	HarNameValue,
	HarPage,
	HarRequest,
	HarResponse,
	HarTimings,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Internal state per in-flight request
// ---------------------------------------------------------------------------

interface RequestState {
	requestId: string;
	startedDateTime: string;
	startMs: number;
	pageref: string;
	request: HarRequest;
}

// ---------------------------------------------------------------------------
// CDP event shapes (minimal — only the fields we consume)
// ---------------------------------------------------------------------------

interface CdpNetworkRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	postData?: string;
	initialPriority?: string;
}

interface CdpNetworkResponse {
	url: string;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	mimeType: string;
	encodedDataLength?: number;
	fromDiskCache?: boolean;
	fromServiceWorker?: boolean;
	timing?: {
		requestTime: number;
		dnsStart: number;
		dnsEnd: number;
		connectStart: number;
		connectEnd: number;
		sslStart: number;
		sslEnd: number;
		sendStart: number;
		sendEnd: number;
		receiveHeadersEnd: number;
	};
}

interface CdpRequestWillBeSent {
	requestId: string;
	frameId?: string;
	loaderId?: string;
	documentURL?: string;
	request: CdpNetworkRequest;
	timestamp: number;
	wallTime?: number;
	type?: string;
	redirectResponse?: CdpNetworkResponse;
}

interface CdpResponseReceived {
	requestId: string;
	frameId?: string;
	loaderId?: string;
	timestamp: number;
	type?: string;
	response: CdpNetworkResponse;
}

interface CdpLoadingFinished {
	requestId: string;
	timestamp: number;
	encodedDataLength: number;
}

interface CdpLoadingFailed {
	requestId: string;
	timestamp: number;
	errorText: string;
	canceled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a Record<string, string> header map into HAR's `HarNameValue[]`
 * format. CDP sends headers as a flat object; HAR requires an array of pairs.
 */
function headersToHar(headers: Record<string, string>): HarNameValue[] {
	return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

/**
 * Parses a URL query string into `HarNameValue[]`.
 */
function parseQueryString(url: string): HarNameValue[] {
	try {
		const parsed = new URL(url);
		const result: HarNameValue[] = [];
		parsed.searchParams.forEach((value, name) => {
			result.push({ name, value });
		});
		return result;
	} catch {
		return [];
	}
}

/**
 * Parses a `Cookie:` header string into `HarCookie[]`.
 * Input format: "name1=val1; name2=val2"
 */
function parseCookieHeader(cookieHeader: string): HarCookie[] {
	if (!cookieHeader) return [];
	return cookieHeader.split(";").map((pair) => {
		const eq = pair.indexOf("=");
		if (eq < 0) return { name: pair.trim(), value: "" };
		return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
	});
}

/**
 * Parses a `Set-Cookie:` header value into a `HarCookie`.
 */
function parseSetCookieHeader(setCookieHeader: string): HarCookie {
	const parts = setCookieHeader.split(";");
	const firstPart = parts[0] ?? "";
	const eq = firstPart.indexOf("=");
	const name = eq >= 0 ? firstPart.slice(0, eq).trim() : firstPart.trim();
	const value = eq >= 0 ? firstPart.slice(eq + 1).trim() : "";
	const cookie: HarCookie = { name, value };

	for (let i = 1; i < parts.length; i++) {
		const part = parts[i].trim();
		const eqIdx = part.indexOf("=");
		const key = (eqIdx >= 0 ? part.slice(0, eqIdx) : part).trim().toLowerCase();
		const val = eqIdx >= 0 ? part.slice(eqIdx + 1).trim() : "";
		if (key === "path") cookie.path = val;
		else if (key === "domain") cookie.domain = val;
		else if (key === "expires") cookie.expires = val;
		else if (key === "httponly") cookie.httpOnly = true;
		else if (key === "secure") cookie.secure = true;
	}
	return cookie;
}

/**
 * Extracts HAR cookies from a response headers map. CDP may include multiple
 * `set-cookie` values merged with `\n` separator (Chrome CDP behaviour).
 */
function extractResponseCookies(headers: Record<string, string>): HarCookie[] {
	const raw = headers["set-cookie"] ?? headers["Set-Cookie"] ?? "";
	if (!raw) return [];
	return raw.split("\n").filter(Boolean).map(parseSetCookieHeader);
}

/**
 * Extracts HAR cookies from a request headers map (from the `Cookie:` header).
 */
function extractRequestCookies(headers: Record<string, string>): HarCookie[] {
	const raw = headers["cookie"] ?? headers["Cookie"] ?? "";
	return parseCookieHeader(raw);
}

/**
 * Converts CDP timing data into HAR timings. All values in milliseconds.
 * CDP timing values are relative to `requestTime` in seconds; we convert to ms.
 */
function buildTimings(cdpTiming: CdpNetworkResponse["timing"], totalMs: number): HarTimings {
	if (!cdpTiming) {
		// No timing info available — distribute total time across send+wait+receive
		const third = Math.round(totalMs / 3);
		return {
			blocked: -1,
			dns: -1,
			connect: -1,
			send: third,
			wait: third,
			receive: Math.max(0, totalMs - third * 2),
			ssl: -1,
		};
	}

	const toMs = (s: number) => (s < 0 ? -1 : Math.round(s));

	const dns =
		cdpTiming.dnsStart >= 0 && cdpTiming.dnsEnd >= 0
			? toMs((cdpTiming.dnsEnd - cdpTiming.dnsStart) * 1000)
			: -1;

	const connect =
		cdpTiming.connectStart >= 0 && cdpTiming.connectEnd >= 0
			? toMs((cdpTiming.connectEnd - cdpTiming.connectStart) * 1000)
			: -1;

	const ssl =
		cdpTiming.sslStart >= 0 && cdpTiming.sslEnd >= 0
			? toMs((cdpTiming.sslEnd - cdpTiming.sslStart) * 1000)
			: -1;

	const send =
		cdpTiming.sendStart >= 0 && cdpTiming.sendEnd >= 0
			? Math.max(0, toMs((cdpTiming.sendEnd - cdpTiming.sendStart) * 1000))
			: 0;

	const wait =
		cdpTiming.sendEnd >= 0 && cdpTiming.receiveHeadersEnd >= 0
			? Math.max(0, toMs((cdpTiming.receiveHeadersEnd - cdpTiming.sendEnd) * 1000))
			: Math.max(0, Math.round(totalMs * 0.8));

	const receive = Math.max(0, totalMs - send - wait);

	return { blocked: -1, dns, connect, send, wait, receive, ssl };
}

// ---------------------------------------------------------------------------
// HarRecorder
// ---------------------------------------------------------------------------

/**
 * Records network events from a Bunlight `Page` and produces a HAR 1.2 log.
 *
 * The recorder hooks into the CDP message stream via the page's internal
 * transport to intercept `Network.requestWillBeSent`, `Network.responseReceived`,
 * `Network.loadingFinished`, and `Network.loadingFailed` events.
 *
 * Because Bunlight's `StaticDomTransport` (profile=static) does not execute
 * network requests, the recorder will produce an empty entries list for that
 * profile. It is most useful with profile=fast (Lightpanda CDP) or any real
 * browser-backed transport.
 */
export class HarRecorder {
	readonly #page: Page;
	#recording = false;
	#entries: HarEntry[] = [];
	#pages: HarPage[] = [];
	#inFlight = new Map<string, RequestState>();
	#currentPageId = "page_1";
	#currentPageStart = new Date().toISOString();
	#originalOnMessage?: (raw: string) => void;

	constructor(page: Page) {
		this.#page = page;
	}

	/**
	 * Starts recording. Idempotent: calling start() twice has no extra effect.
	 */
	start(): void {
		if (this.#recording) return;
		this.#recording = true;
		this.#entries = [];
		this.#pages = [];
		this.#inFlight = new Map();
		this.#currentPageStart = new Date().toISOString();
		this.#currentPageId = "page_1";

		// Register an initial page
		this.#pages.push({
			startedDateTime: this.#currentPageStart,
			id: this.#currentPageId,
			title: "",
			pageTimings: { onContentLoad: -1, onLoad: -1 },
		});

		// Tap into the transport message stream
		const transport = this.#page._internalTransport;
		const prevOnMessage = transport.onmessage;
		this.#originalOnMessage = prevOnMessage;

		transport.onmessage = (raw: string) => {
			prevOnMessage?.call(transport, raw);
			if (this.#recording) {
				this.#handleCdpMessage(raw);
			}
		};
	}

	/**
	 * Stops recording and returns the complete HAR log.
	 * The recorder is reset and can be restarted by calling `start()` again.
	 */
	stop(): HarLog {
		this.#recording = false;

		// Restore original transport message handler
		const transport = this.#page._internalTransport;
		transport.onmessage = this.#originalOnMessage;
		this.#originalOnMessage = undefined;

		// Flush any in-flight requests as incomplete entries
		for (const state of this.#inFlight.values()) {
			const endMs = Date.now();
			const totalMs = Math.max(0, endMs - state.startMs);
			this.#entries.push(
				this.#buildEntry(
					state,
					{
						status: 0,
						statusText: "Incomplete",
						httpVersion: "HTTP/1.1",
						cookies: [],
						headers: [],
						content: { size: -1, mimeType: "application/octet-stream" },
						redirectURL: "",
						headersSize: -1,
						bodySize: -1,
					},
					totalMs,
				),
			);
		}
		this.#inFlight.clear();

		const log: HarLog = {
			version: "1.2",
			creator: { name: "Bunlight", version: "0.1.0" },
			browser: { name: "Bunlight", version: "0.1.0" },
			pages: [...this.#pages],
			entries: [...this.#entries],
		};

		// Reset for next recording session
		this.#entries = [];
		this.#pages = [];

		return log;
	}

	/**
	 * Saves the current HAR log to `path` as a JSON file.
	 * Calls `stop()` internally if recording is still active.
	 */
	async save(path: string): Promise<void> {
		const log = this.#recording ? this.stop() : this.stop();
		const harFile = { log };
		await Bun.write(path, JSON.stringify(harFile, null, 2));
	}

	// ---------------------------------------------------------------------------
	// CDP message interception
	// ---------------------------------------------------------------------------

	#handleCdpMessage(raw: string): void {
		let msg: { method?: string; params?: Record<string, unknown>; id?: number };
		try {
			msg = JSON.parse(raw) as typeof msg;
		} catch {
			return;
		}

		// Only process unsolicited events (no `id` field)
		if (msg.id !== undefined || !msg.method || !msg.params) return;

		const sessionId = this.#page._internalSessionId;

		// Filter to events on this page's session
		const rawMsg = msg as { sessionId?: string };
		if (rawMsg.sessionId !== undefined && rawMsg.sessionId !== sessionId) return;

		switch (msg.method) {
			case "Network.requestWillBeSent":
				this.#onRequestWillBeSent(msg.params as unknown as CdpRequestWillBeSent);
				break;
			case "Network.responseReceived":
				this.#onResponseReceived(msg.params as unknown as CdpResponseReceived);
				break;
			case "Network.loadingFinished":
				this.#onLoadingFinished(msg.params as unknown as CdpLoadingFinished);
				break;
			case "Network.loadingFailed":
				this.#onLoadingFailed(msg.params as unknown as CdpLoadingFailed);
				break;
			case "Page.frameNavigated":
				this.#onFrameNavigated(msg.params);
				break;
		}
	}

	#onRequestWillBeSent(event: CdpRequestWillBeSent): void {
		const { requestId, request, wallTime } = event;
		const now = wallTime ? new Date(wallTime * 1000) : new Date();
		const startedDateTime = now.toISOString();
		const startMs = now.getTime();

		const postData = request.postData
			? {
					mimeType:
						request.headers["Content-Type"] ??
						request.headers["content-type"] ??
						"application/octet-stream",
					text: request.postData,
				}
			: undefined;

		const harRequest: HarRequest = {
			method: request.method.toUpperCase(),
			url: request.url,
			httpVersion: "HTTP/1.1",
			cookies: extractRequestCookies(request.headers),
			headers: headersToHar(request.headers),
			queryString: parseQueryString(request.url),
			postData,
			headersSize: -1,
			bodySize: postData ? postData.text.length : -1,
		};

		this.#inFlight.set(requestId, {
			requestId,
			startedDateTime,
			startMs,
			pageref: this.#currentPageId,
			request: harRequest,
		});
	}

	#onResponseReceived(event: CdpResponseReceived): void {
		const state = this.#inFlight.get(event.requestId);
		if (!state) return;

		const response = event.response;
		const endMs = event.timestamp ? event.timestamp * 1000 : Date.now();
		const totalMs = Math.max(0, endMs - state.startMs);

		const content: HarContent = {
			size: response.encodedDataLength ?? -1,
			mimeType: response.mimeType || "application/octet-stream",
		};

		const harResponse: HarResponse = {
			status: response.status,
			statusText: response.statusText,
			httpVersion: "HTTP/1.1",
			cookies: extractResponseCookies(response.headers),
			headers: headersToHar(response.headers),
			content,
			redirectURL: response.headers["location"] ?? response.headers["Location"] ?? "",
			headersSize: -1,
			bodySize: response.encodedDataLength ?? -1,
		};

		const timings = buildTimings(response.timing, totalMs);

		const entry = this.#buildEntry(state, harResponse, totalMs, timings);
		this.#entries.push(entry);
		this.#inFlight.delete(event.requestId);
	}

	#onLoadingFinished(event: CdpLoadingFailed | CdpLoadingFinished): void {
		// If the request is still in-flight (no responseReceived), finalize it now
		const state = this.#inFlight.get(event.requestId);
		if (!state) return;

		const encodedDataLength =
			"encodedDataLength" in event && typeof event.encodedDataLength === "number"
				? event.encodedDataLength
				: -1;

		const totalMs = event.timestamp ? Math.max(0, event.timestamp * 1000 - state.startMs) : 0;

		const harResponse: HarResponse = {
			status: 200,
			statusText: "OK",
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [],
			content: { size: encodedDataLength, mimeType: "application/octet-stream" },
			redirectURL: "",
			headersSize: -1,
			bodySize: encodedDataLength,
		};

		this.#entries.push(this.#buildEntry(state, harResponse, totalMs));
		this.#inFlight.delete(event.requestId);
	}

	#onLoadingFailed(event: CdpLoadingFailed): void {
		const state = this.#inFlight.get(event.requestId);
		if (!state) return;

		const totalMs = event.timestamp ? Math.max(0, event.timestamp * 1000 - state.startMs) : 0;

		const harResponse: HarResponse = {
			status: 0,
			statusText: event.errorText,
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [],
			content: { size: 0, mimeType: "application/octet-stream", text: "" },
			redirectURL: "",
			headersSize: -1,
			bodySize: 0,
			comment: `Failed: ${event.errorText}`,
		};

		this.#entries.push(this.#buildEntry(state, harResponse, totalMs));
		this.#inFlight.delete(event.requestId);
	}

	#onFrameNavigated(params: Record<string, unknown>): void {
		// Each top-level frame navigation creates a new HAR page
		const pageCount = this.#pages.length + 1;
		const frame = params["frame"] as Record<string, unknown> | undefined;
		const url = typeof frame?.["url"] === "string" ? frame["url"] : "";
		const title = typeof frame?.["name"] === "string" ? frame["name"] : url;

		const newPageId = `page_${pageCount}`;
		this.#currentPageId = newPageId;
		this.#currentPageStart = new Date().toISOString();

		this.#pages.push({
			startedDateTime: this.#currentPageStart,
			id: newPageId,
			title,
			pageTimings: { onContentLoad: -1, onLoad: -1 },
		});
	}

	#buildEntry(
		state: RequestState,
		response: HarResponse,
		totalMs: number,
		timings?: HarTimings,
	): HarEntry {
		const cache: HarCache = {};
		const resolvedTimings = timings ?? buildTimings(undefined, totalMs);

		return {
			pageref: state.pageref,
			startedDateTime: state.startedDateTime,
			time: Math.round(totalMs),
			request: state.request,
			response,
			cache,
			timings: resolvedTimings,
		};
	}
}
