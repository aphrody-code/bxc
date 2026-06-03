// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody-code/next-playwright
 *
 * bxc port of Next.js's `@next/playwright` (`/tmp/next.js/packages/
 * next-playwright`, MIT, `16.3.0-canary.39`) — the `instant()` navigation-
 * testing primitive. Within an `instant()` scope, Next serves only cached /
 * prefetched content (Cache Components), driven entirely by a single cookie,
 * `next-instant-navigation-testing`.
 *
 * The cookie protocol, the nesting guard, `resolveURL`, and the acquire/release
 * `finally` semantics are copied **verbatim** from upstream — they are the
 * load-bearing contract with the Next.js runtime
 * (`navigation-testing-lock.ts`) and must match byte-for-byte. What differs is
 * the substrate: the cookie ops run over bxc's CDP layer
 * ({@link CdpCookieContext}) instead of Playwright's `BrowserContext`, and
 * `step()` targets bxc's runner instead of `@playwright/test`.
 *
 * Usage with `@aphrody-code/bxc-test`:
 *
 * ```ts
 * import { test, expect } from "@aphrody-code/bxc-test";
 * import { instant, adaptPage } from "@aphrody-code/next-playwright";
 *
 * test("instant navigation", async ({ page }) => {
 *   await page.goto("http://localhost:3000/");
 *   await instant(adaptPage(page), async () => {
 *     await page.getByRole("link", { name: "Dashboard" }).click();
 *     await expect(page.getByRole("heading")).toHaveText("Dashboard");
 *   });
 * });
 * ```
 *
 * A real Playwright `Page` already satisfies the structural `PlaywrightPage`
 * type, so `instant(page, fn)` also works unchanged against Playwright.
 */

import type { PlaywrightPage } from "./context.ts";
import { step } from "./step.ts";

export {
	adaptPage,
	CdpCookieContext,
	type BxcPageLike,
	type CdpSend,
	type PlaywrightBrowserContext,
	type PlaywrightPage,
	type PwCookie,
	type PwCookieParam,
} from "./context.ts";
export { setStepReporter, step, type Step } from "./step.ts";

/**
 * The load-bearing cookie name. Next.js reads this (CookieStore change event →
 * `navigation-testing-lock.ts`) to acquire/release the in-memory navigation
 * lock. Must match the Next.js runtime byte-for-byte — do not rename.
 */
export const INSTANT_COOKIE = "next-instant-navigation-testing";

/**
 * Runs a function with instant navigation enabled. Within this scope,
 * navigations render the prefetched UI immediately and wait for the callback to
 * complete before streaming in dynamic data.
 *
 * Uses the cookie-based protocol: setting the cookie acquires the navigation
 * lock (via the CookieStore change event), and clearing it releases the lock.
 *
 * If the page is already loaded, the URL is inferred automatically. For a fresh
 * page (before any navigation), pass `baseURL` so the cookie can be scoped to
 * the correct domain:
 *
 * ```ts
 * await instant(page, async () => {
 *   await page.goto(url);
 *   // ...
 * }, { baseURL: "http://localhost:3000" });
 * ```
 */
export async function instant<T>(
	page: PlaywrightPage,
	fn: () => Promise<T>,
	options?: { baseURL?: string },
): Promise<T> {
	// Check for nested instant() calls. The cookie is scoped to the browser
	// context, so we can detect nesting by checking if it's already set.
	const existingCookies = await page.context().cookies();
	if (existingCookies.some((c) => c.name === INSTANT_COOKIE)) {
		throw new Error(
			"An instant() scope is already active. Nesting instant() " +
				"calls is not supported. Did you forget to await the " +
				"previous instant() call?",
		);
	}

	// Acquire the lock by setting the cookie via the browser context. This
	// ensures the cookie is present even on the very first navigation. The
	// cookie triggers the CookieStore change event in navigation-testing-lock.ts,
	// which acquires the in-memory navigation lock.
	const { hostname } = new URL(resolveURL(page, options));
	await step("Acquire Instant Lock", () =>
		page.context().addCookies([
			{
				name: INSTANT_COOKIE,
				value: JSON.stringify([0, `p${Math.random()}`]),
				domain: hostname,
				path: "/",
			},
		]),
	);
	try {
		return await fn();
	} finally {
		// Release the lock by clearing the cookie. Next.js may have updated the
		// cookie value (e.g. from [0] to [1,null]) during the lock scope. We
		// clear by name to remove the cookie regardless of its current value or
		// which domain variant it was stored under.
		await step("Release Instant Lock", () =>
			page.context().clearCookies({ name: INSTANT_COOKIE }),
		);
	}
}

/**
 * Resolves the URL to scope the instant navigation cookie to. Prefers an
 * explicit `baseURL` option, then falls back to the page's current URL. Throws
 * a descriptive error if neither is available (e.g. fresh page before any
 * navigation).
 */
function resolveURL(
	page: PlaywrightPage,
	options?: { baseURL?: string },
): string {
	const url = options?.baseURL ?? page.url();
	if (url && url !== "about:blank") {
		return url;
	}
	const error = new Error(
		`Could not infer the base URL of the application.

instant() needs to know the base URL so it can configure the
browser before the first page load. If the page is already
loaded, the base URL is detected automatically.
Otherwise, you can fix this in one of two ways:

1. Pass a baseURL option:

  await instant(page, async () => {
    await page.goto('http://localhost:3000')
    // ...
  }, { baseURL: 'http://localhost:3000' })

  Tip: If you use baseURL in your Playwright config, you can
  get it from the test fixture:

    test('my test', async ({ page, baseURL }) => {
      await instant(page, async () => {
        // ...
      }, { baseURL })
    })

2. Navigate to a page before calling instant():

  await page.goto('http://localhost:3000')
  await instant(page, async () => {
    // ...
  })`,
	);
	// Remove resolveURL and instant from the stack trace so the error points at
	// the caller's code. (V8/Bun expose captureStackTrace; guard for safety.)
	Error.captureStackTrace?.(error, instant);
	throw error;
}
