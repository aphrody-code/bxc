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

export {
	parseNextData,
	parseAppRouterFlight,
	parseNuxtState,
	parseRemixContext,
	parseInitialState,
	parseSvelteKitFetched,
	parseAstroIslands,
	findReactRoots,
	detectHydration,
	snapshotHydration,
	fetchNextData,
	type NextDataPayload,
	type AppRouterFlightChunk,
	type ReactRootInfo,
	type HydrationSignal,
} from "./parser.ts";

export { waitForHydration, type WaitForHydrationOptions } from "./hydration.ts";
