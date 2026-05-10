/**
 * @module bunlight/recorder/HarReplayer
 *
 * Replays a HAR archive as a local HTTP server. Any fetch() to the server
 * that matches a recorded URL + method returns the original status, headers,
 * and body -- enabling fully deterministic test scenarios without network access.
 *
 * Usage:
 * ```ts
 * import { HarReplayer } from "./HarReplayer.ts";
 *
 * const replayer = await HarReplayer.load("/tmp/example.har");
 * const { stop, port } = await replayer.serve();
 * const res = await fetch(`http://localhost:${port}/https://example.com`);
 * console.log(await res.text());
 * await stop();
 * ```
 *
 * Routing strategy:
 * - Primary key: exact URL + method match (case-insensitive method).
 * - Fallback: URL-only match with GET method (useful for browser navigations).
 * - If no match is found, the server returns 404 with a descriptive body.
 */

import type { HarFile, HarEntry } from "./types.ts";

// ---------------------------------------------------------------------------
// Internal index
// ---------------------------------------------------------------------------

/** Composite lookup key used to index HAR entries. */
type EntryKey = string;

function makeKey(method: string, url: string): EntryKey {
	return `${method.toUpperCase()}::${url}`;
}

// ---------------------------------------------------------------------------
// HarReplayer
// ---------------------------------------------------------------------------

/** A handle returned by `HarReplayer.serve()`. */
export interface ReplayServer {
	/** The port the server is listening on. */
	port: number;
	/** Stops the replay server and releases the port. */
	stop(): Promise<void>;
}

/**
 * Loads a HAR file and provides a local HTTP server that replays recorded
 * responses deterministically. Ideal for offline testing and CI environments.
 */
export class HarReplayer {
	readonly #entries: Map<EntryKey, HarEntry>;
	readonly #urlIndex: Map<string, HarEntry>;

	private constructor(entries: Map<EntryKey, HarEntry>, urlIndex: Map<string, HarEntry>) {
		this.#entries = entries;
		this.#urlIndex = urlIndex;
	}

	/**
	 * Loads a HAR file from disk and returns a `HarReplayer` instance.
	 *
	 * @param path - Absolute path to the `.har` file (JSON format).
	 * @throws If the file cannot be read or is not valid HAR 1.2 JSON.
	 */
	static async load(path: string): Promise<HarReplayer> {
		const raw = await Bun.file(path).text();
		const harFile = JSON.parse(raw) as HarFile;

		if (!harFile?.log?.entries) {
			throw new Error(`Invalid HAR file at ${path}: missing log.entries`);
		}

		const entries = new Map<EntryKey, HarEntry>();
		const urlIndex = new Map<string, HarEntry>();

		for (const entry of harFile.log.entries) {
			const key = makeKey(entry.request.method, entry.request.url);
			// First occurrence wins (deterministic replay)
			if (!entries.has(key)) {
				entries.set(key, entry);
			}
			// URL-only fallback index (last match for GET, first otherwise)
			if (!urlIndex.has(entry.request.url) || entry.request.method.toUpperCase() === "GET") {
				urlIndex.set(entry.request.url, entry);
			}
		}

		return new HarReplayer(entries, urlIndex);
	}

	/**
	 * Creates a `HarReplayer` directly from an in-memory HAR log (no disk I/O).
	 * Useful for testing the replayer itself.
	 */
	static fromEntries(entries: HarEntry[]): HarReplayer {
		const map = new Map<EntryKey, HarEntry>();
		const urlIndex = new Map<string, HarEntry>();

		for (const entry of entries) {
			const key = makeKey(entry.request.method, entry.request.url);
			if (!map.has(key)) {
				map.set(key, entry);
			}
			if (!urlIndex.has(entry.request.url) || entry.request.method.toUpperCase() === "GET") {
				urlIndex.set(entry.request.url, entry);
			}
		}

		return new HarReplayer(map, urlIndex);
	}

	/**
	 * Returns the number of entries in this replayer's index.
	 */
	get size(): number {
		return this.#entries.size;
	}

