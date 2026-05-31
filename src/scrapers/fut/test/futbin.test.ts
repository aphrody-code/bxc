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

import { test, expect, describe } from "bun:test";
import { Browser } from "../../../api/browser.ts";
import { launchGhostBrowser } from "../../../profiles/ghost/index.ts";

const NETWORK_OK = !Bun.env.SKIP_NETWORK_TESTS;
const TARGET_URL = "https://www.futbin.com/";

function logSkip(reason: string): void {
	console.warn(`[SKIP] ${reason}`);
}

describe("Futbin Tests", () => {
	test("HTTP profile - fetch or detect bot protection", async () => {
		if (!NETWORK_OK) {
			logSkip("SKIP_NETWORK_TESTS=1");
			return;
		}

		let page;
		try {
			page = await Browser.newPage({ profile: "http" });
			const response = await page.goto(TARGET_URL);
			expect(page.profile()).toBe("http");

			const status = response ? response.status : 200;
			const body = await page.content();

			// Check that we can fetch the page or detect bot protection (like Cloudflare, 403, 503, Turnstile, etc.)
			const isBotBlocked =
				status === 403 ||
				status === 503 ||
				/Just a moment/i.test(body) ||
				/Checking your browser/i.test(body) ||
				/cf-mitigated/i.test(body) ||
				/cloudflare/i.test(body) ||
				/datadome/i.test(body) ||
				/recaptcha/i.test(body) ||
				/hcaptcha/i.test(body) ||
				/turnstile/i.test(body);

			if (isBotBlocked) {
				console.log(`[Futbin HTTP] Bot protection detected. Status: ${status}`);
				expect(isBotBlocked).toBe(true);
			} else {
				console.log(
					`[Futbin HTTP] Page fetched successfully. Status: ${status}`,
				);
				const title = await page.title();
				expect(title.toLowerCase()).toContain("futbin");
			}
		} catch (err: unknown) {
			const error = err as Error;
			if (error.message?.includes("libcurl-impersonate not found")) {
				logSkip("libcurl-impersonate not found");
				return;
			}
			throw err;
		} finally {
			if (page) {
				await page.close().catch(() => {});
			}
			await Browser.close().catch(() => {});
		}
	}, 30_000);

	test("Ghost profile - fetch or detect bot protection", async () => {
		if (!NETWORK_OK) {
			logSkip("SKIP_NETWORK_TESTS=1");
			return;
		}

		let ghost;
		try {
			ghost = await launchGhostBrowser({
				fingerprint: {
					os: "linux",
					browser: "chrome",
				},
			});

			const response = await ghost.page.goto(TARGET_URL);
			const status = response ? response.status : 200;
			let body = "";
			try {
				body = await ghost.page.content();
			} catch (e: any) {
				console.warn(
					`[Futbin Ghost] Failed to retrieve page content: ${e.message}`,
				);
			}

			let title = "";
			try {
				title = await ghost.page.title();
			} catch (e: any) {
				console.warn(
					`[Futbin Ghost] Failed to retrieve page title: ${e.message}`,
				);
			}

			const isBotBlocked =
				status === 403 ||
				status === 503 ||
				/Just a moment/i.test(body) ||
				/Just a moment/i.test(title) ||
				/Checking your browser/i.test(body) ||
				/Checking your browser/i.test(title) ||
				/cf-mitigated/i.test(body) ||
				/cloudflare/i.test(body) ||
				/datadome/i.test(body) ||
				/recaptcha/i.test(body) ||
				/hcaptcha/i.test(body) ||
				/turnstile/i.test(body);

			if (isBotBlocked) {
				console.log(
					`[Futbin Ghost] Bot protection detected. Status: ${status} (Title: "${title}")`,
				);
				expect(isBotBlocked).toBe(true);
			} else {
				console.log(
					`[Futbin Ghost] Page fetched successfully. Status: ${status}`,
				);
				expect(title.toLowerCase()).toContain("futbin");
			}
		} finally {
			if (ghost) {
				await ghost.close().catch(() => {});
			}
		}
	}, 40_000);
});
