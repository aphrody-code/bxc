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

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { startCloudflareMock } from "./mocks/cloudflare-simulator.ts";
import { Browser } from "../src/api/browser.ts";

describe("Stealth Challenge System", () => {
	let mockServer: ReturnType<typeof startCloudflareMock>;
	const PORT = 29523;
	const MOCK_URL = `http://localhost:${PORT}/`;

	beforeAll(() => {
		mockServer = startCloudflareMock(PORT);
		// Allow hitting localhost for tests
		process.env.OBSCURA_ALLOW_PRIVATE_NETWORK = "1";
	});

	afterAll(() => {
		mockServer.stop();
	});

	test("Tier 1: Static mode fails on challenge (no JS)", async () => {
		const page = await Browser.newPage({ profile: "static" });
		const resp = await page.goto(MOCK_URL);

		// The mock returns 403 for bot detection (no Mozilla UA)
		expect(resp.status).toBe(403);
		const content = await page.content();
		expect(content).toContain("Bot detected");
		await page.close();
	});

	test.skip("Tier 2: Ghost mode solves challenge (with JS/Stealth)", async () => {
		// Ghost mode uses Rust-driven Chromium which handles the mock script
		const page = await Browser.newPage({
			profile: "stealth",
			userAgent:
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			// Force high-stealth headers
			httpOpts: { profile: "chrome131" },
		});

		await page.goto(MOCK_URL);

		// The mock reload logic should trigger and set cf_clearance
		// We wait for the JSON response
		await Bun.sleep(1000);

		const content = await page.content();
		expect(content).toContain("Cloudflare Mock Passed");
		await page.close();
	});

	test.skip("Mandate Check: Real-world stealth on Google", async () => {
		const page = await Browser.newPage({
			profile: "stealth",
			userAgent:
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		});
		await page.goto("https://www.google.com/search?q=bxc+stealth+test");

		// Wait for actual Chromium navigation since our raw API doesn't auto-wait for lifecycle yet
		await Bun.sleep(2000);

		const title = await page.title();
		expect(title).toContain("Google");
		await page.close();
	});
});
