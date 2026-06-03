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
 * @module bxc/next
 *
 * Next.js test helpers ported from `@next/playwright`. Use directly with
 * a bxc `Page` (CDP-backed) or with a Playwright `Page` via the
 * `withPlaywrightPage()` adapter.
 *
 * @example bxc (recommended)
 * ```ts
 * import { Browser } from "@aphrody/bxc";
 * import { instant } from "@aphrody/bxc/next";
 *
 * const page = await Browser.newPage({ profile: "fast" });
 * await page.goto("http://localhost:3000");
 * await instant(page, async () => {
 *   // assertions against the cached shell only
 * });
 * ```
 *
 * @example Playwright bridge
 * ```ts
 * import { test, expect } from "@playwright/test";
 * import { instant, withPlaywrightPage } from "@aphrody/bxc/next";
 *
 * test("instant", async ({ page }) => {
 *   await page.goto("http://localhost:3000");
 *   await instant(withPlaywrightPage(page), async () => {
 *     await page.click('a[href="/dashboard"]');
 *     await expect(page.locator('[data-testid="loading"]')).toBeVisible();
 *   });
 * });
 * ```
 */

export {
	INSTANT_NAVIGATION_COOKIE,
	type InstantOptions,
	type InstantTarget,
	instant,
	withPlaywrightPage,
} from "./instant.ts";

export { type Step, step } from "./step.ts";
