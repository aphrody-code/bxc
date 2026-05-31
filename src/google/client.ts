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
 * @module bxc/google/client
 *
 * High-level unified Google client for stealth scraping and audit.
 */

import { Browser, Page } from "../api/browser.ts";
import { enforceMandate } from "./mandate-guard.ts";
import {
	auditNetwork,
	type NetworkAuditResult,
} from "../utils/network-auditor.ts";
import {
	googleWebSearch,
	type SearchResult,
	type SearchOptions,
} from "./search.ts";
import { GoogleMassScanner } from "./mass-scanner.ts";
import { parseSerp, type SerpContent } from "./serp-parser.ts";
import { sharedCache } from "./cache.ts";
import { HOSTS_BY_FRAMEWORK } from "./atlas.ts";

export interface GoogleSessionOptions {
	profile?: "static" | "stealth" | "max";
	proxy?: string;
	userAgent?: string;
	useCache?: boolean;
}

export class GoogleClient {
	#options: GoogleSessionOptions;

	constructor(opts: GoogleSessionOptions = {}) {
		this.#options = {
			profile: "stealth",
			useCache: true,
			...opts,
		};
	}

	/**
	 * Resolve the best stealth profile based on the Google Ecosystem Atlas.
	 */
	private resolveAtlasProfile(hostname: string): string | null {
		if (HOSTS_BY_FRAMEWORK.wiz.includes(hostname)) return "stealth-wiz";
		if (HOSTS_BY_FRAMEWORK.angular.includes(hostname)) return "stealth-spa";
		if (HOSTS_BY_FRAMEWORK.lit.includes(hostname)) return "stealth-lit";
		return null;
	}

	/**
	 * Navigate to a Google property with mandate enforcement and Atlas-aware routing.
	 */
	async open(
		url: string,
		opts: { profile?: string } = {},
	): Promise<{ page: Page; audit: NetworkAuditResult }> {
		await enforceMandate(url);

		const hostname = new URL(url).hostname;
		const atlasProfile = this.resolveAtlasProfile(hostname);
		const profile = (opts.profile ||
			atlasProfile ||
			this.#options.profile ||
			"stealth") as any;

		const page = (await Browser.newPage({
			profile,
		})) as Page;

		const resp = await page.goto(url);
		if (!resp.ok) {
			await page.close();
			throw new Error(`Failed to load ${url}: status ${resp.status}`);
		}

		const audit = await auditNetwork(hostname);

		if (this.#options.useCache) {
			sharedCache().set(`page:${url}`, {
				title: await page.title(),
				status: resp.status,
				audit,
			});
		}

		return { page, audit };
	}

	/**
	 * Perform a stealth search.
	 */
	async search(
		query: string,
		opts: SearchOptions = {},
	): Promise<SearchResult[]> {
		const cacheKey = `search:${query}:${opts.hl || "en"}:${opts.gl || "US"}`;
		if (this.#options.useCache) {
			const cached = sharedCache().get<SearchResult[]>(cacheKey);
			if (cached) return cached;
		}

		const results = await googleWebSearch(query, opts);

		if (this.#options.useCache && results.length > 0) {
			sharedCache().set(cacheKey, results);
		}

		return results;
	}

	/**
	 * Advanced SERP parsing from HTML.
	 */
	async parseSerp(html: string, query: string = ""): Promise<SerpContent> {
		return parseSerp(html, query);
	}

	/**
	 * Run a massive audit on multiple properties.
	 */
	async auditMassive(
		seeds: string[],
		maxPages: number = 5656,
		concurrency: number = 24,
	) {
		const scanner = new GoogleMassScanner({
			concurrency,
			maxPages,
		});
		return scanner.scan(seeds);
	}
}

/**
 * Global singleton for quick access.
 */
export const google = new GoogleClient();
