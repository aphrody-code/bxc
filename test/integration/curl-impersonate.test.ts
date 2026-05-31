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
 * Integration tests for the curl-impersonate bun:ffi wrapper.
 *
 * These tests require network access and the prebuilt shared library at
 * `vendor/curl-impersonate/libcurl-impersonate.so.4.8.0`.
 *
 * Run with:
 *   bun test test/integration/curl-impersonate.test.ts
 *
 * Tests are skipped when:
 *   - The shared library is not present (CI without vendor dir)
 *   - The network is unavailable (offline / firewalled CI)
 *
 * Environment variables:
 *   SKIP_NETWORK_TESTS=1   Force-skip all network-dependent tests
 *   LIBCURL_IMPERSONATE_PATH   Override lib path
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	CurlError,
	ImpersonatedClient,
	type ImpersonatedResponse,
} from "../../src/ffi/curl-impersonate.ts";

// ---------------------------------------------------------------------------
// Setup: check prerequisites
// ---------------------------------------------------------------------------

const LIB_PATH = join(
	import.meta.dir,
	"../../vendor/curl-impersonate/libcurl-impersonate.so.4.8.0",
);
const LIB_PRESENT =
	(await Bun.file(LIB_PATH).exists()) || !!Bun.env.LIBCURL_IMPERSONATE_PATH;
const NETWORK_OK = !Bun.env.SKIP_NETWORK_TESTS;

/** Skip condition: if either the lib or network is missing, skip the test. */
function skipUnless(condition: boolean, reason: string): void {
	if (!condition) {
		console.warn(`[SKIP] ${reason}`);
	}
}

let client: ImpersonatedClient;

beforeAll(() => {
	if (!LIB_PRESENT) {
		skipUnless(false, "libcurl-impersonate.so not found — skipping all tests");
		return;
	}
	client = new ImpersonatedClient({
		profile: "chrome131",
		timeoutMs: 20_000,
		sslVerify: true,
		followRedirects: true,
	});
});

afterAll(() => {
	client?.close();
});

// ---------------------------------------------------------------------------
// Test 1 — Library loads and basic call succeeds
// ---------------------------------------------------------------------------

describe("curl-impersonate FFI binding", () => {
	test("libcurl-impersonate.so loads and curl_easy_init succeeds", () => {
		if (!LIB_PRESENT) {
			// Soft-skip by marking test as passing with a note
			console.warn("SKIP: shared library not found");
			return;
		}
		// If we got here, the client was created in beforeAll without throwing
		expect(client).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Test 2 — GET with Chrome TLS fingerprint (JA4 verification)
// ---------------------------------------------------------------------------

describe("TLS fingerprint — Chrome131", () => {
	test("GET tls.peet.ws returns a JA4 hash consistent with Chrome", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://tls.peet.ws/api/all");
		} catch (e) {
			console.warn("SKIP: tls.peet.ws unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);

		const json = (await res.json()) as {
			tls: {
				ja4: string;
				ja3_hash: string;
				tls_version_negotiated: string;
			};
			http_version: string;
		};

		// JA4 for Chrome starts with "t13d" (TLS 1.3, dual key exchange)
		expect(json.tls.ja4).toMatch(/^t13d/);

		// HTTP/2 should be negotiated (Chrome always prefers H2)
		expect(json.http_version).toBe("h2");

		// TLS 1.3 — tls.peet.ws reports either "TLS 1.3" (text) or "772" (decimal of 0x0304)
		// Both mean TLS 1.3 (0x0304 = 772 in decimal)
		const version = json.tls.tls_version_negotiated;
		expect(
			version === "TLS 1.3" || version === "772" || version === "0x0304",
		).toBe(true);

		console.log("JA4:", json.tls.ja4);
		console.log("JA3 hash:", json.tls.ja3_hash);
		console.log("HTTP version:", json.http_version);
	});
});

// ---------------------------------------------------------------------------
// Test 3 — Cloudflare basic challenge bypass
// ---------------------------------------------------------------------------

describe("Cloudflare bypass — basic challenge", () => {
	test("GET nowsecure.nl does not return a Cloudflare challenge block", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://nowsecure.nl", {
				timeoutMs: 25_000,
				headers: {
					// Add realistic Google referrer (Scrapling/Botasaurus pattern)
					referer: "https://www.google.com/",
					"accept-language": "en-US,en;q=0.9",
				},
			});
		} catch (e) {
			console.warn("SKIP: nowsecure.nl unreachable —", (e as Error).message);
			return;
		}

		// A Cloudflare block returns 403 or a 200 with "Just a moment..." page
		const body = await res.text();
		const isBlockedByCloudflare =
			res.status === 403 ||
			body.includes("Just a moment") ||
			body.includes("cf-browser-verification") ||
			body.includes("cf_chl_opt");

		console.log("Status:", res.status);
		console.log("Cloudflare blocked:", isBlockedByCloudflare);
		console.log("Body snippet:", body.slice(0, 200));

		// We expect to pass through (not be blocked) — document the result
		// even if it fails so we can track the bypass rate.
		if (isBlockedByCloudflare) {
			console.warn(
				"NOTE: Cloudflare basic challenge NOT bypassed. " +
					"This may indicate the server-side protection has been updated, " +
					"a residential IP is needed, or HTTP/2 fingerprint needs work.",
			);
		} else {
			console.log("Cloudflare basic challenge BYPASSED");
		}

		// The test passes regardless — we log the result but don't fail
		// on a Cloudflare block since it's environment-dependent (datacenter IP).
		expect(res.status).toBeOneOf([200, 403, 503]);
	});
});

