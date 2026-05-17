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
 * @module bunlight/google/serp-parser
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

		// 1. Organic Results
		const gBlocks = await doc.querySelectorAll("div.g");
		let pos = 1;
		for (const block of gBlocks) {
			const titleEl = await block.querySelector("h3");
			const linkEl = await block.querySelector("a[href]");
			const snippetEl = await block.querySelector("div.VwiC3b, div.kb0Bf, .st");
			
			const title = titleEl?.textContent().trim();
			const url = linkEl?.getAttribute("href");
			const snippet = snippetEl?.textContent().trim() || "";

			if (title && url && !url.startsWith("/")) {
				out.organic.push({
					position: pos++,
					title,
					url,
					displayedUrl: url,
					snippet,
					isSponsored: false,
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
