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
 * @module bunlight/google/verticals
 *
 * Specialized search verticals: News, Images, Videos, Scholar.
 * Optimized with high-performance ZigQuery element-scoped parsing.
 */

import { Browser, type HttpPage } from "../api/browser.ts";
import type { Cookie } from "../cookies/cookie-loader.ts";
import { parseHtml } from "../ffi/zigquery.ts";
import { isGoogleDomain } from "./dns.ts";

export interface VerticalOptions {
	hl?: string;
	gl?: string;
	domain?: string;
	num?: number;
	start?: number;
	cookies?: Cookie[];
}

export interface NewsResult {
	title: string;
	url: string;
	source: string;
	snippet: string;
	publishedAt: string | null;
}

export interface ImageResult {
	thumbnail: string;
	source: string;
	title: string;
	imageUrl: string | null;
}

export interface ScholarResult {
	title: string;
	url: string;
	authors: string;
	venue: string;
	snippet: string;
	citedBy: number | null;
	year: number | null;
	pdfUrl: string | null;
}

export interface VideoResult {
	title: string;
	url: string;
	source: string;
	duration: string | null;
	thumbnail: string | null;
}

export interface MapsResult {
	name: string;
	address: string;
	rating: number | null;
	reviewCount: number | null;
	url: string;
}

export interface BookResult {
	title: string;
	author: string;
	url: string;
	year: number | null;
	snippet: string;
}

function buildUrl(domain: string, tbm: string | null, q: string, opts: VerticalOptions): URL {
	if (!isGoogleDomain(domain)) {
		throw new Error(`Invalid Google domain: ${domain}`);
	}
	const u = new URL(`https://${domain}/search`);
	u.searchParams.set("q", q);
	if (tbm) u.searchParams.set("tbm", tbm);
	if (opts.hl) u.searchParams.set("hl", opts.hl);
	if (opts.gl) u.searchParams.set("gl", opts.gl);
	if (opts.num) u.searchParams.set("num", String(opts.num));
	if (opts.start) u.searchParams.set("start", String(opts.start));
	return u;
}

async function fetchHtml(url: string, cookies: Cookie[] | undefined): Promise<string> {
	let page: HttpPage | null = null;
	try {
		page = (await Browser.newPage({
			profile: "http",
			httpOpts: { profile: "chrome131" },
			cookies,
		})) as HttpPage;
		await page.goto(url);
		return (await page.content()) ?? "";
	} finally {
		if (page) await page.close().catch(() => {});
	}
}

function unwrapRedirect(href: string): string {
	if (!href) return href;
	if (href.startsWith("/url?")) {
		try {
			const u = new URL(`https://www.google.com${href}`);
			return u.searchParams.get("q") ?? u.searchParams.get("url") ?? href;
		} catch {
			return href;
		}
	}
	return href;
}

/**
 * Google Maps "places" search (tbm=lcl).
 */
