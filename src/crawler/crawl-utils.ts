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

import { Browser } from "../api/browser.ts";
import { BxcDB } from "../db/BxcDB.ts";
import { redis } from "bun";
import { extractStructuredData } from "../google/fetch.ts";
import { generateOpenApiSchema } from "../utils/openapi.ts";
import { getEmbedding } from "../utils/vector.ts";

export const profilesOrder = ["static", "http", "fast", "stealth", "max"] as const;
export type ScrapeProfile = typeof profilesOrder[number];

export interface SmartFetchOptions {
	force?: boolean;
	initialProfile?: ScrapeProfile;
	cookies?: string | any[];
	userAgent?: string;
	viewport?: { width: number; height: number };
	insecure?: boolean;
	proxy?: string;
	proxyAuth?: string;
	spawnOpts?: any;
	timeoutMs?: number;
	redisTtl?: number;
	headless?: boolean;
}

export interface SmartFetchResult {
	url: string;
	title: string;
	status: number;
	html: string;
	markdown: string;
	structured: any;
	openapi: any;
	vector?: number[];
	timestamp: string;
	source: "redis" | "sqlite" | "live-crawl";
	profileUsed?: string;
}

/**
 * Markers that only appear on a Cloudflare *interstitial* (challenge or block
 * page), never on an ordinary page that merely happens to be served by
 * Cloudflare.
 *
 * The distinction matters: `email-decode.min.js`, `rocket-loader.min.js` and
 * `static.cloudflareinsights.com/beacon.min.js` are injected into perfectly
 * normal 200 responses across a large share of the web. Matching the bare word
 * "cloudflare" in the body therefore marked *every* CF-fronted page as blocked,
 * which made a successful fetch indistinguishable from a challenge and burned
 * the whole escalation chain on pages that had already been retrieved in full.
 */
const CF_INTERSTITIAL_MARKERS = [
	"/cdn-cgi/challenge-platform/",
	"cf-challenge",
	"cf-browser-verification",
	"cf-spinner",
	"cf_chl_opt",
	"window._cf_chl",
	"challenge-form",
	"cf-error-details",
	"cf-please-wait",
] as const;

/** Interstitial `<title>` values used by Cloudflare and friends. */
const BLOCKED_TITLE_MARKERS = [
	"just a moment",
	"please wait",
	"attention required",
	"access denied",
	"block page",
	"ddos",
	"security check",
	"verifying you are human",
] as const;

/** CAPTCHA widgets. Only conclusive on a page with no real content. */
const CAPTCHA_MARKERS = ["hcaptcha", "recaptcha", "turnstile"] as const;

/**
 * Checks if a crawl result represents a failure or blocker (like Cloudflare,
 * Captcha, or 403).
 *
 * Errs towards *accepting* a page: a false positive throws away a body that was
 * actually fetched and escalates to a slower profile that will fare no better,
 * whereas a false negative merely hands the caller a page it can inspect.
 */
/**
 * Une entree de cache est-elle inexploitable ? Une page mise en cache apres un echec
 * (corps vide, interstitiel) est pire qu'une absence de cache : elle est servie
 * indefiniment avec un code de sortie 0, et seul `--force` la contourne.
 * Mesure du 2026-09-05 : 137 des 365 entrees de ~/bxc/data/bxc.sqlite avaient un
 * markdown de moins de 50 caracteres.
 */
export function isCacheUnusable(html: string, markdown: string, title: string, status?: number): boolean {
	if ((markdown ?? "").trim().length < 50 && (html ?? "").trim().length < 200) return true;
	return isCrawlFailure(status, html ?? "", title ?? "");
}

export function isCrawlFailure(status: number | undefined, html: string, title: string): boolean {
	if (status !== undefined && (status < 200 || status >= 400)) {
		return true;
	}

	const lowerTitle = title.toLowerCase();
	if (BLOCKED_TITLE_MARKERS.some((m) => lowerTitle.includes(m))) {
		return true;
	}

	const lowerHtml = html.toLowerCase();
	if (CF_INTERSTITIAL_MARKERS.some((m) => lowerHtml.includes(m))) {
		return true;
	}

	// Content is empty or a stub: a failed load whatever the status says.
	const cleanText = html.replace(/<[^>]*>/g, " ").trim();
	if (cleanText.length < 50) {
		return true;
	}

	// A CAPTCHA widget on a page that also carries substantial text is a contact
	// form, not a wall. Only treat it as a block on a near-empty page.
	if (cleanText.length < 2000 && CAPTCHA_MARKERS.some((m) => lowerHtml.includes(m))) {
		return true;
	}

	return false;
}

/**
 * High-reliability fetch utility with Redis+SQLite caching, crawl failure detection,
 * and automatic profile escalation.
 */
