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
 * @module bunlight/utils/sitemap
 *
 * Streaming sitemap parser — supports:
 *  - `sitemap.xml` (urlset)
 *  - `sitemap-index.xml` (sitemapindex → recursive fetch)
 *  - `.txt` sitemaps (one URL per line)
 *  - gzip-compressed `.xml.gz` / `.txt.gz`
 *  - Robots.txt `Sitemap:` directive auto-discovery
 *
 * Inspired by Crawlee's Sitemap class
 * (packages/utils/src/internals/sitemap.ts) but rewritten Bun-native:
 *  - Bun.fetch for streaming HTTP (no got-scraping / stream)
 *  - Bun.gunzipSync for decompression (no zlib)
 *  - Lightweight hand-rolled XML parser instead of sax
 *
 * @example
 * ```ts
 * for await (const url of parseSitemap("https://google.com/sitemap.xml")) {
 *   console.log(url.loc, url.priority);
 * }
 *
 * // Auto-discover from robots.txt
 * const urls = await collectSitemapUrls("https://google.com");
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SitemapChangefreq =
	| "always"
	| "hourly"
	| "daily"
	| "weekly"
	| "monthly"
	| "yearly"
	| "never";

export interface SitemapUrl {
	/** Canonical URL of the page. */
	loc: string;
	/** Last modification date (from <lastmod>). */
	lastmod?: Date;
	/** Crawl priority (0.0–1.0). */
	priority?: number;
	/** Change frequency hint. */
	changefreq?: SitemapChangefreq;
	/** URL of the sitemap that contained this entry. */
	originSitemapUrl: string;
}

export interface ParseSitemapOptions {
	/**
	 * Maximum recursion depth for sitemap indexes.
	 * Default: 3.
	 */
	maxDepth?: number;
	/**
	 * Maximum total URLs to yield (stream stops after this count).
	 * Default: Infinity.
	 */
	maxUrls?: number;
	/**
	 * Optional AbortSignal to cancel ongoing fetches.
	 */
	signal?: AbortSignal;
	/**
	 * User-agent header for HTTP requests.
	 * Default: "Bunlight/1.0 SitemapParser"
	 */
	userAgent?: string;
}

// ---------------------------------------------------------------------------
// Internal XML streaming tokenizer
// ---------------------------------------------------------------------------

type XmlToken =
	| { type: "open"; name: string }
	| { type: "close"; name: string }
	| { type: "text"; value: string };

/**
 * Zero-dependency, streaming-friendly XML tokenizer.
 * Handles the subset of XML used in sitemaps (no namespaces, no entities beyond &amp; etc.)
 */
function* tokenizeXml(text: string): Generator<XmlToken> {
	let i = 0;
	const len = text.length;

	while (i < len) {
		const ltIdx = text.indexOf("<", i);
		if (ltIdx === -1) {
			const content = text.slice(i).trim();
			if (content) yield { type: "text", value: decodeXmlEntities(content) };
			break;
		}
		if (ltIdx > i) {
			const content = text.slice(i, ltIdx).trim();
			if (content) yield { type: "text", value: decodeXmlEntities(content) };
		}
		const gtIdx = text.indexOf(">", ltIdx + 1);
		if (gtIdx === -1) break;

		const tag = text.slice(ltIdx + 1, gtIdx).trim();
		i = gtIdx + 1;

		if (tag.startsWith("?") || tag.startsWith("!")) continue; // PI / comments / CDATA skip

		if (tag.startsWith("/")) {
			yield { type: "close", name: tag.slice(1).split(/[\s/]/)[0].toLowerCase() };
		} else if (tag.endsWith("/")) {
			// Self-closing
			const name = tag.slice(0, -1).trim().split(/\s/)[0].toLowerCase();
			yield { type: "open", name };
			yield { type: "close", name };
		} else {
			yield { type: "open", name: tag.split(/\s/)[0].toLowerCase() };
		}
	}
}

function decodeXmlEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// HTTP fetch with gzip support (Bun-native)
// ---------------------------------------------------------------------------

async function fetchText(url: string, userAgent: string, signal?: AbortSignal): Promise<string> {
	const res = await fetch(url, {
		headers: { "User-Agent": userAgent, Accept: "text/xml,application/xml,text/plain,*/*" },
		signal,
	});

	if (!res.ok) {
		throw new Error(`sitemap fetch failed: ${res.status} ${res.statusText} — ${url}`);
	}

	// Bun automatically handles `Content-Encoding: gzip` in fetch, but for
	// explicit .gz URLs we decompress manually if the content-type doesn't hint.
	const isGzip = url.endsWith(".gz") && !res.headers.get("content-encoding")?.includes("gzip");

	if (isGzip) {
		const buf = await res.arrayBuffer();
		const bytes = Bun.gunzipSync(new Uint8Array(buf));
		return new TextDecoder().decode(bytes);
	}

	return res.text();
}

// ---------------------------------------------------------------------------
// Core streaming parser
// ---------------------------------------------------------------------------

/**
 * Async generator that yields `SitemapUrl` objects from a sitemap URL.
 * Recursively follows `<sitemapindex>` pointers up to `maxDepth`.
 */
export async function* parseSitemap(
	sitemapUrl: string,
	opts: ParseSitemapOptions = {},
	_depth = 0,
	_seen = new Set<string>(),
	_counter = { count: 0 },
): AsyncGenerator<SitemapUrl> {
	const maxDepth = opts.maxDepth ?? 3;
	const maxUrls = opts.maxUrls ?? Infinity;
	const userAgent = opts.userAgent ?? "Bunlight/1.0 SitemapParser";

	if (_depth > maxDepth) return;
	if (_seen.has(sitemapUrl)) return;
	_seen.add(sitemapUrl);

	const text = await fetchText(sitemapUrl, userAgent, opts.signal);
	const isTxt =
		sitemapUrl.endsWith(".txt") ||
		sitemapUrl.endsWith(".txt.gz") ||
		(!text.trimStart().startsWith("<") && text.includes("\n"));

	if (isTxt) {
		// Text sitemap: one URL per line
		for (const line of text.split("\n")) {
			const loc = line.trim();
			if (!loc || loc.startsWith("#")) continue;
			if (_counter.count >= maxUrls) return;
			_counter.count++;
			yield { loc, originSitemapUrl: sitemapUrl };
		}
		return;
	}

	// XML sitemap
	let rootTag: "urlset" | "sitemapindex" | null = null;
	let currentTag: string | null = null;
	const current: Partial<SitemapUrl & { _sitemapIndexLoc?: string }> = {};

	for (const token of tokenizeXml(text)) {
		if (opts.signal?.aborted) return;

		if (token.type === "open") {
			const name = token.name;
			if (name === "urlset") {
				rootTag = "urlset";
				continue;
			}
			if (name === "sitemapindex") {
				rootTag = "sitemapindex";
				continue;
			}
			currentTag = name;
		} else if (token.type === "close") {
			const name = token.name;

			if (rootTag === "urlset" && name === "url" && current.loc) {
				if (_counter.count >= maxUrls) return;
				_counter.count++;
				yield {
					loc: current.loc,
					lastmod: current.lastmod,
					priority: current.priority,
					changefreq: current.changefreq,
					originSitemapUrl: sitemapUrl,
				};
				// Reset
				current.loc = undefined;
				current.lastmod = undefined;
				current.priority = undefined;
				current.changefreq = undefined;
			}

			if (rootTag === "sitemapindex" && name === "sitemap" && current._sitemapIndexLoc) {
				// Recurse into nested sitemap
				const nestedUrl = current._sitemapIndexLoc;
				current._sitemapIndexLoc = undefined;
				yield* parseSitemap(nestedUrl, opts, _depth + 1, _seen, _counter);
				if (_counter.count >= maxUrls) return;
			}

			currentTag = null;
		} else if (token.type === "text" && currentTag !== null) {
			const val = token.value;
			if (currentTag === "loc") {
				if (rootTag === "sitemapindex") {
					current._sitemapIndexLoc = val;
				} else {
					current.loc = val;
				}
			} else if (currentTag === "lastmod") {
				const d = new Date(val);
				if (!Number.isNaN(d.getTime())) current.lastmod = d;
			} else if (currentTag === "priority") {
				const p = parseFloat(val);
				if (!Number.isNaN(p)) current.priority = p;
			} else if (currentTag === "changefreq") {
				const freq = val as SitemapChangefreq;
				if (["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].includes(freq)) {
					current.changefreq = freq;
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Convenience: collect all URLs to an array
// ---------------------------------------------------------------------------

/**
 * Collect all `SitemapUrl` entries into an array.
 * Be careful with large sitemaps — use `parseSitemap()` for streaming.
 */
export async function collectSitemapUrls(
	sitemapUrl: string,
	opts?: ParseSitemapOptions,
): Promise<SitemapUrl[]> {
	const urls: SitemapUrl[] = [];
	for await (const url of parseSitemap(sitemapUrl, opts)) {
		urls.push(url);
	}
	return urls;
}

// ---------------------------------------------------------------------------
// Auto-discovery from robots.txt
// ---------------------------------------------------------------------------

/**
 * Fetch `https://<origin>/robots.txt`, extract all `Sitemap:` directives,
 * and return the sitemap URLs found.
 */
