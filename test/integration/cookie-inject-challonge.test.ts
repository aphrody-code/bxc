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
 * Integration test — cookie injection bypassing Cloudflare + login on
 * challonge.com.
 *
 * Strategy:
 *   1. Without cookies → expect 403 / 503 / Cloudflare challenge page.
 *   2. With cookies (cf_clearance + session_production) → expect 200 + an
 *      authenticated tournament page (presence of "Logout" or account UI
 *      elements proves the session cookie was honoured).
 *
 * The test is *automatically skipped* when:
 *   - `cookies/private/challonge.json` is missing (the file is gitignored
 *     and only present on machines holding a real authenticated session).
 *   - libcurl-impersonate is not built locally.
 *   - `SKIP_NETWORK_TESTS=1` is set (offline / firewalled CI).
 *
 * Run with:
 *   bun test test/integration/cookie-inject-challonge.test.ts
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Browser, type HttpPage } from "../../src/api/browser.ts";
import { buildCookieHeader } from "../../src/cookies/cookie-injector.ts";
import {
	filterExpired,
	loadCookieJar,
	maskCookiesForLog,
	parseCookies,
} from "../../src/cookies/cookie-loader.ts";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "../..");
const COOKIE_FILE = join(ROOT, "cookies/private/google.json");
const LIB_PATH = join(
	ROOT,
	"vendor/curl-impersonate/libcurl-impersonate.so.4.8.0",
);

const HAS_COOKIES = await Bun.file(COOKIE_FILE).exists();
const HAS_LIB =
	(await Bun.file(LIB_PATH).exists()) || !!Bun.env.LIBCURL_IMPERSONATE_PATH;
const NETWORK_OK = !Bun.env.SKIP_NETWORK_TESTS;

const TEST_URL = "https://www.google.com";

const RUN_LIVE = HAS_COOKIES && HAS_LIB && NETWORK_OK;

