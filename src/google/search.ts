/**
 * @module bunlight/google/search
 *
 * Specialized Google Search (SERP) scraping.
 */

import type { Page } from "../api/browser.ts";
import { launchGhostBrowser } from "../profiles/ghost/index.ts";
import { sharedCache } from "./cache.ts";
import { isGoogleDomain } from "./dns.ts";
import { extractSerpFeatures, type SerpFeatures } from "./serp-features.ts";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	source?: string;
}

export interface RichSearchResult {
	results: SearchResult[];
	features: SerpFeatures;
	query: string;
	url: string;
	servedFromCache: boolean;
	profileUsed: "ghost" | "http";
}

export interface SearchOptions {
	/** Language (e.g. "fr", "en"). Defaults to "en". */
	hl?: string;
	/** Region (e.g. "FR", "US"). Defaults to "US". */
	gl?: string;
	/** Number of results per page (deprecated by Google, but sometimes still works). */
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
 * Uses 'ghost' profile (Lightpanda + stealth) by default, with a fallback to 'http' (curl-impersonate)
 * if JS challenges or specific blocks are detected.
 */
export async function googleWebSearch(
	query: string,
	opts: SearchOptions = {},
): Promise<SearchResult[]> {
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

	const baseDomain = `.${domain.replace(/^www\./, "")}`;
	const cookies = [
		{
			name: "CONSENT",
			value: `YES+cb.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-00-p0.en+FX+001`,
			domain: baseDomain,
			path: "/",
			expires: Math.floor(Date.now() / 1000) + 63072000,
			secure: true,
			sameSite: "None" as "None",
		},
		{
			name: "SOCS",
			value: "CAISHAgBEhJnd3NfMjAyNjA1MTItMF9SQzEaAmVuIAEaBgiA_L6zBg",
			domain: baseDomain,
			path: "/",
			expires: Math.floor(Date.now() / 1000) + 63072000,
			secure: true,
			sameSite: "Lax" as "Lax",
		},
	];

	const cacheKey = opts.cacheTtlMs ? `serp:${url.toString()}` : null;
	if (cacheKey) {
		const hit = sharedCache().get<SearchResult[]>(cacheKey);
		if (hit) return hit;
	}

	// 1. Try Ghost (Lightpanda + Stealth)
	let results = await tryGhostSearch(url.toString(), cookies, opts);

	// 2. If Ghost failed or was blocked, fallback to HTTP (curl-impersonate)
	if (results.length === 0) {
		console.warn(
			"[google-search] Ghost profile failed, falling back to HTTP profile...",
		);
		results = await tryHttpSearch(url.toString(), cookies);
	}

	if (cacheKey && results.length > 0) {
		sharedCache().set(cacheKey, results, opts.cacheTtlMs);
	}

	return results;
}

/**
 * Rich variant of {@link googleWebSearch} that returns organic results plus
 * SERP features (featured snippet, knowledge panel, "People Also Ask",
 * related searches, JSON-LD, total results, time taken).
 *
 * Always uses the HTTP profile (curl-impersonate) so the raw HTML can be
 * parsed by zigquery — Lightpanda's hydrated DOM strips most SERP features.
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
	if (opts.num) url.searchParams.set("num", String(opts.num));
	if (opts.start) url.searchParams.set("start", String(opts.start));
	if (opts.safe) url.searchParams.set("safe", opts.safe);
	if (classic) url.searchParams.set("udm", "14");

	const cacheKey = opts.cacheTtlMs ? `serp-rich:${url.toString()}` : null;
	if (cacheKey) {
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

	const { Browser: CoreBrowser } = await import("../api/browser.ts");
	let page: import("../api/browser.ts").HttpPage | null = null;
	let html = "";
	try {
		page = (await CoreBrowser.newPage({
			profile: "http",
			httpOpts: { profile: "chrome131" },
			cookies: cookies as import("../cookies/cookie-loader.ts").Cookie[],
		})) as import("../api/browser.ts").HttpPage;
		await page.goto(url.toString());
		html = (await page.content()) ?? "";
	} finally {
		if (page) await page.close().catch(() => {});
	}

	const features = extractSerpFeatures(html);
	const results = await parseHttpResults(html);

	const rich: RichSearchResult = {
		results,
		features,
		query,
		url: url.toString(),
		servedFromCache: false,
		profileUsed: "http",
	};

	if (cacheKey && results.length > 0) {
		sharedCache().set(cacheKey, rich, opts.cacheTtlMs);
	}

	return rich;
}

async function tryGhostSearch(
	url: string,
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		secure: boolean;
		sameSite: "None" | "Lax" | "Strict";
	}>,
	opts: SearchOptions,
): Promise<SearchResult[]> {
	let ghost: import("../profiles/ghost/index.ts").GhostBrowser | null = null;
	try {
		ghost = await launchGhostBrowser({
			binaryPath: opts.binaryPath,
			logLevel: "error",
			fingerprint: { os: "windows", browser: "chrome" },
			locale: (opts.hl ?? "en") === "en" ? "en-US" : opts.hl,
			timezone: "UTC",
		});

		await ghost.page.addCookies(cookies);
		await ghost.page.goto(url, { waitUntil: "networkidle" });

		// Handle Consent Page
		const title = await ghost.page.title();
		if (
			title.includes("Before you continue") ||
			title.includes("Avant de continuer") ||
			title.includes("Avant d'accéder") ||
			title.includes("consent") ||
			title.includes("Innan du fortsätter")
		) {
			const clicked = await ghost.page.evaluate(() => {
				const buttons = Array.from(
					document.querySelectorAll("input[type='submit'], button"),
				);
				const acceptBtn = buttons.find((b) => {
					const val = b instanceof HTMLInputElement ? b.value : b.textContent;
					const low = val?.toLowerCase() || "";
					return (
						low.includes("accept all") ||
						low.includes("tout accepter") ||
						low.includes("accepter tout") ||
						low.includes("i agree") ||
						low.includes("j'accepte") ||
						low.includes("ich stimme zu") ||
						low.includes("accepteren") ||
						low.includes("jag godkänner")
					);
				}) as HTMLElement | undefined;

				if (acceptBtn) {
					if (acceptBtn instanceof HTMLInputElement && acceptBtn.form) {
						acceptBtn.form.submit();
					} else {
						acceptBtn.click();
					}
					return true;
				}
				return false;
			});
			if (clicked) await Bun.sleep(2500);
		}

		// Wait for results
		await ghost.page
			.waitForSelector("div.wHYlTd, div.g, div.MjjYud, .g, h3", 5000)
			.catch(() => {});

		const results = await ghost.page.evaluate(() => {
			const elements = Array.from(
				document.querySelectorAll("div.wHYlTd.tF2Cxc, div.g, div.MjjYud, .g"),
			);

			if (elements.length === 0) {
				const text = document.body.textContent || "";
				if (
					text.includes("detected unusual traffic") ||
					text.includes("trafic exceptionnel") ||
					document.querySelector("#captcha-form") ||
					text.includes("not a robot") ||
					text.includes("pas un robot")
				) {
					return { error: "anti-bot" };
				}
				// Look for "Lite" DOM as a backup
				const liteLinks = Array.from(
					document.querySelectorAll("div.BNeawe, h3"),
				);
				if (liteLinks.length > 5) return "lite-mode";

				return { error: "no-results" };
			}

			return elements
				.map((el) => {
					const titleEl = el.querySelector("h3");
					const linkEl = el.querySelector(
						"a[href*='/url?'], a[data-ved], div.yuRUbf > a, a[href]",
					);
					const snippetEl = el.querySelector(
						"div.VwiC3b, div.kb0Bf, div.kb0NTe, .st, .y355M, .VwiC3b",
					);

					let rawUrl = linkEl?.getAttribute("href") ?? "";
					if (rawUrl.startsWith("/url?")) {
						try {
							const u = new URL(`https://www.google.com${rawUrl}`);
							rawUrl = u.searchParams.get("q") ?? rawUrl;
						} catch {
							/* ignore */
						}
					}

					return {
						title: titleEl?.textContent?.trim() ?? "",
						url: rawUrl,
						snippet: snippetEl?.textContent?.trim() ?? "",
					};
				})
				.filter((r) => r.title && r.url && !r.url.startsWith("/"));
		});

		if (results === "lite-mode") {
			return await parseLiteDom(ghost.page);
		}

		if ((results as { error?: string }).error) return [];
		return (results as SearchResult[]) || [];
	} catch (e) {
		console.error("[ghost-search] Error:", e);
		return [];
	} finally {
		if (ghost) await ghost.close().catch(() => {});
	}
}

