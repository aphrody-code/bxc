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
 * @module bxc/mirror
 *
 * Site mirror — downloads the full HTML/CSS/JS/asset graph of a site,
 * rewrites URLs to local relative paths, and produces a self-contained
 * directory that opens in a browser via `file://`.
 *
 * Pipeline :
 *
 *   1. Auto-discover hidden pages via robots.txt and sitemap.xml.
 *
 *   2. Crawl HTML pages recursively (asynchronously and in parallel) up to limits.
 *      Supports subdomains and CDNs based on configuration.
 *
 *   3. Walk the HTML with `Bun.HTMLRewriter` (lol-html, streaming) to
 *      extract every asset URL.
 *
 *   4. Concurrently download every asset, with a configurable worker
 *      pool. Re-walk CSS for nested assets.
 *
 *   5. Rewrite URLs inside HTML (assets and navigation links) and CSS to relative local paths.
 *
 *   6. Write sidecar gzip (.gz) files for text-based assets.
 *
 *   7. Emit `manifest.json`.
 */

import {
	dirname,
	relative as relativePath,
	resolve as resolvePath,
} from "node:path";
import { type Cookie, loadCookieJar } from "../cookies/cookie-loader.ts";
import { autoDiscoverAndParse } from "../utils/sitemap.ts";
import type { HarEntry, HarLog } from "../recorder/types.ts";
import {
	ImpersonatedClient,
	type ImpersonateProfile,
} from "../ffi/curl-impersonate.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MirrorProfile = "static" | "fast" | "http" | "stealth" | "max";

export interface MirrorOptions {
	/** Output directory — created if missing. */
	outDir: string;
	/** Bxc profile used to fetch pages (default: `"http"`). */
	profile?: MirrorProfile;
	/** Cookie jar path passed to bxc (Playwright/CDP/Netscape JSON). */
	cookies?: string;
	/** Concurrent asset downloads / crawl threads (default: 6). */
	concurrency?: number;
	/** Per-asset fetch timeout in ms (default: 15_000). */
	timeoutMs?: number;
	/** When true, inline same-origin assets only ; cross-origin keeps remote URLs. */
	sameOriginOnly?: boolean;
	/** Maximum bytes per asset (default: 50 MB). Aborts on overshoot. */
	maxAssetBytes?: number;
	/**
	 * Optional asset filter — return false to skip an URL (e.g. analytics
	 * endpoints, ads). Receives the absolute URL and the discovery source.
	 */
	filter?: (url: string, sourceTag: string) => boolean;
	/** User-Agent override (default: bxc-mirror/0.1 + contact URL). */
	userAgent?: string;
	/** Verbose logger (default: silent). */
	log?: (msg: string) => void;
	/** Bypass TLS certificate validation. */
	insecure?: boolean;

	/** Proxy server URL (e.g. `http://127.0.0.1:8080`). */
	proxy?: string;
	/** Proxy credentials (e.g. `user:password`). */
	proxyAuth?: string;
	/** Server credentials (e.g. `user:password`). */
	auth?: string;
	/** Set default HTTP version to request. */
	httpVersion?: "1.0" | "1.1" | "2.0" | "3.0" | "default";
	/** Enable curl verbose logging. */
	verbose?: boolean;

	// --- CRAWL / RECURSIVE OPTIONS ---
	/** Enable recursive crawling (multi-page) instead of single page (default: false). */
	recursive?: boolean;
	/** Maximum HTML pages to crawl (default: 1 for non-recursive, 100 for recursive). */
	maxPages?: number;
	/** Maximum crawl depth for links (default: 0 for non-recursive, 10 for recursive). */
	maxDepth?: number;
	/** Compress assets with gzip (.gz) sidecar files. */
	compress?: boolean;
	/** Auto-discover hidden pages via robots.txt and sitemap.xml. */
	discoverHidden?: boolean;
	/** Resolve and scrape subdomains of the seed host. */
	resolveSubdomains?: boolean;
	/** Resolve and scrape CDNs or external assets / pages from specific domains (or true to resolve general CDNs). */
	resolveCdns?: string[] | boolean;
	/** Allow only these domains for crawling and downloading. */
	allowedDomains?: string[];
	/** Exclude these domains from crawling and downloading. */
	excludedDomains?: string[];
	/** Allow only paths starting with these prefixes. */
	allowedPaths?: string[];
	/** Exclude paths starting with these prefixes. */
	excludedPaths?: string[];
	/** Only crawl pages under the parent directory path of the seed URL. */
	noParent?: boolean;
	/** Skip creating host-name directories for same-origin files. */
	noHostDirectories?: boolean;
	/** Time delay in milliseconds to wait between requests. */
	delayMs?: number;
	/** Output path to save the crawl session as a HAR log. */
	har?: string;
}

export interface MirrorAssetRecord {
	url: string;
	finalUrl: string;
	localPath: string;
	relativePath: string;
	sourceTag: string;
	contentType: string;
	bytes: number;
	httpStatus: number;
	sha256?: string;
	error?: string;
}

export interface MirrorManifest {
	seed: string;
	rootHtmlPath: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	totalAssets: number;
	totalBytes: number;
	failed: number;
	assets: MirrorAssetRecord[];
}

// ---------------------------------------------------------------------------
// Host/Subdomain Utilities
// ---------------------------------------------------------------------------

