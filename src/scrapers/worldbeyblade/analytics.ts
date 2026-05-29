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

import * as cheerio from "cheerio";
import type {
	WorldBeybladeThread,
	WBOTournament,
	WBOPodium,
	WBOCombo,
	WBOAnomaly,
	WBOPartRanking,
	WBOComboSynergy,
	WBOMetagameData,
} from "./types.ts";

// Normalization maps for Blades and Bits
export const BLADE_MAP: Record<string, string> = {
	"pheonix wing": "Phoenix Wing",
	"phoenix wing": "Phoenix Wing",
	pheonixwing: "Phoenix Wing",
	phoenixwing: "Phoenix Wing",
	"wyvern gail": "Wyvern Gale",
	"wyvern gale": "Wyvern Gale",
	wyverngale: "Wyvern Gale",
	hellscythe: "Hells Scythe",
	hellsscythe: "Hells Scythe",
	"hells scythe": "Hells Scythe",
	"hell scythe": "Hells Scythe",
	sharkedge: "Shark Edge",
	"shark edge": "Shark Edge",
	cobaltdrake: "Cobalt Drake",
	"cobalt drake": "Cobalt Drake",
	colbaltdrake: "Cobalt Drake",
	"colbalt drake": "Cobalt Drake",
	dransword: "Dran Sword",
	"dran sword": "Dran Sword",
	drandagger: "Dran Dagger",
	"dran dagger": "Dran Dagger",
	wizardarrow: "Wizard Arrow",
	"wizard arrow": "Wizard Arrow",
	knightshield: "Knight Shield",
	"knight shield": "Knight Shield",
	"knight lance": "Knight Lance",
	knightlance: "Knight Lance",
	vipertail: "Viper Tail",
	"viper tail": "Viper Tail",
	hellschain: "Hells Chain",
	"hells chain": "Hells Chain",
	"hell chain": "Hells Chain",
	leonclaw: "Leon Claw",
	"leon claw": "Leon Claw",
	unicornsting: "Unicorn Sting",
	"unicorn sting": "Unicorn Sting",
	tyrannobeat: "Tyranno Beat",
	"tyranno beat": "Tyranno Beat",
	"dranzer s": "Dranzer S",
	"dranzer-s": "Dranzer S",
	dranzer: "Dranzer S",
	dranzerspiral: "Dranzer S",
	"dranzer spiral": "Dranzer S",
	rhinohorn: "Rhinohorn",
	"rhino horn": "Rhinohorn",
	"phoenix feather": "Phoenix Feather",
	phoenixfeather: "Phoenix Feather",
};

export const BIT_MAP: Record<string, string> = {
	"gear ball": "Gear Ball",
	gb: "Gear Ball",
	ball: "Ball",
	b: "Ball",
	orb: "Orb",
	o: "Orb",
	rush: "Rush",
	r: "Rush",
	point: "Point",
	p: "Point",
	flat: "Flat",
	f: "Flat",
	"gear flat": "Gear Flat",
	gf: "Gear Flat",
	taper: "Taper",
	tapered: "Taper",
	t: "Taper",
	"high taper": "High Taper",
	"high tapered": "High Taper",
	ht: "High Taper",
	needle: "Needle",
	n: "Needle",
	"high needle": "High Needle",
	hn: "High Needle",
	orbit: "Orbit",
	ob: "Orbit",
	spike: "Spike",
	s: "Spike",
	"low flat": "Low Flat",
	lf: "Low Flat",
	lowflat: "Low Flat",
	"gear needle": "Gear Needle",
	gn: "Gear Needle",
	"gear point": "Gear Point",
	gp: "Gear Point",
	hexa: "Hexa",
	h: "Hexa",
	accel: "Accel",
	a: "Accel",
	glide: "Glide",
	g: "Glide",
	"metal needle": "Metal Needle",
	mn: "Metal Needle",
};

export const BLADE_KEYWORDS = [
	"wing",
	"scythe",
	"sword",
	"dagger",
	"arrow",
	"shield",
	"lance",
	"tail",
	"chain",
	"claw",
	"sting",
	"beat",
	"dranzer",
	"horn",
	"feather",
	"drake",
	"gale",
	"rhino",
	"viper",
	"wizard",
	"knight",
	"hells",
	"cobalt",
	"tyranno",
];

