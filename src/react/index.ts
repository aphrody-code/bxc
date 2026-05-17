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
 * await page.goto("https://google.com/users/42");
 * const snap = await snapshotHydration(page);
 * console.log(snap.signal.framework, snap.nextData?.props?.pageProps);
 *
 * if (snap.nextData?.buildId) {
 *   const json = await fetchNextData("https://google.com", "/users/42", snap.nextData.buildId);
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
