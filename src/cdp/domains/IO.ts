/**
 * IO domain handler.
 *
 * Implements streaming reads for large blobs produced by Page.printToPDF and
 * Page.captureScreenshot.  The workflow is:
 *
 *   1. A domain handler (e.g. Page.printToPDF) writes the blob into
 *      ctx.networkCtx.ioStreams via `registerIOStream()` and returns a
 *      `{ stream: handle }` result.
 *   2. agent-browser calls `IO.read { handle, size? }` repeatedly until
 *      `eof: true` is returned.
 *   3. agent-browser calls `IO.close { handle }` to release the buffer.
 *
 * The IO stream map is shared across all sessions in `ctx.networkCtx.ioStreams`.
 * Handles are generated as `"io-<counter>"` strings.
 *
 * Chunk size: 65536 bytes per read (matches Chrome CDP default).
 */

import type { DomainHandler, IOStream } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default chunk size used by IO.read when `size` param is absent. */
const DEFAULT_CHUNK_SIZE = 65536;

// ---------------------------------------------------------------------------
// Public factory (used by Page domain or other domains that produce streams)
// ---------------------------------------------------------------------------

let _streamCounter = 0;

/**
 * Creates and registers a new IOStream from a `Uint8Array` buffer.
 * Returns the stream handle (opaque string) to be returned to the CDP client.
 *
 * Usage from a domain handler:
 * ```ts
 * const handle = registerIOStream(ctx, pdfBytes);
 * return { stream: handle };
 * ```
 */
export function registerIOStream(streams: Map<string, IOStream>, data: Uint8Array): string {
	const handle = `io-${++_streamCounter}`;
	streams.set(handle, { handle, data, position: 0 });
	return handle;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const IOHandler: DomainHandler = async (method, params, ctx, _sessionId) => {
	const streams = ctx.networkCtx.ioStreams;

	switch (method) {
		// ------------------------------------------------------------------
		// IO.read — return the next chunk from the stream
		// ------------------------------------------------------------------
		case "IO.read": {
			const p = params as { handle: string; offset?: number; size?: number };
			const stream = streams.get(p.handle);

			if (!stream) {
				throw new Error(`IO stream not found: ${p.handle}`);
			}

			// If an explicit offset is requested, seek to it
			if (typeof p.offset === "number" && p.offset >= 0) {
				stream.position = p.offset;
			}

			const chunkSize = typeof p.size === "number" && p.size > 0 ? p.size : DEFAULT_CHUNK_SIZE;
			const remaining = stream.data.byteLength - stream.position;

			if (remaining <= 0) {
				// Already at/past EOF
				return { data: "", base64Encoded: false, eof: true };
			}

			const sliceEnd = Math.min(stream.position + chunkSize, stream.data.byteLength);
			const chunk = stream.data.slice(stream.position, sliceEnd);
			stream.position = sliceEnd;

			const eof = stream.position >= stream.data.byteLength;

			// Encode as base64 (binary-safe, matches Chrome CDP behaviour for binary blobs)
			const base64 = (chunk as Uint8Array).toBase64();

			return { data: base64, base64Encoded: true, eof };
		}

		// ------------------------------------------------------------------
		// IO.close — release the stream buffer
		// ------------------------------------------------------------------
		case "IO.close": {
			const p = params as { handle: string };
			// Silently succeed even if the handle is already gone (idempotent)
			streams.delete(p.handle);
			return {};
		}

		default:
			return null;
	}
};
