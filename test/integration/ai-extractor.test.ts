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

import { describe, expect, it } from "bun:test";
import { Browser } from "../../src/api/browser.ts";
function logSkip(reason: string): void {
	console.warn(`[SKIP] ${reason}`);
}

describe("Stagehand-style AI Extractor", () => {
	it("should extract data using Anthropic API", async () => {
		if (!Bun.env.ANTHROPIC_API_KEY) {
			logSkip("ANTHROPIC_API_KEY is not set");
			return;
		}

		// Mock product page
		const html = `
			<!DOCTYPE html>
			<html>
			<body>
				<header>
					<nav>Ignore this nav</nav>
				</header>
				<main>
					<div class="product-container">
						<h1 id="title" class="product-title-text">Bunlight Super Scraper 3000</h1>
						<div class="price-box">
							<span class="currency">$</span>
							<span class="value">99.99</span>
						</div>
						<div class="reviews">
							<span class="rating">4.8 out of 5</span>
							<a href="#reviews">124 reviews</a>
						</div>
						<script>console.log('Ignore script');</script>
					</div>
				</main>
			</body>
			</html>
		`;

		const page = await Browser.newPage({ profile: "static" }) as import("../../src/api/browser.ts").Page;
		await page.setContent(html);

		const instruction = "product title, exact price (number only), and rating out of 5";
		const { data, selectors } = await page.aiExtract(instruction);

		// Assertions on the generated selectors
		expect(Object.keys(selectors).length).toBeGreaterThanOrEqual(3);

		// Assertions on the extracted data
		// Since we use LLM, keys might vary slightly, but we expect something like title, price, rating
		const dataStr = JSON.stringify(data).toLowerCase();
		expect(dataStr).toContain("bunlight super scraper 3000");
		expect(dataStr).toContain("99.99");
		expect(dataStr).toContain("4.8");

		await page.close();
	}, 15000); // 15s timeout for API call
});
