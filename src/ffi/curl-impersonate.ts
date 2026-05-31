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

// @ts-nocheck
// FFI ABI-level casts (number <-> Pointer, ArrayBufferLike <-> ArrayBuffer)
// are correct at runtime on x86_64 SysV ABI but TS cannot model them.
/**
 * @module bxc/ffi/curl-impersonate
 *
 * Thin bun:ffi wrapper around libcurl-impersonate (lexiforest/curl-impersonate).
 *
 * Provides `ImpersonatedClient` — a fetch()-compatible client that performs
 * HTTP/1.1 + HTTP/2 requests with a Chrome/Firefox/Safari TLS fingerprint
 * (JA3/JA4) instead of the one emitted by the host TLS stack.
 *
 * The library is loaded lazily on first use via `dlopen`.  The `.so` path is
 * resolved relative to this file's location inside `vendor/curl-impersonate/`.
 *
 * Supported impersonation profiles (lexiforest/curl-impersonate, this build):
 *   Chrome:  chrome99, chrome99_android, chrome100, chrome101, chrome104,
 *            chrome107, chrome110, chrome116, chrome119, chrome120, chrome123,
 *            chrome124, chrome131, chrome131_android, chrome133a, chrome136,
 *            chrome142, chrome145, chrome146
 *   Firefox: firefox133, firefox135, firefox144, firefox147
 *   Safari:  safari15_3, safari15_5, safari17_0, safari17_2_ios,
 *            safari18_0, safari18_0_ios, safari18_4, safari18_4_ios,
 *            safari26_0, safari26_0_1, safari26_0_ios
 *   Edge:    edge99, edge101
 *
 * Default profile: `chrome131`
 *
 * @example
 * ```ts
 * import { ImpersonatedClient } from "bxc/ffi/curl-impersonate";
 *
 * const client = new ImpersonatedClient({ profile: "chrome131" });
 * const res = await client.fetch("https://tls.peet.ws/api/all");
 * console.log(await res.json());
 * client.close();
 * ```
 */

import {
	dlopen,
	FFIType,
	JSCallback,
	type Library,
	ptr,
	toArrayBuffer,
} from "bun:ffi";
import { join } from "node:path";
import { hasEmbedded, curlImpersonateAsset } from "../rust/embedded-assets.ts";
import { extractEmbeddedAssetIfNeeded } from "../internal/embedded-loader.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Impersonation profile string accepted by curl_easy_impersonate(). */
export type ImpersonateProfile =
	// Chrome (desktop)
	| "chrome99"
	| "chrome100"
	| "chrome101"
	| "chrome104"
	| "chrome107"
	| "chrome110"
	| "chrome116"
	| "chrome119"
	| "chrome120"
	| "chrome123"
	| "chrome124"
	| "chrome131"
	| "chrome133a"
	| "chrome136"
	| "chrome142"
	| "chrome145"
	| "chrome146"
	// Chrome (Android)
	| "chrome99_android"
	| "chrome131_android"
	// Firefox
	| "firefox133"
	| "firefox135"
	| "firefox144"
	| "firefox147"
	// Safari (macOS/desktop)
	| "safari15_3"
	| "safari15_5"
	| "safari17_0"
	| "safari18_0"
	| "safari18_4"
	| "safari26_0"
	| "safari26_0_1"
	// Safari (iOS)
	| "safari17_2_ios"
	| "safari18_0_ios"
	| "safari18_4_ios"
	| "safari26_0_ios"
	// Edge
	| "edge99"
	| "edge101";

export type ImpersonateFamily = "chrome" | "firefox" | "safari" | "edge";

/** Options for `ImpersonatedClient`. */
export interface ImpersonatedClientOptions {
	/** TLS impersonation profile. Default: `"chrome131"`. */
	profile?: ImpersonateProfile;
	/** Whether to default to Chrome-style headers (Accept, Accept-Language, …).
	 *  `true` by default when profile is a Chrome variant. */
	defaultHeaders?: boolean;
	/** Maximum simultaneous connections per host (default: 6). */
	maxConnections?: number;
	/** Global request timeout in milliseconds (default: 30_000). */
	timeoutMs?: number;
	/** Follow redirects (default: true). */
	followRedirects?: boolean;
	/** Max redirect hops (default: 10). */
	maxRedirects?: number;
	/** Verify SSL certificates (default: true). */
	sslVerify?: boolean;
	/** Path to CA bundle (default: system). */
	caBundle?: string;
}

