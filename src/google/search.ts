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

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchGhostBrowser } from "../profiles/ghost/index.ts";
import { buildCookieHeader } from "../cookies/cookie-injector.ts";
import { type Cookie, loadCookieJar } from "../cookies/cookie-loader.ts";
import { sharedCache } from "./cache.ts";
import { isGoogleDomain } from "./dns.ts";
import {
	parseSerp,
	type SerpContent,
	type OrganicResult,
} from "./serp-parser.ts";

/** Transport used to fetch the SERP HTML. */
export type SearchTransport = "auto" | "fetch" | "ghost" | "http";

import { resolveCookiePath } from "../utils/paths.ts";

/** Default location of the authenticated Google cookie jar. */
export const DEFAULT_GOOGLE_COOKIE_JAR = resolveCookiePath("google");

const DESKTOP_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	source?: string;
}

export interface RichSearchResult extends SerpContent {
	servedFromCache: boolean;
	profileUsed: SearchTransport;
	/** Whether an authenticated cookie jar was used for this request. */
	authenticated: boolean;
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
	/**
	 * Google result-mode code (`udm`). `14` = Web (clean organic, default when
	 * `classic`), `2` = Images, `7` = Videos, `12` = News, `36` = Books.
	 * Overrides `classic` when set.
	 */
	udm?: number;
	/** Cache TTL in ms (0 disables). Default: 0. */
	cacheTtlMs?: number;
	/**
	 * Authenticated cookie jar: a path to a cookie file or an in-memory
	 * `Cookie[]`. When omitted, `~/.bxc/cookies/google.json` is used if present.
	 * Set to `false` to force an anonymous request (CONSENT cookie only).
	 */
	cookies?: string | Cookie[] | false;
	/**
	 * Fetch strategy. `"auto"` (default) uses a native authenticated `fetch`
	 * and falls back to `ghost` (Lightpanda) then `http` (curl-impersonate) if
	 * the response looks blocked.
	 */
	transport?: SearchTransport;
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

	// Bare apex Google domains (`google.com`, `google.fr`) serve a JS-only shell
	// and 302 to the `www.` host — on which Bun's fetch does not always replay
	// cookies, yielding an empty SERP. Request the `www.` host directly.
	const requestHost = domain.startsWith("google.") ? `www.${domain}` : domain;
	const url = new URL(`https://${requestHost}/search`);
	url.searchParams.set("q", query);
	url.searchParams.set("hl", hl);
	url.searchParams.set("gl", gl);
	if (opts.num) url.searchParams.set("num", opts.num.toString());
	if (opts.start) url.searchParams.set("start", opts.start.toString());
	if (opts.safe) url.searchParams.set("safe", opts.safe);
	const udm = opts.udm ?? (classic ? 14 : undefined);
	if (udm !== undefined) url.searchParams.set("udm", udm.toString());

	const cacheKey = `serp-rich:${url.toString()}`;
	if (opts.cacheTtlMs) {
		const hit = sharedCache().get<RichSearchResult>(cacheKey);
		if (hit) return { ...hit, servedFromCache: true };
	}

	const { cookies, authenticated } = await resolveSearchCookies(
		opts.cookies,
		domain,
	);

	const transport = opts.transport ?? "auto";
	const { html, profileUsed } = await fetchSerpHtml(
		url,
		cookies,
		transport,
		opts,
	);

	const content = await parseSerp(html, query);

	// Rich (non-`udm`) SERPs are JS-hydrated and often ship no server-rendered
	// organic results. Backfill from the stable `udm=14` Web view so callers
	// always get organic results while keeping any rich features just parsed.
	if (content.organic.length === 0 && udm === undefined) {
		const webUrl = new URL(url);
		webUrl.searchParams.set("udm", "14");
		try {
			const { html: webHtml } = await fetchSerpHtml(
				webUrl,
				cookies,
				transport,
				opts,
			);
			const web = await parseSerp(webHtml, query);
			if (web.organic.length > 0) {
				content.organic = web.organic;
				if (content.totalResults === undefined)
					content.totalResults = web.totalResults;
			}
		} catch {
			/* best-effort backfill */
		}
	}

	if (content.organic.length === 0 && Bun.env.BXC_DEBUG === "1") {
		const { writeFileSync } = await import("node:fs");
		const dbg = join(Bun.env.TMPDIR ?? "/tmp", "bxc-serp-debug.html");
		writeFileSync(dbg, html);
		Bun.stderr.write(
			`[google-search] 0 results via ${profileUsed} (html=${html.length}b) — saved ${dbg}\n`,
		);
	}

