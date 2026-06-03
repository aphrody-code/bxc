// SPDX-License-Identifier: Apache-2.0
/**
 * X Radar (Premium+) — https://x.com/i/radar
 * Community: keyword monitor + trend viz via SearchTimeline (querySource: radar).
 */

export const RADAR_PAGE_URL = "https://x.com/i/radar" as const;
export const RADAR_NEW_URL = "https://x.com/i/radar/new" as const;

export const RADAR_ROUTES = [
  "/i/radar",
  "/i/radar/new",
] as const;

/** GraphQL used by Radar UI (no dedicated Radar* op in 2026 public bundles). */
export const RADAR_GRAPHQL_OPS = [
  "SearchTimeline",
  "ExplorePage",
  "ExploreSidebar",
] as const;

export const RADAR_QUERY_SOURCE = "radar" as const;

export const RADAR_SEARCH_PRODUCTS = ["Latest", "Top"] as const;

export type RadarSearchProduct = (typeof RADAR_SEARCH_PRODUCTS)[number];

/** Advanced search operators documented for Radar (help.x.com / community). */
export const RADAR_QUERY_SYNTAX_HELP = [
  '"exact phrase"',
  "term1 OR term2",
  "term -exclude",
  "term min_faves:100",
  "term url:domain",
  "@handle",
  "from:user",
] as const;