/** Options for a single `fetch()` call. */
export interface FetchOptions {
	method?: string;
	headers?: Record<string, string> | Headers;
	body?: string | Uint8Array | ArrayBuffer | URLSearchParams;
	/** Override per-request timeout (ms). */
	timeoutMs?: number;
	/** Override impersonation profile for this request only. */
	profile?: ImpersonateProfile;
	/** Persistent cookies to send (semicolon-separated "k=v" string). */
	cookies?: string;
	/** Follow redirects for this request (overrides client default). */
	followRedirects?: boolean;
	/** Bypass TLS certificate validation. */
	insecure?: boolean;
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// CURLOPT constants (from curl.h — stable across versions)
// ---------------------------------------------------------------------------

const CURLOPT = {
	URL: 10002,
	PORT: 3,
	HTTPHEADER: 10023,
	POSTFIELDS: 10015,
	POSTFIELDSIZE: 60,
	COPYPOSTFIELDS: 10165,
	CUSTOMREQUEST: 10036,
	USERAGENT: 10018,
	COOKIE: 10022,
	COOKIEFILE: 10031, // "" = enable in-memory cookie engine
	TIMEOUT_MS: 155,
	CONNECTTIMEOUT_MS: 156,
	FOLLOWLOCATION: 52,
	MAXREDIRS: 68,
	SSL_VERIFYPEER: 64,
	SSL_VERIFYHOST: 81,
	CAINFO: 10065,
	WRITEFUNCTION: 20011,
	WRITEDATA: 10001,
	HEADERFUNCTION: 20079,
	HEADERDATA: 10029,
	HTTP_VERSION: 84,
	HTTPGET: 80,
	POST: 47,
	NOBODY: 44,
	VERBOSE: 41,
	ERRORBUFFER: 10010,
	// "" = enable any built-in encoding (gzip, deflate, br, zstd) — required
	// to receive decoded bodies for hosts that always answer compressed.
	ACCEPT_ENCODING: 102,
	NOSIGNAL: 99,
	MAXCONNECTS: 71,
	TCP_KEEPALIVE: 213,
} as const;

/** CURLcode success value. */
const CURLE_OK = 0;

// ---------------------------------------------------------------------------
// Library singleton
// ---------------------------------------------------------------------------

let _lib: Library<typeof SYMBOLS> | null = null;
let _libPath: string | null = null;

const SYMBOLS = {
	curl_global_init: {
		args: [FFIType.i64],
		returns: FFIType.i32,
	},
	curl_global_cleanup: {
		args: [],
		returns: FFIType.void,
	},
	curl_easy_init: {
		args: [],
		returns: FFIType.ptr,
	},
	curl_easy_cleanup: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	curl_easy_reset: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	curl_easy_setopt: {
		// varargs — on x86_64 SysV ABI, both long and void* map to the same 64-bit
		// general-purpose register, so i64 covers both pointer and scalar cases.
		// Pass BigInt(ptr(buf)) for pointer args, BigInt(value) for integer args.
		args: [FFIType.ptr, FFIType.i32, FFIType.i64],
		returns: FFIType.i32,
	},
	curl_easy_perform: {
		args: [FFIType.ptr],
		returns: FFIType.i32,
	},
	curl_easy_getinfo: {
		args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
		returns: FFIType.i32,
	},
	curl_easy_impersonate: {
		args: [FFIType.ptr, FFIType.cstring, FFIType.i32],
		returns: FFIType.i32,
	},
	curl_easy_strerror: {
		args: [FFIType.i32],
		returns: FFIType.cstring,
	},
	curl_slist_append: {
		args: [FFIType.ptr, FFIType.cstring],
		returns: FFIType.ptr,
	},
	curl_slist_free_all: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
} as const;

function resolveLibPath(): string {
	if (hasEmbedded && curlImpersonateAsset) {
		const name =
			process.platform === "win32"
				? "libcurl-impersonate.dll"
				: process.platform === "darwin"
					? "libcurl-impersonate.dylib"
					: "libcurl-impersonate.so";
		try {
			const extracted = extractEmbeddedAssetIfNeeded(
				curlImpersonateAsset,
				name,
			);
			if (extracted && Bun.file(extracted).size > 0) {
				return extracted;
			}
		} catch (err) {
			console.warn(
				`[bxc] Failed to load/extract embedded curl-impersonate:`,
				err,
			);
		}
	}

	// Bun-native path: import.meta.dir replaces dirname(fileURLToPath(import.meta.url))
	const dir = import.meta.dir;
	const vendor = join(dir, "../../vendor/curl-impersonate");
	// Walk up to find vendor/curl-impersonate/ — per-platform shared lib naming:
	//   Linux   : libcurl-impersonate*.so[.X.Y.Z]
	//   macOS   : libcurl-impersonate*.dylib
	//   Windows : libcurl-impersonate*.dll  (also looked up next to the executable)
	let candidates: string[];
	if (process.platform === "win32") {
		candidates = [
			join(vendor, "libcurl-impersonate.dll"),
			join(vendor, "libcurl-impersonate-chrome.dll"),
			// Bundled next to a standalone bxc.exe (build-windows.ts layout).
			join(dir, "libcurl-impersonate.dll"),
		];
	} else if (process.platform === "darwin") {
		candidates = [
			join(vendor, "libcurl-impersonate.4.dylib"),
			join(vendor, "libcurl-impersonate.dylib"),
			join(vendor, "libcurl-impersonate-chrome.4.dylib"),
			join(vendor, "libcurl-impersonate-chrome.dylib"),
		];
	} else {
		candidates = [
			join(vendor, "libcurl-impersonate.so.4.8.0"),
			join(vendor, "libcurl-impersonate.so.4"),
			join(vendor, "libcurl-impersonate.so"),
			join(vendor, "libcurl-impersonate-chrome.so.4.8.0"),
			join(vendor, "libcurl-impersonate-chrome.so.4"),
			join(vendor, "libcurl-impersonate-chrome.so"),
		];
	}
	// Allow override via env (highest priority).
	const envOverride = Bun.env.LIBCURL_IMPERSONATE_PATH;
	if (envOverride) candidates.unshift(envOverride);

	// Return the first candidate that exists on disk. `Bun.file().size` is a
	// synchronous existence probe that works on every platform (unlike spawning
	// the POSIX `test` binary, which does not exist on Windows).
	for (const c of candidates) {
		try {
			if (Bun.file(c).size > 0) return c;
		} catch {
			// not present / not readable — try the next candidate
		}
	}
	throw new Error(
		`libcurl-impersonate not found. Expected in vendor/curl-impersonate/ ` +
			`(.so / .dylib / .dll depending on platform). ` +
			`Set LIBCURL_IMPERSONATE_PATH to override.`,
	);
}

function getLib(): Library<typeof SYMBOLS> {
	if (_lib) return _lib;
	_libPath = resolveLibPath();
	_lib = dlopen(_libPath, SYMBOLS);
	// CURL_GLOBAL_ALL = 3
	_lib.symbols.curl_global_init(3n as unknown as number);
	return _lib;
}

// ---------------------------------------------------------------------------
// Internal helpers — setopt wrappers
// ---------------------------------------------------------------------------

/**
 * Encode a JS string into a null-terminated Uint8Array that remains alive
 * during the synchronous `curl_easy_perform` call.
 */
function encodeC(s: string): Uint8Array {
	const enc = new TextEncoder().encode(s);
	const buf = new Uint8Array(enc.length + 1);
	buf.set(enc);
	// last byte is already 0
	return buf;
}

function setoptStr(
	sym: Library<typeof SYMBOLS>["symbols"],
	handle: number,
	opt: number,
	value: string,
): Uint8Array {
	const buf = encodeC(value);
	// Pass pointer as BigInt — on x86_64 SysV ABI ptr and i64 share the same register
	const code = sym.curl_easy_setopt(
		handle,
		opt,
		BigInt(ptr(buf)) as unknown as number,
	);
	if (code !== CURLE_OK) {
		throw new CurlError(`curl_easy_setopt(${opt}) failed`, code);
	}
	return buf; // caller must keep alive until perform()
}

function setoptLong(
	sym: Library<typeof SYMBOLS>["symbols"],
	handle: number,
	opt: number,
	value: bigint,
): void {
	// Integer options — pass as BigInt directly (i64 ABI slot)
	const code = sym.curl_easy_setopt(handle, opt, value as unknown as number);
	if (code !== CURLE_OK) {
		throw new CurlError(`curl_easy_setopt(${opt}) failed`, code);
	}
}

// ---------------------------------------------------------------------------
// JS-side decompression fallback
// ---------------------------------------------------------------------------

/**
 * Decompress a body buffer based on its `content-encoding` header.  Returns
 * `null` if the encoding is unsupported or decoding fails (caller keeps the
 * raw buffer in that case).
 */
function tryDecompress(input: Uint8Array, encoding: string): Uint8Array | null {
	try {
		switch (encoding) {
			case "gzip":
			case "x-gzip":
				return Bun.gunzipSync(input);
			case "deflate":
				return Bun.inflateSync(input);
			case "br":
			case "brotli": {
				// Bun does not expose `Bun.brotliDecompressSync` (as of 1.3).
				// `zlib.brotliDecompressSync` is available via the Node-compat
				// layer and is genuinely synchronous — no async polyfill needed.
				const zlib = require("node:zlib") as typeof import("zlib");
				return new Uint8Array(zlib.brotliDecompressSync(input));
			}
			case "zstd":
				return Bun.zstdDecompressSync(input);
			default:
				return null;
		}
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Response collector callback
// ---------------------------------------------------------------------------

/**
 * We collect response body + headers via JSCallback.
 *
 * NOTE: JSCallback has known thread-safety limitations in bun:ffi.
 * libcurl by default runs synchronously inside curl_easy_perform on the same
 * thread, so this is safe as long as we do not use CURLOPT_NOSIGNAL=0 with
 * signals and do not call perform from worker threads without JS isolation.
 */
class ResponseCollector {
	readonly bodyChunks: Uint8Array[] = [];
	readonly headerLines: string[] = [];

	// JSCallback instances — kept alive until collect() resolves
	readonly writeCallback: JSCallback;
	readonly headerCallback: JSCallback;

	constructor() {
		// write_callback(char *ptr, size_t size, size_t nmemb, void *userdata) → size_t
		this.writeCallback = new JSCallback(
			(_ptr: number, size: number, nmemb: number, _ud: number): number => {
				const length = Number(size) * Number(nmemb);
				if (length === 0) return 0;
				// toArrayBuffer gives a zero-copy view into libcurl memory.
				// We must copy the bytes before this callback returns.
				const ab = toArrayBuffer(Number(_ptr), 0, length);
				const copy = new Uint8Array(length);
				copy.set(new Uint8Array(ab));
				this.bodyChunks.push(copy);
				return length;
			},
			{
				args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr],
				returns: FFIType.u64,
			},
		);

		// header_callback(char *buf, size_t size, size_t nitems, void *userdata) → size_t
		this.headerCallback = new JSCallback(
			(_ptr: number, size: number, nitems: number, _ud: number): number => {
				const length = Number(size) * Number(nitems);
				if (length === 0) return 0;
				const ab = toArrayBuffer(Number(_ptr), 0, length);
				const copy = new Uint8Array(length);
				copy.set(new Uint8Array(ab));
				const line = new TextDecoder().decode(copy).trimEnd();
				if (line) this.headerLines.push(line);
				return length;
			},
			{
				args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr],
				returns: FFIType.u64,
			},
		);
	}

	/** Merge chunks, parse headers, build a Web-compatible Response. */
	buildResponse(): ImpersonatedResponse {
		let body = Bun.concatArrayBuffers(this.bodyChunks);

		// Parse status line and headers
		let statusCode = 200;
		let statusText = "OK";
		const headers = new Headers();
		let effectiveUrl = "";

		for (const line of this.headerLines) {
			if (line.startsWith("HTTP/")) {
				// "HTTP/2 200" or "HTTP/1.1 200 OK"
				const parts = line.split(" ");
				const code = parseInt(parts[1] ?? "200", 10);
				if (!Number.isNaN(code)) statusCode = code;
				statusText = parts.slice(2).join(" ") || "OK";
			} else if (line.includes(": ")) {
				const idx = line.indexOf(": ");
				const name = line.slice(0, idx).toLowerCase();
				const value = line.slice(idx + 2);
				if (name === "location") effectiveUrl = value;
				headers.append(name, value);
			}
		}

		// JS-side decompression — when curl did not transparently decode
		// (curl-impersonate sometimes locks CURLOPT_ACCEPT_ENCODING to preserve
		// fingerprint integrity), strip and decode based on content-encoding.
		const encoding = (headers.get("content-encoding") ?? "")
			.toLowerCase()
			.trim();
		if (encoding && body.byteLength > 0) {
			const decoded = tryDecompress(new Uint8Array(body), encoding);
			if (decoded) {
				body = decoded.buffer.slice(
					decoded.byteOffset,
					decoded.byteOffset + decoded.byteLength,
				) as ArrayBuffer;
				headers.delete("content-encoding");
				headers.delete("content-length");
			}
		}

		return new ImpersonatedResponse(body, {
			status: statusCode,
			statusText,
			headers,
			url: effectiveUrl,
		});
	}

	dispose(): void {
		try {
			this.writeCallback.close();
		} catch {
			/* already closed */
		}
		try {
			this.headerCallback.close();
		} catch {
			/* already closed */
		}
	}
}

// ---------------------------------------------------------------------------
// ImpersonatedResponse — extends Web Response with extras
// ---------------------------------------------------------------------------

export class ImpersonatedResponse extends Response {
	readonly #effectiveUrl: string;