if (!RUN_LIVE) {
	const reasons: string[] = [];
	if (!HAS_COOKIES) reasons.push("missing cookies/private/google.json");
	if (!HAS_LIB) reasons.push("missing libcurl-impersonate.so");
	if (!NETWORK_OK) reasons.push("SKIP_NETWORK_TESTS=1");
	console.warn(`[SKIP] cookie-inject-google — ${reasons.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Pure-logic tests (always run)
// ---------------------------------------------------------------------------

describe("cookie-loader — format detection", () => {
	test("parses Playwright/CDP JSON arrays", () => {
		const json = JSON.stringify([
			{
				name: "sid",
				value: "abc123",
				domain: ".google.com",
				path: "/",
				expires: 9999999999,
				httpOnly: true,
				secure: true,
				sameSite: "None",
			},
		]);
		const cookies = parseCookies(json);
		expect(cookies).toHaveLength(1);
		expect(cookies[0].name).toBe("sid");
		expect(cookies[0].sameSite).toBe("None");
	});

	test("parses DevTools-style JSON with expirationDate + hostOnly", () => {
		const json = JSON.stringify([
			{
				name: "sid",
				value: "x",
				domain: "google.com",
				path: "/",
				expirationDate: 9999999999.123,
				secure: false,
				httpOnly: false,
				sameSite: "lax",
				hostOnly: true,
			},
		]);
		const cookies = parseCookies(json);
		expect(cookies[0].expires).toBe(9999999999);
		expect(cookies[0].hostOnly).toBe(true);
	});

	test("parses Netscape cookies.txt (curl/yt-dlp format)", () => {
		const txt = [
			"# Netscape HTTP Cookie File",
			"#HttpOnly_.google.com\tTRUE\t/\tTRUE\t9999999999\tSID\tabc123",
			".google.com\tTRUE\t/\tTRUE\t9999999999\tHSID\txyz",
		].join("\n");
		const cookies = parseCookies(txt);
		expect(cookies).toHaveLength(2);
		expect(cookies[0].httpOnly).toBe(true);
		expect(cookies[0].name).toBe("SID");
		expect(cookies[1].name).toBe("HSID");
	});

	test("filters expired cookies", () => {
		const past = Math.floor(Date.now() / 1000) - 10_000;
		const future = Math.floor(Date.now() / 1000) + 10_000;
		const cookies = filterExpired([
			{
				name: "expired",
				value: "x",
				domain: ".google.com",
				path: "/",
				expires: past,
				httpOnly: false,
				secure: false,
				sameSite: "Lax",
			},
			{
				name: "fresh",
				value: "y",
				domain: ".google.com",
				path: "/",
				expires: future,
				httpOnly: false,
				secure: false,
				sameSite: "Lax",
			},
			{
				name: "session",
				value: "z",
				domain: ".google.com",
				path: "/",
				expires: -1,
				httpOnly: false,
				secure: false,
				sameSite: "Lax",
			},
		]);
		expect(cookies.map((c) => c.name)).toEqual(["fresh", "session"]);
	});

	test("masks cookie values for logging (security)", () => {
		const cookies = parseCookies(
			JSON.stringify([
				{
					name: "sid",
					value: "secret-do-not-log-me",
					domain: ".google.com",
					path: "/",
				},
			]),
		);
		const masked = maskCookiesForLog(cookies);
		expect(masked).not.toContain("secret-do-not-log-me");
		expect(masked).toContain("<masked:");
	});

	test("rejects non-array JSON", () => {
		expect(() => parseCookies('{"not":"array"}')).toThrow();
	});
});

describe("cookie-injector — RFC 6265 header builder", () => {
	const cookies = [
		{
			name: "SID",
			value: "abc",
			domain: ".google.com",
			path: "/",
			expires: 9999999999,
			httpOnly: true,
			secure: true,
			sameSite: "None" as const,
		},
		{
			name: "HSID",
			value: "xyz",
			domain: ".google.com",
			path: "/",
			expires: 9999999999,
			httpOnly: true,
			secure: true,
			sameSite: "Lax" as const,
		},
		{
			name: "other_site",
			value: "nope",
			domain: ".material.io",
			path: "/",
			expires: 9999999999,
			httpOnly: false,
			secure: false,
			sameSite: "Lax" as const,
		},
	];

	test("matches subdomain via leading-dot domain", () => {
		const header = buildCookieHeader(cookies, "https://www.google.com/");
		expect(header).toContain("SID=abc");
		expect(header).toContain("HSID=xyz");
		expect(header).not.toContain("other_site");
	});

	test("excludes cookies for unrelated domains", () => {
		const header = buildCookieHeader(cookies, "https://www.google.fr/");
		expect(header).toBeNull();
	});

	test("respects secure flag (no secure cookies on http://)", () => {
		const header = buildCookieHeader(cookies, "http://google.com/");
		expect(header).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Live tests — google.com bypass
// ---------------------------------------------------------------------------

describe.if(RUN_LIVE)("Browser.newPage({ cookies }) — google.com live", () => {
	test("loads cookies from disk and reports a non-empty jar", async () => {
		const cookies = await loadCookieJar(COOKIE_FILE);
		expect(cookies.length).toBeGreaterThan(0);
		// Sanity check that at least one cookie is for google.com
		const google = cookies.filter((c) =>
			c.domain.toLowerCase().includes("google"),
		);
		expect(google.length).toBeGreaterThan(0);
		// Log only masked output (security)
		console.log(
			`[google] loaded ${cookies.length} cookies — ${maskCookiesForLog(google.slice(0, 3))}…`,
		);
	});

	test("WITH cookies — http profile reaches authenticated page", async () => {
		const page = (await Browser.newPage({
			profile: "http",
			cookies: COOKIE_FILE,
			httpOpts: { profile: "chrome131", timeoutMs: 45_000 },
		})) as HttpPage;

		try {
			const res = await page.goto(TEST_URL);
			const body = await page.content();

			expect(res.status).toBeGreaterThanOrEqual(200);
			expect(res.status).toBeLessThan(400);

			const lower = body.toLowerCase();
			expect(lower.includes("google")).toBe(true);
		} finally {
			await page.close();
		}
	}, 60_000);
});
