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
 * @module bxc/google/serp-parser
 * 
 * High-performance parser for Google Search Engine Result Pages (SERP).
 * Extracts organic results, featured snippets, knowledge panels, and "People Also Ask".
 * 
 * Optimized for Bun v1.3+ and ZigQuery FFI.
 */

import { parseHtml } from "../ffi/zigquery.ts";

export interface OrganicResult {
	position: number;
	title: string;
	url: string;
	displayedUrl: string;
	snippet: string;
	sitelinks?: Array<{ title: string; url: string }>;
	isSponsored: boolean;
}

export interface FeaturedSnippet {
	title: string;
	url: string;
	content: string;
	source?: string;
}

export interface KnowledgePanel {
	title: string;
	type?: string;
	description: string;
	metadata: Record<string, string>;
	imageUrl?: string;
	url?: string;
}

export interface SerpContent {
	query: string;
	organic: OrganicResult[];
	featuredSnippet?: FeaturedSnippet;
	knowledgePanel?: KnowledgePanel;
	peopleAlsoAsk: string[];
	relatedSearches: string[];
	totalResults?: number;
	searchTimeMs?: number;
	jsonLd: any[];
	correctedQuery?: string;
}

const DECIMAL_GROUP_RE = /[,.  ]/g;

/**
 * Advanced SERP parser using ZigQuery FFI.
 * Unified and optimized replacement for legacy serp-features.ts.
 */
export async function parseSerp(html: string, query: string = ""): Promise<SerpContent> {
	const doc = await parseHtml(html);
	try {
		const out: SerpContent = {
			query,
			organic: [],
			peopleAlsoAsk: [],
			relatedSearches: [],
			jsonLd: [],
		};

		// 1. Organic Results — layout-agnostic.
		//
		// Google ships at least two markups: the legacy `div.g` blocks and the
		// modern `div.MjjYud` containers used by the `udm=14` ("Web") view, the
		// AI-Overview layout, and most current desktop SERPs. We iterate both,
		// extract via tolerant selector chains, decode `/url?q=` redirects, drop
		// Google-internal links, and dedupe by URL so a result that appears in
		// both block types is only emitted once.
		const seen = new Set<string>();
		let pos = 1;
		for (const blockSel of ["div.MjjYud", "div.g"]) {
			const blocks = await doc.querySelectorAll(blockSel);
			for (const block of blocks) {
				const titleEl = await block.querySelector("h3");
				const title = titleEl?.textContent().trim();
				if (!title) continue;

				const linkEl =
					(await block.querySelector("div.yuRUbf a[href]")) ??
					(await block.querySelector("a[jsname][href]")) ??
					(await block.querySelector("a[href]"));
				const url = cleanResultUrl(linkEl?.getAttribute("href") ?? "");
				if (!url) continue;

				const dedupeKey = url.replace(/[#?].*$/, "").replace(/\/$/, "");
				if (seen.has(dedupeKey)) continue;
				seen.add(dedupeKey);

				const snippetEl = await block.querySelector(
					"div.VwiC3b, div[data-sncf], div.kb0Bf, .st",
				);

				let displayedUrl = url;
				try {
					displayedUrl = new URL(url).hostname.replace(/^www\./, "");
				} catch {
					/* keep full url */
				}

				out.organic.push({
					position: pos++,
					title: cleanText(title),
					url,
					displayedUrl,
					snippet: cleanText(snippetEl?.textContent() ?? ""),
					isSponsored: block.outerHTML().includes("data-text-ad"),
				});
			}
		}

		// 2. People Also Ask
		const paaEls = await doc.querySelectorAll("div.related-question-pair, .iDP60e, .CS59e, div[jsname='Cpkphb']");
		for (const el of paaEls) {
			const q = el.textContent().trim();
			if (q && q.length < 250) out.peopleAlsoAsk.push(q);
		}

		// 3. Related Searches
		const relatedEls = await doc.querySelectorAll("div.nv67Ub, .y676u, .RES9nd, a.k8XOCe");
		for (const el of relatedEls) {
			const q = el.textContent().trim();
			if (q && q.length < 120) out.relatedSearches.push(q);
		}

		// 4. Featured Snippet
		const fsBlock = await doc.querySelector("div.kp-blk, .LGOjbe, .c29vbe, div.xpdopen");
		if (fsBlock) {
			const titleEl = await fsBlock.querySelector("h3");
			const linkEl = await fsBlock.querySelector("a[href]");
			const contentEl = await fsBlock.querySelector(".LGOjbe, .hgKElc, .V3FYCf, .Z0LcW");
			if (titleEl && linkEl) {
				out.featuredSnippet = {
					title: titleEl.textContent().trim(),
					url: linkEl.getAttribute("href") || "",
					content: contentEl?.textContent().trim() || "",
					source: linkEl.textContent().trim() || undefined,
				};
			}
		}

		// 5. Knowledge Panel
		const kpBlock = await doc.querySelector("div.kp-wholepage, div.knowledge-panel, div[data-attrid='kc:/common/topic']");
		if (kpBlock) {
			const title = (await kpBlock.querySelector("h2, h3, span[role='heading']"))?.textContent().trim() ?? "";
			const type = (await kpBlock.querySelector("div.wwUB2c span, div.YhemCb"))?.textContent().trim();
			const description = (await kpBlock.querySelector("div.kno-rdesc span, div.PZPZlf span"))?.textContent().trim() ?? "";
			
			const metadata: Record<string, string> = {};
			const rows = await kpBlock.querySelectorAll("div.rVusze, div[data-attrid] div.zloOqf");
			for (const row of rows) {
				const text = row.textContent().trim();
				const colon = text.indexOf(":");
				if (colon > 0 && colon < 60) {
					const key = text.slice(0, colon).trim();
					const value = text.slice(colon + 1).trim();
					if (key && value) metadata[key] = value;
				}
			}

			const img = await kpBlock.querySelector("img");
			const imageUrl = img?.getAttribute("src") || undefined;
			const link = await kpBlock.querySelector("a.ab_button, a.LV6jFe");
			const url = link?.getAttribute("href") || undefined;

			out.knowledgePanel = { title, type, description, metadata, imageUrl, url };
		}

		// 6. JSON-LD
		const scripts = await doc.querySelectorAll("script[type='application/ld+json']");
		for (const s of scripts) {
			try {
				const parsed = JSON.parse(s.textContent().trim());
				if (Array.isArray(parsed)) out.jsonLd.push(...parsed);
				else out.jsonLd.push(parsed);
			} catch {}
		}

		// 7. Metadata (Total Results & Time)
		out.totalResults = extractTotalResults(html);
		out.searchTimeMs = extractTookMs(html);
		
		// 8. Corrected Query
		const correctedEl = await doc.querySelector("a.gL9Hy, span.aIIZGf, p.gqLncc i");
		out.correctedQuery = correctedEl?.textContent().trim() || undefined;

		return out;
	} finally {
		doc.destroy();
	}
}

const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	"#39": "'",
};

/**
 * Cleans extracted SERP text for AI consumption: decodes the common HTML
 * entities that survive tag-stripping, removes Google's trailing UI affordances
 * ("Read more", "More results"), and collapses whitespace.
 */
function cleanText(text: string): string {
	return text
		.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_m, e) => ENTITY_MAP[e] ?? _m)
		.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/\s*(Read more|More results|More|En savoir plus|Plus de résultats)\s*$/i, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Normalises a raw SERP anchor `href` into a clean external result URL.
 *
 * - Decodes Google redirect wrappers (`/url?q=` / `/url?url=`).
 * - Rejects relative links and Google-internal navigation
 *   (`/search`, `/url`, `accounts.google.com`, etc.).
 * - Returns `null` when the href is not a usable external result.
 */
