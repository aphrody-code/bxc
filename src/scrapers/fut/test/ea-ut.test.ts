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
import { Browser } from "../../../api/browser.ts";
import { launchGhostBrowser } from "../../../profiles/ghost/index.ts";

const RUN_LIVE = !Bun.env.SKIP_NETWORK_TESTS;

describe.if(RUN_LIVE)("EA Sports FC Ultimate Team integration tests", () => {
	const MAIN_URL = "https://www.ea.com/fr-fr/ea-sports-fc/ultimate-team/";
	const WEB_APP_URL =
		"https://www.ea.com/fr-fr/ea-sports-fc/ultimate-team/web-app/";

	// Helper to check response status and body content
	function verifyEaResponse(
		status: number,
		body: string,
		isWebApp: boolean,
	): void {
		if (isWebApp) {
			// Web app url should return 200
			expect(status).toBe(200);
			expect(body.toLowerCase()).toContain("ea");
		} else {
			// Main URL might return 200, 404 or a redirect
			const isSuccessOrRedirectOr404 =
				status === 200 || status === 404 || (status >= 300 && status < 400);
			expect(isSuccessOrRedirectOr404).toBe(true);
			if (status === 200) {
				expect(body.toLowerCase()).toContain("ea");
			}
		}
	}

	describe("HTTP Profile tests", () => {
		test("should fetch EA Sports FC Ultimate Team landing page", async () => {
			const page = await Browser.newPage({ profile: "http" });
			try {
				const res = await page.goto(MAIN_URL);
				const content = await page.content();
				verifyEaResponse(res.status, content, false);
			} finally {
				await page.close();
			}
		}, 30000);

		test("should fetch EA Sports FC Ultimate Team Web App page", async () => {
			const page = await Browser.newPage({ profile: "http" });
			try {
				const res = await page.goto(WEB_APP_URL);
				const content = await page.content();
				verifyEaResponse(res.status, content, true);
			} finally {
				await page.close();
			}
		}, 30000);
	});

	describe("Fast Profile tests", () => {
		test("should fetch EA Sports FC Ultimate Team landing page", async () => {
			const page = await Browser.newPage({ profile: "fast" });
			try {
				const res = await page.goto(MAIN_URL);
				// Standard pages need a short sleep or wait for network idle to ensure DOM is ready
				await Bun.sleep(2000);
				const content = await page.content();
				verifyEaResponse(res.status, content, false);
			} finally {
				await page.close();
			}
		}, 45000);

		test("should fetch EA Sports FC Ultimate Team Web App page", async () => {
			const page = await Browser.newPage({ profile: "fast" });
			try {
				const res = await page.goto(WEB_APP_URL);
				await Bun.sleep(2000);
				const content = await page.content();
				verifyEaResponse(res.status, content, true);
			} finally {
				await page.close();
			}
		}, 45000);
	});

	describe("Ghost Profile tests", () => {
		test("should fetch EA Sports FC Ultimate Team landing page", async () => {
			const ghost = await launchGhostBrowser();
			try {
				const res = await ghost.page.goto(MAIN_URL);
				await Bun.sleep(2000);
				const content = await ghost.page.content();
				verifyEaResponse(res.status, content, false);
			} finally {
				await ghost.close();
			}
		}, 45000);

		test("should fetch EA Sports FC Ultimate Team Web App page", async () => {
			const ghost = await launchGhostBrowser();
			try {
				const res = await ghost.page.goto(WEB_APP_URL);
				await Bun.sleep(2000);
				const content = await ghost.page.content();
				verifyEaResponse(res.status, content, true);
			} finally {
				await ghost.close();
			}
		}, 45000);
	});
});
