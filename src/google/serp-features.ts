/**
 * @module bunlight/google/serp-features
 *
 * SERP feature extractors. Parses HTML returned by Google Web Search to
 * surface featured snippets, knowledge panels, "People Also Ask",
 * related searches, and structured data (JSON-LD) when present.
 */

import { parseHtml, type ZigDoc } from "../ffi/zigquery.ts";

export interface FeaturedSnippet {
	answer: string;
	source: string;
	url: string;
}

export interface PeopleAlsoAsk {
	question: string;
	answer?: string;
}

export interface KnowledgePanel {
	title: string;
	subtitle: string;
	description: string;
	attributes: Record<string, string>;
	url?: string;
	imageUrl?: string;
}

export interface SerpFeatures {
	featuredSnippet: FeaturedSnippet | null;
	peopleAlsoAsk: PeopleAlsoAsk[];
	relatedSearches: string[];
	knowledgePanel: KnowledgePanel | null;
	jsonLd: unknown[];
	correctedQuery: string | null;
	totalResults: number | null;
	tookMs: number | null;
}

const DECIMAL_GROUP_RE = /[,.  ]/g;

/**
 * Best-effort extraction of SERP features from a Google search HTML page.
 * All fields are independently optional — missing features simply return null/empty.
 */
export function extractSerpFeatures(html: string): SerpFeatures {
	const doc = parseHtml(html);
	try {
		return {
			featuredSnippet: extractFeaturedSnippet(doc),
			peopleAlsoAsk: extractPeopleAlsoAsk(doc),
			relatedSearches: extractRelatedSearches(doc),
			knowledgePanel: extractKnowledgePanel(doc),
			jsonLd: extractJsonLd(doc),
			correctedQuery: extractCorrectedQuery(doc),
			totalResults: extractTotalResults(html),
			tookMs: extractTookMs(html),
		};
	} finally {
		doc.destroy();
	}
}

function extractFeaturedSnippet(doc: ZigDoc): FeaturedSnippet | null {
	const candidates = [
		"div.kp-blk div.IZ6rdc",
		"div.xpdopen .hgKElc",
		"div.ifM9O .V3FYCf",
		"div.wDYxhc[data-attrid] .Z0LcW",
	];
	for (const sel of candidates) {
		const el = doc.querySelector(sel);
		if (!el) continue;
		const answer = el.textContent().trim();
		if (!answer) continue;
		const link =
			doc.querySelector(`${sel} a`) ??
			doc.querySelector("div.kp-blk a, div.xpdopen a");
		const url = link?.getAttribute("href") ?? "";
		const source = link?.textContent().trim() ?? "";
		return { answer, source, url };
	}
	return null;
}

function extractPeopleAlsoAsk(doc: ZigDoc): PeopleAlsoAsk[] {
	const out: PeopleAlsoAsk[] = [];
	const blocks = doc.querySelectorAll(
		"div.related-question-pair, div.JlqpRe, div[jsname='Cpkphb']",
	);
	for (const block of blocks) {
		const q = block.textContent().trim();
		if (q && q.length < 250) out.push({ question: q });
	}
	return out;
}

function extractRelatedSearches(doc: ZigDoc): string[] {
	const out = new Set<string>();
	const links = doc.querySelectorAll(
		"a.k8XOCe, a.ZWRArf, div.AJLUJb a, div.s75CSd, div.brs_col a",
	);
	for (const a of links) {
		const text = a.textContent().trim();
		if (text && text.length < 120) out.add(text);
	}
	return Array.from(out);
}

function extractKnowledgePanel(doc: ZigDoc): KnowledgePanel | null {
	const root =
		doc.querySelector("div.kp-wholepage") ??
		doc.querySelector("div.knowledge-panel") ??
		doc.querySelector("div[data-attrid='kc:/common/topic']");
	if (!root) return null;

	const subDoc = parseHtml(root.innerHTML());
	try {
		const title =
			subDoc
				.querySelector("h2, h3, span[role='heading']")
				?.textContent()
				.trim() ?? "";
		const subtitle =
			subDoc
				.querySelector("div.wwUB2c span, div.YhemCb")
				?.textContent()
				.trim() ?? "";
		const description =
			subDoc
				.querySelector("div.kno-rdesc span, div.PZPZlf span")
				?.textContent()
				.trim() ?? "";

		const attributes: Record<string, string> = {};
		const rows = subDoc.querySelectorAll(
			"div.rVusze, div[data-attrid] div.zloOqf",
		);
		for (const row of rows) {
			const text = row.textContent().trim();
			const colon = text.indexOf(":");
			if (colon > 0 && colon < 60) {
				const key = text.slice(0, colon).trim();
				const value = text.slice(colon + 1).trim();
				if (key && value) attributes[key] = value;
			}
		}

		const link = subDoc.querySelector("a.ab_button, a.LV6jFe");
		const url = link?.getAttribute("href") || undefined;
		const img = subDoc.querySelector("img");
		const imageUrl = img?.getAttribute("src") || undefined;

		if (!title && !description && Object.keys(attributes).length === 0)
			return null;
		return { title, subtitle, description, attributes, url, imageUrl };
	} finally {
		subDoc.destroy();
	}
}

function extractJsonLd(doc: ZigDoc): unknown[] {
	const out: unknown[] = [];
	const scripts = doc.querySelectorAll("script[type='application/ld+json']");
	for (const s of scripts) {
		const raw = s.textContent().trim();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) out.push(...parsed);
			else out.push(parsed);
		} catch {
			// ignore malformed
		}
	}
	return out;
}

function extractCorrectedQuery(doc: ZigDoc): string | null {
	const node = doc.querySelector("a.gL9Hy, span.aIIZGf, p.gqLncc i");
	const text = node?.textContent().trim();
	return text && text.length > 0 ? text : null;
}

function extractTotalResults(html: string): number | null {
	// Matches "About 1,234,567 results" / "Environ 1 234 567 résultats"
	const m = html.match(
		/(?:About|Environ|Ungefähr|Cerca de)\s+([\d.,\s ]+)\s+(?:results|résultats|Ergebnisse|resultados)/i,
	);
	if (!m) return null;
	const n = Number(m[1].replace(DECIMAL_GROUP_RE, ""));
	return Number.isFinite(n) ? n : null;
}

function extractTookMs(html: string): number | null {
	const m = html.match(/\(([\d.,]+)\s*(seconds|secondes|Sekunden|segundos)\)/i);
	if (!m) return null;
	const n = Number(m[1].replace(",", "."));
	return Number.isFinite(n) ? Math.round(n * 1000) : null;
}