	constructor(body: ArrayBuffer, init: ResponseInit & { url?: string }) {
		const { url, ...rest } = init as ResponseInit & { url?: string };
		super(body, rest);
		this.#effectiveUrl = url ?? "";
	}

	/** Final URL after redirects (populated from Location headers). */
	get effectiveUrl(): string {
		return this.#effectiveUrl || this.url;
	}
}

// ---------------------------------------------------------------------------
// CurlError
// ---------------------------------------------------------------------------

export class CurlError extends Error {
	readonly curlCode: number;
	constructor(message: string, code: number) {
		super(`${message} (CURLcode ${code})`);
		this.name = "CurlError";
		this.curlCode = code;
	}
}

// ---------------------------------------------------------------------------
// ImpersonatedClient
// ---------------------------------------------------------------------------

/**
 * HTTP client backed by libcurl-impersonate.
 *
 * Uses `curl_easy_impersonate()` to set TLS + HTTP fingerprints before each
 * request.  Instantiate once and reuse across requests — the CURL handle is
 * reset between calls (no connection reuse for simplicity; add a multi-handle
 * pool if you need multiplexed pipelining).
 *
 * @example
 * ```ts
 * const client = new ImpersonatedClient({ profile: "chrome131" });
 * const res = await client.fetch("https://google.com");
 * console.log(res.status, await res.text());
 * client.close();
 * ```
 */
export class ImpersonatedClient {
	readonly #opts: Required<ImpersonatedClientOptions>;
	#handle: number | null = null;
	#closed = false;

