/**
 * @module test/e2e/discover-pages
 *
 * Discovers all crawlable URLs for a given origin, used by the rosegriffon
 * and azalee E2E full-crawl suites.
 *
 * Strategy:
 *   1. Try the well-known sitemap paths (`/sitemap.xml`, `/sitemap_index.xml`,
 *      `/sitemaps.xml`). The first one that yields URLs wins.
 *   2. Fall back to a small breadth-first crawl from `/` (depth=2, max 50 pages,
 *      same-origin only) when no sitemap is reachable.
 *   3. Filter the result against `robots.txt` for the wildcard agent so we
 *      respect Disallow directives.
 *   4. Cache the final array as JSON in `test/e2e/fixtures/sitemaps/<host>-<date>.json`
 *      so the suite can run offline once warmed.
 *
 * The fallback BFS uses Bun-native `fetch` and a tolerant HTML link extractor
 * (regex-based) — we do not need a full browser for href harvesting and this
 * keeps the helper independent from the subprocesses being tested.
 */

import { collectSitemapUrls, type SitemapUrl } from "../../src/utils/sitemap.ts";
import { RobotsFile } from "../../src/utils/robots.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
	/** Override the cache filename (defaults to `<host>-<YYYY-MM-DD>.json`). */
	cacheFile?: string;
	/** Skip writing the cache to disk. */
	noCache?: boolean;
	/** Read from the cache only — never hit the network. */
	cacheOnly?: boolean;
	/** Max URLs to keep in the final array (sample-down for big sitemaps). */
	maxPages?: number;
	/** User-agent string sent on all probe requests. */
	userAgent?: string;
	/** Timeout per request, in ms. Default 10 000. */
	requestTimeoutMs?: number;
}

