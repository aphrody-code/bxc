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
 * @module bxc/google/gemini-session
 *
 * Server-side, multi-conversation pool over {@link GeminiWebClient}.
 *
 * Long-lived HTTP servers that expose Gemini Web (the aphrody web chat API and
 * the standalone aphrody-gemini proxy) keep one Gemini thread per conversation
 * key so `keepContext` continuity survives across independent requests, and they
 * share a single staleness contract instead of each re-implementing client
 * lifecycle + "session expired" detection. CLI one-shots (`bxc google chat`)
 * talk to {@link GeminiWebClient} directly and do not need this.
 */

import { GeminiWebClient } from "./gemini-web.ts";

/**
 * Stable, user-facing message shown when the Google session is missing or stale
 * and the cookies must be re-imported. Kept here so every consumer surfaces the
 * exact same wording.
 */
export const GEMINI_STALE_MESSAGE =
	"Session Gemini expiree — reimporter les cookies via `bxc cookies save google` puis reessayer.";

/**
 * Heuristic: does this error message indicate the Google session is missing or
 * stale (re-import required), as opposed to a transient/network fault?
 */
export function isGeminiStaleError(message: string): boolean {
	return /not signed in|SNlM0e|stale|sign-?in|cookies|__Secure-1PSID|HTTP 40[13]/i.test(message);
}

export interface GeminiSessionOptions {
	/** Gemini model id handed to each new client (`flash`, `flash-lite`, `pro`). */
	model?: string;
}

/**
 * Keeps one {@link GeminiWebClient} per conversation key so successive turns
 * reuse the same Gemini thread (continuity via `keepContext`).
 *
 * The intended keyspace is "currently active chat ids"; call {@link reset} when
 * a chat starts a new conversation and {@link drop} when it is closed/deleted so
 * the map does not grow without bound.
 */
export class GeminiSessionPool {
	private readonly clients = new Map<string, GeminiWebClient>();
	private readonly started = new Set<string>();
	private readonly model?: string;

	constructor(opts: GeminiSessionOptions = {}) {
		this.model = opts.model;
	}

	/** True once `key` has completed at least one successful turn this lifetime. */
	hasStarted(key: string): boolean {
		return this.started.has(key);
	}

	/**
	 * Lazily create and initialise the client for `key`. Throws
	 * {@link GeminiWebError} when the stored Google session is invalid.
	 */
	async client(key: string): Promise<GeminiWebClient> {
		const existing = this.clients.get(key);
		if (existing) return existing;
		const client = new GeminiWebClient(this.model ? { model: this.model } : {});
		await client.init();
		this.clients.set(key, client);
		return client;
	}

	/**
	 * Run one Gemini turn for `key` with `keepContext` continuity and return the
	 * reply text. On any failure the thread is dropped so the next call
	 * re-initialises cleanly; callers should classify the thrown message with
	 * {@link isGeminiStaleError}.
	 */
	async generate(key: string, prompt: string, opts: { model?: string } = {}): Promise<string> {
		try {
			const client = await this.client(key);
			const text = await client.generate(prompt, { keepContext: true, model: opts.model });
			this.started.add(key);
			return text;
		} catch (err) {
			this.drop(key);
			throw err;
		}
	}

	/**
	 * Start a fresh Gemini conversation for `key` while keeping the (still valid)
	 * warm client, clearing only the continuation ids and the "started" flag.
	 */
	reset(key: string): void {
		this.clients.get(key)?.reset();
		this.started.delete(key);
	}

	/** Forget `key` entirely (drops both the client and the started flag). */
	drop(key: string): void {
		this.clients.delete(key);
		this.started.delete(key);
	}

	/** Number of live conversation threads currently held. */
	get size(): number {
		return this.clients.size;
	}
}
