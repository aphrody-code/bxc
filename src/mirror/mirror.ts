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
 * Site mirror — downloads the full HTML/CSS/JS/asset graph of a single
 * page, rewrites URLs to local relative paths, and produces a
 * self-contained directory that opens in a browser via `file://`.
 *
 * Pipeline :
 *
 *   1. Fetch the seed URL via the user-selected bxc profile
 *      (default: `http` + curl-impersonate Chrome 131 + cookie jar).
 *      This bypasses Cloudflare Managed Challenge when cookies are
 *      provided, and produces a TLS / JA4 fingerprint that matches a
 *      real Chrome browser.
 *
 *   2. Walk the HTML with `Bun.HTMLRewriter` (lol-html, streaming) to
 *      extract every asset URL from `<link>`, `<script>`, `<img>`,
 *      `<source>`, `<video>`, `<audio>`, `<iframe>`, `<object>`, `<embed>`,
 *      `srcset` attributes, plus `style` attributes containing `url(...)`.
 *
 *   3. Concurrently download every asset, with a configurable worker
 *      pool. Each asset is also walked when it's a CSS file — `url(...)`
 *      and `@import` references are extracted and queued recursively.
 *
 *   4. Rewrite every URL in the HTML and CSS files to a relative path
 *      pointing at the local copy. Absolute paths to the same origin
 *      are also localised so the mirror is fully relocatable.
 *
 *   5. Emit `manifest.json` listing every asset (URL, local path, bytes,
 *      sha256, content-type, http-status, source-of-discovery).
 *
 * The mirror works on any site bxc can reach :
 *   - Static HTML / classic websites : trivial.
 *   - Cloudflare-gated sites : pass `cookies` (cf_clearance + session).
 *   - SPAs : pre-render via `profile: "fast"` (Lightpanda) — the mirror
 *     captures the post-hydration DOM, not the empty shell.
 *
 * Bun-native only : `Bun.HTMLRewriter`, `Bun.file`, `Bun.write`,
 * `Bun.CryptoHasher`, `Bun.Glob`, `fetch` global.
 */

import { dirname, relative as relativePath, resolve as resolvePath } from "node:path";
import { Browser } from "../api/browser.ts";
import type { AnyPage } from "../api/types.ts";
import { type Cookie, loadCookieJar } from "../cookies/cookie-loader.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MirrorProfile = "static" | "fast" | "http";

export interface MirrorOptions {
	/** Output directory — created if missing. */
	outDir: string;
	/** Bxc profile used to fetch the seed page (default: `"http"`). */
	profile?: MirrorProfile;
	/** Cookie jar path passed to bxc (Playwright/CDP/Netscape JSON). */
	cookies?: string;
	/** Concurrent asset downloads (default: 6). */
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
// URL → local path mapping
// ---------------------------------------------------------------------------

/**
 * Maps an absolute URL to a relocatable local path under `outDir`.
 * Same origin → `<host>/<path>`. Cross-origin → `_external/<host>/<path>`.
 * Query strings become a `__qhash` segment so different query variants
 * coexist on disk.
 */
function mapUrlToLocalPath(url: string, outDir: string, seedHost: string): string {
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
	const sameOrigin = u.hostname === seedHost;
	const root = sameOrigin ? u.hostname : `_external/${u.hostname}`;
	return resolvePath(outDir, root, pathname);
}

function simpleHash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// HTML asset extraction (HTMLRewriter)
// ---------------------------------------------------------------------------

interface AssetTask {
	url: string;
	sourceTag: string;
}

// Only `<link>` rels that load actual assets are captured. SEO/navigation
// rels (`alternate`, `canonical`, `next`, `prev`, `dns-prefetch`,
// `preconnect`, `author`, `license`, `me`, `bookmark`, `pingback`,
// `prerender`, `search`) do not produce a downloadable resource and
// trigger Cloudflare 403s on every variant — we ignore them.
const HTML_ASSET_SELECTORS: Array<{ selector: string; attr: string; tag: string }> = [
	{ selector: "link[rel~='stylesheet'][href]", attr: "href", tag: "link-css" },
	{ selector: "link[rel~='icon'][href]", attr: "href", tag: "link-icon" },
	{ selector: "link[rel='shortcut icon'][href]", attr: "href", tag: "link-icon" },
	{ selector: "link[rel='apple-touch-icon'][href]", attr: "href", tag: "link-icon" },
	{
		selector: "link[rel='apple-touch-icon-precomposed'][href]",
		attr: "href",
		tag: "link-icon",
	},
	{ selector: "link[rel='mask-icon'][href]", attr: "href", tag: "link-icon" },
	{ selector: "link[rel='manifest'][href]", attr: "href", tag: "link-manifest" },
	{ selector: "link[rel='preload'][href]", attr: "href", tag: "link-preload" },
	{ selector: "link[rel='modulepreload'][href]", attr: "href", tag: "link-modulepreload" },
	{ selector: "link[rel='prefetch'][href]", attr: "href", tag: "link-prefetch" },
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
	for (const m of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g)) {
		const v = m[1] ?? m[2] ?? m[3];
		if (v && !v.startsWith("data:")) out.add(v);
	}
	for (const m of css.matchAll(/@import\s+(?:url\()?\s*(?:"([^"]+)"|'([^']+)')\s*\)?/g)) {
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
			raw.startsWith("mailto:")
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
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor }).HTMLRewriter;
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
	// Inline `style="background:url(...)"`
	rw.on("[style]", {
		element(el) {
			const s = el.getAttribute("style") ?? "";
			for (const u of extractCssUrls(s)) push(u, "inline-style");
		},
	});
	rw.transform(html);
	return tasks;
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
			raw.startsWith("mailto:")
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
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor }).HTMLRewriter;
	if (!Rewriter) {
		// Fallback : naive replace
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
	let out = css.replace(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g, (_full, a, b, c) => {
		const v = a ?? b ?? c;
		return `url("${remap(v)}")`;
	});
	out = out.replace(/@import\s+(?:url\()?\s*(?:"([^"]+)"|'([^']+)')\s*\)?\s*;?/g, (full, a, b) => {
		const v = a ?? b;
		const r = remap(v);
		return `@import "${r}";`;
	});
	return out;
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
}