export async function smartFetch(
	url: string,
	opts: SmartFetchOptions = {}
): Promise<SmartFetchResult> {
	const force = opts.force ?? false;
	const initialProfile = opts.initialProfile ?? "static";
	const redisTtl = opts.redisTtl ?? 86400; // 24h
	const cacheKey = `bxc:cache:url:${url}`;

	// 1. Check Caches first if not forced
	if (!force) {
		try {
			const cached = await redis.get(cacheKey);
			if (cached) {
				const parsed = JSON.parse(cached);
				if (isCacheUnusable(parsed.html || "", parsed.markdown || "", parsed.title || "", parsed.status)) {
					console.error(`[smartFetch] Entree Redis inexploitable pour ${url} — purgee, recrawl`);
					await redis.del(cacheKey).catch(() => {});
				} else return {
					url,
					title: parsed.title || "",
					status: parsed.status || 200,
					html: parsed.html || "",
					markdown: parsed.markdown || "",
					structured: parsed.structured || null,
					openapi: parsed.openapi || null,
					vector: parsed.vector,
					timestamp: parsed.timestamp || new Date().toISOString(),
					source: "redis",
					profileUsed: parsed.profileUsed
				};
			}
		} catch (err) {
			console.error("[smartFetch] Redis cache get error:", err);
		}

		const db = new BxcDB();
		try {
			const row = db.getScrapeByUrl(url);
			if (row && isCacheUnusable(row.content || "", row.markdown || "", row.metadata ? (JSON.parse(row.metadata).title ?? "") : "", row.status)) {
				console.error(`[smartFetch] Entree SQLite inexploitable pour ${url} — ignoree, recrawl`);
			} else if (row) {
				const result: SmartFetchResult = {
					url: row.url,
					title: row.metadata ? JSON.parse(row.metadata).title || "" : "",
					status: row.status,
					html: row.content || "",
					markdown: row.markdown || "",
					structured: row.json_data ? JSON.parse(row.json_data) : null,
					openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
					vector: row.vector ? JSON.parse(row.vector) : undefined,
					timestamp: row.timestamp,
					source: "sqlite",
					profileUsed: row.profile
				};

				// Cache in Redis for next requests
				try {
					await redis.set(
						cacheKey,
						JSON.stringify({
							title: result.title,
							status: result.status,
							html: result.html,
							markdown: result.markdown,
							structured: result.structured,
							openapi: result.openapi,
							vector: result.vector,
							timestamp: result.timestamp,
							profileUsed: result.profileUsed
						}),
						"EX",
						redisTtl
					);
				} catch (cacheErr) {
					console.error("[smartFetch] Failed to update Redis cache:", cacheErr);
				}

				return result;
			}
		} catch (err) {
			console.error("[smartFetch] SQLite cache get error:", err);
		} finally {
			db.close();
		}
	}

	// 2. Profile escalation sequence
	const idx = profilesOrder.indexOf(initialProfile);
	const escalationPath = idx === -1 ? profilesOrder : profilesOrder.slice(idx);

	let lastError: Error | null = null;

	for (const profile of escalationPath) {
		// stderr, jamais stdout : `bxc scrape --markdown` ecrit son resultat sur stdout, et
		// cette ligne se retrouvait EN TETE du Markdown de chaque page rendue.
		console.error(`[smartFetch] Trying profile: ${profile} for ${url}`);
		let page: any = null;
		try {
			const isBrowserProfile = profile === "fast" || profile === "stealth" || profile === "max";
			page = await Browser.newPage({
				profile,
				headless: opts.headless ?? true,
				cookies: opts.cookies,
				userAgent: opts.userAgent,
				viewport: opts.viewport,
				insecure: opts.insecure,
				proxy: opts.proxy,
				proxyAuth: opts.proxyAuth,
				spawnOpts: opts.spawnOpts ?? (isBrowserProfile ? { logLevel: "error", readyTimeoutMs: 10000 } : undefined)
			});

			const response = await page.goto(url, { timeoutMs: opts.timeoutMs ?? 30000 });
			const status = response?.status;
			const html = await page.content();
			const title = await page.title();

			if (isCrawlFailure(status, html, title)) {
				throw new Error(
					`Crawl failure detected (status: ${status}, title: "${title}", content length: ${html.length})`
				);
			}

			// Crawl succeeded!
			const markdown = await page.markdown();
			const structured = await extractStructuredData(html);
			const openapi = generateOpenApiSchema({
				url,
				title,
				description: structured.description || undefined,
				markdown,
				structuredData: structured,
				timestamp: new Date().toISOString()
			});
			const vector = await getEmbedding(markdown);

			const timestamp = new Date().toISOString();

			// Save to SQLite cache
			const db = new BxcDB();
			try {
				db.saveScrape(
					url,
					profile,
					status ?? 200,
					html,
					{ title, canonical: structured.canonical, openGraph: structured.openGraph },
					markdown,
					structured,
					openapi,
					vector
				);
			} catch (dbErr) {
				console.error("[smartFetch] SQLite save error:", dbErr);
			} finally {
				db.close();
			}

			// Save to Redis cache
			try {
				await redis.set(
					cacheKey,
					JSON.stringify({
						title,
						status: status ?? 200,
						html,
						markdown,
						structured,
						openapi,
						vector,
						timestamp,
						profileUsed: profile
					}),
					"EX",
					redisTtl
				);
			} catch (redisErr) {
				console.error("[smartFetch] Redis save error:", redisErr);
			}

			return {
				url,
				title,
				status: status ?? 200,
				html,
				markdown,
				structured,
				openapi,
				vector,
				timestamp,
				source: "live-crawl",
				profileUsed: profile
			};

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[smartFetch] Profile ${profile} failed for ${url}: ${message}`);
			lastError = err instanceof Error ? err : new Error(message);
		} finally {
			if (page) {
				try {
					await page.close();
				} catch {}
			}
		}
	}

	throw lastError ?? new Error(`Failed to crawl ${url} with all profiles in escalation path.`);
}