// Clean a string from common symbols or prefixes
export function cleanComboLine(line: string): string {
	return line
		.replace(/[\u00a0\s]+/g, " ")
		.replace(/^[>\-*•#\s\\]+/g, "")
		.trim();
}

export function cleanStageComments(text: string): string {
	const cleanRegex =
		/\b(?:both stages?|first stages? only|final stages? only|first stages?|final stages?|finals? only|finals?|both|only|stages?)\b/gi;
	return text
		.replace(/\(.*?\)/g, "")
		.replace(/\[.*?\]/g, "")
		.replace(cleanRegex, "")
		.replace(/^[\s\-*,./]+/, "")
		.replace(/[\s\-*,./]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeBlade(blade: string): {
	normalized: string;
	isRecognized: boolean;
} {
	const raw = blade.trim().replace(/[\u00a0\s]+/g, " ");
	const clean = raw.toLowerCase();

	if (BLADE_MAP[clean]) {
		return { normalized: BLADE_MAP[clean], isRecognized: true };
	}

	const standardValues = Object.values(BLADE_MAP);
	if (standardValues.includes(raw)) {
		return { normalized: raw, isRecognized: true };
	}

	return { normalized: raw, isRecognized: false };
}

export function normalizeBit(bit: string): {
	normalized: string;
	isRecognized: boolean;
} {
	const raw = bit.trim().replace(/[\u00a0\s]+/g, " ");
	const clean = raw.toLowerCase();

	if (BIT_MAP[clean]) {
		return { normalized: BIT_MAP[clean], isRecognized: true };
	}

	const standardValues = Object.values(BIT_MAP);
	if (standardValues.includes(raw)) {
		return { normalized: raw, isRecognized: true };
	}

	return { normalized: raw, isRecognized: false };
}

// Splits the combo line at the first occurrence of a ratchet (e.g. 3-60 or 5-80 or 10-80)
export function parseComboSplit(
	line: string,
	pid: number | string,
	date: string,
	anomalies: WBOAnomaly[],
): WBOCombo | null {
	const cleaned = cleanComboLine(line);

	const ratchetMatch = cleaned.match(/(\d+-\d+)/);
	if (!ratchetMatch?.[1]) {
		return null;
	}

	const ratchet = ratchetMatch[1];
	const index = cleaned.indexOf(ratchet);

	let bladeRaw = cleaned.slice(0, index).trim();
	let bitRaw = cleaned.slice(index + ratchet.length).trim();

	bladeRaw = cleanStageComments(bladeRaw);
	bitRaw = cleanStageComments(bitRaw);

	if (!bladeRaw || !bitRaw) {
		anomalies.push({
			post_id: pid,
			date: date,
			type: "MALFORMED_COMBO",
			text: `[REQUIRES VERIFICATION] Combo line has empty blade or bit: "${line}"`,
		});
		return null;
	}

	const { normalized: blade, isRecognized: bladeOk } = normalizeBlade(bladeRaw);
	const { normalized: bit, isRecognized: bitOk } = normalizeBit(bitRaw);

	if (!bladeOk) {
		anomalies.push({
			post_id: pid,
			date: date,
			type: "UNRECOGNIZED_BLADE",
			text: `[REQUIRES VERIFICATION] Unrecognized blade: "${bladeRaw}" in line: "${line}"`,
		});
	}
	if (!bitOk) {
		anomalies.push({
			post_id: pid,
			date: date,
			type: "UNRECOGNIZED_BIT",
			text: `[REQUIRES VERIFICATION] Unrecognized bit: "${bitRaw}" in line: "${line}"`,
		});
	}

	return { blade, ratchet, bit };
}

// Check if a line is a placement header using strict word boundaries for ignore words
export function isPlacement(
	line: string,
	place: "1st" | "2nd" | "3rd",
): boolean {
	const cleanLine = line.toLowerCase();

	const ignoreRegex =
		/\b(?:stage|format|banlist|event|organized|rules|deck|match|versus|link|photo|video|pics|footage|time|date|place only|stage only)\b/i;
	if (ignoreRegex.test(cleanLine)) {
		return false;
	}

	if (place === "1st") {
		return /\b1st\b|\bfirst\b/i.test(line);
	}
	if (place === "2nd") {
		return /\b2nd\b|\bsecond\b/i.test(line);
	}
	if (place === "3rd") {
		return /\b3rd\b|\b3nd\b|\bthird\b/i.test(line);
	}
	return false;
}

/**
 * Parses a single post's HTML content to extract podium placings.
 */
export function parsePodiumFromPostHtml(
	contentHtml: string,
	pid: number | string,
	postDate: string,
	anomalies: WBOAnomaly[],
): WBOPodium | null {
	const $ = cheerio.load(contentHtml);
	const cloned = $.root().clone();
	cloned.find("script, style, .post-signature").remove();
	cloned.find("br").replaceWith("\n");
	cloned.find("div, p, li, ul, ol, td, tr, table").each((_, el) => {
		$(el).prepend("\n").append("\n");
	});

	const text = cloned.text();
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const podium: WBOPodium = {
		first_place: [],
		second_place: [],
		third_place: [],
	};

	let currentPlace: "first_place" | "second_place" | "third_place" | null =
		null;
	let hasPlacementHeaders = false;

	for (const line of lines) {
		const cleaned = cleanComboLine(line);

		if (isPlacement(cleaned, "1st")) {
			currentPlace = "first_place";
			hasPlacementHeaders = true;
			continue;
		}
		if (isPlacement(cleaned, "2nd")) {
			currentPlace = "second_place";
			hasPlacementHeaders = true;
			continue;
		}
		if (isPlacement(cleaned, "3rd")) {
			currentPlace = "third_place";
			hasPlacementHeaders = true;
			continue;
		}

		if (currentPlace) {
			const hasRatchet = /(\d+-\d+)/.test(cleaned);
			if (hasRatchet) {
				const combo = parseComboSplit(cleaned, pid, postDate, anomalies);
				if (combo) {
					podium[currentPlace].push(combo);
				}
			} else {
				if (cleaned.length < 80) {
					const cleanLower = cleaned.toLowerCase();
					const hasBladeKeyword = BLADE_KEYWORDS.some((k) =>
						cleanLower.includes(k),
					);
					if (
						hasBladeKeyword &&
						!cleanLower.includes("place") &&
						!cleanLower.startsWith("link:")
					) {
						anomalies.push({
							post_id: pid,
							date: postDate,
							type: "MALFORMED_LINE",
							text: `[REQUIRES VERIFICATION] Line contains blade keyword but no ratchet: "${cleaned}"`,
						});
					}
				}
			}
		}
	}

	if (hasPlacementHeaders) {
		const totalCombos =
			podium.first_place.length +
			podium.second_place.length +
			podium.third_place.length;
		if (totalCombos > 0) {
			if (podium.first_place.length === 0) {
				anomalies.push({
					post_id: pid,
					date: postDate,
					type: "MISSING_FIRST_PLACE",
					text: `[REQUIRES VERIFICATION] Tournament pid_${pid} is missing first place combinations`,
				});
			}
			if (podium.second_place.length === 0) {
				anomalies.push({
					post_id: pid,
					date: postDate,
					type: "MISSING_SECOND_PLACE",
					text: `[REQUIRES VERIFICATION] Tournament pid_${pid} is missing second place combinations`,
				});
			}
			if (podium.third_place.length === 0) {
				anomalies.push({
					post_id: pid,
					date: postDate,
					type: "MISSING_THIRD_PLACE",
					text: `[REQUIRES VERIFICATION] Tournament pid_${pid} is missing third place combinations`,
				});
			}
			return podium;
		}

		anomalies.push({
			post_id: pid,
			date: postDate,
			type: "NO_COMBOS_PARSED",
			text: `[REQUIRES VERIFICATION] Placement headers found but zero combinations parsed for tournament pid_${pid}`,
		});
	}

	return null;
}

/**
 * Parses full raw MyBB Thread HTML content.
 */
export function parseTournamentsFromHtml(html: string): {
	tournaments: WBOTournament[];
	anomalies: WBOAnomaly[];
} {
	const $ = cheerio.load(html);
	const tournaments: WBOTournament[] = [];
	const anomalies: WBOAnomaly[] = [];

	$("div.post_body").each((index, element) => {
		const pidAttr = $(element).attr("id");
		const pidStr = pidAttr ? pidAttr.replace("pid_", "") : `unknown_${index}`;
		const pid = parseInt(pidStr, 10) || index;

		// Skip MyBB rules post index 0 entirely (pid 1857608)
		if (pid === 1857608) {
			return;
		}

		let postDate = "Unknown";
		const postContainer = $(element).closest(".post");
		if (postContainer.length > 0) {
			const dateEl = postContainer.find(".post_date");
			if (dateEl.length > 0) {
				postDate = dateEl
					.text()
					.replace(/&nbsp;/g, " ")
					.trim();
			}
		}

		const postHtml = $(element).html();
		if (postHtml) {
			const podium = parsePodiumFromPostHtml(
				postHtml,
				pid,
				postDate,
				anomalies,
			);
			if (podium) {
				tournaments.push({
					tournament_id: `pid_${pid}`,
					date: postDate,
					podium,
				});
			}
		}
	});

	return { tournaments, anomalies };
}

/**
 * Parses a WorldBeybladeThread containing scraped posts.
 */
export function parseTournamentsFromThread(thread: WorldBeybladeThread): {
	tournaments: WBOTournament[];
	anomalies: WBOAnomaly[];
} {
	const tournaments: WBOTournament[] = [];
	const anomalies: WBOAnomaly[] = [];

	for (const post of thread.posts) {
		// Skip rules post
		if (post.pid === 1857608) {
			continue;
		}

		const podium = parsePodiumFromPostHtml(
			post.contentHtml,
			post.pid,
			post.postDate ?? "Unknown",
			anomalies,
		);
		if (podium) {
			tournaments.push({
				tournament_id: `pid_${post.pid}`,
				date: post.postDate ?? "Unknown",
				podium,
			});
		}
	}

	return { tournaments, anomalies };
}

/**
 * Performs mathematical analytics on the extracted tournaments to produce metagame data.
 */
export function calculateMetagameAnalytics(tournaments: WBOTournament[]): {
	partRankings: WBOPartRanking[];
	synergyRankings: WBOComboSynergy[];
} {
	const partStats = new Map<string, { totalScore: number; count: number }>();

	const addPartScore = (partName: string | undefined, score: number) => {
		if (!partName) return;
		const stats = partStats.get(partName) ?? { totalScore: 0, count: 0 };
		stats.totalScore += score;
		stats.count += 1;
		partStats.set(partName, stats);
	};

	for (const t of tournaments) {
		for (const c of t.podium.first_place) {
			addPartScore(c.blade, 3);
			addPartScore(c.ratchet, 3);
			addPartScore(c.bit, 3);
		}
		for (const c of t.podium.second_place) {
			addPartScore(c.blade, 2);
			addPartScore(c.ratchet, 2);
			addPartScore(c.bit, 2);
		}
		for (const c of t.podium.third_place) {
			addPartScore(c.blade, 1);
			addPartScore(c.ratchet, 1);
			addPartScore(c.bit, 1);
		}
	}

	const partRankings = Array.from(partStats.entries())
		.map(([part, stats]) => ({
			part,
			average_score: Number((stats.totalScore / stats.count).toFixed(3)),
			placements: stats.count,
			total_score: stats.totalScore,
		}))
		.sort(
			(a, b) =>
				b.average_score - a.average_score || b.placements - a.placements,
		);

	const synergyStats = new Map<
		string,
		{ totalScore: number; count: number; partA: string; partB: string }
	>();

	const addSynergyPair = (
		partA: string | undefined,
		partB: string | undefined,
		score: number,
	) => {
		if (!partA || !partB) return;
		const sorted = [partA, partB].sort();
		const key = `${sorted[0]} || ${sorted[1]}`;

		const stats = synergyStats.get(key) ?? {
			totalScore: 0,
			count: 0,
			partA: sorted[0] ?? "",
			partB: sorted[1] ?? "",
		};
		stats.totalScore += score;
		stats.count += 1;
		synergyStats.set(key, stats);
	};

	const processSynergy = (combos: WBOCombo[], score: number) => {
		for (const c of combos) {
			addSynergyPair(c.blade, c.ratchet, score);
			addSynergyPair(c.blade, c.bit, score);
			addSynergyPair(c.ratchet, c.bit, score);
		}
	};

	for (const t of tournaments) {
		processSynergy(t.podium.first_place, 3);
		processSynergy(t.podium.second_place, 2);
		processSynergy(t.podium.third_place, 1);
	}

	const synergyRankings = Array.from(synergyStats.values())
		.map((s) => {
			const average_success = s.totalScore / s.count;
			const synergy_score = average_success * (1 - 1 / (1 + s.count));
			return {
				part_a: s.partA,
				part_b: s.partB,
				co_occurrences: s.count,
				average_success: Number(average_success.toFixed(3)),
				synergy_score: Number(synergy_score.toFixed(3)),
			};
		})
		.sort((a, b) => b.synergy_score - a.synergy_score);

	return { partRankings, synergyRankings };
}

/**
 * Runs the full metagame analysis on a MyBB thread's raw HTML.
 */
export function runFullMetagameAnalysis(threadHtml: string): WBOMetagameData {
	const { tournaments, anomalies } = parseTournamentsFromHtml(threadHtml);
	const { partRankings, synergyRankings } =
		calculateMetagameAnalytics(tournaments);

	return {
		metadata: {
			total_tournaments: tournaments.length,
			scraped_at: new Date().toISOString(),
		},
		part_rankings: partRankings,
		combo_synergy: synergyRankings,
		anomalies,
	};
}