export async function googleMapsSearch(query: string, opts: VerticalOptions = {}): Promise<MapsResult[]> {
	const url = buildUrl(opts.domain ?? "google.com", "lcl", query, opts);
	const html = await fetchHtml(url.toString(), opts.cookies);
	const doc = await parseHtml(html);
	try {
		const items = await doc.querySelectorAll("div.VkpGBb, div.rllt__details");
		const out: MapsResult[] = [];
		for (const it of items) {
			const name = (await it.querySelector("div.dbg0pd, div.rllt__details div"))?.textContent().trim() ?? "";
			const ratingEl = await it.querySelector("span.yi40Hd, span.BTtC6e");
			const ratingText = ratingEl?.textContent().trim() ?? "";
			const rating = ratingText ? Number(ratingText.replace(",", ".")) : null;
			const reviewEl = await it.querySelector("span.RDApEe");
			const reviewMatch = reviewEl?.textContent().match(/(\d+)/);
			const reviewCount = reviewMatch ? Number(reviewMatch[1]) : null;
			const link = await it.querySelector("a[href]");
			const linkUrl = unwrapRedirect(link?.getAttribute("href") ?? "");
			const details = await it.querySelectorAll("div.rllt__details div");
			const address = details.at(1)?.textContent().trim() ?? "";
			
			if (!name) continue;
			out.push({
				name,
				address,
				rating: Number.isFinite(rating ?? NaN) ? rating : null,
				reviewCount,
				url: linkUrl,
			});
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Google Books search (tbm=bks).
 */
export async function googleBooksSearch(query: string, opts: VerticalOptions = {}): Promise<BookResult[]> {
	const url = buildUrl(opts.domain ?? "google.com", "bks", query, opts);
	const html = await fetchHtml(url.toString(), opts.cookies);
	const doc = await parseHtml(html);
	try {
		const items = await doc.querySelectorAll("div.MjjYud, div.Yr5TG");
		const out: BookResult[] = [];
		for (const it of items) {
			const title = (await it.querySelector("h3, .DKV0Md"))?.textContent().trim() ?? "";
			const link = await it.querySelector("a[href*='books.google']");
			if (!title || !link) continue;
			const url = unwrapRedirect(link.getAttribute("href") ?? "");
			const meta = (await it.querySelector("div.fl, .qLRx3b"))?.textContent().trim() ?? "";
			const yearMatch = meta.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
			const year = yearMatch ? Number(yearMatch[0]) : null;
			const author = meta.replace(/\b(1[5-9]\d{2}|20\d{2})\b.*$/, "").trim();
			const snippet = (await it.querySelector("div.VwiC3b, .cmlJmd"))?.textContent().trim() ?? "";
			out.push({ title, author, url, year, snippet });
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Google News search (tbm=nws).
 */
export async function googleNewsSearch(query: string, opts: VerticalOptions = {}): Promise<NewsResult[]> {
	const url = buildUrl(opts.domain ?? "google.com", "nws", query, opts);
	const html = await fetchHtml(url.toString(), opts.cookies);
	const doc = await parseHtml(html);
	try {
		const items = await doc.querySelectorAll("div.SoaBEf, div.WlydOe, g-card");
		const out: NewsResult[] = [];
		for (const it of items) {
			const title = (await it.querySelector("div.MBeuO, div.n0jPhd, h3"))?.textContent().trim() ?? "";
			const link = await it.querySelector("a[href]");
			const rawUrl = link?.getAttribute("href") ?? "";
			const url = unwrapRedirect(rawUrl);
			const source = (await it.querySelector("div.NUnG9d span, div.MgUUmf span"))?.textContent().trim() ?? "";
			const snippet = (await it.querySelector("div.GI74Re, div.Y3v8qd"))?.textContent().trim() ?? "";
			const time = (await it.querySelector("div.OSrXXb span, span.WG9SHc"))?.textContent().trim() ?? "";
			if (title && url) {
				out.push({ title, url, source, snippet, publishedAt: time || null });
			}
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Google Images search (tbm=isch). Lite parsing — surfaces thumbnail data.
 */
export async function googleImageSearch(query: string, opts: VerticalOptions = {}): Promise<ImageResult[]> {
	const url = buildUrl(opts.domain ?? "google.com", "isch", query, opts);
	const html = await fetchHtml(url.toString(), opts.cookies);
	const out: ImageResult[] = [];

	const doc = await parseHtml(html);
	try {
		const imgs = await doc.querySelectorAll("img");
		for (const img of imgs) {
			const src = img.getAttribute("src");
			const alt = img.getAttribute("alt");
			if (!src || src.startsWith("data:") || !alt) continue;
			out.push({
				thumbnail: src,
				source: "",
				title: alt.trim(),
				imageUrl: null,
			});
		}
	} finally {
		doc.destroy();
	}

	const jsonMatches = html.match(/\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif))"/gi);
	if (jsonMatches) {
		for (let i = 0; i < Math.min(jsonMatches.length, out.length); i++) {
			const u = jsonMatches[i].match(/"(https?:\/\/[^"]+)"/)?.[1];
			if (u && out[i]) out[i].imageUrl = u;
		}
	}
	return out.slice(0, opts.num ?? 50);
}

/**
 * Google Videos search (tbm=vid).
 */
export async function googleVideoSearch(query: string, opts: VerticalOptions = {}): Promise<VideoResult[]> {
	const url = buildUrl(opts.domain ?? "google.com", "vid", query, opts);
	const html = await fetchHtml(url.toString(), opts.cookies);
	const doc = await parseHtml(html);
	try {
		const items = await doc.querySelectorAll("div.MjjYud, div.g, div.RzdJxc");
		const out: VideoResult[] = [];
		for (const it of items) {
			const title = (await it.querySelector("h3"))?.textContent().trim() ?? "";
			const link = await it.querySelector("a[href]");
			const rawUrl = unwrapRedirect(link?.getAttribute("href") ?? "");
			if (!title || !rawUrl) continue;
			const source = (await it.querySelector("cite"))?.textContent().trim() ?? "";
			const duration = (await it.querySelector("div.J1mWY, span.fGsHV"))?.textContent().trim() ?? null;
			const thumb = (await it.querySelector("img"))?.getAttribute("src") ?? null;
			out.push({ title, url: rawUrl, source, duration, thumbnail: thumb });
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Google Scholar search (scholar.google.com — no tbm).
 */
export async function googleScholarSearch(query: string, opts: VerticalOptions = {}): Promise<ScholarResult[]> {
	const u = new URL("https://scholar.google.com/scholar");
	u.searchParams.set("q", query);
	if (opts.hl) u.searchParams.set("hl", opts.hl);
	if (opts.start) u.searchParams.set("start", String(opts.start));

	const html = await fetchHtml(u.toString(), opts.cookies);
	const doc = await parseHtml(html);
	try {
		const items = await doc.querySelectorAll("div.gs_r.gs_or, div.gs_ri");
		const out: ScholarResult[] = [];
		for (const it of items) {
			const link = (await it.querySelector("h3.gs_rt a, h3 a"));
			const title = link?.textContent().trim() ?? "";
			const url = link?.getAttribute("href") ?? "";
			if (!title || !url) continue;
			const meta = (await it.querySelector("div.gs_a"))?.textContent().trim() ?? "";
			const snippet = (await it.querySelector("div.gs_rs"))?.textContent().trim() ?? "";
			const links = await it.querySelectorAll("a");
			const cited = links.find((a) => a.textContent().toLowerCase().includes("cited by"));
			const citedBy = cited ? Number((cited.textContent().match(/\d+/) ?? [null])[0]) || null : null;
			const yearMatch = meta.match(/\b(19|20)\d{2}\b/);
			const year = yearMatch ? Number(yearMatch[0]) : null;
			const pdf = links.find((a) => (a.getAttribute("href") || "").toLowerCase().endsWith(".pdf"));
			const pdfUrl = pdf?.getAttribute("href") ?? null;
			const authorsVenue = meta.split("-").map((s) => s.trim());
			out.push({
				title,
				url,
				authors: authorsVenue[0] ?? "",
				venue: authorsVenue[1] ?? "",
				snippet,
				citedBy,
				year,
				pdfUrl,
			});
		}
		return out;
	} finally {
		doc.destroy();
	}
}

/**
 * Google Suggest autocomplete API.
 */
export async function googleAutocomplete(query: string, opts: { hl?: string; gl?: string; client?: "firefox" | "chrome" } = {}): Promise<string[]> {
	const u = new URL("https://suggestqueries.google.com/complete/search");
	u.searchParams.set("client", opts.client ?? "firefox");
	u.searchParams.set("q", query);
	if (opts.hl) u.searchParams.set("hl", opts.hl);
	if (opts.gl) u.searchParams.set("gl", opts.gl);

	try {
		const res = await fetch(u.toString(), {
			headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return [];
		const text = await res.text();
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
			return parsed[1].filter((x): x is string => typeof x === "string");
		}
	} catch {
		/* swallow */
	}
	return [];
}

/**
 * Trending search topics RSS.
 */
export async function googleTrendingTopics(geo = "US"): Promise<string[]> {
	const u = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${encodeURIComponent(geo)}`;
	try {
		const res = await fetch(u, {
			headers: { "User-Agent": "Mozilla/5.0" },
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return [];
		const xml = await res.text();
		const titles: string[] = [];
		const re = /<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g;
		let m: RegExpExecArray | null;
		let first = true;
		while ((m = re.exec(xml))) {
			if (first) {
				first = false;
				continue;
			}
			titles.push(m[1].trim());
		}
		return titles;
	} catch {
		return [];
	}
}
