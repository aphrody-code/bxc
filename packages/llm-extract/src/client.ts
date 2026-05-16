// Typed OpenAI-compat client for the local llama-server hosting gemma-4-E2B-it.
// Bun-only: no node:* imports. Uses fetch + AbortSignal from the Web API.
// Defaults to Gemma 4's OFFICIAL sampling (temp=1.0, top_p=0.95, top_k=64).

import {
	GEMMA4_DEFAULT_SAMPLING,
	stripThinkingChannel,
} from "./gemma-template.ts";

export type TextPart = { readonly type: "text"; readonly text: string };
export type ImagePart = {
	readonly type: "image_url";
	readonly image_url: { readonly url: string };
};
export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
	readonly role: "system" | "user" | "assistant";
	readonly content: string | ReadonlyArray<ContentPart>;
}

export interface CompletionTimings {
	readonly prompt_n: number;
	readonly prompt_ms: number;
	readonly prompt_per_second: number;
	readonly predicted_n: number;
	readonly predicted_ms: number;
	readonly predicted_per_second: number;
}

export interface CompletionResponse {
	readonly choices: ReadonlyArray<{
		readonly message: { readonly role: string; readonly content: string };
		readonly finish_reason: string;
	}>;
	readonly usage: {
		readonly prompt_tokens: number;
		readonly completion_tokens: number;
		readonly total_tokens: number;
	};
	readonly timings?: CompletionTimings;
}

export interface ChatRequestOptions {
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly topP?: number;
	readonly topK?: number;
	readonly minP?: number;
	readonly stop?: ReadonlyArray<string>;
	readonly jsonSchema?: Record<string, unknown>;
	readonly thinking?: boolean;
	readonly stripThinking?: boolean;
	readonly signal?: AbortSignal;
	/** llama.cpp-specific : pin to a slot for cache_prompt cross-call reuse. */
	readonly slotId?: number;
	/** llama.cpp-specific : mirostat 0=off, 1=v1, 2=v2 (adaptive temperature). */
	readonly mirostat?: 0 | 1 | 2;
	readonly mirostatTau?: number;
	readonly mirostatEta?: number;
	/** llama.cpp-specific : keep last N tokens of the slot KV cache across calls. */
	readonly cachePrompt?: boolean;
}

export interface LlmClientConfig {
	readonly baseUrl?: string;
	readonly model?: string;
	readonly defaultTimeoutMs?: number;
	readonly retries?: number;
}

const CLIENT_DEFAULTS = {
	baseUrl: "http://127.0.0.1:8080",
	model: "gemma4-e2b",
	defaultTimeoutMs: 60_000,
	retries: 2,
} as const;

export class LlmClient {
	readonly baseUrl: string;
	readonly model: string;
	readonly defaultTimeoutMs: number;
	readonly retries: number;

	constructor(config: LlmClientConfig = {}) {
		this.baseUrl = config.baseUrl ?? CLIENT_DEFAULTS.baseUrl;
		this.model = config.model ?? CLIENT_DEFAULTS.model;
		this.defaultTimeoutMs =
			config.defaultTimeoutMs ?? CLIENT_DEFAULTS.defaultTimeoutMs;
		this.retries = config.retries ?? CLIENT_DEFAULTS.retries;
	}

	async chat(
		messages: ReadonlyArray<ChatMessage>,
		opts: ChatRequestOptions = {},
	): Promise<CompletionResponse> {
		const thinking = opts.thinking ?? false;
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			max_tokens: opts.maxTokens ?? 512,
			temperature: opts.temperature ?? GEMMA4_DEFAULT_SAMPLING.temperature,
			top_p: opts.topP ?? GEMMA4_DEFAULT_SAMPLING.topP,
			top_k: opts.topK ?? GEMMA4_DEFAULT_SAMPLING.topK,
			stream: false,
			chat_template_kwargs: { enable_thinking: thinking },
		};
		if (opts.minP !== undefined) body.min_p = opts.minP;
		if (opts.stop !== undefined) body.stop = opts.stop;
		if (opts.jsonSchema !== undefined) {
			body.response_format = {
				type: "json_schema",
				json_schema: { name: "extract", strict: true, schema: opts.jsonSchema },
			};
		}
		// llama.cpp extra_body pass-through (server-common.cpp copies unknown
		// body keys straight into llama_params).
		if (opts.slotId !== undefined) body.id_slot = opts.slotId;
		if (opts.cachePrompt !== undefined) body.cache_prompt = opts.cachePrompt;
		if (opts.mirostat !== undefined) {
			body.mirostat = opts.mirostat;
			if (opts.mirostatTau !== undefined) body.mirostat_tau = opts.mirostatTau;
			if (opts.mirostatEta !== undefined) body.mirostat_eta = opts.mirostatEta;
		}

		const raw = await this.requestWithRetry(
			"/v1/chat/completions",
			body,
			opts.signal,
		);
		const stripDefault = thinking;
		return (opts.stripThinking ?? stripDefault)
			? this.stripThinkingFromResponse(raw)
			: raw;
	}

	async health(): Promise<boolean> {
		try {
			const r = await fetch(`${this.baseUrl}/health`, {
				signal: AbortSignal.timeout(2000),
			});
			return r.ok;
		} catch {
			return false;
		}
	}

	private stripThinkingFromResponse(
		res: CompletionResponse,
	): CompletionResponse {
		return {
			...res,
			choices: res.choices.map((c) => ({
				...c,
				message: {
					...c.message,
					content: stripThinkingChannel(c.message.content),
				},
			})),
		};
	}

	private async requestWithRetry(
		path: string,
		body: unknown,
		userSignal?: AbortSignal,
	): Promise<CompletionResponse> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			const ctrl = new AbortController();
			const timeoutId = setTimeout(() => ctrl.abort(), this.defaultTimeoutMs);
			const signal = mergeSignals(ctrl.signal, userSignal);
			try {
				const res = await fetch(`${this.baseUrl}${path}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
					signal,
				});
				clearTimeout(timeoutId);
				if (res.status === 503 && attempt < this.retries) {
					await sleep(200 * 2 ** attempt);
					continue;
				}
				if (!res.ok) {
					throw new Error(`llama-server ${res.status}: ${await res.text()}`);
				}
				return (await res.json()) as CompletionResponse;
			} catch (err) {
				clearTimeout(timeoutId);
				lastError = err;
				if (attempt < this.retries && !userSignal?.aborted) {
					await sleep(200 * 2 ** attempt);
					continue;
				}
				throw err;
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
	if (b === undefined) return a;
	const ctrl = new AbortController();
	const onAbort = (): void => ctrl.abort();
	if (a.aborted || b.aborted) ctrl.abort();
	a.addEventListener("abort", onAbort, { once: true });
	b.addEventListener("abort", onAbort, { once: true });
	return ctrl.signal;
}