function getBaseDomain(hostname: string): string {
	const parts = hostname.split(".");
	if (parts.length >= 3) {
		const secondToLast = parts[parts.length - 2];
		if (
			["co", "com", "net", "org", "edu", "gov", "ac"].includes(secondToLast)
		) {
			return parts.slice(-3).join(".");
		}
	}
	return parts.slice(-2).join(".");
}

function matchesFilters(
	urlStr: string,
	seedUrl: URL,
	options: MirrorOptions,
): boolean {
	try {
		const u = new URL(urlStr);
		const host = u.hostname;
		const path = u.pathname;

		// 1. Domain filters
		if (options.allowedDomains && options.allowedDomains.length > 0) {
			if (!options.allowedDomains.includes(host) && host !== seedUrl.hostname) {
				return false;
			}
		}
		if (options.excludedDomains && options.excludedDomains.length > 0) {
			if (options.excludedDomains.includes(host)) {
				return false;
			}
		}

		// 2. Path filters
		if (options.allowedPaths && options.allowedPaths.length > 0) {
			const matched = options.allowedPaths.some((p) => path.startsWith(p));
			if (!matched) return false;
		}
		if (options.excludedPaths && options.excludedPaths.length > 0) {
			const matched = options.excludedPaths.some((p) => path.startsWith(p));
			if (matched) return false;
		}

		// 3. No Parent filter
		if (options.noParent) {
			let seedDir = seedUrl.pathname;
			if (!seedDir.endsWith("/")) {
				seedDir = seedDir.slice(0, seedDir.lastIndexOf("/") + 1);
			}
			if (!path.startsWith(seedDir)) {
				return false;
			}
		}

		return true;
	} catch {
		return false;
	}
}

function shouldCrawl(
	urlStr: string,
	seedUrl: URL,
	options: MirrorOptions,
): boolean {
	if (!matchesFilters(urlStr, seedUrl, options)) return false;

	try {
		const u = new URL(urlStr);
		const host = u.hostname;
		const seedHost = seedUrl.hostname;

		if (host === seedHost) return true;

		if (options.resolveSubdomains) {
			const seedBaseDomain = getBaseDomain(seedHost);
			const hostBaseDomain = getBaseDomain(host);
			if (hostBaseDomain === seedBaseDomain) return true;
		}

		if (options.resolveCdns) {
			if (options.resolveCdns === true) {
				if (
					host.includes("cdn") ||
					host.includes("static") ||
					host.includes("assets")
				)
					return true;
			} else if (Array.isArray(options.resolveCdns)) {
				if (options.resolveCdns.includes(host)) return true;
			}
		}

		return false;
	} catch {
		return false;
	}
}

function shouldDownloadAsset(
	urlStr: string,
	seedUrl: URL,
	options: MirrorOptions,
): boolean {
	if (!matchesFilters(urlStr, seedUrl, options)) return false;

	try {
		const u = new URL(urlStr);
		const host = u.hostname;
		const seedHost = seedUrl.hostname;

		if (host === seedHost) return true;

		if (options.resolveSubdomains) {
			const seedBaseDomain = getBaseDomain(seedHost);
			const hostBaseDomain = getBaseDomain(host);
			if (hostBaseDomain === seedBaseDomain) return true;
		}

		if (options.resolveCdns) {
			if (options.resolveCdns === true) {
				if (
					host.includes("cdn") ||
					host.includes("static") ||
					host.includes("assets")
				)
					return true;
			} else if (Array.isArray(options.resolveCdns)) {
				if (options.resolveCdns.includes(host)) return true;
			}
		}

		if (options.sameOriginOnly) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// URL → local path mapping
// ---------------------------------------------------------------------------

/**
 * Maps an absolute URL to a relocatable local path under `outDir`.
 * Same origin → `<host>/<path>`. Cross-origin → `_external/<host>/<path>`.
 * Query strings become a `__qhash` segment so different query variants
 * coexist on disk.
 */
function mapUrlToLocalPath(
	url: string,
	outDir: string,
	seedHost: string,
	options?: MirrorOptions,
): string {
	const u = new URL(url);
	let pathname = u.pathname.replace(/^\/+/, "");
	if (pathname === "" || pathname.endsWith("/")) {
		pathname = `${pathname}index.html`;
	}
	if (u.search.length > 0) {
		const hash = simpleHash(u.search).slice(0, 8);
		const dot = pathname.lastIndexOf(".");
		if (dot >= 0) {
			pathname = `${pathname.slice(0, dot)}__q${hash}${pathname.slice(dot)}`;
		} else {
			pathname = `${pathname}__q${hash}`;
		}
	}
	let sameOrigin = u.hostname === seedHost;
	if (!sameOrigin && options?.resolveSubdomains) {
		sameOrigin = getBaseDomain(u.hostname) === getBaseDomain(seedHost);
	}
	const root = sameOrigin
		? options?.noHostDirectories
			? ""
			: u.hostname
		: `_external/${u.hostname}`;
	return resolvePath(outDir, root, pathname);
}

function simpleHash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h).toString(36);
}

