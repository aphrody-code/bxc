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
 * InProcessTransport — ConnectionTransport implementation that dispatches CDP
 * messages to an in-process handler without any TCP or Unix socket overhead.
 *
 * The handler receives a parsed CDP request and must return a Promise that
 * resolves to the CDP result object (or throw a CDPError).
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A raw CDP message as sent by Puppeteer's Connection layer. */
export interface CDPRequest {
	id: number;
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
}

/** Shape returned by Puppeteer when it receives a response. */
export interface CDPResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
	sessionId?: string;
}

/** Shape of an unsolicited CDP event (no `id`). */
export interface CDPEvent {
	method: string;
	params?: unknown;
	sessionId?: string;
}

/**
 * A function that handles a single CDP command and returns its result, or
 * throws a CDPError / Error on failure.
 */
export type CDPHandler = (
	method: string,
	params: Record<string, unknown>,
	sessionId: string | undefined,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// CDPError — thrown by handlers for well-typed protocol errors
// ---------------------------------------------------------------------------

export class CDPError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(message: string, code = -32000, data?: unknown) {
		super(message);
		this.name = "CDPError";
		this.code = code;
		this.data = data;
	}
}

// ---------------------------------------------------------------------------
// InProcessTransport
// ---------------------------------------------------------------------------

/**
 * Puppeteer-compatible `ConnectionTransport` backed by a synchronous in-process
 * handler instead of a WebSocket.  Each `send()` call dispatches the CDP
 * command to the handler and enqueues the response via `onmessage` in the next
 * microtask, preserving the correlation `id`.
 *
 * Unsolicited events can be pushed from the outside via `emit()`.
 */
export class InProcessTransport implements ConnectionTransport {
	onmessage?: (message: string) => void;
	onclose?: () => void;

	readonly #handler: CDPHandler;
	#closed = false;

	constructor(handler: CDPHandler) {
		this.#handler = handler;
	}

	/**
	 * Called by Puppeteer's Connection to send a CDP command.
	 * The response is delivered asynchronously via `this.onmessage`.
	 */
	send(message: string): void {
		if (this.#closed) return;

		let parsed: CDPRequest;
		try {
			parsed = JSON.parse(message) as CDPRequest;
		} catch {
			// Malformed JSON — nothing we can do at this layer
			return;
		}

		const { id, method, params = {}, sessionId } = parsed;

		this.#handler(method, params, sessionId).then(
			(result) => {
				this.#dispatch({ id, result, sessionId } satisfies CDPResponse);
			},
			(err: unknown) => {
				const error =
					err instanceof CDPError
						? { code: err.code, message: err.message, data: err.data }
						: {
								code: -32000,
								message: err instanceof Error ? err.message : String(err),
							};
				this.#dispatch({ id, error, sessionId } satisfies CDPResponse);
			},
		);
	}

	/**
	 * Push an unsolicited CDP event (e.g. Target.targetCreated) to the
	 * Puppeteer Connection layer.
	 */
	emit(event: CDPEvent): void {
		if (this.#closed) return;
		this.#dispatch(event);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		// Fire onclose in the next microtask so Puppeteer can finish its teardown.
		queueMicrotask(() => {
			this.onclose?.();
		});
	}

	get closed(): boolean {
		return this.#closed;
	}

	// Enqueue via queueMicrotask to mimic the async nature of a real socket.
	#dispatch(message: CDPResponse | CDPEvent): void {
		queueMicrotask(() => {
			if (!this.#closed) {
				this.onmessage?.(JSON.stringify(message));
			}
		});
	}
}
