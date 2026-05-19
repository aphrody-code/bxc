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
 * @module bxc/google/search
 *
 * Specialized Google Search (SERP) scraping.
 * Unified to use the high-performance ZigQuery SerpParser.
 */

import { launchGhostBrowser } from "../profiles/ghost/index.ts";
import { sharedCache } from "./cache.ts";
import { isGoogleDomain } from "./dns.ts";
import { parseSerp, type SerpContent, type OrganicResult } from "./serp-parser.ts";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	source?: string;
}

export interface RichSearchResult extends SerpContent {
	servedFromCache: boolean;
	profileUsed: "ghost" | "http";
}

export interface SearchOptions {
	/** Language (e.g. "fr", "en"). Defaults to "en". */
	hl?: string;
	/** Region (e.g. "FR", "US"). Defaults to "US". */
	gl?: string;
	/** Number of results per page. */
	num?: number;
	/** Offset for pagination. */
	start?: number;
	/** Safe search mode. */
	safe?: "active" | "off";
	/** Use a specific Google domain (e.g. "google.fr"). */
	domain?: string;
	/** Lightpanda binary override. */
	binaryPath?: string;
	/** Force classic web view (removes AI Overviews). Default: true. */
	classic?: boolean;
	/** Cache TTL in ms (0 disables). Default: 0. */
	cacheTtlMs?: number;
}

/**
 * Perform a Google Web Search and return a list of results.
 * Uses 'ghost' profile (Lightpanda + stealth) by default.
 */
export async function googleWebSearch(
	query: string,
	opts: SearchOptions = {},
): Promise<OrganicResult[]> {
	const rich = await googleSearchRich(query, opts);
	return rich.organic;
}

/**
 * Rich variant of {@link googleWebSearch} that returns organic results plus
 * all SERP features (featured snippet, knowledge panel, PAA, etc).
 */
export async function googleSearchRich(
	query: string,
	opts: SearchOptions = {},
): Promise<RichSearchResult> {
	const hl = opts.hl ?? "en";
	const gl = opts.gl ?? "US";
	const domain = opts.domain ?? "google.com";
	const classic = opts.classic ?? true;

	if (!isGoogleDomain(domain)) {
		throw new Error(`Invalid Google domain: ${domain}`);
	}

	const url = new URL(`https://${domain}/search`);
	url.searchParams.set("q", query);
	url.searchParams.set("hl", hl);
	url.searchParams.set("gl", gl);
	if (opts.num) url.searchParams.set("num", opts.num.toString());
	if (opts.start) url.searchParams.set("start", opts.start.toString());
	if (opts.safe) url.searchParams.set("safe", opts.safe);
	if (classic) url.searchParams.set("udm", "14");

	const cacheKey = `serp-rich:${url.toString()}`;
	if (opts.cacheTtlMs) {
		const hit = sharedCache().get<RichSearchResult>(cacheKey);
		if (hit) return { ...hit, servedFromCache: true };
	}

	const baseDomain = `.${domain.replace(/^www\./, "")}`;
	const cookies = [
		{
			name: "CONSENT",
			value: `YES+cb.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-00-p0.en+FX+001`,
			domain: baseDomain,
			path: "/",
			expires: Math.floor(Date.now() / 1000) + 63072000,
			secure: true,
			sameSite: "None" as const,
		},
	];

	// 1. Try Ghost (Lightpanda + Stealth) for full JS execution
	let html = "";
	let profileUsed: "ghost" | "http" = "ghost";
	
	try {
		const ghost = await launchGhostBrowser({
			binaryPath: opts.binaryPath,
			logLevel: "error",
			fingerprint: { os: "windows", browser: "chrome" },
		});
		try {
			await ghost.page.addCookies(cookies);
			await ghost.page.goto(url.toString(), { waitUntil: "networkidle" });
			html = await ghost.page.content();
		} finally {
			await ghost.close();
		}
	} catch {
		// 2. Fallback to HTTP (curl-impersonate)
		profileUsed = "http";
		const { Browser: CoreBrowser } = await import("../api/browser.ts");
		const page = (await CoreBrowser.newPage({
			profile: "http",
			httpOpts: { profile: "chrome131" },
			cookies: cookies as any,
		})) as any;
		try {
			await page.goto(url.toString());
			html = await page.content();
		} finally {
			await page.close();
		}
	}

	const content = await parseSerp(html, query);
	console.log(`[google-search] Profile: ${profileUsed}, HTML size: ${html.length}, Results: ${content.organic.length}`);
	
	if (content.organic.length === 0) {
		const { writeFileSync } = await import("node:fs");
		writeFileSync("debug-serp.html", html);
		console.log("[google-search] Saved debug-serp.html for inspection.");
	}

	const rich: RichSearchResult = {
		...content,
		servedFromCache: false,
		profileUsed,
	};

	if (opts.cacheTtlMs && rich.organic.length > 0) {
		sharedCache().set(cacheKey, rich, opts.cacheTtlMs);
	}

	return rich;
}
