// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody-code/bxc-test
 *
 * Playwright-compatible browser/site test package for Bun, backed by bxc's
 * native in-process CDP layer (`src/cdp/**`) and the `bun:test` runner. No
 * Chromium bundling, no Playwright dependency — zero-spawn in the `static`
 * profile.
 *
 * Drop-in usage (mirrors `@playwright/test`):
 *
 * ```ts
 * import { test, expect } from "@aphrody-code/bxc-test";
 *
 * test("homepage", async ({ page }) => {
 *   await page.goto("http://localhost:3000/");
 *   await expect(page.getByRole("heading")).toHaveText("Welcome");
 *   await expect(page.getByTestId("cart")).toHaveCount(1);
 * });
 * ```
 *
 * Compatibility matrix and design notes: `docs/test-package-plan.md`.
 */

export {
	test,
	createTest,
	describe,
	it,
	beforeAll,
	afterAll,
	beforeEach,
	afterEach,
	mock,
	type BxcTest,
	type BxcFixtures,
	type FixtureBody,
} from "./runner.ts";

export {
	expect,
	type LocatorMatchers,
	type MatcherOptions,
} from "./expect.ts";

export { TestPage, type TestPageOptions } from "./page.ts";

export {
	BxcLocator,
	type CdpPage,
	type FilterOptions,
} from "./locator.ts";

export {
	defineConfig,
	type BxcTestConfig,
	type UseOptions,
	type ExpectConfig,
} from "./config.ts";

export {
	type ByRoleOptions,
	type ResolvedQuery,
	type TextMatcher,
} from "./selectors.ts";
