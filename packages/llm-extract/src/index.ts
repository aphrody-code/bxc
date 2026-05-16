// Bun-native, bunlight-integrated structured extraction.
//
// Default path: one LLM call → cached CSS selectors → native Zig DOM extraction
// for every subsequent page on the same (hostname, schema). Sub-millisecond
// per page after the first.

export { LlmClient } from "./client.ts";
export type {
	ChatMessage,
	ChatRequestOptions,
	CompletionResponse,
	CompletionTimings,
	ContentPart,
	ImagePart,
	LlmClientConfig,
	TextPart,
} from "./client.ts";
export {
	applyThinking,
	GEMMA4_DEFAULT_SAMPLING,
	stripThinkingChannel,
	THINK_PREFIX,
} from "./gemma-template.ts";
export type { GemmaSampling } from "./gemma-template.ts";
export {
	clampToTokens,
	htmlToText,
	preclean,
	precleanSync,
	stripHtml,
} from "./preclean.ts";
export { globalLlmQueue, SerialQueue } from "./queue.ts";
export {
	classify,
	extractFromImage,
	extractStructured,
	summarize,
	zodToJsonSchema,
} from "./extract.ts";
export type { ExtractOptions } from "./extract.ts";
export {
	cacheKey,
	SelectorCache,
	sharedSelectorCache,
} from "./selector-cache.ts";
export type { SelectorCacheOptions } from "./selector-cache.ts";
export {
	applySelectorsToHtml,
	coerceToShape,
} from "./selector-extract.ts";
export type { ExtractedFields, SelectorMap } from "./selector-extract.ts";
export { generateSelectors } from "./selector-generator.ts";
export type { GenerateSelectorsOptions } from "./selector-generator.ts";
