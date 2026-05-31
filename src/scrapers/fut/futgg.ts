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
	urlOrHtml: string,
	profile: "static" | "http" | "ghost" = "static",
): Promise<FutPlayer> {
	let content = "";
	let title = "";

	if (urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://")) {
		if (profile === "ghost") {
			const ghost = await launchGhostBrowser();
			try {
				await ghost.page.goto(urlOrHtml);
				await Bun.sleep(2000);
				content = await ghost.page.content();
				title = await ghost.page.title();
			} finally {
				await ghost.close();
			}
		} else {
			const page = await Browser.newPage({ profile });
			try {
				await page.goto(urlOrHtml);
				content = await page.content();
				title = await page.title();
			} finally {
				await page.close();
			}
		}
	} else {
		content = urlOrHtml;
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

	// 2. Extract Club, Nation, and League
	const clubMatch =
		/href="\/clubs\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const club = clubMatch
		? clubMatch[2]
				.replace(/&#x27;/g, "'")
				.replace(/&amp;/g, "&")
				.trim()
		: undefined;

	const nationMatch =
		/href="\/nations\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const nation = nationMatch
		? nationMatch[2]
				.replace(/&#x27;/g, "'")
				.replace(/&amp;/g, "&")
				.trim()
		: undefined;

	const leagueMatch =
		/href="\/leagues\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const league = leagueMatch
		? leagueMatch[2]
				.replace(/&#x27;/g, "'")
				.replace(/&amp;/g, "&")
				.trim()
		: undefined;

	// 3. Extract standard Stats (PAC, SHO, PAS, DRI, DEF, PHY) or Goalkeeper Stats (DIV, HAN, KIC, REF, SPD, POS)
	const stats: Record<string, number> = {};
	const statNames = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
	for (const stat of statNames) {
		const regex = new RegExp(
			`${stat}<\\/div><div class="[^"]*">(\\d{2})<\\/div>`,
			"i",
		);
		const match = regex.exec(content);
		if (match && match[1]) {
			stats[stat.toLowerCase()] = parseInt(match[1], 10);
		}
	}

	const gkStats: Record<string, number> = {};
	const gkStatNames = ["DIV", "HAN", "KIC", "REF", "SPD", "POS"];
	for (const stat of gkStatNames) {
		const regex = new RegExp(
			`${stat}<\\/div><div class="[^"]*">(\\d{2})<\\/div>`,
			"i",
		);
		const match = regex.exec(content);
		if (match && match[1]) {
			gkStats[stat.toLowerCase()] = parseInt(match[1], 10);
		}
	}

	const hasStandardStats = Object.keys(stats).length > 0;
	const hasGkStats = Object.keys(gkStats).length > 0;

	// Identify generic hub/listing pages (if a page has no stats at all, it's generic)
	const isGeneric =
		(!hasStandardStats && !hasGkStats) ||
		name.includes("Players") ||
		name.includes("Evolutions") ||
		name.includes("SBCs") ||
		name.toLowerCase().includes("squad builder") ||
		name.toLowerCase().includes("sbc solutions");

	// 4. Extract Weak Foot and Skill Moves
	const smMatch =
		/\bSkill\s+Moves\s*:\s*(\d)/i.exec(content) ||
		/(\d)\s*(?:star|★)\s*Skill\s+Moves/i.exec(content) ||
		/Skill\s+Moves\s*(\d)/i.exec(content);
	const skillMoves = smMatch ? parseInt(smMatch[1], 10) : undefined;

	const wfMatch =
		/\bWeak\s+Foot\s*:\s*(\d)/i.exec(content) ||
		/(\d)\s*(?:star|★)\s*Weak\s+Foot/i.exec(content) ||
		/Weak\s+Foot\s*(\d)/i.exec(content);
	const weakFoot = wfMatch ? parseInt(wfMatch[1], 10) : undefined;

	// 5. Extract Workrates
	const wrMatch =
		/Work\s*Rates?\s*:\s*([HLM][a-z]+)\s*\/\s*([HLM][a-z]+)/i.exec(content);
	const workrateAttack = wrMatch ? wrMatch[1].trim() : undefined;
	const workrateDefense = wrMatch ? wrMatch[2].trim() : undefined;

	// 6. Differentiate standard Playstyles and Playstyles+ (Plus)
	const playstylesPlus: string[] = [];
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
		const plusRegex = new RegExp(`\\b${ps}\\+|\\b${ps}\\s+Plus\\b`, "i");
		if (plusRegex.test(content)) {
			playstylesPlus.push(ps);
		} else {
			const normalRegex = new RegExp(`\\b${ps}\\b`, "i");
			if (normalRegex.test(content)) {
				playstyles.push(ps);
			}
		}
	}

	return {
		name,
		rating,
		position,
		club,
		nation,
		league,
		playstyles,
		playstylesPlus,
		pac: stats.pac,
		sho: stats.sho,
		pas: stats.pas,
		dri: stats.dri,
		def: stats.def,
		phy: stats.phy,
		div: gkStats.div,
		han: gkStats.han,
		kic: gkStats.kic,
		ref: gkStats.ref,
		spd: gkStats.spd,
		pos: gkStats.pos,
		skillMoves,
		weakFoot,
		workrateAttack,
		workrateDefense,
		isGeneric,
	};
}
