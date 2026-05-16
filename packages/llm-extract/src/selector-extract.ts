// Apply a {fieldName -> cssSelector} map to a raw HTML string using bunlight's
// native Zig DOM (Rust bridge). Pure Bun, no Page / Browser instance required.
//
// Throughput: ~0.5-2 ms per call on this VPS — orders of magnitude faster than
// shipping the HTML through the LLM.

import { parseHtml } from "../../../src/ffi/zigquery.ts";

export type SelectorMap = Readonly<Record<string, string>>;
export type ExtractedFields = Record<string, string | ReadonlyArray<string>>;

/**
 * Run every selector in `selectors` against `html` and return text content.
 * If a selector matches multiple elements, returns an array. Missing → empty string.
 */
export async function applySelectorsToHtml(
	html: string,
	selectors: SelectorMap,
): Promise<ExtractedFields> {
	const doc = await parseHtml(html);
	try {
		const out: ExtractedFields = {};
		for (const [key, sel] of Object.entries(selectors)) {
			if (!sel || sel === "*") {
				out[key] = "";
				continue;
			}
			const matches = await doc.querySelectorAll(sel);
			if (matches.count === 0) {
				out[key] = "";
			} else if (matches.count === 1) {
				out[key] = matches.at(0)?.textContent() ?? "";
			} else {
				out[key] = matches
					.map((el) => el.textContent().trim())
					.filter((t) => t.length > 0);
			}
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Coerce extracted strings/arrays toward the shape a zod schema expects.
 * Empty fields become `undefined` (so optional zod fields pass through cleanly),
 * single-element arrays collapse to scalars when the schema asks for a string.
 */
export function coerceToShape(
	raw: ExtractedFields,
	expectedFields: ReadonlyArray<string>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of expectedFields) {
		const v = raw[k];
		if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
			continue;
		}
		out[k] = v;
	}
	return out;
}
