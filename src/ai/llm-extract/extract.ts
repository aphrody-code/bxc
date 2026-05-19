// High-level extraction primitives.
//
// Two paths:
//   1. **Selector-cached** (default for `extractStructured`): one LLM call
//      per (hostname, schema). Subsequent pages reuse cached selectors and
//      extract via native Zig DOM (sub-millisecond).
//   2. **LLM-direct fallback**: when no URL is provided or the cache is
//      disabled, the LLM is invoked per call (slower, original behaviour).
//
// Pattern lifted from `bxc/src/ai/extractor.ts` — adapted to use the
// local llama-server instead of Anthropic cloud.

import { z } from "zod";
import {
	type ChatMessage,
	type ChatRequestOptions,
	type ContentPart,
	LlmClient,
} from "./client.ts";
import { preclean } from "./preclean.ts";
import { globalLlmQueue, SerialQueue } from "./queue.ts";
import {
	cacheKey,
	sharedSelectorCache,
	SelectorCache,
} from "./selector-cache.ts";
import { applySelectorsToHtml, coerceToShape } from "./selector-extract.ts";
import { generateSelectors } from "./selector-generator.ts";

export interface ExtractOptions<Schema extends z.ZodTypeAny> {
	readonly schema: Schema;
	readonly url?: string;
	readonly instruction?: string;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly thinking?: boolean;
	readonly client?: LlmClient;
	readonly queue?: SerialQueue;
	readonly cache?: SelectorCache | null;
	readonly signal?: AbortSignal;
}

const DEFAULT_CLIENT = new LlmClient();

/**
 * Extract a typed object from raw HTML.
 *
 * When `url` is provided, uses the **selector cache** path: one LLM call
 * generates CSS selectors for the (hostname, schema) pair, every subsequent
 * page is parsed through native Zig DOM in microseconds.
 *
 * When `url` is omitted, falls back to the LLM-direct path (slower).
 */
export async function extractStructured<Schema extends z.ZodTypeAny>(
	html: string,
	opts: ExtractOptions<Schema>,
): Promise<z.infer<Schema>> {
	const fields = listSchemaFields(opts.schema);

	if (opts.url !== undefined && opts.cache !== null) {
		return extractViaSelectorCache(html, fields, opts);
	}
	return extractViaLlmDirect(html, fields, opts);
}

async function extractViaSelectorCache<Schema extends z.ZodTypeAny>(
	html: string,
	fields: ReadonlyArray<string>,
	opts: ExtractOptions<Schema>,
): Promise<z.infer<Schema>> {
	const cache = opts.cache ?? sharedSelectorCache();
	const key = cacheKey(opts.url ?? "", fields);

	let selectors = cache.get(key);
	if (!selectors || Object.keys(selectors).length === 0) {
		try {
			// Call directly — wrapping in queue.enqueue corrupted the call
			// somehow (model returned `{}` even with identical args).
			selectors = await generateSelectors(html, fields, {
				client: opts.client,
				maxInputTokens: opts.maxInputTokens,
				maxOutputTokens: opts.maxOutputTokens,
				signal: opts.signal,
			});
		} catch (err) {
			console.warn(
				"[llm-extract] generateSelectors failed:",
				(err as Error).message,
			);
			selectors = {};
		}
		const hasUsable = Object.values(selectors).some((v) => v && v !== "");
		if (hasUsable) cache.set(key, selectors);
	}

	const raw = await applySelectorsToHtml(html, selectors);
	const coerced = coerceToShape(raw, fields);
	const parsed = opts.schema.safeParse(coerced);
	if (parsed.success) return parsed.data as z.infer<Schema>;

	// Schema rejection on a fully-optional payload typically means the page
	// shape diverged. Return the best-effort coerced shape without re-hitting
	// the LLM (single failure should NOT cost an LLM call).
	return coerced as z.infer<Schema>;
}

