<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody-code/next-playwright

A bxc port of Next.js's [`@next/playwright`](https://github.com/vercel/next.js/tree/canary/packages/next-playwright) — the `instant()` navigation-testing primitive — built on [`@aphrody-code/bxc-test`](../test) and bxc's native CDP layer. **No `@playwright/test` runtime dependency.**

`instant(page, fn)` runs `fn` while the `next-instant-navigation-testing` cookie is set. Inside the scope, a Next.js app with **Cache Components** serves only cached/prefetched content and defers dynamic data until the cookie is cleared — letting a test assert the instant (prefetched) shell deterministically.

## Why a port

`@next/playwright` talks to a Playwright `BrowserContext` (`page.context().addCookies / cookies / clearCookies`). bxc drives Chrome — and its fully-offline `static` DOM — over **CDP**, not Playwright. This package keeps the load-bearing half **byte-for-byte** and swaps only the substrate:

| Piece | Treatment |
| --- | --- |
| Cookie name `next-instant-navigation-testing` | **copied verbatim** — the contract Next.js reads (`navigation-testing-lock.ts`). Renaming it breaks the protocol. |
| Cookie value `JSON.stringify([0, "p"+Math.random()])`, `domain`/`path` scoping | copied verbatim |
| Nesting guard (read `context().cookies()`, throw if already set) | copied verbatim |
| `resolveURL` + the descriptive `about:blank` error | copied verbatim |
| acquire → `fn()` → release-in-`finally` semantics | copied verbatim |
| `step()` (was `@playwright/test` `test.step`) | **reimplemented** — a pluggable bxc reporter, defaults to direct execution |
| cookie ops (was Playwright `BrowserContext`) | **reimplemented** — `CdpCookieContext` over `Network.setCookies` / `getCookies` / `deleteCookies` |

## Usage

```ts
import { test, expect } from "@aphrody-code/bxc-test";
import { instant, adaptPage } from "@aphrody-code/next-playwright";

test("instant navigation to /dashboard", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await instant(adaptPage(page), async () => {
    await page.getByRole("link", { name: "Dashboard" }).click();
    // Only the prefetched shell is rendered inside the scope:
    await expect(page.getByRole("heading")).toHaveText("Dashboard");
  });
});
```

`adaptPage(testPage)` bridges a bxc `TestPage` (or any page exposing `_cdp` / `_send` and `url()`) to the structural `PlaywrightPage` that `instant()` expects, routing the cookie context through CDP.

A real Playwright `Page` already satisfies the structural `PlaywrightPage` type, so `instant(page, fn)` works against Playwright unchanged — the package is runner-agnostic by design.

### Fresh page (no navigation yet)

```ts
await instant(adaptPage(page), async () => {
  await page.goto("http://localhost:3000");
  // ...
}, { baseURL: "http://localhost:3000" });
```

## API

- `instant<T>(page, fn, options?) => Promise<T>` — acquire/release the lock around `fn`. `options.baseURL` scopes the cookie before the first navigation.
- `adaptPage(bxcPage) => PlaywrightPage` — wrap a bxc page as the structural target.
- `CdpCookieContext` — the `addCookies` / `cookies` / `clearCookies` adapter over CDP, usable standalone.
- `INSTANT_COOKIE` — the cookie-name constant (`next-instant-navigation-testing`).
- `setStepReporter(fn | null)` — install a custom step reporter (trace/label sink).
- Types: `PlaywrightPage`, `PlaywrightBrowserContext`, `BxcPageLike`, `CdpSend`, `PwCookie`, `PwCookieParam`, `Step`.

## Relationship to `src/next`

bxc core also ships `@aphrody-code/bxc/next` (`src/next/`) — a bxc-native, page-direct variant of `instant()` (the page itself exposes `addCookies`/`clearCookies`; nesting is guarded by an in-process flight lock) plus `withPlaywrightPage()`. This package is the **faithful, publishable mirror of vercel's `packages/next-playwright`** (structural `context()` shape, cookie-read nesting guard), layered on the `@aphrody-code/bxc-test` runner. Use the core module for quick bxc scripts; use this package when you want the exact `@next/playwright` surface in a `bun test` suite.

## Scope

This is **only** the `instant()` primitive — exactly like upstream. No dev/build/start harness, no fixtures. The Next.js consumer side (serving cached content) lives in the framework and requires Cache Components; in production builds it is gated behind `experimental.exposeTestingApiInProductionBuild`.

## License

Apache-2.0. Ports the MIT-licensed `@next/playwright` cookie protocol (constant + value shape); see header notes.
