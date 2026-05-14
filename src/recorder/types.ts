/**
 * @module bunlight/recorder/types
 *
 * HAR 1.2 type definitions.
 * Spec: http://www.softwareishard.com/blog/har-12-spec/
 *
 * All fields follow the HAR 1.2 specification strictly. Optional fields are
 * marked with `?` and default to sensible empty values when omitted.
 */

// ---------------------------------------------------------------------------
// HAR 1.2 primitive types
// ---------------------------------------------------------------------------

/**
 * A name/value pair as used in headers, query strings, cookies, and POST data.
 */
export interface HarNameValue {
	name: string;
	value: string;
	comment?: string;
}

/** A single cookie captured from a request or response. */
export interface HarCookie {
	name: string;
	value: string;
	path?: string;
	domain?: string;
	expires?: string;
	httpOnly?: boolean;
	secure?: boolean;
	comment?: string;
}

/** The "timings" object for a single HAR entry (all values in ms, -1 = N/A). */
export interface HarTimings {
	/** Time spent blocked waiting for a network connection (-1 if not applicable). */
	blocked: number;
	/** DNS resolution time (-1 if not applicable). */
	dns: number;
	/** Time required to create a TCP connection (-1 if not applicable). */
	connect: number;
	/** Time required to send HTTP request to the server. */
	send: number;
	/** Waiting for a response from the server (TTFB). */
	wait: number;
	/** Time required to read the entire response from the server. */
	receive: number;
	/** Time required for SSL/TLS negotiation (-1 if not applicable). */
	ssl?: number;
	comment?: string;
}

/** The HTTP request in a HAR entry. */
export interface HarRequest {
	/** HTTP request method (GET, POST, ...). */
	method: string;
	/** Absolute URL of the request. */
	url: string;
	/** HTTP version string (e.g. "HTTP/1.1"). */
	httpVersion: string;
	/** List of request cookies. */
	cookies: HarCookie[];
	/** List of request headers. */
	headers: HarNameValue[];
	/** URL query parameters extracted from the URL. */
	queryString: HarNameValue[];
	/** POST data (only present for POST requests). */
	postData?: HarPostData;
	/** Total number of bytes from the start of the HTTP request up to and
	 *  including the double CRLF before the request body (-1 if unknown). */
	headersSize: number;
	/** Size of the request body (POST data) in bytes (-1 if unknown). */
	bodySize: number;
	comment?: string;
}

/** POST data captured in a HAR request. */
export interface HarPostData {
	/** MIME type of the POST data. */
	mimeType: string;
	/** List of posted parameters (used when mimeType is application/x-www-form-urlencoded). */
	params?: HarNameValue[];
	/** Plain text representation of the POST data. */
	text: string;
	comment?: string;
}

/** Content of a response body. */
export interface HarContent {
	/** Length of the returned content in bytes. -1 if unknown. */
	size: number;
	/** Number of bytes saved. Use -1 if unknown. */
	compression?: number;
	/** MIME type of the response. */
	mimeType: string;
	/** Response body as plain text (may be base64-encoded for binary content). */
	text?: string;
	/** Encoding used for the `text` field (e.g. "base64"). */
	encoding?: string;
	comment?: string;
}

/** The HTTP response in a HAR entry. */
export interface HarResponse {
	/** HTTP response status code. */
	status: number;
	/** HTTP response status text. */
	statusText: string;
	/** HTTP version string. */
	httpVersion: string;
	/** List of response cookies. */
	cookies: HarCookie[];
	/** List of response headers. */
	headers: HarNameValue[];
	/** Response body content. */
	content: HarContent;
	/** URL of the redirected response. Empty string if no redirect. */
	redirectURL: string;
	/** Total number of bytes from start of HTTP response message up to
	 *  (and including) double CRLF before body (-1 if unknown). */
	headersSize: number;
	/** Size of the received response body in bytes (-1 if unknown). */
	bodySize: number;
	comment?: string;
}

/** Cache state for a request. */
export interface HarCache {
	/** State of a cache entry before the request. */
	beforeRequest?: HarCacheEntry;
	/** State of a cache entry after the request. */
	afterRequest?: HarCacheEntry;
	comment?: string;
}

/** A single cache entry state. */
export interface HarCacheEntry {
	expires?: string;
	lastAccess: string;
	eTag: string;
	hitCount: number;
	comment?: string;
}

/** A single network request/response pair in the HAR log. */
export interface HarEntry {
	/** Reference to the parent page. */
	pageref?: string;
	/** Date and time stamp of the request start (ISO 8601). */
	startedDateTime: string;
	/** Total elapsed time for the request in milliseconds. */
	time: number;
	/** The HTTP request. */
	request: HarRequest;
	/** The HTTP response. */
	response: HarResponse;
	/** Cache information for the request. */
	cache: HarCache;
	/** Detailed timing breakdown. */
	timings: HarTimings;
	/** IP address of the server that was connected to. */
	serverIPAddress?: string;
	/** Unique ID of the TCP/IP connection. */
	connection?: string;
	comment?: string;
}

/** Information about the page that generated the HAR. */
export interface HarPage {
	/** Date and time stamp for the beginning of the page load (ISO 8601). */
	startedDateTime: string;
	/** Unique identifier for the page. */
	id: string;
	/** Page title. */
	title: string;
	/** Timings for various events during page load. */
	pageTimings: HarPageTimings;
	comment?: string;
}

/** Page-level timings in milliseconds. */
export interface HarPageTimings {
	/** Content of page loaded (ms). -1 if not applicable. */
	onContentLoad?: number;
	/** Page is loaded (onLoad event fired). -1 if not applicable. */
	onLoad?: number;
	comment?: string;
}

/** Creator / browser info block. */
export interface HarCreatorBrowser {
	name: string;
	version: string;
	comment?: string;
}

/** The top-level HAR log object. */
export interface HarLog {
	/** HAR format version (always "1.2"). */
	version: "1.2";
	/** Software that created the HAR. */
	creator: HarCreatorBrowser;
	/** Browser that created the HAR. */
	browser?: HarCreatorBrowser;
	/** List of pages (one per navigated URL). */
	pages: HarPage[];
	/** List of request/response entries. */
	entries: HarEntry[];
	comment?: string;
}

/** Top-level HAR file structure. */
export interface HarFile {
	log: HarLog;
}
