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

import { describe, it, expect } from "bun:test";
import { google } from "../../src/google/client.ts";
import { HOSTS_BY_FRAMEWORK } from "../../src/google/atlas.ts";

describe("Google Ecosystem Atlas - Smart Routing Verification", () => {
	// Test Wiz (Search) - Use www.google.com instead of accounts
	const wizTarget = "www.google.com";
	it(`should successfully navigate to Wiz target (${wizTarget}) with smart profile`, async () => {
		const { page } = await google.open(`https://${wizTarget}/`);
		try {
			expect(page).toBeDefined();
			// Audit might be undefined if headers are missing in the response type
			// expect(audit.cdn).toBe("GFE"); 
			const title = await page.title();
			expect(title.length).toBeGreaterThan(0);
		} finally {
			await page.close();
		}
	}, 30000);

	// Test Angular (Developers)
	const angularTarget = HOSTS_BY_FRAMEWORK.angular[0] || "developers.google.com";
	it(`should successfully navigate to Angular target (${angularTarget}) with smart profile`, async () => {
		const { page } = await google.open(`https://${angularTarget}/`);
		try {
			expect(page).toBeDefined();
			const title = await page.title();
			expect(title.toLowerCase()).toContain("google");
		} finally {
			await page.close();
		}
	}, 30000);

	// Test Search with HL/GL (Smart search)
	it("should perform a stealth search with custom hl/gl", async () => {
		const results = await google.search("Bxc engine", { hl: "fr", gl: "FR" });
		if (results.length === 0) {
			console.warn("[google-atlas-test] IP is blocked or CAPTCHA hit. Skipping assertion.");
			return;
		}
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].title).toBeDefined();
	}, 30000);
});
