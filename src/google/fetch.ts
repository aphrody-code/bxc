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
 * @module bxc/google/fetch
 *
 * Enhanced web fetch specialized for Google infrastructure and anti-scraping.
 * Refactored to use unified GoogleClient and ZigQuery extraction.
 */

import { google, type GoogleSessionOptions } from "./client.ts";
import { parseHtml } from "../ffi/zigquery.ts";
import { isGoogleDomain } from "./dns.ts";

export interface StructuredData {
	jsonLd: unknown[];
	openGraph: Record<string, string>;
	twitter: Record<string, string>;
	canonical: string | null;
	description: string | null;
}

export interface FetchResult {
	url: string;
	content: string;
	title: string;
	metadata: Record<string, string>;
	cleaned: boolean;
	structured?: StructuredData;
}

export interface FetchOptions extends GoogleSessionOptions {
	/** Whether to remove ads, navigation, and other noise. Default: true. */
	clean?: boolean;
	/** Timeout in ms. Default: 30s. */
	timeoutMs?: number;
	/** Extract JSON-LD / OpenGraph / Twitter cards. Default: true. */
	extractStructured?: boolean;
	/** Lightpanda binary override. */
	binaryPath?: string;
}

/**
 * High-performance structured data extraction using ZigQuery.
 */
export async function extractStructuredData(
	html: string,
): Promise<StructuredData> {
	const out: StructuredData = {
		jsonLd: [],
		openGraph: {},
		twitter: {},
		canonical: null,
		description: null,
	};

	const doc = await parseHtml(html);
	try {
		// 1. JSON-LD
		const scripts = await doc.querySelectorAll(
			"script[type='application/ld+json']",
		);
		for (const s of scripts) {
			try {
				const parsed = JSON.parse(s.textContent().trim());
				if (Array.isArray(parsed)) out.jsonLd.push(...parsed);
				else out.jsonLd.push(parsed);
			} catch {}
		}

		// 2. Meta tags
		const metas = await doc.querySelectorAll("meta");
		for (const m of metas) {
			const prop = m.getAttribute("property") || m.getAttribute("name");
			const content = m.getAttribute("content");
			if (!prop || !content) continue;

			const key = prop.toLowerCase();
			if (key.startsWith("og:")) out.openGraph[key.slice(3)] = content;
			else if (key.startsWith("twitter:")) out.twitter[key.slice(8)] = content;
			else if (key === "description") out.description = content;
		}

		// 3. Canonical
		const canon = await doc.querySelector("link[rel='canonical']");
		out.canonical = canon?.getAttribute("href") || null;
	} finally {
		doc.destroy();
	}

	return out;
}

/**
 * Fetch a URL with Google-specialized cleaning and challenge handling.
 */
export async function googleWebFetch(
	url: string,
	opts: FetchOptions = {},
): Promise<FetchResult> {
	const clean = opts.clean ?? true;
	const isGoogle = isGoogleDomain(new URL(url).hostname);

	try {
		const { page } = await google.open(url);

		const title = await page.title();
		let content = (await page.content()) || "";
		let cleaned = false;

		if (clean && content) {
			content = await page.evaluate(() => {
				const junkSelector =
					"nav, header, footer, aside, .ads, .advertisement, .social-share, script, style, iframe, noscript";
				document.querySelectorAll(junkSelector).forEach((el) => el.remove());
				const main = document.querySelector(
					"article, main, #main, .main-content, #content, .post-content",
				);
				return main ? main.innerHTML : document.body.innerHTML;
			});
			cleaned = true;
		}

		const structured =
			(opts.extractStructured ?? true)
				? await extractStructuredData(content)
				: undefined;

		await page.close();

		return {
			url,
			content,
			title,
			metadata: {
				isGoogle: isGoogle.toString(),
			},
			cleaned,
			structured,
		};
	} catch (err) {
		return {
			url,
			content: "",
			title: "",
			metadata: { error: err instanceof Error ? err.message : String(err) },
			cleaned: false,
		};
	}
}

/**
 * Parallel fetch for multiple URLs.
 */
export async function googleWebFetchAll(
	urls: string[],
	opts: FetchOptions = {},
): Promise<FetchResult[]> {
	if (urls.length === 0) return [];
	const results: FetchResult[] = Array.from({ length: urls.length });
	let nextIdx = 0;
	let finishedIdx = 0;

	const { AutoscaledPool } = await import("../pool/AutoscaledPool.ts");
	const pool = new AutoscaledPool({
		minConcurrency: 1,
		maxConcurrency: 10,
		runTaskFunction: async () => {
			const idx = nextIdx++;
			if (idx >= urls.length) return;
			try {
				results[idx] = await googleWebFetch(urls[idx], opts);
			} finally {
				finishedIdx++;
			}
		},
		isTaskReadyFunction: async () => nextIdx < urls.length,
		isFinishedFunction: async () => finishedIdx >= urls.length,
	});

	await pool.run();
	return results;
}