function cleanResultUrl(rawHref: string): string | null {
	let href = rawHref.trim();
	if (!href) return null;

	if (href.startsWith("/url?") || href.startsWith("/url%3F")) {
		try {
			const u = new URL(href, "https://www.google.com");
			href = u.searchParams.get("q") ?? u.searchParams.get("url") ?? "";
		} catch {
			return null;
		}
	}

	if (!/^https?:\/\//i.test(href)) return null;

	try {
		const u = new URL(href);
		const host = u.hostname.toLowerCase();
		const isGoogleNav =
			(host === "google.com" || host.endsWith(".google.com")) &&
			(u.pathname === "/search" ||
				u.pathname.startsWith("/url") ||
				host === "accounts.google.com" ||
				host === "policies.google.com" ||
				host === "support.google.com");
		if (isGoogleNav) return null;
		return u.toString();
	} catch {
		return null;
	}
}

function extractTotalResults(html: string): number | undefined {
	const m = html.match(/(?:About|Environ|Ungefähr|Cerca de)\s+([\d.,\s ]+)\s+(?:results|résultats|Ergebnisse|resultados)/i);
	if (!m) return undefined;
	const n = Number(m[1].replace(DECIMAL_GROUP_RE, ""));
	return Number.isFinite(n) ? n : undefined;
}

function extractTookMs(html: string): number | undefined {
	const m = html.match(/\(([\d.,]+)\s*(seconds|secondes|Sekunden|segundos)\)/i);
	if (!m) return undefined;
	const n = Number(m[1].replace(",", "."));
	return Number.isFinite(n) ? Math.round(n * 1000) : undefined;
}