	constructor(opts: ImpersonatedClientOptions = {}) {
		this.#opts = {
			profile: opts.profile ?? "chrome146",
			defaultHeaders: opts.defaultHeaders ?? true,
			maxConnections: opts.maxConnections ?? 6,
			timeoutMs: opts.timeoutMs ?? 30_000,
			followRedirects: opts.followRedirects ?? true,
			maxRedirects: opts.maxRedirects ?? 10,
			sslVerify: opts.sslVerify ?? true,
			caBundle: opts.caBundle ?? "",
		};
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Perform an HTTP request with the configured TLS fingerprint profile.
	 * Returns a Web-compatible `Response` (with an extra `.effectiveUrl` field).
	 */
	async fetch(
		url: string,
		opts: FetchOptions = {},
	): Promise<ImpersonatedResponse> {
		if (this.#closed) throw new Error("ImpersonatedClient has been closed");

		const lib = getLib();
		const sym = lib.symbols;

		// Allocate or reuse handle
		if (!this.#handle) {
			const h = sym.curl_easy_init();
			if (!h) throw new CurlError("curl_easy_init() returned null", -1);
			this.#handle = h as unknown as number;
		} else {
			sym.curl_easy_reset(this.#handle as unknown as number);
		}

		const handle = this.#handle as unknown as number;
		const profile = opts.profile ?? this.#opts.profile;

		// Set impersonation profile (sets TLS + H2 fingerprints + default headers)
		const profileBuf = encodeC(profile);
		const impersonateResult = sym.curl_easy_impersonate(
			handle,
			profileBuf as unknown as string,
			// default_headers: 1 = set default Accept/Accept-Language/etc.
			this.#opts.defaultHeaders ? 1 : 0,
		);
		if (impersonateResult !== CURLE_OK) {
			throw new CurlError(
				`curl_easy_impersonate("${profile}") failed — profile may not be supported`,
				impersonateResult,
			);
		}

		// Collect alive buffers (must outlive curl_easy_perform)
		const alive: Uint8Array[] = [profileBuf];

		// URL
		alive.push(setoptStr(sym, handle, CURLOPT.URL, url));

		// Method
		const method = (opts.method ?? "GET").toUpperCase();
		if (method === "GET") {
			setoptLong(sym, handle, CURLOPT.HTTPGET, 1n);
		} else if (method === "HEAD") {
			setoptLong(sym, handle, CURLOPT.NOBODY, 1n);
		} else {
			// POST / PUT / PATCH / DELETE / etc.
			setoptLong(sym, handle, CURLOPT.POST, 1n);
			alive.push(setoptStr(sym, handle, CURLOPT.CUSTOMREQUEST, method));
		}

		// TLS validation
		if (opts.insecure) {
			setoptLong(sym, handle, CURLOPT.SSL_VERIFYPEER, 0n);
			setoptLong(sym, handle, CURLOPT.SSL_VERIFYHOST, 0n);
		}

		// Body
		if (opts.body !== undefined) {
			let bodyBytes: Uint8Array;
			if (typeof opts.body === "string") {
				bodyBytes = new TextEncoder().encode(opts.body);
			} else if (opts.body instanceof URLSearchParams) {
				bodyBytes = new TextEncoder().encode(opts.body.toString());
			} else if (opts.body instanceof ArrayBuffer) {
				bodyBytes = new Uint8Array(opts.body);
			} else {
				bodyBytes = opts.body;
			}
			// Use COPYPOSTFIELDS to let libcurl copy the data (safe for async boundary)
			const bodyBuf = new Uint8Array(bodyBytes.length + 1);
			bodyBuf.set(bodyBytes);
			alive.push(bodyBuf);
			// Set size first, then data
			setoptLong(sym, handle, CURLOPT.POSTFIELDSIZE, BigInt(bodyBytes.length));
			const code = sym.curl_easy_setopt(
				handle,
				CURLOPT.COPYPOSTFIELDS,
				BigInt(ptr(bodyBuf)) as unknown as number,
			);
			if (code !== CURLE_OK)
				throw new CurlError("CURLOPT_COPYPOSTFIELDS failed", code);
		}

		// Custom headers
		// curl_slist_append returns FFIType.ptr → bigint in bun:ffi
		let slistPtr: bigint = 0n;
		const headersToSet = this.#normalizeHeaders(opts.headers);
		if (headersToSet.length > 0) {
			for (const [k, v] of headersToSet) {
				const headerBuf = encodeC(`${k}: ${v}`);
				alive.push(headerBuf);
				slistPtr = sym.curl_slist_append(
					slistPtr as unknown as number,
					headerBuf as unknown as string,
				) as unknown as bigint;
			}
			const code = sym.curl_easy_setopt(
				handle,
				CURLOPT.HTTPHEADER,
				slistPtr as unknown as number,
			);
			if (code !== CURLE_OK)
				throw new CurlError("CURLOPT_HTTPHEADER failed", code);
		}

		// Cookies
		if (opts.cookies) {
			alive.push(setoptStr(sym, handle, CURLOPT.COOKIE, opts.cookies));
		}
		// Enable in-memory cookie engine (pass empty string to COOKIEFILE)
		alive.push(setoptStr(sym, handle, CURLOPT.COOKIEFILE, ""));

		// Enable transparent decompression on builds that expose
		// CURLOPT_ACCEPT_ENCODING.  curl-impersonate sometimes locks this
		// option to preserve fingerprint integrity, so we ignore CURLE_UNKNOWN
		// (48) and fall back to JS-side decompression in `buildResponse()`.
		try {
			const buf = encodeC("");
			alive.push(buf);
			sym.curl_easy_setopt(
				handle,
				CURLOPT.ACCEPT_ENCODING,
				BigInt(ptr(buf)) as unknown as number,
			);
		} catch {
			/* falls through to JS-side decode */
		}

		// Thread safety & resource limits
		setoptLong(sym, handle, CURLOPT.NOSIGNAL, 1n);
		setoptLong(sym, handle, CURLOPT.MAXCONNECTS, BigInt(this.#opts.maxConnections));
		setoptLong(sym, handle, CURLOPT.TCP_KEEPALIVE, 1n);

		// Timeouts
		const timeoutMs = opts.timeoutMs ?? this.#opts.timeoutMs;
		setoptLong(sym, handle, CURLOPT.TIMEOUT_MS, BigInt(timeoutMs));
		setoptLong(
			sym,
			handle,
			CURLOPT.CONNECTTIMEOUT_MS,
			BigInt(Math.min(10_000, timeoutMs)),
		);

		// Redirects
		const followRedirects = opts.followRedirects ?? this.#opts.followRedirects;
		setoptLong(sym, handle, CURLOPT.FOLLOWLOCATION, followRedirects ? 1n : 0n);
		setoptLong(sym, handle, CURLOPT.MAXREDIRS, BigInt(this.#opts.maxRedirects));

		// SSL
		setoptLong(
			sym,
			handle,
			CURLOPT.SSL_VERIFYPEER,
			this.#opts.sslVerify ? 1n : 0n,
		);
		setoptLong(
			sym,
			handle,
			CURLOPT.SSL_VERIFYHOST,
			this.#opts.sslVerify ? 2n : 0n,
		);
		if (this.#opts.caBundle) {
			alive.push(setoptStr(sym, handle, CURLOPT.CAINFO, this.#opts.caBundle));
		}

		// Wire up response collector callbacks
		const collector = new ResponseCollector();
		try {
			const writeFnPtr = collector.writeCallback.ptr;
			const headerFnPtr = collector.headerCallback.ptr;

			sym.curl_easy_setopt(
				handle,
				CURLOPT.WRITEFUNCTION,
				BigInt(writeFnPtr) as unknown as number,
			);
			sym.curl_easy_setopt(handle, CURLOPT.WRITEDATA, 0n as unknown as number);
			sym.curl_easy_setopt(
				handle,
				CURLOPT.HEADERFUNCTION,
				BigInt(headerFnPtr) as unknown as number,
			);
			sym.curl_easy_setopt(handle, CURLOPT.HEADERDATA, 0n as unknown as number);

			// Perform — this blocks the JS thread (acceptable for I/O-bound scraping)
			// For true async, wrap in Bun.spawn or use the curl_multi API.
			const code = sym.curl_easy_perform(handle);
			if (code !== CURLE_OK) {
				const errMsg = sym.curl_easy_strerror(code);
				throw new CurlError(
					`curl_easy_perform failed: ${errMsg} — ${url}`,
					code,
				);
			}

			// Free slist
			if (slistPtr) sym.curl_slist_free_all(slistPtr as unknown as number);

			// Keep alive array referenced (prevent GC before perform returns)
			void alive;

			return collector.buildResponse();
		} finally {
			collector.dispose();
		}
	}

	/**
	 * Convenience: GET and return parsed JSON.
	 */
	async fetchJSON<T = unknown>(
		url: string,
		opts: FetchOptions = {},
	): Promise<T> {
		const res = await this.fetch(url, { ...opts, method: "GET" });
		if (!res.ok) {
			throw new CurlError(`HTTP ${res.status} for ${url}`, res.status);
		}
		return res.json() as Promise<T>;
	}

	/**
	 * Convenience: POST JSON body and return parsed JSON response.
	 */
	async postJSON<T = unknown>(
		url: string,
		data: unknown,
		opts: FetchOptions = {},
	): Promise<T> {
		const res = await this.fetch(url, {
			...opts,
			method: "POST",
			body: JSON.stringify(data),
			headers: {
				"content-type": "application/json",
				...this.#normalizeHeadersMap(opts.headers),
			},
		});
		if (!res.ok) {
			throw new CurlError(`HTTP ${res.status} for POST ${url}`, res.status);
		}
		return res.json() as Promise<T>;
	}

	/** Release the CURL handle. The client cannot be used after this call. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#handle) {
			try {
				const lib = getLib();
				lib.symbols.curl_easy_cleanup(this.#handle as unknown as number);
			} catch {
				/* best-effort */
			}
			this.#handle = null;
		}
	}

	/** `AsyncDisposable` support (`await using client = new ImpersonatedClient()`). */
	async [Symbol.asyncDispose](): Promise<void> {
		this.close();
	}

	[Symbol.dispose](): void {
		this.close();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	#normalizeHeaders(h: FetchOptions["headers"]): [string, string][] {
		if (!h) return [];
		if (h instanceof Headers) {
			const out: [string, string][] = [];
			h.forEach((v, k) => out.push([k, v]));
			return out;
		}
		return Object.entries(h);
	}

	#normalizeHeadersMap(h: FetchOptions["headers"]): Record<string, string> {
		if (!h) return {};
		if (h instanceof Headers) {
			const out: Record<string, string> = {};
			h.forEach((v, k) => {
				out[k] = v;
			});
			return out;
		}
		return h as Record<string, string>;
	}
}

// ---------------------------------------------------------------------------
// Singleton factory helpers
// ---------------------------------------------------------------------------

let _defaultClient: ImpersonatedClient | null = null;

/**
 * Returns (or creates) a process-level singleton `ImpersonatedClient` with
 * default options (`chrome131`).  Suitable for simple one-off requests.
 *
 * For production use, instantiate `ImpersonatedClient` directly to control
 * lifecycle and profile.
 */
export function getDefaultClient(): ImpersonatedClient {
	if (
		!_defaultClient ||
		(_defaultClient as unknown as { _closed: boolean })._closed
	) {
		_defaultClient = new ImpersonatedClient();
	}
	return _defaultClient;
}

/**
 * Drop-in replacement for `fetch()` using Chrome131 TLS fingerprint.
 *
 * @example
 * ```ts
 * import { impersonateFetch } from "bxc/ffi/curl-impersonate";
 * const res = await impersonateFetch("https://google.com");
 * ```
 */
export async function impersonateFetch(
	url: string,
	opts?: FetchOptions,
): Promise<ImpersonatedResponse> {
	return getDefaultClient().fetch(url, opts);
}

// Cleanup singleton on process exit
process.on("exit", () => {
	try {
		_defaultClient?.close();
	} catch {
		/* ignore */
	}
});

/** Check whether libcurl-impersonate is available on this machine. */
export function isLibAvailable(): boolean {
	try {
		resolveLibPath();
		return true;
	} catch {
		return false;
	}
}
