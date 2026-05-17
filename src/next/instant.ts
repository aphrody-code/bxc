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
 * @module bxc/next/instant
 *
 * Port of `@next/playwright`'s `instant()` helper to bxc.
 *
 * `instant(page, fn, options?)` runs `fn` with the
 * `next-instant-navigation-testing` cookie set on the current host.
 * Inside the callback, Next.js (with Cache Components enabled) renders
 * only the cached/prefetched UI and defers all dynamic data fetching
 * until the cookie is cleared.
 *
 * Differences vs `@next/playwright` :
 *   - Works against a bxc `Page` (CDP-backed, lightpanda profile),
 *     not a Playwright `Page`. Cookie ops use `addCookies` /
 *     `clearCookies` we expose on `src/api/browser.ts`.
 *   - The Playwright structural shim (`PlaywrightPage`) is preserved as
 *     an *additional* compatibility path: any object that exposes
 *     `url()`, `addCookies()`, `clearCookies()` works too.
 *   - Step labelling uses `bxc/next/step` which auto-detects
 *     `@playwright/test` step API when present and falls back to
 *     direct execution under `bun:test`.
 *
 * Reference upstream :
 *   https://developers.google.com/vercel/next.js/tree/canary/packages/next-playwright
 *   https://nextjs.org/docs (Cache Components, instant navigation)
 */

import { step } from "./step.ts";

/**
 * Structural type accepted by `instant()`. Both bxc's `Page` and
 * Playwright's `Page` (via `page.context().addCookies`) satisfy this
 * shape after a tiny adapter — see `withPlaywrightPage()` below.
 */
export interface InstantTarget {
	url(): string;
	addCookies(
		cookies: Array<{
			name: string;
			value: string;
			url?: string;
			domain?: string;
			path?: string;
		}>,
	): Promise<void>;
	clearCookies(filter?: { name?: string; domain?: string; path?: string }): Promise<void>;
}

const INSTANT_COOKIE = "next-instant-navigation-testing";

let inFlight: Promise<unknown> | null = null;

export interface InstantOptions {
	/**
	 * Base URL used to scope the cookie when the page has not navigated yet
	 * (i.e. `page.url()` is `about:blank` or empty). Mirrors the upstream
	 * Playwright fixture `baseURL`.
	 */
	baseURL?: string;
}

/**
 * Acquire the Next.js instant-navigation lock for the duration of `fn`.
 * The lock is implemented as a single cookie scoped to the host.
 */
export async function instant<T>(
	page: InstantTarget,
	fn: () => Promise<T>,
	options?: InstantOptions,
): Promise<T> {
	if (inFlight) {
		throw new Error(
			"instant() is already running. Concurrent or nested instant() " +
				"calls is not supported. Did you forget to await the " +
				"previous instant() call?",
		);
	}

	const { hostname } = new URL(resolveURL(page, options));
	const acquire = step("Acquire Instant Lock", () =>
		page.addCookies([
			{
				name: INSTANT_COOKIE,
				value: JSON.stringify([0, `p${Math.random()}`]),
				domain: hostname,
				path: "/",
			},
		]),
	);
	inFlight = acquire;

	try {
		await acquire;
		return await fn();
	} finally {
		// Clear by name to drop the cookie regardless of any value mutation
		// performed by Next.js during the lock scope.
		await step("Release Instant Lock", () => page.clearCookies({ name: INSTANT_COOKIE }));
		inFlight = null;
	}
}

function resolveURL(page: InstantTarget, options?: InstantOptions): string {
	const url = options?.baseURL ?? page.url();
	if (url && url !== "about:blank") return url;
	const error = new Error(
		`Could not infer the base URL of the application.

instant() needs to know the base URL so it can configure the
browser before the first page load. If the page is already
loaded, the base URL is detected automatically. Otherwise:

  await instant(page, async () => {
    await page.goto('http://localhost:3000');
  }, { baseURL: 'http://localhost:3000' });

  // or navigate first:
  await page.goto('http://localhost:3000');
  await instant(page, async () => { ... });
`,
	);
	Error.captureStackTrace(error, instant);
	throw error;
}

/**
 * Compatibility adapter for Playwright `Page`. Returns an object that
 * satisfies `InstantTarget` by delegating cookie operations to
 * `page.context()`.
 *
 * @example
 * ```ts
 * import { instant, withPlaywrightPage } from "@aphrody-code/bxc/next";
 * test("instant", async ({ page }) => {
 *   await page.goto("http://localhost:3000");
 *   await instant(withPlaywrightPage(page), async () => {
 *     await page.click('a[href="/dashboard"]');
 *     await expect(page.locator('[data-testid="loading"]')).toBeVisible();
 *   });
 * });
 * ```
 */
export function withPlaywrightPage(page: {
	url: () => string;
	context: () => {
		addCookies: (
			cookies: Array<{
				name: string;
				value: string;
				url?: string;
				domain?: string;
				path?: string;
			}>,
		) => Promise<void>;
		clearCookies: (filter?: { name?: string; domain?: string; path?: string }) => Promise<void>;
	};
}): InstantTarget {
	const ctx = page.context();
	return {
		url: () => page.url(),
		addCookies: (c) => ctx.addCookies(c),
		clearCookies: (f) => ctx.clearCookies(f),
	};
}

export const INSTANT_NAVIGATION_COOKIE = INSTANT_COOKIE;