async function parseLiteDom(page: Page): Promise<SearchResult[]> {
	return await page.evaluate(() => {
		// Lite DOM usually has results in <div> blocks with h3 or BNeawe titles
		const results: SearchResult[] = [];
		const blocks = Array.from(
			document.querySelectorAll("div > a > h3, h3"),
		).map((h3) => h3.closest("div"));

		for (const block of blocks) {
			if (!block) continue;
			const titleEl = block.querySelector("h3");
			const linkEl = block.querySelector("a");
			const snippetEl = block.nextElementSibling; // Often the next div contains the snippet

			let url = linkEl?.getAttribute("href") ?? "";
			if (url.startsWith("/url?")) {
				const u = new URL(`https://www.google.com${url}`);
				url = u.searchParams.get("q") ?? url;
			}

			if (titleEl && url && !url.startsWith("/")) {
				results.push({
					title: titleEl.textContent?.trim() ?? "",
					url,
					snippet: snippetEl?.textContent?.trim() ?? "",
				});
			}
		}
		return results;
	});
}

async function tryHttpSearch(
	url: string,
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		secure: boolean;
		sameSite: "None" | "Lax" | "Strict";
	}>,
): Promise<SearchResult[]> {
	let page: import("../api/browser.ts").HttpPage | null = null;
	try {
		const { Browser: CoreBrowser } = await import("../api/browser.ts");
		page = (await CoreBrowser.newPage({
			profile: "http",
			httpOpts: { profile: "chrome131" },
			cookies: cookies as import("../cookies/cookie-loader.ts").Cookie[],
		})) as import("../api/browser.ts").HttpPage;

		await page.goto(url);
		const html = await page.content();

		if (
			html.includes("Before you continue") ||
			html.includes("/httpservice/retry/enablejs")
		) {
			return [];
		}

		return await parseHttpResults(html);
	} catch (err) {
		console.error(`tryHttpSearch failed: ${err}`);
		return [];
	} finally {
		if (page) await page.close().catch(() => {});
	}
}

async function parseHttpResults(html: string): Promise<SearchResult[]> {
	const { parseHtml } = await import("../ffi/zigquery.ts");
	const doc = parseHtml(html);
	try {
		const results: SearchResult[] = [];
		// In Lite DOM (HTTP profile), results are often in <table> or simple <div> structures
		const links = doc.querySelectorAll("a");

		for (const link of links) {
			const href = link.getAttribute("href");
			if (!href?.includes("/url?q=")) continue;

			const title = link.textContent().trim();
			if (!title) continue;

			let url = href;
			if (url.startsWith("/url?")) {
				try {
					const u = new URL(`https://www.google.com${url}`);
					url = u.searchParams.get("q") ?? url;
				} catch {
					/* ignore */
				}
			}

			results.push({
				title,
				url,
				snippet: "", // Snippet extraction is harder in lite DOM without traversal
			});
		}
		return results;
	} finally {
		doc.destroy();
	}
}
