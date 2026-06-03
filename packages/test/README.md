<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/bxc-test

Playwright-compatible browser/site test runner for **Bun**, backed by bxc's
**native in-process CDP layer** (`src/cdp/**`) and the `bun:test` runner. No
Chromium bundling, no Playwright dependency — zero-spawn in the `static` profile.

```ts
import { test, expect } from "@aphrody/bxc-test";

test("homepage renders", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await expect(page.getByRole("heading")).toHaveText("Welcome");
  await expect(page.getByTestId("cart")).toHaveCount(1);
  await expect(page.locator("#submit")).toBeEnabled();
});
```

Run it with Bun's native runner:

```bash
bun test test/
```

## Why

`@playwright/test` spawns Chromium and speaks CDP over a WebSocket. bxc already
*is* a CDP engine: `src/cdp/**` answers CDP method calls in-process, and
`src/api/browser.ts` drives navigation + DOM queries with no external binary.
This package mirrors the `@playwright/test` author surface (`test`/`expect`/
`page`/`locator`/`getBy*`) on top of that engine, so site tests run entirely
inside Bun.

## Surface

- **Runner**: `test`, `test.describe`, `describe`, `beforeEach`/`afterEach`/
  `beforeAll`/`afterAll`, `mock` — re-exported from `bun:test`. `test(name,
  async ({ page }) => …)` injects a fresh `TestPage`, closed automatically.
- **Page**: `goto`, `setContent`, `title`, `content`, `url`, `locator`,
  `getByTestId`, `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`,
  `getByAltText`, `getByTitle`.
- **Locator** (`BxcLocator`): `click`, `fill`, `textContent`, `getAttribute`,
  `isVisible`, `count`, `waitFor`, `filter({ hasText })`, `first`/`last`/`nth`.
- **Web-first `expect(locator)`** (auto-retrying): `toBeVisible`, `toBeHidden`,
  `toHaveText`, `toContainText`, `toHaveCount`, `toHaveAttribute`, `toBeEnabled`,
  `toBeDisabled`, and `.not`. `expect(value)` on non-locators falls through to
  `bun:test`.
- **Config**: `defineConfig({ use: { baseURL, testIdAttribute, profile },
  expect: { timeout } })` — a `playwright.config.ts`-shaped object consumed by
  `createTest(config)`.

## Compatibility & limits

bxc's default `static` profile has no JS engine and no layout, so a few things
are *adapted* or *not-yet*:

- `getByRole` uses a role→CSS heuristic + text filter, not a full ARIA tree.
- "Visible" means *attached and not hidden* (`hidden` / `display:none` /
  `aria-hidden`), not "non-zero box" — there is no layout in `static`.
- `toHaveScreenshot` / trace viewer / video need a rendering engine (use the
  `fast` Lightpanda profile) and are roadmap, not stubbed.

Full matrix and design rationale: [`../../docs/test-package-plan.md`](../../docs/test-package-plan.md).