	/**
	 * Looks up an entry by method + URL. Returns `undefined` if not found.
	 */
	lookup(method: string, url: string): HarEntry | undefined {
		return (
			this.#entries.get(makeKey(method, url)) ??
			(method.toUpperCase() !== "GET" ? this.#urlIndex.get(url) : undefined)
		);
	}

	/**
	 * Starts a `Bun.serve` HTTP server that replays HAR responses.
	 *
	 * Request URL format accepted by the server:
	 *   `GET /https://original.url.com/path`  — the full original URL is passed
	 *   as the path (URL-encoded or raw). The server decodes it and looks up
	 *   the matching HAR entry.
	 *
	 * Alternative (proxy-style):
	 *   `GET http://localhost:<port>/https://original.url.com/`
	 *   The full URL after `http://localhost:<port>` is used as the lookup key.
	 *
	 * @param port - TCP port to listen on (0 = OS-assigned ephemeral port).
	 */
	async serve(port = 0): Promise<ReplayServer> {
		const replayer = this;

		const server = Bun.serve({
			port,
			fetch(req: Request): Response {
				// Extract the original URL from the request path.
				// Accept two formats:
				//   1. Path-prefixed: GET /https://example.com/path
				//   2. Query-encoded: GET /?url=https%3A%2F%2Fexample.com%2Fpath
				const reqUrl = new URL(req.url);
				let targetUrl: string;
				let targetMethod = req.method;

				const queryUrl = reqUrl.searchParams.get("url");
				if (queryUrl) {
					targetUrl = queryUrl;
					targetMethod = reqUrl.searchParams.get("method") ?? req.method;
				} else {
					// Strip the leading "/" and treat the rest as the original URL
					const rawPath = reqUrl.pathname.slice(1) + (reqUrl.search ?? "");
					// Allow both URL-encoded and raw
					try {
						targetUrl = decodeURIComponent(rawPath);
					} catch {
						targetUrl = rawPath;
					}
				}

				if (!targetUrl) {
					return new Response(
						JSON.stringify({
							error: "Missing target URL. Use /<encoded-url> or ?url=<encoded-url>",
						}),
						{
							status: 400,
							headers: { "content-type": "application/json" },
						},
					);
				}

				const entry = replayer.lookup(targetMethod, targetUrl) ?? replayer.lookup("GET", targetUrl);

				if (!entry) {
					const available = Array.from(replayer.#entries.keys()).slice(0, 10).join(", ");
					return new Response(
						JSON.stringify({
							error: `No HAR entry for ${targetMethod} ${targetUrl}`,
							available,
						}),
						{
							status: 404,
							headers: { "content-type": "application/json" },
						},
					);
				}

				// Build response from HAR entry
				const harResp = entry.response;
				const responseHeaders = new Headers();

				for (const header of harResp.headers) {
					// Skip problematic headers that Bun.serve manages itself
					const lc = header.name.toLowerCase();
					if (lc === "transfer-encoding" || lc === "connection") continue;
					responseHeaders.set(header.name, header.value);
				}

				// Set content-type from HAR content.mimeType if not already present
				if (!responseHeaders.has("content-type") && harResp.content.mimeType) {
					responseHeaders.set("content-type", harResp.content.mimeType);
				}

				const body = buildResponseBody(harResp.content);

				return new Response(body, {
					status: harResp.status || 200,
					statusText: harResp.statusText || "OK",
					headers: responseHeaders,
				});
			},
		});

		const actualPort: number = server.port ?? 0;

		return {
			port: actualPort,
			stop: async () => {
				await server.stop();
			},
		};
	}
}

// ---------------------------------------------------------------------------
// Response body builder
// ---------------------------------------------------------------------------

/**
 * Reconstructs the response body from a HAR content block.
 * Handles base64-encoded binary content and plain text.
 */
function buildResponseBody(content: HarEntry["response"]["content"]): string | ArrayBuffer | null {
	if (!content.text) return null;

	if (content.encoding === "base64") {
		// Decode base64 to binary
		const bytes = Buffer.from(content.text, "base64");
		return bytes.buffer as ArrayBuffer;
	}

	return content.text;
}
