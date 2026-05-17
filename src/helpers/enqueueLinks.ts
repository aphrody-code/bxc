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
 * @module bunlight/helpers/enqueueLinks
 *
 * Helper that extracts anchor hrefs from a page and enqueues them into a
 * RequestQueue, with optional filtering by domain strategy, glob patterns,
 * regexps, and a user-supplied transform function.
 *
 * Inspired by Crawlee's `enqueueLinks` utility but rewritten Bun-native:
 * glob matching uses `Bun.Glob`, URL parsing uses the global `URL` API.
 *
 * @example
 * ```ts
 * import { Browser } from "bunlight/api/browser";
 * import { RequestQueue } from "bunlight/queue/RequestQueue";
 * import { enqueueLinks } from "bunlight/helpers/enqueueLinks";
 *
 * const queue = RequestQueue.open(":memory:");
 * const page = await Browser.newPage({ profile: "static" });
 * await page.goto("https://google.com");
 *
 * const { added, skipped } = await enqueueLinks({ page, queue });
 * console.log(`Added ${added}, skipped ${skipped}`);
 * ```
 */

import type { AnyPage } from "../api/types.ts";
import type { RequestQueue } from "../queue/RequestQueue.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Filtering strategy controlling which links are eligible for enqueueing.
 *
 * - `"same-hostname"` (default) — only links whose `hostname` matches the
 *   current page's hostname. Sub-domains are treated as different hostnames
 *   (e.g., `sub.google.com` !== `google.com`).
 * - `"same-domain"` — relaxed: allows any hostname that ends with the same
 *   registrable domain (eTLD+1). E.g., `sub.google.com` is accepted when
 *   the base page is `google.com`.
 * - `"all"` — no domain restriction; any absolute HTTP/HTTPS link passes.
 */
export type EnqueueLinksStrategy = "same-domain" | "same-hostname" | "all";

/**
 * Options accepted by {@link enqueueLinks}.
 */
export interface EnqueueLinksOptions {
	/** The page to extract links from. */
	page: AnyPage;
	/** The destination queue. */
	queue: RequestQueue;
	/**
	 * CSS selector used to find anchor elements.
	 * Defaults to `"a[href]"`.
	 */
	selector?: string;
	/**
	 * Base URL used to resolve relative hrefs.
	 * Defaults to `page.url()`.
	 */
	baseUrl?: string;
	/**
	 * Glob patterns (e.g., `"https://google.com/**"`) — a link must match
	 * at least one pattern to be enqueued.  When empty or omitted, no glob
	 * filtering is applied.
	 *
	 * Uses `Bun.Glob` internally.
	 */
	globs?: string[];
	/**
	 * Regular expressions — a link must match at least one regexp to be
	 * enqueued.  Takes precedence over `globs` when both are supplied
	 * (i.e., `globs` is ignored if `regexps` is non-empty).
	 */
	regexps?: RegExp[];
	/**
	 * Maximum number of links to enqueue in a single call.
	 * Links are evaluated in document order; surplus links are skipped.
	 * Defaults to `Infinity`.
	 */
	limit?: number;
	/**
	 * User-defined transform/filter applied after strategy + pattern
	 * filtering.  Receives the absolute URL string.  Return:
	 * - A (possibly modified) URL string to enqueue that URL.
	 * - `null` to discard the link.
	 */
	transform?: (url: string) => string | null;
	/**
	 * Domain filtering strategy.  Defaults to `"same-hostname"`.
	 */
	strategy?: EnqueueLinksStrategy;
}

/**
 * Result returned by {@link enqueueLinks}.
 */
export interface EnqueueLinksResult {
	/** Number of unique links newly added to the queue. */
	added: number;
	/** Number of links that were extracted but not enqueued (filtered or duplicate). */
	skipped: number;
}

// ---------------------------------------------------------------------------
// Glob cache — avoids re-compiling the same pattern on each call
// ---------------------------------------------------------------------------

const globCache = new Map<string, InstanceType<typeof Bun.Glob>>();