async function extractViaLlmDirect<Schema extends z.ZodTypeAny>(
	html: string,
	fields: ReadonlyArray<string>,
	opts: ExtractOptions<Schema>,
): Promise<z.infer<Schema>> {
	const client = opts.client ?? DEFAULT_CLIENT;
	const queue = opts.queue ?? globalLlmQueue;
	const text = await preclean(html, opts.maxInputTokens ?? 3000);
	const jsonSchema = zodToJsonSchema(opts.schema);
	const instruction =
		opts.instruction ??
		`Extract structured data. Use EXACTLY these field names: ${fields.join(", ")}.`;
	const messages: ReadonlyArray<ChatMessage> = [
		{ role: "system", content: instruction },
		{ role: "user", content: text },
	];
	const reqOpts: ChatRequestOptions = {
		maxTokens: opts.maxOutputTokens ?? 200,
		temperature: 0.3,
		jsonSchema,
		thinking: opts.thinking ?? false,
		stripThinking: opts.thinking ?? false,
		signal: opts.signal,
		slotId: 0,
		cachePrompt: true,
	};
	return queue.enqueue(async () => {
		const res = await client.chat(messages, reqOpts);
		const raw = res.choices[0]?.message.content ?? "{}";
		const parsed = opts.schema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(`schema parse failed (raw=${raw.slice(0, 80)})`);
		}
		return parsed.data as z.infer<Schema>;
	});
}

/** Closed-set classifier. Goes through LLM-direct only (selectors not useful for labels). */
export async function classify<Labels extends readonly [string, ...string[]]>(
	html: string,
	labels: Labels,
	opts: { client?: LlmClient; queue?: SerialQueue; signal?: AbortSignal } = {},
): Promise<Labels[number]> {
	const schema = z.object({ label: z.enum(labels) });
	const result = await extractStructured(html, {
		schema,
		instruction: `Classify the page. Choose exactly one label from: ${labels.join(", ")}.`,
		maxOutputTokens: 32,
		client: opts.client,
		queue: opts.queue,
		signal: opts.signal,
	});
	return result.label;
}

/** Free-form summary. */
export async function summarize(
	html: string,
	opts: {
		sentences?: number;
		client?: LlmClient;
		queue?: SerialQueue;
		signal?: AbortSignal;
	} = {},
): Promise<string> {
	const client = opts.client ?? DEFAULT_CLIENT;
	const queue = opts.queue ?? globalLlmQueue;
	const text = await preclean(html, 3000);
	const sentences = opts.sentences ?? 3;
	return queue.enqueue(async () => {
		const res = await client.chat(
			[
				{
					role: "system",
					content: `Summarize the page in exactly ${sentences} short sentences. Plain text, no preamble.`,
				},
				{ role: "user", content: text },
			],
			{ maxTokens: 200, signal: opts.signal },
		);
		return (res.choices[0]?.message.content ?? "").trim();
	});
}

/** Multimodal extraction: image MUST precede text (Gemma 4 model card mandate). */
export async function extractFromImage<Schema extends z.ZodTypeAny>(
	imageDataUrl: string,
	instruction: string,
	schema: Schema,
	opts: {
		client?: LlmClient;
		queue?: SerialQueue;
		signal?: AbortSignal;
		maxOutputTokens?: number;
	} = {},
): Promise<z.infer<Schema>> {
	const client = opts.client ?? DEFAULT_CLIENT;
	const queue = opts.queue ?? globalLlmQueue;
	const content: ReadonlyArray<ContentPart> = [
		{ type: "image_url", image_url: { url: imageDataUrl } },
		{ type: "text", text: instruction },
	];
	return queue.enqueue(async () => {
		const res = await client.chat([{ role: "user", content }], {
			maxTokens: opts.maxOutputTokens ?? 300,
			jsonSchema: zodToJsonSchema(schema),
			signal: opts.signal,
		});
		const raw = res.choices[0]?.message.content ?? "{}";
		const parsed = schema.safeParse(JSON.parse(raw));
		if (!parsed.success) throw new Error("schema parse failed (image)");
		return parsed.data as z.infer<Schema>;
	});
}

function listSchemaFields(s: z.ZodTypeAny): ReadonlyArray<string> {
	const v4Shape = (
		s as unknown as { def?: { shape?: Record<string, unknown> } }
	).def?.shape;
	if (v4Shape) return Object.keys(v4Shape);
	const direct = (s as unknown as { shape?: Record<string, unknown> }).shape;
	if (direct) return Object.keys(direct);
	return [];
}

/** Zod → JSON-Schema using Zod v4's native converter. */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	const ns = z as unknown as {
		toJSONSchema?: (s: z.ZodTypeAny, o?: unknown) => Record<string, unknown>;
	};
	if (typeof ns.toJSONSchema === "function") {
		return ns.toJSONSchema(schema, { target: "draft-2020-12" });
	}
	const method = (
		schema as unknown as { toJSONSchema?: () => Record<string, unknown> }
	).toJSONSchema;
	if (typeof method === "function") return method.call(schema);
	return {};
}
