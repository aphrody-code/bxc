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

import { scrapeFutGgPlayer } from "../futgg.ts";
import { scrapeFutBinPrice } from "../futbin.ts";

const RUN_LIVE = !process.env.SKIP_NETWORK_TESTS;

async function runMapping() {
	if (!RUN_LIVE) {
		console.log("[SKIP] SKIP_NETWORK_TESTS=1 is set, skipping live mapping.");
		return;
	}

	console.log("=== Starting FUT Data Mapping ===");

	const futGgPlayerUrl =
		"https://www.fut.gg/players/170890-blaise-matuidi/26-50502538/";
	const futBinPlayerUrl =
		"https://www.futbin.com/26/player/20801/cristiano-ronaldo";

	// 1. Scrape FUT.gg Player
	try {
		console.log(`\nMapping FUT.gg player info: ${futGgPlayerUrl}...`);
		const player = await scrapeFutGgPlayer(futGgPlayerUrl, "static");
		console.log("-> Success! Extracted Details:");
		console.log(JSON.stringify(player, null, 2));
	} catch (e: any) {
		console.error(`FUT.gg Scrape Failed: ${e.message}`);
	}

	// 2. Scrape FUTBin Price (using http fallback if ghost not available, or ghost)
	try {
		console.log(`\nMapping FUTBin player price: ${futBinPlayerUrl}...`);
		const priceInfo = await scrapeFutBinPrice(futBinPlayerUrl, "ghost");
		console.log("-> Success! Extracted Details:");
		console.log(JSON.stringify(priceInfo, null, 2));
	} catch (e: any) {
		console.error(`FUTBin Scrape Failed: ${e.message}`);
	}

	console.log("\n=== FUT Data Mapping Complete ===");
}

runMapping().then(() => process.exit(0));
