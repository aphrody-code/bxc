// SPDX-License-Identifier: Apache-2.0

/**
 * Offline, zero-spawn tests for the bxc `instant()` port. They drive the real
 * `next-instant-navigation-testing` cookie protocol through bxc's `static`
 * in-process CDP transport (`Network.setCookies` / `getCookies` /
 * `deleteCookies`) — no Next.js server, no Chromium, no network.
 *
 * What's asserted: the cookie is acquired inside the scope and released after
 * (even on throw), nesting is rejected, the cookie name matches the Next.js
 * contract byte-for-byte, and `resolveURL` throws on a fresh page without a
 * baseURL. The Next.js *consumer* side (serving cached content) lives in the
 * framework and is out of scope here; this package is purely the primitive.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Browser } from "../../../src/api/browser.ts";
import type { AnyPage } from "../../../src/api/types.ts";
import { adaptPage, CdpCookieContext, type CdpSend } from "../src/context.ts";
import { INSTANT_COOKIE, instant } from "../src/index.ts";

const BASE = "http://localhost:3000";

let page: AnyPage;

beforeEach(async () => {
	page = await Browser.newPage({ profile: "static" });
});

afterEach(async () => {
	await page.close();
});

/** Reads the cookie jar via the same CDP adapter `instant()` uses. */
function jar(p: AnyPage): CdpCookieContext {
	return new CdpCookieContext(p as unknown as CdpSend);
}

test("contract: the cookie name matches Next.js byte-for-byte", () => {
	expect(INSTANT_COOKIE).toBe("next-instant-navigation-testing");
});

test("acquires the lock cookie inside the scope, releases after", async () => {
	const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });

	expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);

	let sawInside = false;
	const ret = await instant(pw, async () => {
		const inside = await pw.context().cookies();
		sawInside = inside.some((c) => c.name === INSTANT_COOKIE);
		return 42;
	});

	expect(ret).toBe(42);
	expect(sawInside).toBe(true); // present during the scope
	// released after — Network.deleteCookies removed it from the jar
	expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("releases the lock even when the body throws", async () => {
	const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
	await expect(
		instant(pw, async () => {
			expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(true);
			throw new Error("boom");
		}),
	).rejects.toThrow("boom");
	expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("scopes the cookie to the resolved hostname", async () => {
	const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
	await instant(pw, async () => {
		const c = (await pw.context().cookies()).find((x) => x.name === INSTANT_COOKIE);
		expect(c?.domain).toBe("localhost");
		// value is the Next protocol shape: JSON-encoded [0, "p<rand>"]
		const parsed = JSON.parse(c?.value ?? "null");
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0]).toBe(0);
		expect(String(parsed[1]).startsWith("p")).toBe(true);
	});
});

test("rejects nested instant() scopes", async () => {
	const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
	await instant(pw, async () => {
		await expect(instant(pw, async () => undefined)).rejects.toThrow(
			"An instant() scope is already active",
		);
	});
	expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("uses baseURL when the page has no current URL", async () => {
	// A page that reports a fresh location; resolveURL must fall back to baseURL.
	const pw = adaptPage({ url: () => "about:blank", _cdp: page as unknown as CdpSend });
	await instant(
		pw,
		async () => {
			const c = (await pw.context().cookies()).find((x) => x.name === INSTANT_COOKIE);
			expect(c?.domain).toBe("example.test");
		},
		{ baseURL: "https://example.test/app" },
	);
});

test("throws a descriptive error on a fresh page with no baseURL", async () => {
	const pw = adaptPage({ url: () => "about:blank", _cdp: page as unknown as CdpSend });
	await expect(instant(pw, async () => undefined)).rejects.toThrow(
		"Could not infer the base URL",
	);
});

test("jar adapter clears by name via Network.deleteCookies", async () => {
	const ctx = jar(page);
	await ctx.addCookies([
		{ name: "keep", value: "1", domain: "localhost", path: "/" },
		{ name: INSTANT_COOKIE, value: "x", domain: "localhost", path: "/" },
	]);
	expect((await ctx.cookies()).length).toBe(2);
	await ctx.clearCookies({ name: INSTANT_COOKIE });
	const after = await ctx.cookies();
	expect(after.some((c) => c.name === INSTANT_COOKIE)).toBe(false);
	expect(after.some((c) => c.name === "keep")).toBe(true);
});
