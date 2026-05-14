/**
 * @module bunlight/next
 *
 * Next.js test helpers ported from `@next/playwright`. Use directly with
 * a bunlight `Page` (CDP-backed) or with a Playwright `Page` via the
 * `withPlaywrightPage()` adapter.
 *
 * @example bunlight (recommended)
 * ```ts
 * import { Browser } from "@aphrody-code/bunlight";
 * import { instant } from "@aphrody-code/bunlight/next";
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
 * import { instant, withPlaywrightPage } from "@aphrody-code/bunlight/next";
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
