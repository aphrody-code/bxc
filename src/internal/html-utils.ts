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
 * @module bxc/internal/html-utils
 *
 * Tiny regex-based HTML helpers shared between transport-layer parsers
 * (`StaticDomTransport`, `HttpProfileTransport`) that previously each owned a
 * private copy of these routines.
 *
 * These are intentionally crude — they exist only to back the cdylib-less
 * fallback path and to support the `<title>` / opening-tag attribute extraction
 * that both transports need.  For real HTML parsing/queries the zigquery FFI
 * is preferred (`src/ffi/zigquery.ts`).
 */

import {
	extractTitle as nativeExtractTitle,
	htmlToMarkdown as nativeHtmlToMarkdown,
	stripTags as nativeStripTags,
} from "../rust/bridge.ts";
import { htmlToMarkdownJS } from "./html-to-markdown.ts";

const ATTR_RE = /([a-zA-Z_:][^\s=]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

/** Extracts `<title>…</title>` (trimmed) from an HTML document using the native Rust bridge. */
export function extractTitle(html: string): string {
	try {
		return nativeExtractTitle(html);
	} catch {
		// Fallback to basic regex if FFI fails for some reason
		const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
		const m = TITLE_RE.exec(html);
		return m ? (m[1] ?? "").trim() : "";
	}
}

/** Strips every tag from `html`, returning the raw text content using the native Rust bridge. */
export function stripTags(html: string): string {
	try {
		return nativeStripTags(html);
	} catch {
		// Fallback to basic regex if FFI fails
		const STRIP_TAGS_RE = /<[^>]+>/g;
		return html.replace(STRIP_TAGS_RE, "");
	}
}

/**
 * Converts `html` to GFM Markdown via the native Rust bridge, falling back to
 * the dependency-free JS converter when the cdylib is unavailable. This keeps
 * the most common AI scraping primitive working on hosts without the Rust
 * toolchain (portability) instead of hard-failing.
 */
export function htmlToMarkdown(html: string): string {
	// Drop subtrees that are pure noise for an AI reader before conversion. The
	// native converter does not strip these, so doing it here keeps CSS/JS out
	// of the Markdown on both the native and JS paths.
	const cleaned = html.replace(
		/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi,
		"",
	);
	try {
		const md = nativeHtmlToMarkdown(cleaned);
		// An empty result on non-empty input means the native path silently
		// produced nothing — prefer the JS converter over returning "".
		if (md.trim().length > 0 || cleaned.trim().length === 0) return md;
	} catch {
		// cdylib missing/unloadable — degrade to the portable JS converter.
	}
	return htmlToMarkdownJS(cleaned);
}

/**
 * Parses the attribute list of an opening tag (or a leading attribute string)
 * into a flat `name → value` map.  Quoted, single-quoted, and bare attribute
 * forms are all accepted.
 */
export function parseAttributes(openingTag: string): Record<string, string> {
	const out: Record<string, string> = {};
	ATTR_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = ATTR_RE.exec(openingTag)) !== null) {
		if (m[1] !== undefined) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
	}
	return out;
}

/**
 * Returns the opening tag of `outerHTML` (everything up to and including the
 * first `>`).  Used to feed `parseAttributes` from a raw element representation.
 */
export function openingTagOf(outerHTML: string): string {
	const close = outerHTML.indexOf(">");
	return close === -1 ? outerHTML : outerHTML.slice(0, close + 1);
}
