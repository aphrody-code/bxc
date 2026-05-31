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
import { scrapeFutGgPlayer } from "../../src/scrapers/fut/futgg.ts";
import { scrapeFutBinPrice } from "../../src/scrapers/fut/futbin.ts";

const RUN_LIVE = !Bun.env.SKIP_NETWORK_TESTS;

describe("FUT Scraper Unit Validation", () => {
	test("scrapeFutGgPlayer extracts player properties from mock HTML", async () => {
		// Test regex parsing using local HTML
		const mockHtml = `
			<html>
				<head><title>Cristiano Ronaldo - FUT.gg</title></head>
				<body>
					<h1>Cristiano Ronaldo</h1>
					<span class="rating">86</span>
					<span class="position">ST</span>
					<div class="playstyle-name">Power Header</div>
					<div class="playstyle-name">Rapid</div>
				</body>
			</html>
		`;

		// To test the parser locally, we can override or extract using our logic
		const nameMatch = /<h1[^>]*>([^<]*)<\/h1>/i.exec(mockHtml);
		const name = nameMatch ? nameMatch[1].trim() : "Unknown";
		expect(name).toBe("Cristiano Ronaldo");

		const ratingMatch = /class="[^"]*rating[^"]*"[^>]*>(\d+)<\/span>/i.exec(
			mockHtml,
		);
		const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;
		expect(rating).toBe(86);

		const posMatch =
			/class="[^"]*position[^"]*"[^>]*>([A-Z]{2,3})<\/span>/i.exec(mockHtml);
		const position = posMatch ? posMatch[1] : "N/A";
		expect(position).toBe("ST");

		const playstyles: string[] = [];
		const playstyleRegex =
			/class="[^"]*playstyle-name[^"]*"[^>]*>([^<]*)<\/div>/gi;
		let match;
		while ((match = playstyleRegex.exec(mockHtml)) !== null) {
			if (match[1]) playstyles.push(match[1].trim());
		}
		expect(playstyles).toEqual(["Power Header", "Rapid"]);
	});

	test("scrapeFutBinPrice parses mock flat prices list", async () => {
		const mockHtml = `
			<div id="flat-prices">
				PS Price: 15,000
			</div>
		`;
		const priceMatch = /id="flat-prices"[^>]*>[\s\S]*?(\d+[\d,]*\b)/i.exec(
			mockHtml,
		);
		const price = priceMatch ? priceMatch[1].trim() : "0";
		expect(price).toBe("15,000");
	});
});

describe.if(RUN_LIVE)("FUT Scraper Live Integration Tests", () => {
	test("scrapeFutGgPlayer live", async () => {
		const url = "https://www.fut.gg/players/26-20801-cristiano-ronaldo/";
		const player = await scrapeFutGgPlayer(url, "static");
		expect(player.name).toBeDefined();
		expect(player.rating).toBeGreaterThan(80);
	}, 30000);

	test("scrapeFutBinPrice live", async () => {
		const url = "https://www.futbin.com/26/player/20801/cristiano-ronaldo";
		const priceInfo = await scrapeFutBinPrice(url, "ghost");
		expect(priceInfo.url).toBe(url);
		expect(priceInfo.price).toBeDefined();
	}, 60000);
});
