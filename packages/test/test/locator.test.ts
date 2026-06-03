// SPDX-License-Identifier: Apache-2.0

/**
 * Real, fully-offline end-to-end test of `@aphrody-code/bxc-test`.
 *
 * Drives a tiny `Bun.serve({ port: 0 })` HTML page through bxc's native CDP
 * `static` transport and asserts on it with the package's own Playwright-shaped
 * locator + web-first `expect`. No external network, no Chromium.
 */

import { afterAll, beforeAll, describe } from "bun:test";
import { expect, test, TestPage } from "../src/index.ts";

const HTML = `<!doctype html>
<html>
  <head><title>bxc-test fixture</title></head>
  <body>
    <main>
      <h1 data-testid="hdr" role="heading">Welcome Home</h1>
      <button id="go">Submit</button>
      <button id="off" disabled>Disabled</button>
      <a href="/next" role="link">Continue</a>
      <ul>
        <li class="item">alpha</li>
        <li class="item">beta</li>
        <li class="item">gamma</li>
      </ul>
      <span role="status">Ready</span>
      <p style="display:none" data-testid="ghost">hidden text</p>
      <input id="q" type="text" placeholder="Search…" aria-label="query" />
    </main>
  </body>
</html>`;

let server: ReturnType<typeof Bun.serve>;
let baseURL: string;

beforeAll(() => {
	// port: 0 → OS-assigned port, read back. No hardcoded port.
	server = Bun.serve({
		port: 0,
		fetch() {
			return new Response(HTML, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
	baseURL = `http://localhost:${server.port}/`;
});

afterAll(() => {
	server.stop(true);
});

describe("bxc-test locator + web-first expect over native CDP", () => {
	test("navigates and reads the title", async ({ page }) => {
		const resp = await page.goto(baseURL);
		expect(resp.status).toBe(200);
		expect(resp.ok).toBe(true);
		expect(await page.title()).toBe("bxc-test fixture");
	});

	test("getByTestId resolves and has text", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.getByTestId("hdr")).toHaveText("Welcome Home");
		await expect(page.getByTestId("hdr")).toContainText("Welcome");
	});

	test("getByRole maps to native elements", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.getByRole("heading")).toHaveText("Welcome Home");
		await expect(page.getByRole("link")).toHaveText("Continue");
		await expect(page.getByRole("status")).toHaveText("Ready");
	});

	test("getByRole with name filters by accessible text", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(1);
		await expect(page.getByRole("button", { name: "Submit" })).toHaveText(
			"Submit",
		);
	});

	test("toHaveCount over a CSS locator", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.locator(".item")).toHaveCount(3);
		await expect(page.locator(".item").nth(1)).toHaveText("beta");
		await expect(page.locator(".item").first()).toHaveText("alpha");
		await expect(page.locator(".item").last()).toHaveText("gamma");
	});

	test("filter({ hasText }) narrows the set", async ({ page }) => {
		await page.goto(baseURL);
		await expect(
			page.locator(".item").filter({ hasText: "gamma" }),
		).toHaveCount(1);
	});

	test("visibility: hidden element is not visible", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.getByTestId("hdr")).toBeVisible();
		await expect(page.getByTestId("ghost")).toBeHidden();
		expect(await page.getByTestId("ghost").isVisible()).toBe(false);
	});

	test("toBeEnabled / toBeDisabled reflect the disabled attribute", async ({
		page,
	}) => {
		await page.goto(baseURL);
		await expect(page.locator("#go")).toBeEnabled();
		await expect(page.locator("#off")).toBeDisabled();
	});

	test("toHaveAttribute checks attribute presence and value", async ({
		page,
	}) => {
		await page.goto(baseURL);
		await expect(page.getByTestId("hdr")).toHaveAttribute("role", "heading");
		await expect(page.locator("#q")).toHaveAttribute("placeholder", "Search…");
	});

	test("getByPlaceholder / getByLabel attribute locators", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.getByPlaceholder("Search…")).toHaveCount(1);
		await expect(page.getByLabel("query")).toHaveAttribute("id", "q");
	});

	test(".not inverts a web-first matcher", async ({ page }) => {
		await page.goto(baseURL);
		await expect(page.locator(".item")).not.toHaveCount(2);
		await expect(page.getByTestId("hdr")).not.toHaveText("Goodbye");
	});

	test("setContent drives the page without navigation", async ({ page }) => {
		await page.setContent(
			"<main><h2 data-testid='dyn'>Set Content Works</h2></main>",
		);
		await expect(page.getByTestId("dyn")).toHaveText("Set Content Works");
	});

	test("locator.textContent / getAttribute read element state", async ({
		page,
	}) => {
		await page.goto(baseURL);
		const hdr = page.getByTestId("hdr");
		expect(await hdr.textContent()).toBe("Welcome Home");
		expect(await hdr.getAttribute("role")).toBe("heading");
		expect(await page.locator(".item").count()).toBe(3);
	});

	test("plain expect still falls through to bun:test", async () => {
		expect(2 + 2).toBe(4);
		expect([1, 2, 3]).toContain(2);
		expect({ a: 1 }).toEqual({ a: 1 });
	});

	test("TestPage works standalone via await using", async () => {
		await using page = await TestPage.create({ profile: "static" });
		await page.goto(baseURL);
		await expect(page.getByRole("heading")).toHaveText("Welcome Home");
	});
});