function getGlob(pattern: string): InstanceType<typeof Bun.Glob> {
	let g = globCache.get(pattern);
	if (!g) {
		g = new Bun.Glob(pattern);
		globCache.set(pattern, g);
	}
	return g;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Returns the "registrable domain" portion of a hostname:
 * the last two labels joined by a dot (e.g., `sub.google.com` -> `google.com`).
 *
 * This is a heuristic eTLD+1 approximation sufficient for most use cases.
 * It does not handle multi-label public suffixes (e.g., `co.uk`).
 */
function registrableDomain(hostname: string): string {
	const parts = hostname.split(".");
	if (parts.length <= 2) return hostname;
	return parts.slice(-2).join(".");
}

/**
 * Attempt to construct an absolute URL from `href` and `base`.
 * Returns `null` for non-HTTP/HTTPS schemes or malformed inputs.
 */
function resolveHref(href: string, base: string): string | null {
	// Skip obviously non-navigable schemes immediately (avoids URL constructor cost)
	const lower = href.trimStart().toLowerCase();
	if (
		lower.startsWith("javascript:") ||
		lower.startsWith("mailto:") ||
		lower.startsWith("tel:") ||
		lower.startsWith("data:") ||
		lower.startsWith("#")
	) {
		return null;
	}

	try {
		const resolved = new URL(href, base);
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
		// Strip fragment — fragments are never meaningful for crawling
		resolved.hash = "";
		return resolved.href;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Returns `true` if `url` matches at least one of the provided patterns.
 * Glob matching is performed via `Bun.Glob`.
 */
function matchesGlob(url: string, globs: string[]): boolean {
	for (const pattern of globs) {
		if (getGlob(pattern).match(url)) return true;
	}
	return false;
}

function matchesRegexp(url: string, regexps: RegExp[]): boolean {
	for (const re of regexps) {
		if (re.test(url)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Handle-like interface (minimal subset returned by Page.$$)
// ---------------------------------------------------------------------------

interface ElementHandle {
	getAttribute(name: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Main implementation
// ---------------------------------------------------------------------------

/**
 * Extracts all anchor hrefs from `opts.page` matching `opts.selector`,
 * resolves them to absolute URLs, filters them, and enqueues the accepted
 * ones into `opts.queue`.
 *
 * Deduplication is delegated to `RequestQueue.addRequest()` which ignores
 * URLs already tracked via a UNIQUE constraint on `unique_key`.
 *
 * @returns An object `{ added, skipped }` with the enqueue outcome counts.
 */
export async function enqueueLinks(opts: EnqueueLinksOptions): Promise<EnqueueLinksResult> {
	const {
		page,
		queue,
		selector = "a[href]",
		baseUrl: explicitBase,
		globs = [],
		regexps = [],
		limit = Infinity,
		transform,
		strategy = "same-hostname",
	} = opts;

	// Determine base URL for resolving relative hrefs
	const base = explicitBase ?? page.url();

	// Parse base URL once for strategy comparison
	let baseHostname = "";
	let baseDomain = "";
	try {
		const parsedBase = new URL(base);
		baseHostname = parsedBase.hostname;
		baseDomain = registrableDomain(parsedBase.hostname);
	} catch {
		// base might be "about:blank" or empty — strategy filtering is then skipped
	}

	// Decide which pattern filter to use (regexps take precedence over globs)
	const useRegexps = regexps.length > 0;
	const useGlobs = !useRegexps && globs.length > 0;

	// Query all matching elements
	const handles = (await page.$$(selector)) as unknown as ElementHandle[];

	let added = 0;
	let skipped = 0;
	const seen = new Set<string>(); // session-level dedup before hitting SQLite

	for (const handle of handles) {
		if (added >= limit) {
			skipped++;
			continue;
		}

		// Extract href attribute
		let href: string | null = null;
		try {
			href = await handle.getAttribute("href");
		} catch {
			skipped++;
			continue;
		}
		if (!href) {
			skipped++;
			continue;
		}

		// Resolve to absolute URL
		const resolved = resolveHref(href, base);
		if (!resolved) {
			skipped++;
			continue;
		}

		// Strategy filtering
		if (strategy !== "all" && baseHostname) {
			try {
				const u = new URL(resolved);
				if (strategy === "same-hostname") {
					if (u.hostname !== baseHostname) {
						skipped++;
						continue;
					}
				} else {
					// "same-domain"
					if (registrableDomain(u.hostname) !== baseDomain) {
						skipped++;
						continue;
					}
				}
			} catch {
				skipped++;
				continue;
			}
		}

		// Pattern filtering (regexps OR globs, not both)
		if (useRegexps && !matchesRegexp(resolved, regexps)) {
			skipped++;
			continue;
		}
		if (useGlobs && !matchesGlob(resolved, globs)) {
			skipped++;
			continue;
		}

		// User transform
		const finalUrl = transform ? transform(resolved) : resolved;
		if (finalUrl === null) {
			skipped++;
			continue;
		}

		// Session-level dedup (avoids repeated SQLite roundtrips for the same URL)
		if (seen.has(finalUrl)) {
			skipped++;
			continue;
		}
		seen.add(finalUrl);

		// Enqueue — RequestQueue handles cross-session dedup via UNIQUE constraint
		const wasNew = queue.addRequest(finalUrl);
		if (wasNew) {
			added++;
		} else {
			skipped++;
		}
	}

	return { added, skipped };
}
