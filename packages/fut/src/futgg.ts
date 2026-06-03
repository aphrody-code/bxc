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

import { Browser } from "@aphrody/bxc";
import { launchGhostBrowser } from "@aphrody/bxc/profiles/ghost";
import pRetry, { AbortError } from "p-retry";
import type { FutPlayer } from "./types.ts";

export async function scrapeFutGgPlayer(
	urlOrHtml: string,
	profile: "static" | "http" | "ghost" = "static",
): Promise<FutPlayer> {
	let content = "";
	let title = "";

	if (urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://")) {
		const fetched = await pRetry(
			async () => {
				if (profile === "ghost") {
					const ghost = await launchGhostBrowser();
					try {
						const res = await ghost.page.goto(urlOrHtml);
						await Bun.sleep(2000);
						const content = await ghost.page.content();
						const title = await ghost.page.title();
						if (
							title.includes("Just a moment") ||
							title.includes("Cloudflare")
						) {
							throw new AbortError("Cloudflare Turnstile challenge detected");
						}
						if (res && res.status === 404) {
							throw new AbortError(`404 Not Found: ${urlOrHtml}`);
						}
						return { content, title };
					} finally {
						await ghost.close();
					}
				} else {
					const page = await Browser.newPage({ profile });
					try {
						const res = await page.goto(urlOrHtml);
						const title = await page.title();
						if (
							title.includes("Just a moment") ||
							title.includes("Cloudflare")
						) {
							throw new AbortError("Cloudflare Turnstile challenge detected");
						}
						if (res && res.status === 404) {
							throw new AbortError(`404 Not Found: ${urlOrHtml}`);
						}
						if (res && res.status >= 500) {
							throw new Error(`Server error ${res.status}: ${urlOrHtml}`);
						}
						const content = await page.content();
						return { content, title };
					} finally {
						await page.close();
					}
				}
			},
			{
				retries: 2,
				onFailedAttempt: (failedAttempt) => {
					console.warn(
						`  [Retry FutGg] Attempt ${failedAttempt.attemptNumber} failed. ${failedAttempt.retriesLeft} retries left. Error: ${failedAttempt.message}`,
					);
				},
			},
		);
		content = fetched.content;
		title = fetched.title;
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
	let cheerioClub: string | undefined = undefined;
	let cheerioNation: string | undefined = undefined;
	let cheerioLeague: string | undefined = undefined;

	try {
		const { load } = await import("cheerio");
		const $ = load(content);
		cheerioClub = $('a[href*="/clubs/"]').first().text().trim() || undefined;
		cheerioNation =
			$('a[href*="/nations/"]').first().text().trim() || undefined;
		cheerioLeague =
			$('a[href*="/leagues/"]').first().text().trim() || undefined;
	} catch {
		// Ignore Cheerio loading/parsing errors, fall back to RegExp
	}

	const clubMatch =
		/href="\/clubs\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const club =
		cheerioClub ||
		(clubMatch
			? clubMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

	const nationMatch =
		/href="\/nations\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const nation =
		cheerioNation ||
		(nationMatch
			? nationMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

	const leagueMatch =
		/href="\/leagues\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const league =
		cheerioLeague ||
		(leagueMatch
			? leagueMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

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
	let skillMoves = smMatch ? parseInt(smMatch[1], 10) : undefined;
	if (skillMoves === undefined) {
		const smSerMatch = /\bskillMoves\s*:\s*(\d+)/.exec(content);
		if (smSerMatch) skillMoves = parseInt(smSerMatch[1], 10);
	}

	const wfMatch =
		/\bWeak\s+Foot\s*:\s*(\d)/i.exec(content) ||
		/(\d)\s*(?:star|★)\s*Weak\s+Foot/i.exec(content) ||
		/Weak\s+Foot\s*(\d)/i.exec(content);
	let weakFoot = wfMatch ? parseInt(wfMatch[1], 10) : undefined;
	if (weakFoot === undefined) {
		const wfSerMatch = /\bweakFoot\s*:\s*(\d+)/.exec(content);
		if (wfSerMatch) weakFoot = parseInt(wfSerMatch[1], 10);
	}

	// 5. Extract Workrates
	const wrMatch =
		/Work\s*Rates?\s*:\s*([HLM][a-z]+)\s*\/\s*([HLM][a-z]+)/i.exec(content);
	let workrateAttack = wrMatch ? wrMatch[1].trim() : undefined;
	let workrateDefense = wrMatch ? wrMatch[2].trim() : undefined;
	if (workrateAttack === undefined || workrateDefense === undefined) {
		const wraSerMatch =
			/\battackingWorkrate\s*:\s*(?:"([^"]+)"|([a-z]+|null))/.exec(content);
		const wrdSerMatch =
			/\bdefensiveWorkrate\s*:\s*(?:"([^"]+)"|([a-z]+|null))/.exec(content);
		if (wraSerMatch && wraSerMatch[1]) workrateAttack = wraSerMatch[1];
		if (wrdSerMatch && wrdSerMatch[1]) workrateDefense = wrdSerMatch[1];
	}

	// 6. Differentiate standard Playstyles and Playstyles+ (Plus)
	const playstylesPlus: string[] = [];
	const playstylesSet = new Set<string>();
	const playstylesPlusSet = new Set<string>();

	const playstyleBlockRegex =
		/<div class="relative table[^"]*">([\s\S]*?)<span class="overflow-hidden">([^<]+)<\/span>/g;
	let psMatch;
	while ((psMatch = playstyleBlockRegex.exec(content)) !== null) {
		const block = psMatch[1];
		const name = psMatch[2].trim();
		if (block.toLowerCase().includes("#e3c075")) {
			playstylesPlusSet.add(name);
		} else {
			playstylesSet.add(name);
		}
	}

	// Fallback to regex checks if HTML structure parsing found nothing (e.g. mock HTML or altered markup)
	if (playstylesSet.size === 0 && playstylesPlusSet.size === 0) {
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
			"Long Ball",
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
			"Aerial",
			"Aerial Fortress",
		];
		for (const ps of KNOWN_PLAYSTYLES) {
			const plusRegex = new RegExp(`\\b${ps}\\+|\\b${ps}\\s+Plus\\b`, "i");
			if (plusRegex.test(content)) {
				playstylesPlusSet.add(ps);
			} else {
				const normalRegex = new RegExp(`\\b${ps}\\b`, "i");
				if (normalRegex.test(content)) {
					playstylesSet.add(ps);
				}
			}
		}
	}

	for (const ps of playstylesSet) {
		playstyles.push(ps);
	}
	for (const ps of playstylesPlusSet) {
		playstylesPlus.push(ps);
	}

	// 7. Parse Biology, Card Attributes, and Detailed Stats from serialized state
	const overallMatch = /\boverall\s*:\s*(\d+)/.exec(content);
	const overallRating = overallMatch
		? parseInt(overallMatch[1], 10)
		: undefined;

	const dobMatch = /\bdateOfBirth\s*:\s*"([^"]+)"/.exec(content);
	const dateOfBirth = dobMatch ? dobMatch[1] : undefined;

	const heightMatch = /\bheight\s*:\s*(\d+)/.exec(content);
	const heightVal = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

	const weightMatch = /\bweight\s*:\s*(\d+)/.exec(content);
	const weightVal = weightMatch ? parseInt(weightMatch[1], 10) : undefined;

	const ageMatch = /\bage\s*:\s*(\d+)/.exec(content);
	const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;

	const footRawMatch = /\bfoot\s*:\s*(?:"([^"]+)"|(\d+))/.exec(content);
	let foot: string | undefined = undefined;
	if (footRawMatch) {
		if (footRawMatch[1]) {
			foot = footRawMatch[1];
		} else if (footRawMatch[2]) {
			foot = footRawMatch[2] === "2" ? "Left" : "Right";
		}
	}

	const altPosMatch =
		/alternativePositions\s*:\s*(?:\$R\[\d+\]\s*=\s*)?(\[[^\]]*\])/.exec(
			content,
		);
	let alternativePositions: string[] = [];
	if (altPosMatch && altPosMatch[1]) {
		try {
			alternativePositions = JSON.parse(
				altPosMatch[1]
					.replace(/'/g, '"')
					.replace(/!1/g, "false")
					.replace(/!0/g, "true"),
			);
		} catch {}
	}

	const rarityMatch =
		/Rarity<\/span><span[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/span>/i.exec(
			content,
		);
	const rarity = rarityMatch ? rarityMatch[1].trim() : undefined;

	const accMatch = /AcceleRATE<\/span><span[^>]*>\s*([^<]+)\s*<\/span>/i.exec(
		content,
	);
	const accelerateType = accMatch ? accMatch[1].trim() : undefined;

	const isWomenMatch = /\bisWomen\s*:\s*(![01]|true|false)/.exec(content);
	const gender =
		isWomenMatch && (isWomenMatch[1] === "!0" || isWomenMatch[1] === "true")
			? "Women"
			: "Men";

	const subStats: Record<string, number> = {};
	const subStatNames = [
		"Acceleration",
		"SprintSpeed",
		"Agility",
		"Balance",
		"Reactions",
		"BallControl",
		"Dribbling",
		"Composure",
		"Jumping",
		"Stamina",
		"Strength",
		"Aggression",
		"Interceptions",
		"HeadingAccuracy",
		"DefensiveAwareness",
		"StandingTackle",
		"SlidingTackle",
		"Vision",
		"Crossing",
		"FkAccuracy",
		"ShortPassing",
		"LongPassing",
		"Curve",
		"Positioning",
		"Finishing",
		"ShotPower",
		"LongShots",
		"Volleys",
		"Penalties",
		"GkDiving",
		"GkHandling",
		"GkKicking",
		"GkReflexes",
		"GkPositioning",
		"GkSpeed",
	];
	for (const statName of subStatNames) {
		const match = new RegExp(
			`\\battribute${statName}\\s*:\\s*(\\d+)`,
			"i",
		).exec(content);
		if (match && match[1]) {
			const key = statName.charAt(0).toLowerCase() + statName.slice(1);
			subStats[key] = parseInt(match[1], 10);
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

		// New expanded biology/card properties
		overallRating,
		dateOfBirth,
		height: heightVal,
		weight: weightVal,
		foot,
		age,
		rarity,
		accelerateType,
		gender,
		alternativePositions,

		// Detailed stats
		acceleration: subStats.acceleration,
		sprintSpeed: subStats.sprintSpeed,
		agility: subStats.agility,
		balance: subStats.balance,
		reactions: subStats.reactions,
		ballControl: subStats.ballControl,
		dribbling: subStats.dribbling,
		composure: subStats.composure,
		jumping: subStats.jumping,
		stamina: subStats.stamina,
		strength: subStats.strength,
		aggression: subStats.aggression,
		interceptions: subStats.interceptions,
		headingAccuracy: subStats.headingAccuracy,
		defensiveAwareness: subStats.defensiveAwareness,
		standingTackle: subStats.standingTackle,
		slidingTackle: subStats.slidingTackle,
		vision: subStats.vision,
		crossing: subStats.crossing,
		fkAccuracy: subStats.fkAccuracy,
		shortPassing: subStats.shortPassing,
		longPassing: subStats.longPassing,
		curve: subStats.curve,
		positioning: subStats.positioning,
		finishing: subStats.finishing,
		shotPower: subStats.shotPower,
		longShots: subStats.longShots,
		volleys: subStats.volleys,
		penalties: subStats.penalties,
		gkDiving: subStats.gkDiving,
		gkHandling: subStats.gkHandling,
		gkKicking: subStats.gkKicking,
		gkReflexes: subStats.gkReflexes,
		gkPositioning: subStats.gkPositioning,
		gkSpeed: subStats.gkSpeed,
	};
}