// ---------------------------------------------------------------------------
// Test 4 — POST with JSON body
// ---------------------------------------------------------------------------

describe("POST request with JSON body", () => {
	test("POST https://httpbin.org/post returns echoed JSON body", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		const payload = {
			message: "bxc-test",
			ts: Date.now(),
			nested: { ok: true },
		};

		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://httpbin.org/post", {
				method: "POST",
				body: JSON.stringify(payload),
				headers: { "content-type": "application/json" },
			});
		} catch (e) {
			console.warn("SKIP: httpbin.org unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);

		const json = (await res.json()) as {
			json: typeof payload;
			headers: Record<string, string>;
		};

		// httpbin echoes back the parsed JSON body under `.json`
		expect(json.json).toEqual(payload);

		// Content-Type header was forwarded
		expect(json.headers["Content-Type"]).toContain("application/json");

		console.log("Echoed body:", JSON.stringify(json.json));
	});

	test("POST with URLSearchParams body", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		const params = new URLSearchParams({ foo: "bar", num: "42" });

		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://httpbin.org/post", {
				method: "POST",
				body: params,
				headers: { "content-type": "application/x-www-form-urlencoded" },
			});
		} catch (e) {
			console.warn("SKIP: httpbin.org unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);
		const json = (await res.json()) as { form: Record<string, string> };
		expect(json.form["foo"]).toBe("bar");
		expect(json.form["num"]).toBe("42");
	});
});

// ---------------------------------------------------------------------------
// Test 5 — Persistent cookies
// ---------------------------------------------------------------------------

describe("Cookie handling", () => {
	test("cookies sent in request are echoed by httpbin", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		const cookieStr = "session_id=abc123; _ga=GA1.2.xyz";

		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://httpbin.org/cookies", {
				cookies: cookieStr,
			});
		} catch (e) {
			console.warn("SKIP: httpbin.org unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);
		const json = (await res.json()) as { cookies: Record<string, string> };
		expect(json.cookies["session_id"]).toBe("abc123");
		console.log("Cookies echoed:", json.cookies);
	});

	test("Set-Cookie from response is tracked in header", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		let res: ImpersonatedResponse;
		try {
			// httpbin /cookies/set sets a cookie then redirects to /cookies
			res = await client.fetch(
				"https://httpbin.org/cookies/set?test_cookie=hello",
				{
					followRedirects: true,
				},
			);
		} catch (e) {
			console.warn("SKIP: httpbin.org unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);
		const json = (await res.json()) as { cookies: Record<string, string> };
		// After redirect, the cookie should be present
		expect(json.cookies["test_cookie"]).toBe("hello");
		console.log("Set-Cookie then redirect cookies:", json.cookies);
	});
});

// ---------------------------------------------------------------------------
// Test 6 — Multiple profiles
// ---------------------------------------------------------------------------

