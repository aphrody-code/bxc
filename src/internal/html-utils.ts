/**
 * @module bunlight/internal/html-utils
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

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const STRIP_TAGS_RE = /<[^>]+>/g;
const ATTR_RE = /([a-zA-Z_:][^\s=]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

/** Extracts `<title>…</title>` (trimmed) from an HTML document. */
export function extractTitle(html: string): string {
	const m = TITLE_RE.exec(html);
	return m ? m[1].trim() : "";
}

/** Strips every tag from `html`, returning the raw text content. */
export function stripTags(html: string): string {
	return html.replace(STRIP_TAGS_RE, "");
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
		out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
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
