/**
 * @module bunlight/internal/stream-drain
 *
 * Drain helper for `Bun.spawn` stdout/stderr pipes.  Fully consumes a
 * `ReadableStream<Uint8Array>` so the underlying OS pipe never fills up and
 * blocks the sub-process, optionally forwarding decoded text to a callback.
 */

/**
 * Asynchronously consumes `stream` until EOF.  When `cb` is provided each
 * chunk is decoded as UTF-8 (streaming) and forwarded.  Errors during read or
 * during the callback are swallowed — drain is a best-effort housekeeping
 * task and must never tear down its caller.
 */
export function drainStream(
	stream: ReadableStream<Uint8Array> | undefined,
	cb?: (text: string) => void,
): void {
	if (!stream) return;
	void (async () => {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) return;
				if (cb) {
					try {
						cb(decoder.decode(value, { stream: true }));
					} catch {
						// callback failure is non-fatal
					}
				}
			}
		} catch {
			// stream ended or process died
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// best effort
			}
		}
	})();
}