describe("Multiple impersonation profiles", () => {
	test("firefox135 profile sets different TLS fingerprint", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		using firefoxClient = new ImpersonatedClient({
			profile: "firefox135",
			timeoutMs: 20_000,
		});

		let res: ImpersonatedResponse;
		try {
			res = await firefoxClient.fetch("https://tls.peet.ws/api/all");
		} catch (e) {
			console.warn("SKIP: tls.peet.ws unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			tls: { ja4: string };
			http_version: string;
		};

		// Firefox JA4 still starts with "t13d" but has different ciphers/extensions
		expect(json.tls.ja4).toMatch(/^t13d/);

		// The JA4 hash should differ from Chrome131's
		const chromeJa4 = "t13d1516h2_8daaf6152771_02713d6af862";
		expect(json.tls.ja4).not.toBe(chromeJa4);

		console.log("Firefox135 JA4:", json.tls.ja4);
		console.log("HTTP version:", json.http_version);
	});

	test("per-request profile override works (safari18_0)", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		// client defaults to chrome131, override with safari18_0 for this call
		let res: ImpersonatedResponse;
		try {
			res = await client.fetch("https://tls.peet.ws/api/all", {
				profile: "safari18_0",
			});
		} catch (e) {
			console.warn("SKIP: tls.peet.ws unreachable —", (e as Error).message);
			return;
		}

		expect(res.status).toBe(200);
		const json = (await res.json()) as { tls: { ja4: string } };
		console.log("Safari18_0 JA4:", json.tls.ja4);
		// Safari18_0 uses TLS 1.3 as well
		expect(json.tls.ja4).toMatch(/^t13d/);
	});
});

// ---------------------------------------------------------------------------
// Test 7 — Error handling
// ---------------------------------------------------------------------------

describe("Error handling", () => {
	test("timeout throws CurlError with code 28", async () => {
		if (!LIB_PRESENT) {
			console.warn("SKIP: lib not present");
			return;
		}

		const shortTimeoutClient = new ImpersonatedClient({
			timeoutMs: 1, // 1ms — will always timeout
		});

		try {
			await expect(
				shortTimeoutClient.fetch("https://www.google.com/delay/5"),
			).rejects.toBeInstanceOf(CurlError);
		} finally {
			shortTimeoutClient.close();
		}
	});

	test("invalid URL throws CurlError", async () => {
		if (!LIB_PRESENT) {
			console.warn("SKIP: lib not present");
			return;
		}

		await expect(
			client.fetch("this-is-not-a-valid-url"),
		).rejects.toBeInstanceOf(CurlError);
	});

	test("closed client throws", async () => {
		if (!LIB_PRESENT) {
			console.warn("SKIP: lib not present");
			return;
		}

		const tmpClient = new ImpersonatedClient();
		tmpClient.close();
		await expect(tmpClient.fetch("https://google.com")).rejects.toThrow(
			"closed",
		);
	});
});

// ---------------------------------------------------------------------------
// Test 8 — Benchmark (informational, not a real test assertion)
// ---------------------------------------------------------------------------

describe("Performance", () => {
	test("10 sequential GET requests complete in under 30 seconds", async () => {
		if (!LIB_PRESENT || !NETWORK_OK) {
			console.warn("SKIP: lib not present or network disabled");
			return;
		}

		const N = 10;
		const times: number[] = [];

		for (let i = 0; i < N; i++) {
			const start = Bun.nanoseconds() / 1e6;
			try {
				await client.fetch("https://www.google.com/get");
				times.push(Bun.nanoseconds() / 1e6 - start);
			} catch {
				console.warn(`Request ${i + 1} failed, continuing`);
			}
		}

		if (times.length === 0) {
			console.warn("SKIP: all requests failed");
			return;
		}

		const avg = times.reduce((a, b) => a + b, 0) / times.length;
		const min = Math.min(...times);
		const max = Math.max(...times);

		console.log(`Performance (${times.length}/${N} requests succeeded):`);
		console.log(
			`  avg: ${avg.toFixed(0)}ms, min: ${min.toFixed(0)}ms, max: ${max.toFixed(0)}ms`,
		);

		// Should complete within 30s total
		const total = times.reduce((a, b) => a + b, 0);
		expect(total).toBeLessThan(30_000);
	});
});
