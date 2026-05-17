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
 * @module test/e2e/challonge-fixtures
 *
 * Static fixtures for the Challonge E2E crawl suite.
 *
 * All slugs come from real tournaments/users known to be public at
 * challonge.com and are kept as a small representative sample to avoid
 * hammering the CDN.  The matrix is intentionally compact:
 *   - 3 tournament slugs (most recent B_TS5 + demo T_SS1 + B_TS4)
 *   - 2 user handles (sunafterthereign + wild_breakers)
 *   - 9 URL patterns to exercise each page type
 *
 * @example
 * ```ts
 * import { CHALLONGE_PATTERNS, CHALLONGE_SLUGS } from "./challonge-fixtures.ts";
 * for (const slug of CHALLONGE_SLUGS) {
 *   for (const p of CHALLONGE_PATTERNS) {
 *     const url = p.urlBuilder(slug);
 *     // ... test p against url ...
 *   }
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** Real Challonge tournament slugs (public, Beyblade + demo). */
export const CHALLONGE_SLUGS = ["B_TS5", "T_SS1", "B_TS4"] as const;
export type ChallongeSlug = (typeof CHALLONGE_SLUGS)[number];

/** Real Challonge usernames (public profiles). */
export const CHALLONGE_USERS = ["sunafterthereign", "wild_breakers"] as const;
export type ChallongeUser = (typeof CHALLONGE_USERS)[number];

// ---------------------------------------------------------------------------
// Pattern descriptor
// ---------------------------------------------------------------------------

/**
 * A single URL pattern that rpb-challonge consumes via one of its three
 * transports (scraper / curl-impersonate / htmlrewriter).
 *
 * `urlBuilder` receives either a slug or a username string — the pattern
 * decides which.  `signalChecks` runs on the raw response body to verify
 * that meaningful content was received (not a CF interstitial or empty page).
 */
export interface ChallongePattern {
	/** Human-readable pattern name (used in test names and report rows). */
	name: string;
	/**
	 * Builds the full URL from a slug or username.
	 * For user-specific patterns, pass a username; for tournament patterns pass
	 * a tournament slug.
	 */
	urlBuilder: (slugOrUser: string) => string;
	/**
	 * Minimum body byte count expected for a genuine response.
	 * A body shorter than this is treated as a suspicious/CF-wall response.
	 */
	expectedMinBytes: number;
	/**
	 * Return true when the body contains the expected domain-specific signal.
	 * Used to distinguish real tournament data from CF challenges or empty
	 * pages that happen to have status 200.
	 */
	signalCheck: (body: string) => boolean;
	/**
	 * Category describing which rpb-challonge transport this pattern maps to.
	 * - "scraper"      — puppeteer (stealth/max profile)
	 * - "json"         — curl-impersonate JSON reverse
	 * - "htmlrewriter" — HTMLRewriter /module parser
	 * - "log"          — match log page
	 * - "standings"    — standings page
	 * - "participants" — participants page
	 * - "user"         — user profile page
	 * - "user-list"    — user tournament list page
	 * - "community"    — community page
	 */
	category:
		| "scraper"
		| "json"
		| "htmlrewriter"
		| "log"
		| "standings"
		| "participants"
		| "user"
		| "user-list"
		| "community";
	/**
	 * Whether this pattern requires a username (vs a tournament slug) in
	 * `urlBuilder`.
	 */
	requiresUser?: boolean;
}

// ---------------------------------------------------------------------------
// CF interstitial detector (shared across pattern checks)
// ---------------------------------------------------------------------------

/**
 * Returns true when the body looks like a Cloudflare managed-challenge page
 * rather than real Challonge content.
 */
export function isCloudflareWall(body: string): boolean {
	return /Just a moment|Checking your browser|cf-mitigated|Enable JavaScript and cookies|cf_chl_opt/i.test(
		body,
	);
}

// ---------------------------------------------------------------------------
// Pattern definitions — 9 patterns covering all rpb-challonge transports
// ---------------------------------------------------------------------------

export const CHALLONGE_PATTERNS: readonly ChallongePattern[] = [
	// 1. Tournament HTML page — primary scraper target (puppeteer stealth)
	{
		name: "tournament-html",
		urlBuilder: (slug) => `https://challonge.com/${slug}`,
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/challonge|tournament|bracket|data-react-class|participant/i.test(body) &&
			!isCloudflareWall(body),
		category: "scraper",
	},

	// 2. Bracket JSON (public reverse endpoint) — curl-impersonate target
	{
		name: "bracket-json",
		urlBuilder: (slug) => `https://challonge.com/${slug}.json`,
		expectedMinBytes: 500,
		signalCheck: (body) => {
			if (isCloudflareWall(body)) return false;
			try {
				const parsed = JSON.parse(body) as unknown;
				if (typeof parsed !== "object" || parsed === null) return false;
				const obj = parsed as Record<string, unknown>;
				return "tournament" in obj || "matches" in obj || Array.isArray(parsed);
			} catch {
				return false;
			}
		},
		category: "json",
	},

	// 3. Module page — HTMLRewriter target (bracket SVG + standings tables)
	{
		name: "module",
		urlBuilder: (slug) => `https://challonge.com/${slug}/module`,
		expectedMinBytes: 5_000,
		signalCheck: (body) =>
			(/<g[^>]*class="match"/i.test(body) ||
				/<table[^>]*class="standings"/i.test(body) ||
				/data-match-id/i.test(body)) &&
			!isCloudflareWall(body),
		category: "htmlrewriter",
	},

	// 4. Match log page
	{
		name: "match-log",
		urlBuilder: (slug) => `https://challonge.com/${slug}/log`,
		expectedMinBytes: 1_000,
		signalCheck: (body) =>
			(/<table/i.test(body) ||
				/LogStore|ActivityStore|data-react-class/i.test(body) ||
				/match|log|activity/i.test(body)) &&
			!isCloudflareWall(body),
		category: "log",
	},

	// 5. Standings page
	{
		name: "standings",
		urlBuilder: (slug) => `https://challonge.com/${slug}/standings`,
		expectedMinBytes: 1_000,
		signalCheck: (body) =>
			(/standing|rank|participant/i.test(body) || /data-react-class/i.test(body)) &&
			!isCloudflareWall(body),
		category: "standings",
	},

	// 6. Participants page
	{
		name: "participants",
		urlBuilder: (slug) => `https://challonge.com/${slug}/participants`,
		expectedMinBytes: 1_000,
		signalCheck: (body) =>
			(/participant|player|seed/i.test(body) || /data-react-class/i.test(body)) &&
			!isCloudflareWall(body),
		category: "participants",
	},

	// 7. User profile page
	{
		name: "user-profile",
		urlBuilder: (user) => `https://challonge.com/users/${user}`,
		expectedMinBytes: 1_000,
		signalCheck: (body) =>
			(/data-react-class="UserProfile"|data-react-class="Profile"/i.test(body) ||
				/user|profile|tournaments/i.test(body)) &&
			!isCloudflareWall(body),
		category: "user",
		requiresUser: true,
	},

	// 8. User tournament list (localized /fr/ path)
	{
		name: "user-tournaments",
		urlBuilder: (user) => `https://challonge.com/fr/users/${user}/tournaments`,
		expectedMinBytes: 500,
		signalCheck: (body) =>
			(/tournament|hosted|participant/i.test(body) || /data-react-class/i.test(body)) &&
			!isCloudflareWall(body),
		category: "user-list",
		requiresUser: true,
	},

	// 9. Community page (bonus — SATR community)
	{
		name: "community-satr",
		urlBuilder: (_unused) => `https://challonge.com/fr/communities/sunafterthereign`,
		expectedMinBytes: 1_000,
		signalCheck: (body) =>
			(/community|tournament|sunafterthereign/i.test(body) || /data-react-class/i.test(body)) &&
			!isCloudflareWall(body),
		category: "community",
	},
] as const;
