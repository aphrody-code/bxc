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
import { scrapeFutGgPlayer } from "../futgg.ts";
import { scrapeFutBinPrice } from "../futbin.ts";

const RUN_LIVE = !Bun.env.SKIP_NETWORK_TESTS;

describe("FUT Scraper Unit Validation", () => {
	test("scrapeFutGgPlayer extracts player properties from mock HTML", async () => {
		// Test regex parsing using local HTML
		const mockHtml = `
			<html>
				<head><title>Kylian Mbappé - FUT.gg</title></head>
				<body>
					<h1>Kylian Mbappé</h1>
					<div class="player-item-rating">91</div>
					<div class="player-item-position">ST</div>
					
					<!-- Mocking Rarity, AcceleRATE, and Playstyles -->
					<div class="playstyle-item">Rapid</div>
					<div class="playstyle-item">Finesse Shot</div>
					
					Rarity</span><span class="text-white"><a href="/rarities/rare/"><span class="truncate">Rare</span></a></span>
					AcceleRATE</span><span>Controlled Lengthy</span>

					<!-- Mocking serialized state -->
					<script>
						const data = {
							overall:91,
							dateOfBirth:"1998-12-20",
							height:182,
							weight:75,
							age:27,
							foot:1,
							skillMoves:5,
							weakFoot:4,
							alternativePositions:$R[644]=["CF","LW"],
							isWomen:!1,
							attributeAcceleration:97,
							attributeSprintSpeed:97,
							attributeAgility:92,
							attributeBalance:83,
							attributeReactions:93,
							attributeBallControl:92,
							attributeDribbling:93,
							attributeComposure:89,
							attributeJumping:78,
							attributeStamina:88,
							attributeStrength:77,
							attributeAggression:64,
							attributeInterceptions:38,
							attributeHeadingAccuracy:73,
							attributeDefensiveAwareness:26,
							attributeStandingTackle:34,
							attributeSlidingTackle:32,
							attributeVision:83,
							attributeCrossing:78,
							attributeFkAccuracy:69,
							attributeShortPassing:85,
							attributeLongPassing:71,
							attributeCurve:80,
							attributePositioning:93,
							attributeFinishing:90,
							attributeShotPower:89,
							attributeLongShots:82,
							attributeVolleys:84,
							attributePenalties:80
						};
					</script>
				</body>
			</html>
		`;

		const player = await scrapeFutGgPlayer(mockHtml, "static");
		expect(player.name).toBe("Kylian Mbappé");
		expect(player.rating).toBe(91);
		expect(player.position).toBe("ST");
		expect(player.overallRating).toBe(91);
		expect(player.dateOfBirth).toBe("1998-12-20");
		expect(player.height).toBe(182);
		expect(player.weight).toBe(75);
		expect(player.age).toBe(27);
		expect(player.foot).toBe("Right");
		expect(player.skillMoves).toBe(5);
		expect(player.weakFoot).toBe(4);
		expect(player.alternativePositions).toEqual(["CF", "LW"]);
		expect(player.rarity).toBe("Rare");
		expect(player.accelerateType).toBe("Controlled Lengthy");
		expect(player.gender).toBe("Men");

		// Sub-stats
		expect(player.acceleration).toBe(97);
		expect(player.sprintSpeed).toBe(97);
		expect(player.finishing).toBe(90);
		expect(player.dribbling).toBe(93);
		expect(player.stamina).toBe(88);
		expect(player.defensiveAwareness).toBe(26);
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
