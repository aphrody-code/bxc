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

import { Browser } from "../../api/browser.ts";
import { launchGhostBrowser } from "../../profiles/ghost/index.ts";
import type { FutPlayer } from "./types.ts";

export async function scrapeFutGgPlayer(
	url: string,
	profile: "static" | "http" | "ghost" = "static",
): Promise<FutPlayer> {
	let content = "";
	let title = "";

	if (profile === "ghost") {
		const ghost = await launchGhostBrowser();
		try {
			await ghost.page.goto(url);
			await Bun.sleep(2000);
			content = await ghost.page.content();
			title = await ghost.page.title();
		} finally {
			await ghost.close();
		}
	} else {
		const page = await Browser.newPage({ profile });
		try {
			await page.goto(url);
			content = await page.content();
			title = await page.title();
		} finally {
			await page.close();
		}
	}

	let name = "";
	let ratingStr = "";
	let positionStr = "";
	const playstyles: string[] = [];

	// Use Bun's native HTMLRewriter (Web API) for fast, zero-dependency streaming parse
	const rewriter = new HTMLRewriter()
		.on("h1", {
			text(chunk) {
				name += chunk.text;
			},
		})
		.on(".player-item-rating", {
			text(chunk) {
				ratingStr += chunk.text;
			},
		})
		.on(".player-item-position", {
			text(chunk) {
				positionStr += chunk.text;
			},
		});

	// Transform content HTML natively
	const response = new Response(content);
	await rewriter.transform(response).text();

	// Clean up parsed properties
	name = name.trim();
	if (!name) {
		name = title.split("-")[0]?.trim() || "Unknown Player";
	}

	const rating = parseInt(ratingStr.trim(), 10) || 85;
	let position = positionStr.trim().toUpperCase() || "ST";

	// Fallback to robust heuristics if selectors returned empty (e.g. Cloudflare challenged page structure)
	if (position === "ST") {
		const posHeuristic =
			new RegExp(
				`${rating}\\s*\\b(CM|CDM|CAM|ST|RW|LW|CF|CB|LB|RB|LWB|RWB|GK)\\b`,
				"i",
			).exec(content) ||
			/\b(CM|CDM|CAM|ST|RW|LW|CF|CB|LB|RB|LWB|RWB|GK)\b/i.exec(content);
		if (posHeuristic) {
			position = posHeuristic[1].toUpperCase();
		}
	}

	const KNOWN_PLAYSTYLES = [
		"Jockey",
		"Intercept",
		"Anticipate",
		"Block",
		"Bruiser",
		"Slide Tackle",
		"Power Header",
		"Finesse Shot",
		"Power Shot",
		"Dead Ball",
		"Chip Shot",
		"Pinged Pass",
		"Incisive Pass",
		"Long Ball Pass",
		"Tiki Taka",
		"Whipped Pass",
		"First Touch",
		"Flair",
		"Press Proven",
		"Rapid",
		"Technical",
		"Trickster",
		"Quick Step",
		"Relentless",
		"Trivela",
		"Acrobatic",
	];
	for (const ps of KNOWN_PLAYSTYLES) {
		if (new RegExp(`\\b${ps}\\b`, "i").test(content)) {
			playstyles.push(ps);
		}
	}

	return {
		name,
		rating,
		position,
		playstyles,
	};
}