function buildHarEntry(url: string, r: DownloadedAsset, ua: string): HarEntry {
	const requestHeaders: Record<string, string> = { "User-Agent": ua };
	const u = new URL(url);
	const queryParams = Array.from(u.searchParams.entries()).map(
		([name, value]) => ({ name, value }),
	);

	const harRequest = {
		method: "GET",
		url,
		httpVersion: "HTTP/1.1",
		cookies: [],
		headers: Object.entries(requestHeaders).map(([name, value]) => ({
			name,
			value,
		})),
		queryString: queryParams,
		headersSize: -1,
		bodySize: -1,
	};

	const resHeaders = r.headers ?? {};
	const harResponse = {
		status: r.httpStatus,
		statusText: r.error ? `Failed: ${r.error}` : "OK",
		httpVersion: "HTTP/1.1",
		cookies: [],
		headers: Object.entries(resHeaders).map(([name, value]) => ({
			name,
			value,
		})),
		content: {
			size: r.body.byteLength,
			mimeType: r.contentType,
		},
		redirectURL: resHeaders["location"] ?? "",
		headersSize: -1,
		bodySize: r.body.byteLength,
		comment: r.error ? `Error: ${r.error}` : undefined,
	};

	const duration = r.durationMs ?? 0;
	return {
		startedDateTime: r.startedAt ?? new Date().toISOString(),
		time: Math.round(duration),
		request: harRequest,
		response: harResponse,
		cache: {},
		timings: {
			blocked: -1,
			dns: -1,
			connect: -1,
			send: 0,
			wait: Math.round(duration),
			receive: 0,
		},
	};
}

// ---------------------------------------------------------------------------
// HTML asset / link extraction
// ---------------------------------------------------------------------------

interface AssetTask {
	url: string;
	sourceTag: string;
}

const HTML_ASSET_SELECTORS: Array<{
	selector: string;
	attr: string;
	tag: string;
}> = [
	{ selector: "link[rel~='stylesheet'][href]", attr: "href", tag: "link-css" },
	{ selector: "link[rel~='icon'][href]", attr: "href", tag: "link-icon" },
	{
		selector: "link[rel='shortcut icon'][href]",
		attr: "href",
		tag: "link-icon",
	},
	{
		selector: "link[rel='apple-touch-icon'][href]",
		attr: "href",
		tag: "link-icon",
	},
	{
		selector: "link[rel='apple-touch-icon-precomposed'][href]",
		attr: "href",
		tag: "link-icon",
	},
	{ selector: "link[rel='mask-icon'][href]", attr: "href", tag: "link-icon" },
	{
		selector: "link[rel='manifest'][href]",
		attr: "href",
		tag: "link-manifest",
	},
	{ selector: "link[rel='preload'][href]", attr: "href", tag: "link-preload" },
	{
		selector: "link[rel='modulepreload'][href]",
		attr: "href",
		tag: "link-modulepreload",
	},
	{
		selector: "link[rel='prefetch'][href]",
		attr: "href",
		tag: "link-prefetch",
	},
	{ selector: "script[src]", attr: "src", tag: "script" },
	{ selector: "img[src]", attr: "src", tag: "img" },
	{ selector: "img[srcset]", attr: "srcset", tag: "img-srcset" },
	{ selector: "source[src]", attr: "src", tag: "source" },
	{ selector: "source[srcset]", attr: "srcset", tag: "source-srcset" },
	{ selector: "video[src]", attr: "src", tag: "video" },
	{ selector: "video[poster]", attr: "poster", tag: "video-poster" },
	{ selector: "audio[src]", attr: "src", tag: "audio" },
	{ selector: "iframe[src]", attr: "src", tag: "iframe" },
	{ selector: "object[data]", attr: "data", tag: "object" },
	{ selector: "embed[src]", attr: "src", tag: "embed" },
	{ selector: "use[href]", attr: "href", tag: "svg-use" },
	{ selector: "image[href]", attr: "href", tag: "svg-image" },
];

function expandSrcset(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim().split(/\s+/)[0])
		.filter((u) => u && u.length > 0);
}

function extractCssUrls(css: string): string[] {
	const out = new Set<string>();
	for (const m of css.matchAll(
		/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g,
	)) {
		const v = m[1] ?? m[2] ?? m[3];
		if (v && !v.startsWith("data:")) out.add(v);
	}
	for (const m of css.matchAll(
		/@import\s+(?:url\()?\s*(?:"([^"]+)"|'([^']+)')\s*\)?/g,
	)) {
		const v = m[1] ?? m[2];
		if (v && !v.startsWith("data:")) out.add(v);
	}
	return [...out];
}

