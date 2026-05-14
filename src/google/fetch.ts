/**
 * @module bunlight/google/fetch
 *
 * Enhanced web fetch specialized for Google infrastructure and anti-scraping.
 */

import { Browser, type Page } from "../api/browser.ts";
import { launchGhostBrowser } from "../profiles/ghost/index.ts";
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
	/** Structured data extracted when `extractStructured` is true (default: true). */
	structured?: StructuredData;
}

export interface FetchOptions {
	/** Whether to remove ads, navigation, and other noise. Default: true. */
	clean?: boolean;
	/** Profile to use. Default: "fast" (will auto-escalate if needed). */
	profile?: "static" | "fast" | "stealth" | "max";
	/** Timeout in ms. Default: 30s. */
	timeoutMs?: number;
	/** Lightpanda binary override. */
	binaryPath?: string;
	/** Extract JSON-LD / OpenGraph / Twitter cards. Default: true. */
	extractStructured?: boolean;
}

/**
 * Extract JSON-LD, OpenGraph, Twitter Card, canonical URL and meta description
 * from a raw HTML string. Pure function — runs without a browser context.
 */
export function extractStructuredData(html: string): StructuredData {
	const out: StructuredData = {
		jsonLd: [],
		openGraph: {},
		twitter: {},
		canonical: null,
		description: null,
	};

	const ldRe =
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	while ((m = ldRe.exec(html))) {
		const raw = m[1].trim();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) out.jsonLd.push(...parsed);
			else out.jsonLd.push(parsed);
		} catch {
			/* skip malformed */
		}
	}

	const metaRe = /<meta\s+([^>]*)>/gi;
	while ((m = metaRe.exec(html))) {
		const attrs = m[1];
		const propM = attrs.match(/(?:property|name)=["']([^"']+)["']/i);
		const contentM = attrs.match(/content=["']([^"']*)["']/i);
		if (!propM || !contentM) continue;
		const key = propM[1].toLowerCase();
		const value = contentM[1];
		if (key.startsWith("og:")) out.openGraph[key.slice(3)] = value;
		else if (key.startsWith("twitter:")) out.twitter[key.slice(8)] = value;
		else if (key === "description") out.description = value;
	}

	const canonM = html.match(
		/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i,
	);
	if (canonM) out.canonical = canonM[1];

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

	// Default to 'fast' for speed, but use 'max' (via ghost) for Google domains by default
	const profile = opts.profile ?? (isGoogle ? "max" : "fast");

	let page: Page;
	let closeFn: () => Promise<void>;

	if (profile === "stealth" || profile === "max") {
		const ghost = await launchGhostBrowser({
			binaryPath: opts.binaryPath,
			logLevel: "error",
		});
		page = ghost.page;
		closeFn = () => ghost.close();
	} else {
		page = (await Browser.newPage({
			profile: profile as "static" | "fast" | "http",
			spawnOpts: {
				binaryPath: opts.binaryPath,
				readyTimeoutMs: 12000,
			},
		})) as Page;
		closeFn = () => page.close();
	}

	try {
		await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeoutMs: opts.timeoutMs,
		});

		const title = await page.title();
		let content = (await page.content()) || "";
		let cleaned = false;

		if (clean && content) {
			// Extract meaningful text and remove junk
			content = await page.evaluate(() => {
				const junkSelector =
					"nav, header, footer, aside, .ads, .advertisement, .social-share, script, style, iframe, noscript";
				const elements = document.querySelectorAll(junkSelector);
				for (const el of elements) el.remove();

				// Prefer article or main content
				const main = document.querySelector(
					"article, main, #main, .main-content, #content, .post-content",
				);
				return main ? main.innerHTML : document.body.innerHTML;
			});
			cleaned = true;
		}

		const rawHtmlForStructured = await page.content().catch(() => content);
		const structured =
			(opts.extractStructured ?? true)
				? extractStructuredData(rawHtmlForStructured ?? "")
				: undefined;

		return {
			url,
			content: content || "",
			title: title || "",
			metadata: {
				profile,
				isGoogle: isGoogle.toString(),
			},
			cleaned,
			structured,
		};
	} catch (err) {
		console.error(
			`[google-fetch] failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return {
			url,
			content: "",
			title: "",
			metadata: { error: err instanceof Error ? err.message : String(err) },
			cleaned: false,
		};
	} finally {
		await closeFn();
	}
}

/**
 * Parallel fetch for multiple URLs using AutoscaledPool to prevent resource exhaustion.
 */
export async function googleWebFetchAll(
	urls: string[],
	opts: FetchOptions = {},
): Promise<FetchResult[]> {
	if (urls.length === 0) return [];

	const results: FetchResult[] = new Array(urls.length);
	let nextIdx = 0;
	let finishedIdx = 0;

	const { AutoscaledPool } = await import("../pool/AutoscaledPool.ts");

	const pool = new AutoscaledPool({
		minConcurrency: 1,
		maxConcurrency: 10, // Google is sensitive, keep it low
		desiredConcurrency: Math.min(urls.length, 3),
		runTaskFunction: async () => {
			const idx = nextIdx++;
			if (idx >= urls.length) return;
			try {
				results[idx] = await googleWebFetch(urls[idx], opts);
			} catch (err) {
				results[idx] = {
					url: urls[idx],
					content: "",
					title: "",
					metadata: { error: err instanceof Error ? err.message : String(err) },
					cleaned: false,
				};
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