export interface DiscoverResult {
	origin: string;
	urls: string[];
	source: "sitemap" | "bfs" | "cache";
	robotsAllowed: number;
	robotsDisallowed: number;
	cacheFile: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = `${import.meta.dir}/fixtures/sitemaps`;
const TODAY_ISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function hostFromOrigin(origin: string): string {
	return new URL(origin).host;
}

function cachePathFor(origin: string, override?: string): string {
	if (override) return override;
	const host = hostFromOrigin(origin);
	return `${FIXTURES_DIR}/${host}-${TODAY_ISO}.json`;
}

interface CacheFile {
	origin: string;
	discoveredAt: string;
	source: DiscoverResult["source"];
	urls: string[];
}

async function readCache(file: string): Promise<CacheFile | null> {
	const f = Bun.file(file);
	if (!(await f.exists())) return null;
	try {
		const data = (await f.json()) as CacheFile;
		if (Array.isArray(data.urls) && typeof data.origin === "string") return data;
		return null;
	} catch {
		return null;
	}
}

async function writeCache(file: string, data: CacheFile): Promise<void> {
	await Bun.write(file, JSON.stringify(data, null, 2));
}

function uniq<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

// ---------------------------------------------------------------------------
// Sitemap discovery
// ---------------------------------------------------------------------------

const SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemaps.xml"] as const;

async function trySitemap(
	origin: string,
	userAgent: string,
	signal: AbortSignal,
): Promise<string[]> {
	const base = new URL(origin);
	for (const path of SITEMAP_PATHS) {
		const url = `${base.protocol}//${base.host}${path}`;
		try {
			const urls = await collectSitemapUrls(url, {
				userAgent,
				signal,
				maxDepth: 3,
				maxUrls: 1000,
			});
			if (urls.length > 0) return urls.map((u: SitemapUrl) => u.loc);
		} catch {
			// Try next candidate.
		}
	}
	return [];
}

// ---------------------------------------------------------------------------
// BFS fallback
// ---------------------------------------------------------------------------

const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;

function extractLinks(html: string, base: string): string[] {
	const out: string[] = [];
	let match: RegExpExecArray | null;
	HREF_RE.lastIndex = 0;
	while ((match = HREF_RE.exec(html)) !== null) {
		try {
			const u = new URL(match[1], base);
			if (u.protocol === "http:" || u.protocol === "https:") out.push(u.toString());
		} catch {
			// ignore malformed href
		}
	}
	return out;
}

interface BfsOptions {
	maxDepth: number;
	maxPages: number;
	userAgent: string;
	requestTimeoutMs: number;
}

async function bfsCrawl(origin: string, opts: BfsOptions): Promise<string[]> {
	const baseHost = hostFromOrigin(origin);
	const queue: Array<{ url: string; depth: number }> = [{ url: origin, depth: 0 }];
	const seen = new Set<string>([origin]);

	while (queue.length > 0 && seen.size < opts.maxPages) {
		const item = queue.shift();
		if (!item) break;
		if (item.depth > opts.maxDepth) continue;

		try {
			const res = await fetch(item.url, {
				headers: { "User-Agent": opts.userAgent, Accept: "text/html,*/*" },
				signal: AbortSignal.timeout(opts.requestTimeoutMs),
				redirect: "follow",
			});
			if (!res.ok) continue;
			const ct = res.headers.get("content-type") ?? "";
			if (!ct.includes("html")) continue;
			const html = await res.text();

			for (const link of extractLinks(html, item.url)) {
				try {
					const u = new URL(link);
					// strip fragment for dedup
					u.hash = "";
					const norm = u.toString();
					if (u.host !== baseHost) continue;
					if (seen.has(norm)) continue;
					seen.add(norm);
					if (seen.size >= opts.maxPages) break;
					queue.push({ url: norm, depth: item.depth + 1 });
				} catch {
					// skip malformed
				}
			}
		} catch {
			// best-effort, continue with the next URL
		}
	}

	return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover crawlable URLs for `origin`.
 *
 * Workflow:
 *   - read cache if present (and `cacheOnly` or fresh same-day)
 *   - else fetch sitemap(s); on empty result fall back to BFS
 *   - filter via robots.txt
 *   - sample-down to `maxPages` if needed (keep home, then evenly spaced indices)
 *   - persist the final list
 */
export async function discoverPages(
	origin: string,
	opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
	const userAgent = opts.userAgent ?? "Bunlight-E2E/1.0 (+https://github.com/bunmium/bunlight)";
	const requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
	const cacheFile = cachePathFor(origin, opts.cacheFile);

	// 1. cache hit?
	const cached = await readCache(cacheFile);
	if (cached && (opts.cacheOnly || cached.urls.length > 0)) {
		return {
			origin,
			urls: cached.urls,
			source: "cache",
			robotsAllowed: cached.urls.length,
			robotsDisallowed: 0,
			cacheFile,
		};
	}
	if (opts.cacheOnly) {
		throw new Error(`discoverPages: cacheOnly=true but no cache at ${cacheFile}`);
	}

	const signal = AbortSignal.timeout(requestTimeoutMs * 6);

	// 2. sitemap first
	let urls = await trySitemap(origin, userAgent, signal);
	let source: DiscoverResult["source"] = "sitemap";

	// 3. fallback BFS
	if (urls.length === 0) {
		urls = await bfsCrawl(origin, {
			maxDepth: 2,
			maxPages: 50,
			userAgent,
			requestTimeoutMs,
		});
		source = "bfs";
	}

	urls = uniq(urls);

	// 4. robots filter
	const robots = await RobotsFile.fetch(origin, { userAgent, timeoutMs: requestTimeoutMs });
	const allowed: string[] = [];
	let disallowed = 0;
	for (const u of urls) {
		if (robots.isAllowed(u, "*")) allowed.push(u);
		else disallowed++;
	}

	// 5. sample-down if too many: keep home, then take every Nth across the rest.
	const maxPages = opts.maxPages ?? 30;
	let final = allowed;
	if (allowed.length > maxPages) {
		const home = allowed[0];
		const rest = allowed.slice(1);
		const step = Math.max(1, Math.floor(rest.length / (maxPages - 1)));
		const sampled: string[] = [home];
		for (let i = 0; i < rest.length && sampled.length < maxPages; i += step) {
			sampled.push(rest[i]);
		}
		final = sampled;
	}

	// 6. cache
	if (!opts.noCache) {
		await writeCache(cacheFile, {
			origin,
			discoveredAt: new Date().toISOString(),
			source,
			urls: final,
		});
	}

	return {
		origin,
		urls: final,
		source,
		robotsAllowed: allowed.length,
		robotsDisallowed: disallowed,
		cacheFile,
	};
}

// ---------------------------------------------------------------------------
// CLI usage: `bun run test/e2e/discover-pages.ts <origin> [maxPages]`
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const origin = process.argv[2];
	const maxArg = process.argv[3];
	if (!origin) {
		console.error("usage: bun run test/e2e/discover-pages.ts <origin> [maxPages]");
		process.exit(1);
	}
	const result = await discoverPages(origin, {
		maxPages: maxArg ? Number(maxArg) : 30,
	});
	console.log(`origin=${result.origin}`);
	console.log(`source=${result.source}`);
	console.log(
		`urls=${result.urls.length}  allowed=${result.robotsAllowed}  disallowed=${result.robotsDisallowed}`,
	);
	console.log(`cache=${result.cacheFile}`);
	for (const u of result.urls) console.log(`  ${u}`);
}