function discoverHtmlAssets(html: string, baseUrl: string): AssetTask[] {
	const tasks: AssetTask[] = [];
	const base = new URL(baseUrl);
	const push = (raw: string, tag: string): void => {
		if (
			!raw ||
			raw.startsWith("data:") ||
			raw.startsWith("javascript:") ||
			raw.startsWith("#") ||
			raw.startsWith("mailto:") ||
			raw.startsWith("tel:")
		) {
			return;
		}
		try {
			const abs = new URL(raw, base).href;
			tasks.push({ url: abs, sourceTag: tag });
		} catch {
			// invalid URL — skip
		}
	};

	type El = { getAttribute: (n: string) => string | null };
	type RewriterCtor = new () => {
		on(sel: string, h: { element: (el: El) => void }): unknown;
		transform(html: string): string;
	};
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor })
		.HTMLRewriter;
	if (!Rewriter) {
		// Fallback regex.
		for (const m of html.matchAll(
			/<(?:link|script|img|source|video|audio|iframe|object|embed)[^>]+(?:href|src|srcset|poster|data)=["']([^"']+)["']/gi,
		)) {
			push(m[1], "regex-fallback");
		}
		return tasks;
	}

	const rw = new Rewriter();
	for (const sel of HTML_ASSET_SELECTORS) {
		rw.on(sel.selector, {
			element(el) {
				const v = el.getAttribute(sel.attr);
				if (!v) return;
				if (sel.attr === "srcset") {
					for (const u of expandSrcset(v)) push(u, sel.tag);
				} else {
					push(v, sel.tag);
				}
			},
		});
	}
	rw.on("[style]", {
		element(el) {
			const s = el.getAttribute("style") ?? "";
			for (const u of extractCssUrls(s)) push(u, "inline-style");
		},
	});
	rw.transform(html);
	return tasks;
}

function discoverHtmlLinks(html: string, baseUrl: string): string[] {
	const links: string[] = [];
	const base = new URL(baseUrl);
	const push = (raw: string): void => {
		if (
			!raw ||
			raw.startsWith("data:") ||
			raw.startsWith("javascript:") ||
			raw.startsWith("#") ||
			raw.startsWith("mailto:") ||
			raw.startsWith("tel:")
		) {
			return;
		}
		try {
			const abs = new URL(raw, base).href;
			links.push(abs);
		} catch {
			// invalid URL
		}
	};

	type El = { getAttribute: (n: string) => string | null };
	type RewriterCtor = new () => {
		on(sel: string, h: { element: (el: El) => void }): unknown;
		transform(html: string): string;
	};
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor })
		.HTMLRewriter;
	if (!Rewriter) {
		for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
			push(m[1]);
		}
		return links;
	}

	const rw = new Rewriter();
	rw.on("a[href], area[href]", {
		element(el) {
			const v = el.getAttribute("href");
			if (v) push(v);
		},
	});
	rw.transform(html);
	return links;
}

// ---------------------------------------------------------------------------
// HTML / CSS link rewriting (HTMLRewriter)
// ---------------------------------------------------------------------------

function rewriteHtmlLinks(
	html: string,
	baseUrl: string,
	urlToLocal: Map<string, string>,
	htmlOutPath: string,
): string {
	const base = new URL(baseUrl);
	const htmlOutDir = dirname(htmlOutPath);

	const remap = (raw: string): string => {
		if (
			!raw ||
			raw.startsWith("data:") ||
			raw.startsWith("javascript:") ||
			raw.startsWith("#") ||
			raw.startsWith("mailto:") ||
			raw.startsWith("tel:")
		) {
			return raw;
		}
		try {
			const abs = new URL(raw, base).href;
			const local = urlToLocal.get(abs);
			if (!local) return raw;
			return relativePath(htmlOutDir, local);
		} catch {
			return raw;
		}
	};

	type El = {
		getAttribute: (n: string) => string | null;
		setAttribute: (n: string, v: string) => void;
	};
	type RewriterCtor = new () => {
		on(sel: string, h: { element: (el: El) => void }): unknown;
		transform(html: string): string;
	};
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor })
		.HTMLRewriter;
	if (!Rewriter) {
		let out = html;
		for (const [abs, local] of urlToLocal) {
			out = out.split(abs).join(relativePath(htmlOutDir, local));
		}
		return out;
	}

	const rw = new Rewriter();
	for (const sel of HTML_ASSET_SELECTORS) {
		rw.on(sel.selector, {
			element(el) {
				const v = el.getAttribute(sel.attr);
				if (!v) return;
				if (sel.attr === "srcset") {
					const rewritten = v
						.split(",")
						.map((entry) => {
							const parts = entry.trim().split(/\s+/);
							if (parts[0]) parts[0] = remap(parts[0]);
							return parts.join(" ");
						})
						.join(", ");
					el.setAttribute(sel.attr, rewritten);
				} else {
					el.setAttribute(sel.attr, remap(v));
				}
			},
		});
	}
	rw.on("[style]", {
		element(el) {
			const s = el.getAttribute("style") ?? "";
			const rewritten = s.replace(
				/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g,
				(_full, a, b, c) => {
					const v = a ?? b ?? c;
					return `url("${remap(v)}")`;
				},
			);
			el.setAttribute("style", rewritten);
		},
	});
	// Rewrite links & anchors as well
	rw.on("a[href], area[href]", {
		element(el) {
			const v = el.getAttribute("href");
			if (v) el.setAttribute("href", remap(v));
		},
	});
	return rw.transform(html);
}

function rewriteCssLinks(
	css: string,
	baseUrl: string,
	urlToLocal: Map<string, string>,
	cssOutPath: string,
): string {
	const base = new URL(baseUrl);
	const cssOutDir = dirname(cssOutPath);
	const remap = (raw: string): string => {
		if (!raw || raw.startsWith("data:")) return raw;
		try {
			const abs = new URL(raw, base).href;
			const local = urlToLocal.get(abs);
			if (!local) return raw;
			return relativePath(cssOutDir, local);
		} catch {
			return raw;
		}
	};
	let out = css.replace(
		/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g,
		(_full, a, b, c) => {
			const v = a ?? b ?? c;
			return `url("${remap(v)}")`;
		},
	);
	out = out.replace(
		/@import\s+(?:url\()?\s*(?:"([^"]+)"|'([^']+)')\s*\)?\s*;?/g,
		(full, a, b) => {
			const v = a ?? b;
			const r = remap(v);
			return `@import "${r}";`;
		},
	);
	return out;
}