	const rich: RichSearchResult = {
		...content,
		servedFromCache: false,
		profileUsed,
		authenticated,
	};

	if (opts.cacheTtlMs && rich.organic.length > 0) {
		sharedCache().set(cacheKey, rich, opts.cacheTtlMs);
	}

	return rich;
}

/**
 * Resolves the cookie set for a search request: the authenticated jar
 * (explicit, or `~/.bxc/cookies/google.json` when present) plus a synthetic
 * `CONSENT` cookie so anonymous requests skip the EU consent interstitial.
 */
async function resolveSearchCookies(
	input: string | Cookie[] | false | undefined,
	domain: string,
): Promise<{ cookies: Cookie[]; authenticated: boolean }> {
	let jar: Cookie[] = [];
	if (input === false) {
		jar = [];
	} else if (Array.isArray(input)) {
		jar = input;
	} else if (typeof input === "string") {
		jar = await loadCookieJar(input).catch(() => []);
	} else if (existsSync(DEFAULT_GOOGLE_COOKIE_JAR)) {
		jar = await loadCookieJar(DEFAULT_GOOGLE_COOKIE_JAR).catch(() => []);
	}

	const baseDomain = `.${domain.replace(/^www\./, "")}`;
	const consent: Cookie = {
		name: "CONSENT",
		value: `YES+cb.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-00-p0.en+FX+001`,
		domain: baseDomain,
		path: "/",
		expires: Math.floor(Date.now() / 1000) + 63072000,
		httpOnly: false,
		secure: true,
		sameSite: "None",
	};

	const hasConsent = jar.some((c) => c.name === "CONSENT");
	return {
		cookies: hasConsent ? jar : [...jar, consent],
		authenticated: jar.length > 0,
	};
}

const BLOCKED_RE =
	/\/sorry\/|id="recaptcha"|unusual traffic|consent\.google\.com/i;

/**
 * Fetches the raw SERP HTML using the requested transport. `"auto"` prefers a
 * native authenticated `fetch` (fast, no native deps) and only falls back to
 * `ghost` (Lightpanda) then `http` (curl-impersonate) when the response looks
 * blocked — those backends require extra binaries that may be absent.
 */
async function fetchSerpHtml(
	url: URL,
	cookies: Cookie[],
	transport: SearchTransport,
	opts: SearchOptions,
): Promise<{ html: string; profileUsed: SearchTransport }> {
	const order: SearchTransport[] =
		transport === "auto" ? ["fetch", "ghost", "http"] : [transport];

	let lastErr: unknown;
	for (const t of order) {
		try {
			let html = "";
			if (t === "fetch") {
				html = await fetchViaNative(url, cookies);
			} else if (t === "ghost") {
				html = await fetchViaGhost(url, cookies, opts.binaryPath);
			} else if (t === "http") {
				html = await fetchViaHttp(url, cookies);
			}
			if (html && !BLOCKED_RE.test(html)) return { html, profileUsed: t };
			lastErr = new Error(`transport ${t} returned blocked/empty response`);
		} catch (err) {
			lastErr = err;
		}
	}
	throw new Error(
		`google search: all transports failed (${order.join(", ")}): ${
			lastErr instanceof Error ? lastErr.message : String(lastErr)
		}`,
	);
}

async function fetchViaNative(url: URL, cookies: Cookie[]): Promise<string> {
	const headers: Record<string, string> = {
		"user-agent": DESKTOP_UA,
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "en-US,en;q=0.9",
	};
	const cookieHeader = buildCookieHeader(cookies, url.toString());
	if (cookieHeader) headers.cookie = cookieHeader;
	const res = await fetch(url.toString(), { headers, redirect: "follow" });
	return res.text();
}

async function fetchViaGhost(
	url: URL,
	cookies: Cookie[],
	binaryPath?: string,
): Promise<string> {
	const ghost = await launchGhostBrowser({
		binaryPath,
		logLevel: "error",
		fingerprint: { os: "windows", browser: "chrome" },
	});
	try {
		await ghost.page.addCookies(cookies as any);
		await ghost.page.goto(url.toString(), { waitUntil: "networkidle" });
		return await ghost.page.content();
	} finally {
		await ghost.close();
	}
}

async function fetchViaHttp(url: URL, cookies: Cookie[]): Promise<string> {
	const { Browser: CoreBrowser } = await import("../api/browser.ts");
	const page = (await CoreBrowser.newPage({
		profile: "http",
		httpOpts: { profile: "chrome131" },
		cookies: cookies as any,
	})) as any;
	try {
		await page.goto(url.toString());
		return await page.content();
	} finally {
		await page.close();
	}
}