export async function discoverSitemapsFromRobots(
	originUrl: string,
	opts?: Pick<ParseSitemapOptions, "signal" | "userAgent">,
): Promise<string[]> {
	const base = new URL(originUrl);
	const robotsUrl = `${base.protocol}//${base.host}/robots.txt`;
	const ua = opts?.userAgent ?? "Bunlight/1.0 SitemapParser";

	try {
		const text = await fetchText(robotsUrl, ua, opts?.signal);
		const sitemaps: string[] = [];
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.toLowerCase().startsWith("sitemap:")) {
				const loc = trimmed.slice("sitemap:".length).trim();
				if (loc) sitemaps.push(loc);
			}
		}
		return sitemaps;
	} catch {
		return [];
	}
}

/**
 * Full auto-discovery: find sitemaps via robots.txt, then collect all URLs.
 * Falls back to `<origin>/sitemap.xml` if no sitemaps found in robots.txt.
 */
export async function* autoDiscoverAndParse(
	originUrl: string,
	opts?: ParseSitemapOptions,
): AsyncGenerator<SitemapUrl> {
	let sitemaps = await discoverSitemapsFromRobots(originUrl, opts);
	if (sitemaps.length === 0) {
		const base = new URL(originUrl);
		sitemaps = [`${base.protocol}//${base.host}/sitemap.xml`];
	}
	const seen = new Set<string>();
	const counter = { count: 0 };
	for (const sm of sitemaps) {
		yield* parseSitemap(sm, opts, 0, seen, counter);
	}
}
