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

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Browser } from "../../src/api/browser.ts";
import { launchGhostBrowser } from "../../src/profiles/ghost/index.ts";

const NETWORK_OK = !Bun.env.SKIP_NETWORK_TESTS;
const TEST_URL = "https://www.fut.gg/";

// Helper to check if curl-impersonate FFI is available
async function isHttpProfileAvailable(): Promise<boolean> {
	const bxcDir = join(import.meta.dir, "../..");
	const curlVendorDir = join(bxcDir, "vendor/curl-impersonate");
	const curlCandidates = [
		`${curlVendorDir}/libcurl-impersonate-chrome.so.4.8.0`,
		`${curlVendorDir}/libcurl-impersonate.so.4.8.0`,
		`${curlVendorDir}/libcurl-impersonate.so`,
	];
	if (Bun.env.LIBCURL_IMPERSONATE_PATH) return true;
	for (const c of curlCandidates) {
		if (await Bun.file(c).exists()) {
			return true;
		}
	}
	return false;
}

// Helper to check if lightpanda binary is available (for ghost/fast profile)
async function isGhostProfileAvailable(): Promise<boolean> {
	const home = Bun.env.HOME ?? "";
	const candidates = [
		`${home}/.cache/lightpanda-node/lightpanda`,
		`${home}/.lightpanda/lightpanda`,
		`${home}/.local/bin/lightpanda`,
		`${home}/bunmium/lightpanda-src/zig-out/bin/lightpanda`,
	];
	if (Bun.env.LIGHTPANDA_PATH) return true;
	for (const c of candidates) {
		try {
			const stat = await Bun.file(c).stat();
			if (stat.size > 32_768) {
				return true;
			}
		} catch {
			// not present
		}
	}
	return false;
}

// Robust helper to retrieve and verify page title
async function getPageTitle(page: any): Promise<string> {
	let title = await page.title();
	if (!title && typeof page.content === "function") {
		try {
			const content = await page.content();
			const match = /<title[^>]*>([^<]*)<\/title>/i.exec(content);
			title = match ? (match[1] ?? "").trim() : "";
		} catch {
			// best effort
		}
	}
	return title;
}

describe("Fut.gg Navigation Tests", () => {
	// 1. static profile
	test("should retrieve page title using static profile", async () => {
		if (!NETWORK_OK) {
			console.warn("[SKIP] static profile test skipped: SKIP_NETWORK_TESTS=1");
			return;
		}
		const page = await Browser.newPage({ profile: "static" });
		try {
			await page.goto(TEST_URL);
			const title = await getPageTitle(page);
			expect(title).toBeDefined();
			expect(typeof title).toBe("string");
			const titleLower = title.toLowerCase();
			const isFutGg = titleLower.includes("fut.gg");
			const isSuccessfullyRetrieved = title.length > 0;
			expect(isFutGg || isSuccessfullyRetrieved).toBe(true);
		} finally {
			await page.close();
		}
	}, 30_000);

	// 2. http profile
	test("should retrieve page title using http profile", async () => {
		if (!NETWORK_OK) {
			console.warn("[SKIP] http profile test skipped: SKIP_NETWORK_TESTS=1");
			return;
		}
		if (!(await isHttpProfileAvailable())) {
			console.warn(
				"[SKIP] http profile test skipped: curl-impersonate library not found",
			);
			return;
		}
		const page = await Browser.newPage({ profile: "http" });
		try {
			await page.goto(TEST_URL);
			const title = await getPageTitle(page);
			expect(title).toBeDefined();
			expect(typeof title).toBe("string");
			const titleLower = title.toLowerCase();
			const isFutGg = titleLower.includes("fut.gg");
			const isSuccessfullyRetrieved = title.length > 0;
			expect(isFutGg || isSuccessfullyRetrieved).toBe(true);
		} finally {
			await page.close();
		}
	}, 30_000);

	// 3. ghost profile
	test("should retrieve page title using ghost profile", async () => {
		if (!NETWORK_OK) {
			console.warn("[SKIP] ghost profile test skipped: SKIP_NETWORK_TESTS=1");
			return;
		}
		if (!(await isGhostProfileAvailable())) {
			console.warn(
				"[SKIP] ghost profile test skipped: lightpanda binary not found",
			);
			return;
		}
		const ghost = await launchGhostBrowser();
		try {
			await ghost.page.goto(TEST_URL);
			const title = await getPageTitle(ghost.page);
			expect(title).toBeDefined();
			expect(typeof title).toBe("string");
			const titleLower = title.toLowerCase();
			const isFutGg = titleLower.includes("fut.gg");
			const isSuccessfullyRetrieved = title.length > 0;
			expect(isFutGg || isSuccessfullyRetrieved).toBe(true);
		} finally {
			await ghost.close();
		}
	}, 60_000);
});
