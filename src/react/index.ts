/**
 * @module bunlight/react
 *
 * React / Next.js / Nuxt / Remix / Astro / SvelteKit hydration parsers
 * and helpers, designed to extract framework-specific state from
 * server-rendered HTML or live `Page` instances.
 *
 * @example
 * ```ts
 * import { Browser } from "@aphrody-code/bunlight";
 * import { snapshotHydration, fetchNextData } from "@aphrody-code/bunlight/react";
 *
 * const page = await Browser.newPage({ profile: "http" });
 * await page.goto("https://example.com/users/42");
 * const snap = await snapshotHydration(page);
 * console.log(snap.signal.framework, snap.nextData?.props?.pageProps);
 *
 * if (snap.nextData?.buildId) {
 *   const json = await fetchNextData("https://example.com", "/users/42", snap.nextData.buildId);
 *   console.log(json);
 * }
 * ```
 */

export { type WaitForHydrationOptions, waitForHydration } from "./hydration.ts";
export {
	type AppRouterFlightChunk,
	detectHydration,
	fetchNextData,
	findReactRoots,
	type HydrationSignal,
	type NextDataPayload,
	parseAppRouterFlight,
	parseAstroIslands,
	parseInitialState,
	parseNextData,
	parseNuxtState,
	parseRemixContext,
	parseSvelteKitFetched,
	type ReactRootInfo,
	snapshotHydration,
} from "./parser.ts";
