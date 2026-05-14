/**
 * @module bunlight/internal/cdp-call
 *
 * Internal helper: send a single CDP command on a transport and await the
 * matching response.  Extracted from `src/api/browser.ts` (#cdpDirect) and
 * `src/cookies/cookie-injector.ts` (cdpCall) which were nearly identical.
 *
 * The two callers historically used different id schemes (one based on a
 * monotonically-increasing counter, the other on `Math.random`).  We keep the
 * `Math.random` flavour here because it is correct in both contexts (no risk
 * of collision with a per-page counter) and removes the need to thread a
 * shared id allocator across modules.
 *
 * Not part of the public API surface; do not re-export from `src/api/browser.ts`.
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.ts";

interface CDPMessageLike {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
	sessionId?: string;
}

/**
 * Send a single CDP command on `transport` and resolve with its `result`.
 * Rejects on CDP error or if the transport closes before the response arrives.
 *
 * The response handler is installed transiently — `transport.onmessage` is
 * restored once the matching id is seen.  The previous handler (if any) is
 * still invoked so other listeners are not broken while we wait.
 */
export function cdpCall(
	transport: ConnectionTransport,
	method: string,
	params: Record<string, unknown> = {},
	sessionId?: string,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const id = Math.floor(Math.random() * 1_000_000_000);
		const prev = transport.onmessage;

		const handler = (raw: string): void => {
			let msg: CDPMessageLike;
			try {
				msg = JSON.parse(raw) as CDPMessageLike;
			} catch {
				return;
			}
			if (msg.id !== id) return;
			transport.onmessage = prev;
			if (msg.error) {
				reject(new Error(`CDP ${method} failed: ${msg.error.message}`));
			} else {
				resolve(msg.result);
			}
		};

		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			handler(raw);
		};

		const payload: Record<string, unknown> = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		transport.send(JSON.stringify(payload));
	});
}
