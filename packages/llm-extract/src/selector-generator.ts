// Generate a CSS selector map from HTML + a list of fields, using the local
// llama-server (Gemma 4 E2B). Replaces bxc's `callAnthropicForSelectors`
// — which targets Anthropic cloud — with our zero-cost local model.
//
// The LLM is invoked ONCE per (site, schema) pair; the result is cached.

import { LlmClient } from "./client.ts";
import type { SelectorMap } from "./selector-extract.ts";
import { clampToTokens, stripHtml } from "./preclean.ts";

export interface GenerateSelectorsOptions {
	readonly client?: LlmClient;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly signal?: AbortSignal;
}

const DEFAULT_CLIENT = new LlmClient();

const SYSTEM = `You generate CSS selector strings for web scraping. NEVER return the actual content of the page.

Output a JSON object where:
- Keys are the requested field names (verbatim, no renaming).
- Values are CSS selector STRINGS like "h1", "title", "p:first-of-type", ".price", "[itemprop=name]", "meta[property='og:title']" — NEVER the extracted text itself.

Examples:
  Fields: title, price       →  {"title": "h1", "price": ".price"}
  Fields: name, version      →  {"name": "h1", "version": "p.version"}
  Fields: author, date       →  {"author": "[rel=author]", "date": "time[datetime]"}

If a field cannot be located, use the empty string "" — never invent a value.`;

/**
 * Ask the local LLM to generate CSS selectors for the requested fields.
 * Output is a strict `{field: cssSelector}` JSON object, validated against the
 * requested field names.
 */
export async function generateSelectors(
	html: string,
	fields: ReadonlyArray<string>,
	opts: GenerateSelectorsOptions = {},
): Promise<SelectorMap> {
	const client = opts.client ?? DEFAULT_CLIENT;
	// Selector generation needs the actual tag structure — not Markdown.
	// Strip script/style/comments/noisy attrs, but keep tags intact.
	const text = clampToTokens(stripHtml(html), opts.maxInputTokens ?? 3000);

	// Constrain to strings only. We don't mark fields required because the small
	// E2B model degenerates to `{}` if it can't find every selector — better to
	// take partial results than nothing.
	const schema = {
		type: "object",
		properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
	};

	const res = await client.chat(
		[
			{ role: "system", content: SYSTEM },
			{
				role: "user",
				content: `Fields to extract: ${fields.join(", ")}\n\nGenerate CSS selectors for these fields. Page HTML (Markdown form):\n${text}\n\nRemember: values must be CSS selectors (strings like "h1"), NOT the extracted content.`,
			},
		],
		{
			maxTokens: opts.maxOutputTokens ?? 300,
			temperature: 0.1,
			jsonSchema: schema,
			thinking: false,
			signal: opts.signal,
		},
	);

	const raw = res.choices[0]?.message.content ?? "{}";
	if (Bun.env.LLM_EXTRACT_DEBUG) console.log("[gen-sel] raw:", raw);
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const out: Record<string, string> = {};
	for (const f of fields) {
		const v = parsed[f];
		// Sanity check: a selector should be short and contain CSS punctuation
		// or a known tag name. Reject obvious extracted-text leakage.
		if (
			typeof v === "string" &&
			v.length > 0 &&
			v.length < 200 &&
			looksLikeSelector(v)
		) {
			out[f] = v;
		} else {
			out[f] = "";
		}
	}
	return out;
}

const SELECTOR_HINT_RE = /^[#.[]|^[a-zA-Z][a-zA-Z0-9-]*(?:[\s>+~.#:[]|$)/;
function looksLikeSelector(s: string): boolean {
	const trimmed = s.trim();
	if (trimmed === "") return false;
	// Anything containing spaces with multiple non-CSS words is probably text leakage.
	const wordy = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+|\s+\d)/.test(trimmed);
	if (wordy) return false;
	return SELECTOR_HINT_RE.test(trimmed);
}