function cookieHeaderForHost(jar: Cookie[] | undefined, host: string): string | undefined {
	if (!jar || jar.length === 0) return undefined;
	const matches: string[] = [];
	for (const c of jar) {
		const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
		const hostMatch = host === cookieDomain || host.endsWith("." + cookieDomain);
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
	},
): Promise<DownloadedAsset> {
	try {
		const headers: Record<string, string> = { "User-Agent": options.ua };
		const cookieHeader = cookieHeaderForHost(options.cookieJar, new URL(url).hostname);
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
		let finalUrl = r.url;
		if (finalUrl.startsWith("/")) {
			finalUrl = new URL(finalUrl, url).href;
		}
		const contentType = r.headers.get("content-type") ?? "application/octet-stream";
		if (!r.ok) {
			return {
				url,
				finalUrl,
				body: new Uint8Array(),
				contentType,
				httpStatus: r.status,
				error: `HTTP ${r.status}`,
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
			};
		}
		return { url, finalUrl, body, contentType, httpStatus: r.status };
	} catch (err) {
		return {
			url,
			finalUrl: url,
			body: new Uint8Array(),
			contentType: "error",
			httpStatus: 0,
			error: err instanceof Error ? err.message : String(err),
		};
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

// Chrome 131 stable Linux UA so our asset fetches blend with the seed page
// (which was opened by curl-impersonate `chrome131`). Cloudflare-gated
// hosts compare the UA fingerprint against the cf_clearance cookie ; a
// mismatch yields 403 even with valid cookies.
const DEFAULT_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function mirrorSite(seed: string, options: MirrorOptions): Promise<MirrorManifest> {
	const profile: MirrorProfile = options.profile ?? "http";
	const concurrency = options.concurrency ?? 6;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const sameOriginOnly = options.sameOriginOnly ?? false;
	const maxAssetBytes = options.maxAssetBytes ?? 50_000_000;
	const ua = options.userAgent ?? DEFAULT_UA;
	const log = options.log ?? (() => {});
	const filter = options.filter ?? (() => true);

	const startedAt = new Date().toISOString();
	const t0 = Bun.nanoseconds();
	const seedUrl = new URL(seed);
	const seedHost = seedUrl.hostname;
	const outDir = resolvePath(options.outDir);

	// Load cookie jar once — same-origin asset fetches reuse it.
	let cookieJar: Cookie[] | undefined;
	if (options.cookies) {
		try {
			cookieJar = await loadCookieJar(options.cookies);
			log(`[mirror] loaded ${cookieJar.length} cookies from ${options.cookies}`);
		} catch (err) {
			log(`[mirror] cookie load failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Step 1 — fetch the seed via the chosen bxc profile.
	let seedHtml = "";
	let seedFinalUrl = seed;
	let seedStatus = 0;
	let page: AnyPage | undefined;
	try {
		page = await Browser.newPage({
			profile,
			cookies: options.cookies,
			httpOpts: { profile: "chrome131" },
		});
		const nav = await page.goto(seed, { timeoutMs });
		seedFinalUrl = page.url();
		seedStatus = nav.status;
		seedHtml = await page.content().catch(() => "");
	} finally {
		try {
			await page?.close();
		} catch {
			// ignore
		}
		await Browser.close().catch(() => undefined);
	}
	log(`[mirror] seed ${seedStatus} ${seedHtml.length}b ${seedFinalUrl}`);

	// Step 2 — discover assets in the seed HTML.
	const seen = new Set<string>();
	const queue: AssetTask[] = [];
	const enqueue = (task: AssetTask): void => {
		if (seen.has(task.url)) return;
		if (sameOriginOnly && new URL(task.url).hostname !== seedHost) return;
		if (!filter(task.url, task.sourceTag)) return;
		seen.add(task.url);
		queue.push(task);
	};
	for (const t of discoverHtmlAssets(seedHtml, seedFinalUrl)) enqueue(t);
	log(`[mirror] discovered ${queue.length} assets in seed HTML`);

	// Step 3 — download with a fixed worker pool. CSS files are re-walked for
	// nested url(...) and @import.
	const records = new Map<string, MirrorAssetRecord>();
	while (queue.length > 0) {
		const batch = queue.splice(0, queue.length); // drain current
		const results = await workerPool(batch, concurrency, (t) =>
			downloadAsset(t.url, {
				ua,
				timeoutMs,
				cookieJar,
				maxBytes: maxAssetBytes,
				insecure: options.insecure,
			}),

		);
		for (let i = 0; i < batch.length; i++) {
			const t = batch[i];
			const r = results[i];
			const localPath = mapUrlToLocalPath(r.finalUrl, outDir, seedHost);
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

			// Recurse into CSS to discover nested assets BEFORE writing.
			if (r.contentType.includes("css") || t.url.endsWith(".css")) {
				const cssText = new TextDecoder().decode(r.body);
				for (const u of extractCssUrls(cssText)) {
					try {
						enqueue({ url: new URL(u, r.finalUrl).href, sourceTag: "css-url" });
					} catch {
						// skip
					}
				}
			}

			// Persist raw bytes (links rewritten in step 4).
			await Bun.write(localPath, r.body);
		}
		log(`[mirror] downloaded ${batch.length} assets, queue=${queue.length}, total=${records.size}`);
	}

	// Step 4 — rewrite links inside HTML + CSS files.
	const urlToLocal = new Map<string, string>();
	urlToLocal.set(seedFinalUrl, mapUrlToLocalPath(seedFinalUrl, outDir, seedHost));
	for (const [url, rec] of records) {
		if (!rec.error) urlToLocal.set(url, rec.localPath);
	}

	// Seed HTML rewrite + write
	const seedLocal = mapUrlToLocalPath(seedFinalUrl, outDir, seedHost);
	const rewrittenHtml = rewriteHtmlLinks(seedHtml, seedFinalUrl, urlToLocal, seedLocal);
	await Bun.write(seedLocal, rewrittenHtml);
	log(`[mirror] seed written → ${seedLocal}`);

	// CSS rewrite pass
	let cssRewritten = 0;
	for (const rec of records.values()) {
		if (rec.error) continue;
		if (!(rec.contentType.includes("css") || rec.url.endsWith(".css"))) continue;
		const css = await Bun.file(rec.localPath).text();
		const next = rewriteCssLinks(css, rec.finalUrl, urlToLocal, rec.localPath);
		if (next !== css) {
			await Bun.write(rec.localPath, next);
			cssRewritten++;
		}
	}
	log(`[mirror] rewrote ${cssRewritten} CSS files`);

	// Step 5 — manifest
	const completedAt = new Date().toISOString();
	const failed = [...records.values()].filter((r) => r.error).length;
	const totalBytes = [...records.values()].reduce((acc, r) => acc + r.bytes, 0);
	const manifest: MirrorManifest = {
		seed,
		rootHtmlPath: relativePath(outDir, seedLocal),
		startedAt,
		completedAt,
		durationMs: (Bun.nanoseconds() - t0) / 1e6,
		totalAssets: records.size,
		totalBytes,
		failed,
		assets: [...records.values()].sort((a, b) => a.url.localeCompare(b.url)),
	};
	await Bun.write(resolvePath(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
	log(`[mirror] manifest → ${outDir}/manifest.json`);
	return manifest;
}
