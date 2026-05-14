/**
 * StaticDomTransport — concurrent safety regression test.
 *
 * Reproduces the race condition documented in `docs/BENCHMARKS.md`
 * (Scenario 4, parallel-100): when multiple `Page` instances shared the same
 * singleton `StaticDomTransport`, their per-page CDP message ids collided
 * because every page received every response on the broadcast `onmessage`
 * stream. Concurrent goto/`$()`/`textContent()` would hang or return data
 * from the wrong page.
 *
 * The fix : each `Page` opened with `profile: "static"` now owns a fresh
 * `StaticDomTransport` instance, so message ids and pending tables stay
 * disjoint. This test asserts that 10 pages opened in parallel each see
 * their own document.
 */

import { describe, expect, test } from "bun:test";
import { Browser, type Page } from "../../src/api/browser.ts";

describe("StaticDomTransport — concurrent safety", () => {
	test("10 pages parallèles ne se collisionnent pas (CDP id race)", async () => {
		const htmls = Array.from(
			{ length: 10 },
			(_, i) => `<html><body><h1 id="t${i}">Title ${i}</h1></body></html>`,
		);
		const pages: Page[] = [];
		try {
			const tasks = htmls.map(async (html, i) => {
				const page = (await Browser.newPage({ profile: "static" })) as Page;
				pages.push(page);
				await page.goto(`data:text/html,${encodeURIComponent(html)}`);
				const handle = (await page.$("h1")) as { textContent(): Promise<string> } | null;
				const text = await handle?.textContent();
				return { i, text };
			});
			const results = await Promise.all(tasks);
			expect(results.length).toBe(10);
			for (const r of results) {
				expect(r.text).toBe(`Title ${r.i}`);
			}
		} finally {
			for (const p of pages) await p.close().catch(() => undefined);
			await Browser.close();
		}
	}, 30_000);
});