// ---------------------------------------------------------------------------
// Pre-compression (Gzip sidecar)
// ---------------------------------------------------------------------------

function isCompressible(filePath: string): boolean {
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (!ext) return false;
	return [
		"html",
		"css",
		"js",
		"svg",
		"json",
		"xml",
		"txt",
		"ttf",
		"otf",
		"woff",
	].includes(ext);
}

async function compressFile(localPath: string): Promise<void> {
	try {
		const file = Bun.file(localPath);
		const bytes = await file.arrayBuffer();
		const compressed = Bun.gzipSync(new Uint8Array(bytes));
		await Bun.write(`${localPath}.gz`, compressed);
	} catch {
		// Ignore compression failure for single files
	}
}

// ---------------------------------------------------------------------------
// Asset downloader with worker pool
// ---------------------------------------------------------------------------

interface DownloadedAsset {
	url: string;
	finalUrl: string;
	body: Uint8Array;
	contentType: string;
	httpStatus: number;
	error?: string;
	headers?: Record<string, string>;
	durationMs?: number;
	startedAt?: string;
}

function cookieHeaderForHost(
	jar: Cookie[] | undefined,
	host: string,
): string | undefined {
	if (!jar || jar.length === 0) return undefined;
	const matches: string[] = [];
	for (const c of jar) {
		const cookieDomain = c.domain.startsWith(".")
			? c.domain.slice(1)
			: c.domain;
		const hostMatch =
			host === cookieDomain || host.endsWith("." + cookieDomain);
		if (!hostMatch) continue;
		matches.push(`${c.name}=${c.value}`);
	}
	return matches.length > 0 ? matches.join("; ") : undefined;
}

async function downloadAsset(
	url: string,
	options: {
		ua: string;
		timeoutMs: number;
		cookieJar?: Cookie[];
		maxBytes: number;
		insecure?: boolean;
		profile?: MirrorProfile;
		proxy?: string;
		proxyAuth?: string;
		auth?: string;
		httpVersion?: "1.0" | "1.1" | "2.0" | "3.0" | "default";
		verbose?: boolean;
	},
): Promise<DownloadedAsset> {
	const startedAt = new Date().toISOString();
	const tStart = Bun.nanoseconds();

	const isLocal =
		url.startsWith("http://localhost") ||
		url.startsWith("http://127.0.0.1") ||
		url.startsWith("http://[::1]");

	if (isLocal) {
		try {
			const headers: Record<string, string> = { "User-Agent": options.ua };
			const cookieHeader = cookieHeaderForHost(
				options.cookieJar,
				new URL(url).hostname,
			);
			if (cookieHeader) headers["Cookie"] = cookieHeader;

			const fetchOpts: any = {
				signal: AbortSignal.timeout(options.timeoutMs),
				headers,
				redirect: "follow",
			};
			if (options.insecure) {
				fetchOpts.tls = { rejectUnauthorized: false };
			}
			const r = await fetch(url, fetchOpts);
			const durationMs = (Bun.nanoseconds() - tStart) / 1e6;

			let finalUrl = r.url;
			if (finalUrl.startsWith("/")) {
				finalUrl = new URL(finalUrl, url).href;
			}
			const contentType =
				r.headers.get("content-type") ?? "application/octet-stream";

			const responseHeaders: Record<string, string> = {};
			r.headers.forEach((v, k) => {
				responseHeaders[k] = v;
			});

			if (!r.ok) {
				return {
					url,
					finalUrl,
					body: new Uint8Array(),
					contentType,
					httpStatus: r.status,
					error: `HTTP ${r.status}`,
					headers: responseHeaders,
					durationMs,
					startedAt,
				};
			}
			const body = new Uint8Array(await r.arrayBuffer());
			if (body.byteLength > options.maxBytes) {
				return {
					url,
					finalUrl,
					body: new Uint8Array(),
					contentType,
					httpStatus: r.status,
					error: `body ${body.byteLength}b exceeds maxAssetBytes ${options.maxBytes}`,
					headers: responseHeaders,
					durationMs,
					startedAt,
				};
			}
			return {
				url,
				finalUrl,
				body,
				contentType,
				httpStatus: r.status,
				headers: responseHeaders,
				durationMs,
				startedAt,
			};
		} catch (err) {
			const durationMs = (Bun.nanoseconds() - tStart) / 1e6;
			return {
				url,
				finalUrl: url,
				body: new Uint8Array(),
				contentType: "error",
				httpStatus: 0,
				error: err instanceof Error ? err.message : String(err),
				headers: {},
				durationMs,
				startedAt,
			};
		}
	}

	// Map MirrorProfile to curl-impersonate ImpersonateProfile
	let impersonateProfile: ImpersonateProfile = "chrome131";
	if (options.profile === "stealth" || options.profile === "max") {
		impersonateProfile = "chrome146";
	} else if (options.profile === "fast") {
		impersonateProfile = "chrome110";
	} else if (options.profile === "http" || options.profile === "static") {
		impersonateProfile = "chrome131";
	}

	const client = new ImpersonatedClient({
		profile: impersonateProfile,
		proxy: options.proxy,
		proxyAuth: options.proxyAuth,
		auth: options.auth,
		httpVersion: options.httpVersion,
		verbose: options.verbose,
		sslVerify: !options.insecure,
		timeoutMs: options.timeoutMs,
	});

	try {
		const requestHeaders: Record<string, string> = { "User-Agent": options.ua };
		const cookieHeader = cookieHeaderForHost(
			options.cookieJar,
			new URL(url).hostname,
		);

		const fetchOpts: any = {
			headers: requestHeaders,
			cookies: cookieHeader,
			insecure: options.insecure,
		};

		const r = await client.fetch(url, fetchOpts);
		const durationMs = (Bun.nanoseconds() - tStart) / 1e6;

		let finalUrl = r.effectiveUrl || r.url || url;
		if (finalUrl.startsWith("/")) {
			finalUrl = new URL(finalUrl, url).href;
		}
		const contentType =
			r.headers.get("content-type") ?? "application/octet-stream";

		const responseHeaders: Record<string, string> = {};
		r.headers.forEach((v, k) => {
			responseHeaders[k] = v;
		});

		if (!r.ok) {
			return {
				url,
				finalUrl,
				body: new Uint8Array(),
				contentType,
				httpStatus: r.status,
				error: `HTTP ${r.status}`,
				headers: responseHeaders,
				durationMs,
				startedAt,
			};
		}

		const body = new Uint8Array(await r.arrayBuffer());
		if (body.byteLength > options.maxBytes) {
			return {
				url,
				finalUrl,
				body: new Uint8Array(),
				contentType,
				httpStatus: r.status,
				error: `body ${body.byteLength}b exceeds maxAssetBytes ${options.maxBytes}`,
				headers: responseHeaders,
				durationMs,
				startedAt,
			};
		}
		return {
			url,
			finalUrl,
			body,
			contentType,
			httpStatus: r.status,
			headers: responseHeaders,
			durationMs,
			startedAt,
		};
	} catch (err) {
		const durationMs = (Bun.nanoseconds() - tStart) / 1e6;
		return {
			url,
			finalUrl: url,
			body: new Uint8Array(),
			contentType: "error",
			httpStatus: 0,
			error: err instanceof Error ? err.message : String(err),
			headers: {},
			durationMs,
			startedAt,
		};
	} finally {
		client.close();
	}
}

