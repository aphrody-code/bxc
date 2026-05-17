// Pre-clean HTML to minimize prompt tokens before LLM extraction.
// Prefers bxc's native Rust htmlToMarkdown bridge (~3-5× smaller than raw HTML).
// Falls back to a regex-only path when the rust-bridge cdylib is not loadable.

import { minifyHtmlForLLM } from "../../../src/ai/extractor.ts";

/** Strip tags + collapse whitespace using a pure-JS regex path (zero-dep fallback). */
export function stripHtml(html: string): string {
	let out = html.replace(/<!--[\s\S]*?-->/g, "");
	for (const tag of [
		"script",
		"style",
		"noscript",
		"iframe",
		"svg",
		"canvas",
		"video",
		"audio",
	]) {
		out = out.replace(
			new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"),
			"",
		);
	}
	out = out.replace(
		/\s+(?:on\w+|style|class|id|data-[\w-]+|aria-[\w-]+)="[^"]*"/gi,
		"",
	);
	return out.replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string): string {
	return stripHtml(html)
		.replace(/<\/?[a-z][^>]*>/gi, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, " ")
		.trim();
}

export function clampToTokens(
	text: string,
	maxTokens: number,
	charsPerToken = 3.5,
): string {
	const maxChars = Math.floor(maxTokens * charsPerToken);
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/**
 * Preferred path: bxc's `minifyHtmlForLLM` (Rust → Markdown). Falls back to
 * the regex `htmlToText` if the cdylib cannot load (e.g. cross-platform tests).
 */
export async function preclean(
	html: string,
	maxTokens = 3000,
): Promise<string> {
	try {
		const md = await minifyHtmlForLLM(html);
		return clampToTokens(md, maxTokens);
	} catch {
		return clampToTokens(htmlToText(html), maxTokens);
	}
}

/** Synchronous fallback when the caller cannot await (e.g. hot benchmark loops). */
export function precleanSync(html: string, maxTokens = 3000): string {
	return clampToTokens(htmlToText(html), maxTokens);
}
