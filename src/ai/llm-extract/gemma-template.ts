// Gemma 4 E2B-it chat template helpers — based on the OFFICIAL HF model card
// (https://huggingface.co/google/gemma-4-E2B-it, fetched 2026-05-16).
//
// Source-of-truth notes from the card:
//  - Roles: standard `system`, `user`, `assistant` (changed vs Gemma 3).
//  - Thinking mode: include `<|think|>` token AT THE START of the system prompt to enable.
//    With Transformers / llama.cpp `--jinja`, you can also toggle via the
//    `enable_thinking` template kwarg — both paths converge to the same template.
//  - Sampling defaults (per the model card, verbatim):
//      temperature = 1.0  ·  top_p = 0.95  ·  top_k = 64
//  - Multimodal: image / audio content MUST appear BEFORE text in the user message.

export const GEMMA4_DEFAULT_SAMPLING = {
	temperature: 1.0,
	topP: 0.95,
	topK: 64,
} as const;

export type GemmaSampling = typeof GEMMA4_DEFAULT_SAMPLING;

export const THINK_PREFIX = "<|think|>";

/**
 * Prefix a system prompt with `<|think|>` to enable Gemma 4 thinking mode.
 * Returns the prompt unchanged if `enabled === false`.
 */
export function applyThinking(systemPrompt: string, enabled: boolean): string {
	if (!enabled) return systemPrompt;
	if (systemPrompt.startsWith(THINK_PREFIX)) return systemPrompt;
	return `${THINK_PREFIX}${systemPrompt}`;
}

/**
 * Strip Gemma 4 thinking output. The model emits a `<|channel>thought\n…<channel|>`
 * block before the final answer when thinking is on — callers usually want the answer only.
 */
export function stripThinkingChannel(text: string): string {
	return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, "").trim();
}
