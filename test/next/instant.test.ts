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
 * Tests for the bxc port of `@next/playwright`'s `instant()` helper.
 *
 * Uses a structural fake target (no real browser) to validate the
 * cookie acquire/release sequence, error paths, and the re-entrance guard.
 */

import { describe, expect, test } from "bun:test";

import {
	INSTANT_NAVIGATION_COOKIE,
	type InstantTarget,
	instant,
	withPlaywrightPage,
} from "../../src/next/instant.ts";

interface CookieRow {
	name: string;
	value: string;
	domain?: string;
	path?: string;
}

function makeFakeTarget(initialUrl: string) {
	const log: string[] = [];
	const cookies: CookieRow[] = [];
	const target: InstantTarget = {
		url: () => initialUrl,
		async addCookies(rows) {
			for (const r of rows) cookies.push(r);
			log.push(
				`addCookies(${rows.map((r) => `${r.name}@${r.domain ?? "?"}`).join(",")})`,
			);
		},
		async clearCookies(filter) {
			const before = cookies.length;
			if (filter?.name) {
				const idx = cookies.findIndex((c) => c.name === filter.name);
				if (idx >= 0) cookies.splice(idx, 1);
			} else {
				cookies.length = 0;
			}
			log.push(
				`clearCookies(${filter?.name ?? "all"})=${before - cookies.length}`,
			);
		},
	};
	return { target, log, cookies };
}

describe("instant()", () => {
	test("sets and clears the instant cookie around the callback", async () => {
		const { target, log, cookies } = makeFakeTarget("http://localhost:3000/");
		const result = await instant(target, async () => {
			expect(cookies).toHaveLength(1);
			expect(cookies[0].name).toBe(INSTANT_NAVIGATION_COOKIE);
			expect(cookies[0].domain).toBe("localhost");
			expect(cookies[0].path).toBe("/");
			return 42;
		});
		expect(result).toBe(42);
		expect(cookies).toHaveLength(0);
		expect(log).toEqual([
			`addCookies(${INSTANT_NAVIGATION_COOKIE}@localhost)`,
			`clearCookies(${INSTANT_NAVIGATION_COOKIE})=1`,
		]);
	});

	test("clears the cookie even when the callback throws", async () => {
		const { target, cookies } = makeFakeTarget("https://google.com/");
		await expect(
			instant(target, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(cookies).toHaveLength(0);
	});

	test("uses baseURL when the page has not navigated yet", async () => {
		const { target, cookies } = makeFakeTarget("about:blank");
		await instant(
			target,
			async () => {
				expect(cookies[0].domain).toBe("app.google.com");
			},
			{ baseURL: "https://app.google.com/" },
		);
	});

	test("throws a helpful error when no URL is available", async () => {
		const { target } = makeFakeTarget("about:blank");
		await expect(instant(target, async () => undefined)).rejects.toThrow(
			/Could not infer the base URL/,
		);
	});

	test("re-entrance guard rejects nested instant() calls", async () => {
		const { target } = makeFakeTarget("http://localhost:3000/");
		await instant(target, async () => {
			await expect(instant(target, async () => undefined)).rejects.toThrow(
				/already running/,
			);
		});
	});
});

describe("withPlaywrightPage()", () => {
	test("adapts a Playwright-shaped page to InstantTarget", async () => {
		const log: string[] = [];
		const playwrightPage = {
			url: () => "http://localhost:4000/",
			context: () => ({
				async addCookies(rows: Array<{ name: string }>) {
					log.push(`pw.addCookies(${rows.map((r) => r.name).join(",")})`);
				},
				async clearCookies(filter?: { name?: string }) {
					log.push(`pw.clearCookies(${filter?.name ?? "all"})`);
				},
			}),
		};
		await instant(withPlaywrightPage(playwrightPage), async () => {
			expect(log).toEqual([`pw.addCookies(${INSTANT_NAVIGATION_COOKIE})`]);
		});
		expect(log[1]).toBe(`pw.clearCookies(${INSTANT_NAVIGATION_COOKIE})`);
	});
});