async function workerPool<T, U>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<U>,
): Promise<U[]> {
	const results: U[] = Array.from({ length: items.length });
	let cursor = 0;
	async function run(): Promise<void> {
		while (cursor < items.length) {
			const i = cursor++;
			results[i] = await worker(items[i]);
		}
	}
	const workers = Array.from({ length: Math.max(1, concurrency) }, () => run());
	await Promise.all(workers);
	return results;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

const DEFAULT_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function mirrorSite(
	seed: string,
	options: MirrorOptions,
): Promise<MirrorManifest> {
	const concurrency = options.concurrency ?? 6;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const maxAssetBytes = options.maxAssetBytes ?? 50_000_000;
	const ua = options.userAgent ?? DEFAULT_UA;
	const log = options.log ?? (() => {});
	const filter = options.filter ?? (() => true);

	const maxPages = options.maxPages ?? (options.recursive ? 100 : 1);
	const maxDepth = options.maxDepth ?? (options.recursive ? 10 : 0);

	const startedAt = new Date().toISOString();
	const t0 = Bun.nanoseconds();
	const seedUrl = new URL(seed);
	const seedHost = seedUrl.hostname;
	const outDir = resolvePath(options.outDir);

	// Load cookie jar once — same-origin fetches reuse it.
	let cookieJar: Cookie[] | undefined;
	if (options.cookies) {
		try {
			cookieJar = await loadCookieJar(options.cookies);
			log(
				`[mirror] loaded ${cookieJar.length} cookies from ${options.cookies}`,
			);
		} catch (err) {
			log(
				`[mirror] cookie load failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const harEntries: HarEntry[] = [];

	// Step 1 — HTML page crawling queue setup.
	const crawledHtml = new Map<string, { html: string; finalUrl: string }>();
	const htmlQueue = new Set<string>();
	const htmlSeen = new Set<string>();
	const htmlDepth = new Map<string, number>();

	htmlQueue.add(seed);
	htmlSeen.add(seed);
	htmlDepth.set(seed, 0);

	// Discover hidden pages via sitemap.xml / robots.txt if requested
	if (options.discoverHidden) {
		log(`[mirror] discovering sitemaps and robots.txt for ${seed}...`);
		try {
			for await (const sUrl of autoDiscoverAndParse(seed, {
				userAgent: ua,
				signal: AbortSignal.timeout(timeoutMs),
			})) {
				const urlStr = sUrl.loc;
				if (!htmlSeen.has(urlStr)) {
					htmlSeen.add(urlStr);
					htmlQueue.add(urlStr);
					htmlDepth.set(urlStr, 0); // Sitemap pages treated as depth 0
				}
			}
			log(`[mirror] sitemaps parsed, total pages in queue: ${htmlQueue.size}`);
		} catch (err) {
			log(`[mirror] sitemap discovery error: ${err}`);
		}
	}

	// Step 2 — Crawl pages concurrently in parallel
	let activeFetches = 0;

	const processNextHtml = async (): Promise<void> => {
		if (htmlQueue.size === 0 || crawledHtml.size >= maxPages) return;

		const url = htmlQueue.values().next().value;
		if (!url) return;
		htmlQueue.delete(url);

		const depth = htmlDepth.get(url) ?? 0;
		if (depth > maxDepth) return;

		activeFetches++;
		try {
			log(`[mirror] crawling page [depth=${depth}] ${url}`);
			const r = await downloadAsset(url, {
				ua,
				timeoutMs,
				cookieJar,
				maxBytes: maxAssetBytes,
				insecure: options.insecure,
				profile: options.profile,
				proxy: options.proxy,
				proxyAuth: options.proxyAuth,
				auth: options.auth,
				httpVersion: options.httpVersion,
				verbose: options.verbose,
			});
			if (options.delayMs && options.delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, options.delayMs));
			}
			harEntries.push(buildHarEntry(url, r, ua));
			if (r.error) {
				log(`[mirror] failed to crawl ${url}: ${r.error}`);
				return;
			}
			const htmlText = new TextDecoder().decode(r.body);
			crawledHtml.set(url, { html: htmlText, finalUrl: r.finalUrl });

			if (
				options.recursive &&
				depth < maxDepth &&
				crawledHtml.size < maxPages
			) {
				const discoveredLinks = discoverHtmlLinks(htmlText, r.finalUrl);
				for (const link of discoveredLinks) {
					if (htmlSeen.has(link)) continue;
					if (crawledHtml.size + htmlQueue.size >= maxPages) continue;

					if (shouldCrawl(link, seedUrl, options)) {
						htmlSeen.add(link);
						htmlQueue.add(link);
						htmlDepth.set(link, depth + 1);
					}
				}
			}
		} catch (err) {
			log(`[mirror] crawl error for ${url}: ${err}`);
		} finally {
			activeFetches--;
		}
	};

	while (
		(htmlQueue.size > 0 || activeFetches > 0) &&
		crawledHtml.size < maxPages
	) {
		const freeSlots = concurrency - activeFetches;
		if (freeSlots > 0 && htmlQueue.size > 0) {
			const promises: Promise<void>[] = [];
			const toFetch = Math.min(freeSlots, htmlQueue.size);
			for (let i = 0; i < toFetch; i++) {
				promises.push(processNextHtml());
			}
			await Promise.all(promises);
		} else {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	log(`[mirror] crawl complete. Crawled ${crawledHtml.size} pages.`);

	// Step 3 — Discover assets from all crawled HTML pages
	const seenAssets = new Set<string>();
	const assetQueue: AssetTask[] = [];

	const enqueueAsset = (task: AssetTask): void => {
		if (seenAssets.has(task.url)) return;
		if (!shouldDownloadAsset(task.url, seedUrl, options)) return;
		if (!filter(task.url, task.sourceTag)) return;
		seenAssets.add(task.url);
		assetQueue.push(task);
	};

	for (const [, pageData] of crawledHtml) {
		for (const t of discoverHtmlAssets(pageData.html, pageData.finalUrl)) {
			enqueueAsset(t);
		}
	}
	log(`[mirror] discovered ${assetQueue.length} assets to download`);

	// Step 4 — Download all assets concurrently with a worker pool.
	const records = new Map<string, MirrorAssetRecord>();
	while (assetQueue.length > 0) {
		const batch = assetQueue.splice(0, assetQueue.length); // drain current
		const results = await workerPool(batch, concurrency, (t) =>
			downloadAsset(t.url, {
				ua,
				timeoutMs,
				cookieJar,
				maxBytes: maxAssetBytes,
				insecure: options.insecure,
				profile: options.profile,
				proxy: options.proxy,
				proxyAuth: options.proxyAuth,
				auth: options.auth,
				httpVersion: options.httpVersion,
				verbose: options.verbose,
			}),
		);
		for (let i = 0; i < batch.length; i++) {
			const t = batch[i];
			const r = results[i];
			harEntries.push(buildHarEntry(t.url, r, ua));
			const localPath = mapUrlToLocalPath(
				r.finalUrl,
				outDir,
				seedHost,
				options,
			);
			const sha256 =
				r.body.byteLength > 0
					? new Bun.CryptoHasher("sha256").update(r.body).digest("hex")
					: undefined;
			records.set(r.url, {
				url: r.url,
				finalUrl: r.finalUrl,
				localPath,
				relativePath: relativePath(outDir, localPath),
				sourceTag: t.sourceTag,
				contentType: r.contentType,
				bytes: r.body.byteLength,
				httpStatus: r.httpStatus,
				sha256,
				error: r.error,
			});

			if (r.error) continue;

			// Recurse into CSS to discover nested assets.
			if (r.contentType.includes("css") || t.url.endsWith(".css")) {
				const cssText = new TextDecoder().decode(r.body);
				for (const u of extractCssUrls(cssText)) {
					try {
						enqueueAsset({
							url: new URL(u, r.finalUrl).href,
							sourceTag: "css-url",
						});
					} catch {
						// ignore
					}
				}
			}

			// Persist raw bytes (rewritten in step 5).
			await Bun.write(localPath, r.body);
		}
		log(
			`[mirror] downloaded ${batch.length} assets, queue=${assetQueue.length}, total=${records.size}`,
		);
	}

	// Step 5 — Rewrite links inside HTML + CSS files.
	const urlToLocal = new Map<string, string>();
	for (const [url, pageData] of crawledHtml) {
		const localPath = mapUrlToLocalPath(
			pageData.finalUrl,
			outDir,
			seedHost,
			options,
		);
		urlToLocal.set(url, localPath);
		urlToLocal.set(pageData.finalUrl, localPath);
	}
	for (const [url, rec] of records) {
		if (!rec.error) {
			urlToLocal.set(url, rec.localPath);
			urlToLocal.set(rec.finalUrl, rec.localPath);
		}
	}

	// Rewrite HTML pages
	let rewrittenHtmlCount = 0;
	const htmlPromises: Promise<void>[] = [];
	for (const [, pageData] of crawledHtml) {
		const localPath = mapUrlToLocalPath(
			pageData.finalUrl,
			outDir,
			seedHost,
			options,
		);
		const rewrittenHtml = rewriteHtmlLinks(
			pageData.html,
			pageData.finalUrl,
			urlToLocal,
			localPath,
		);
		htmlPromises.push(
			(async () => {
				await Bun.write(localPath, rewrittenHtml);
				if (options.compress && isCompressible(localPath)) {
					await compressFile(localPath);
				}
			})(),
		);
		rewrittenHtmlCount++;
	}
	await Promise.all(htmlPromises);
	log(`[mirror] rewrote and wrote ${rewrittenHtmlCount} HTML files`);

	// CSS rewrite pass
	let cssRewritten = 0;
	const cssPromises: Promise<void>[] = [];
	for (const rec of records.values()) {
		if (rec.error) continue;
		if (!(rec.contentType.includes("css") || rec.url.endsWith(".css")))
			continue;
		cssPromises.push(
			(async () => {
				const css = await Bun.file(rec.localPath).text();
				const next = rewriteCssLinks(
					css,
					rec.finalUrl,
					urlToLocal,
					rec.localPath,
				);
				if (next !== css) {
					await Bun.write(rec.localPath, next);
					cssRewritten++;
				}
				if (options.compress && isCompressible(rec.localPath)) {
					await compressFile(rec.localPath);
				}
			})(),
		);
	}
	await Promise.all(cssPromises);
	log(`[mirror] rewrote ${cssRewritten} CSS files`);

	// Pre-compress remaining assets if compress is true
	if (options.compress) {
		const compressPromises: Promise<void>[] = [];
		for (const rec of records.values()) {
			if (rec.error) continue;
			if (rec.contentType.includes("css") || rec.url.endsWith(".css")) continue;
			if (isCompressible(rec.localPath)) {
				compressPromises.push(compressFile(rec.localPath));
			}
		}
		await Promise.all(compressPromises);
		log(`[mirror] compressed remaining text assets`);
	}

	// Step 6 — manifest
	const completedAt = new Date().toISOString();
	const failed = [...records.values()].filter((r) => r.error).length;
	const htmlBytesSum = [...crawledHtml.values()].reduce(
		(acc, p) => acc + p.html.length,
		0,
	);
	const assetBytesSum = [...records.values()].reduce(
		(acc, r) => acc + r.bytes,
		0,
	);
	const totalBytes = htmlBytesSum + assetBytesSum;

	const seedLocal = mapUrlToLocalPath(seed, outDir, seedHost, options);
	const manifest: MirrorManifest = {
		seed,
		rootHtmlPath: relativePath(outDir, seedLocal),
		startedAt,
		completedAt,
		durationMs: (Bun.nanoseconds() - t0) / 1e6,
		totalAssets: records.size + crawledHtml.size,
		totalBytes,
		failed,
		assets: [
			...[...crawledHtml.keys()].map((url) => {
				const localPath = mapUrlToLocalPath(url, outDir, seedHost, options);
				return {
					url,
					finalUrl: crawledHtml.get(url)!.finalUrl,
					localPath,
					relativePath: relativePath(outDir, localPath),
					sourceTag: "html-crawler",
					contentType: "text/html",
					bytes: crawledHtml.get(url)!.html.length,
					httpStatus: 200,
				};
			}),
			...records.values(),
		].sort((a, b) => a.url.localeCompare(b.url)),
	};

	await Bun.write(
		resolvePath(outDir, "manifest.json"),
		JSON.stringify(manifest, null, 2),
	);
	log(`[mirror] manifest → ${outDir}/manifest.json`);

	if (options.har) {
		const harLog: HarLog = {
			version: "1.2",
			creator: { name: "Bxc", version: "0.1.0" },
			browser: { name: "Bxc", version: "0.1.0" },
			pages: [
				{
					startedDateTime: startedAt,
					id: "mirror_1",
					title: `Mirror of ${seed}`,
					pageTimings: { onContentLoad: -1, onLoad: -1 },
				},
			],
			entries: harEntries,
		};
		await Bun.write(
			resolvePath(options.har),
			JSON.stringify({ log: harLog }, null, 2),
		);
		log(`[mirror] HAR log saved to ${options.har}`);
	}

	return manifest;
}
