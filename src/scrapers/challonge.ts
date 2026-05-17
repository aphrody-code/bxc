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

/**
 * @module bxc/scrapers/challonge
 *
 * Typed extractor for the Challonge tournament HTML page (e.g.
 * `https://challonge.com/<lang>/<slug>`). Reverse-engineered from a
 * full mirror of `B_TS5` (see /tmp/mirror-bts5/, 2026-05-10) :
 *
 *   - `window._initialStoreState['TournamentStore']` holds the full
 *      `tournament` meta + `rounds[]` + `matches_by_round{}` + `groups[]`.
 *      Each match is shaped { id, identifier, round, state, games[],
 *      player1{id,seed,display_name,portrait_url}, player2{...},
 *      scores, winner_id, loser_id, station, prereq_identifier, ... }.
 *      Round keys are signed integers : positive = winners-bracket,
 *      negative = losers-bracket.
 *   - `window._initialStoreState['CurrentUserStore']` holds the
 *      logged-in user's locale + admin flag.
 *   - `window._initialStoreState['BracketSettingsStore']` and
 *      `['ThemeStore']` hold UI prefs (skipped here).
 *   - `window.gon.adminIds[]`, `gon.participantUserIdMap{}`,
 *      `gon.targetingKeyValues{category,game}` carry side-data.
 *   - `<meta property="og:title" content="...">` carries the tournament
 *      display name (the store does not — only `id`/`tournament_type`/
 *      `state`/`progress_meter`).
 *   - `<div data-react-class="TournamentController" data-react-props="...">`
 *      carries the SPA initial view (final-stage / group-stage / etc.).
 *
 * The parser is HTML-only (no DOM, no JS execution) — it works on a
 * mirror page persisted to disk just as well as on a live response, and
 * stays under 5 ms for a typical 230 KB Challonge HTML.
 *
 * Example :
 *
 * ```ts
 * import { extractChallongeTournament } from "bxc/scrapers/challonge";
 *
 * const html = await Bun.file("/tmp/mirror-bts5/challonge.com/fr/B_TS5").text();
 * const snap = extractChallongeTournament(html);
 *
 * console.log(snap.tournament.name, snap.tournament.tournament_type);
 * console.log(`${snap.matches.length} matches over ${snap.rounds.length} rounds`);
 * console.log(`Winner : ${snap.standings[0]?.display_name}`);
 * ```
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChallongePlayer {
	id: number;
	seed: number;
	display_name: string;
	portrait_url: string | null;
	participant_id: number | null;
	quick_added: boolean;
	team_members: unknown;
	active: boolean;
	misc: string | null;
	integration_uids: unknown;
	challonge_username?: string | null;
	final_rank?: number | null;
	attached_participatable_portrait_url?: string | null;
	attached_participant_portrait_url?: string | null;
	tournament_id?: number;
	name?: string;
	created_at?: string;
	updated_at?: string;
	checked_in_at?: string | null;
	clinch?: string | null;
}

export interface ChallongeMatch {
	id: number;
	tournament_id: number;
	identifier: number;
	raw_identifier: string;
	round: number;
	state: "complete" | "pending" | "open" | "collection_yet_to_be_resolved" | string;
	underway_at: string | null;
	games: number[][];
	scores: number[] | null;
	winner_id: number | null;
	loser_id: number | null;
	player1: ChallongePlayer | null;
	player2: ChallongePlayer | null;
	player1_prereq_identifier: string | null;
	player2_prereq_identifier: string | null;
	player1_is_prereq_match_loser: boolean;
	player2_is_prereq_match_loser: boolean;
	player1_placeholder_text: string | null;
	player2_placeholder_text: string | null;
	station: number | null;
	queued_for_station: number | null;
	scheduled_time: string | null;
	has_attachment: boolean;
	has_chat: boolean;
	forfeited: boolean | null;
	is_group_match: boolean;
	shareable: boolean;
	editable_by_user_ids: number[];
}

export interface ChallongeTournamentMeta {
	id: number;
	name: string | null;
	description: string | null;
	og_image: string | null;
	tournament_type: string;
	state: string;
	progress_meter: number;
	is_team: boolean;
	hide_seeds: boolean;
	hide_identifiers: boolean;
	animated: boolean;
	accept_attachments: boolean;
	participants_per_match: number;
	participant_count_to_advance: number;
	split_participants: boolean;
	predict_the_losers_bracket: boolean;
	quick_advance: boolean;
	participants_swappable: boolean;
	voting_underway: boolean;
	show_station_and_time: boolean;
	completed_at?: string | null;
	started_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	game_name?: string | null;
	subdomain?: string | null;
	participants_count?: number;
	only_start_matches_with_stations: boolean;
	grand_finals_modifier: string | null;
	group_stage_progress_meter: number;
	admin_ids: number[];
	owner_ids: number[];
	url: string | null;
	full_url: string | null;
	canonical_lang: string | null;
}

export interface ChallongeRoundInfo {
	round: number;
	bracket: "winners" | "losers" | "grand_finals" | "group_stage";
	match_count: number;
	round_label: string | null;
}

export interface ChallongeStandingEntry {
	rank: number;
	player_id: number;
	display_name: string;
	seed: number;
	portrait_url: string | null;
	wins: number;
	losses: number;
	final_round_reached: number;
	is_admin: boolean;
}

export interface ChallongeReactMount {
	component: string;
	props: Record<string, unknown>;
}

export interface ChallongeGonState {
	admin_ids: number[];
	participant_user_id_map: Record<string, number>;
	targeting: Record<string, string>;
	csrf_token: string | null;
	asset_host: string | null;
	locale: string | null;
}

export interface ChallongeTournamentSnapshot {
	source: { url: string | null; canonical: string | null; lang: string };
	tournament: ChallongeTournamentMeta;
	rounds: ChallongeRoundInfo[];
	matches: ChallongeMatch[];
	matches_by_round: Record<string, ChallongeMatch[]>;
	third_place_match: ChallongeMatch | null;
	consolation_matches: ChallongeMatch[];
	groups: unknown[];
	participants: ChallongePlayer[];
	standings: ChallongeStandingEntry[];
	react: ChallongeReactMount | null;
	gon: ChallongeGonState;
}

// ---------------------------------------------------------------------------
// Internal store types (raw shape from window._initialStoreState)
// ---------------------------------------------------------------------------

interface RawTournamentStore {
	tournament: {
		id: number;
		[k: string]: unknown;
	};
	requested_plotter: string;
	rounds: number[];
	matches_by_round: Record<string, ChallongeMatch[]>;
	third_place_match: ChallongeMatch | null;
	consolation_matches: ChallongeMatch[];
	groups: unknown[];
}

interface RawCurrentUserStore {
	locale: string;
	is_superadmin: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s: string): string {
	return s
		.replaceAll("&quot;", '"')
		.replaceAll("&amp;", "&")
		.replaceAll("&#39;", "'")
		.replaceAll("&#x27;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

/**
 * Match a single-attribute meta tag whatever the attribute order is :
 * `<meta property="og:title" content="X">` and `<meta content="X" property="og:title">`
 * both yield X.
 */
function findMetaContent(html: string, key: string, attr: "property" | "name"): string | null {
	const re1 = new RegExp(
		`<meta[^>]+${attr}\\s*=\\s*["']${escapeRegex(key)}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
		"i",
	);
	const re2 = new RegExp(
		`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*${attr}\\s*=\\s*["']${escapeRegex(key)}["']`,
		"i",
	);
	const m = re1.exec(html) ?? re2.exec(html);
	return m ? decodeHtmlEntities(m[1]) : null;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findStore<T>(html: string, key: string): T | null {
	const re = new RegExp(
		`window\\._initialStoreState\\[['"]${escapeRegex(key)}['"]\\]\\s*=\\s*(\\{[\\s\\S]*?\\});`,
	);
	const m = re.exec(html);
	if (!m) return null;
	try {
		return JSON.parse(m[1]) as T;
	} catch {
		return null;
	}
}

function findGonAssign(html: string, name: string): unknown {
	const re = new RegExp(`gon\\.${escapeRegex(name)}\\s*=\\s*([^;]+);`);
	const m = re.exec(html);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

function findReactMount(html: string): ChallongeReactMount | null {
	const re =
		/<div[^>]+data-react-class\s*=\s*["']([^"']+)["'][^>]*data-react-props\s*=\s*["']([^"']+)["']/i;
	const m = re.exec(html);
	if (!m) return null;
	try {
		const propsRaw = decodeHtmlEntities(m[2]);
		return { component: m[1], props: JSON.parse(propsRaw) as Record<string, unknown> };
	} catch {
		return { component: m[1], props: {} };
	}
}

function bracketKindFromRound(round: number): ChallongeRoundInfo["bracket"] {
	if (round === 0) return "group_stage";
	return round > 0 ? "winners" : "losers";
}

function roundLabel(round: number, totalWinners: number, totalLosers: number): string {
	if (round === 0) return "Group Stage";
	if (round > 0) {
		const fromFinal = totalWinners - round;
		if (fromFinal === 0) return "Grand Finals";
		if (fromFinal === 1) return "Winners Final";
		if (fromFinal === 2) return "Winners Semifinals";
		if (fromFinal === 3) return "Winners Quarterfinals";
		return `Winners Round ${round}`;
	}
	const fromFinal = totalLosers + round; // round is negative
	if (fromFinal === 0) return "Losers Final";
	if (fromFinal === -1) return "Losers Semifinals";
	if (fromFinal === -2) return "Losers Quarterfinals";
	return `Losers Round ${Math.abs(round)}`;
}

// ---------------------------------------------------------------------------
// Standings derivation
// ---------------------------------------------------------------------------

/**
 * Derives standings from the match graph. Players are ranked by the
 * highest round they reached without losing — a player who wins the
 * grand finals is rank 1, losers-final losers are rank 3, and so on.
 *
 * For complete double-elimination tournaments this matches Challonge's
 * official ranking. For round-robin / group-stage / pending brackets
 * the result is best-effort (sorted by wins / seed).
 */
function deriveStandings(matches: ChallongeMatch[], adminIds: number[]): ChallongeStandingEntry[] {
	const players = new Map<number, ChallongePlayer & { wins: number; losses: number }>();
	const lastRoundReached = new Map<number, number>();
	const lastLossRound = new Map<number, number>();
	let maxWinnersRound = 0;
	let maxLosersAbsRound = 0;

	for (const m of matches) {
		if (m.round > maxWinnersRound) maxWinnersRound = m.round;
		if (m.round < 0 && Math.abs(m.round) > maxLosersAbsRound) {
			maxLosersAbsRound = Math.abs(m.round);
		}
		for (const p of [m.player1, m.player2]) {
			if (!p) continue;
			let entry = players.get(p.id);
			if (!entry) {
				entry = { ...p, wins: 0, losses: 0 };
				players.set(p.id, entry);
			}
			const prev = lastRoundReached.get(p.id) ?? Number.NEGATIVE_INFINITY;
			if (m.round > prev) lastRoundReached.set(p.id, m.round);
		}
		if (m.state === "complete" && m.winner_id != null) {
			const w = players.get(m.winner_id);
			if (w) w.wins += 1;
			if (m.loser_id != null) {
				const l = players.get(m.loser_id);
				if (l) l.losses += 1;
				// Track the deepest round where the player was eliminated.
				// Use the elimination depth as the comparison key so a Grand
				// Finals loss (round=+max) outranks a Losers-Final loss
				// (round=-max).
				const eliminationDepth = (r: number): number =>
					r > 0 ? r + maxLosersAbsRound : Math.abs(r);
				const prev = lastLossRound.get(m.loser_id);
				if (prev === undefined || eliminationDepth(m.round) > eliminationDepth(prev)) {
					lastLossRound.set(m.loser_id, m.round);
				}
			}
		}
	}

	const adminSet = new Set(adminIds);
	const out: ChallongeStandingEntry[] = [];
	for (const [id, p] of players) {
		out.push({
			rank: 0,
			player_id: id,
			display_name: p.display_name,
			seed: p.seed,
			portrait_url: p.portrait_url,
			wins: p.wins,
			losses: p.losses,
			final_round_reached: lastRoundReached.get(id) ?? 0,
			is_admin: adminSet.has(id),
		});
	}

	// Elimination depth — Challonge ranks players by the round in which
	// they were eliminated. Undefeated players (the Grand-Finals winner
	// of a complete bracket) come first. For losers-bracket eliminations
	// the depth is `abs(round)` (deeper LB round = better placement).
	// Winners-bracket-only losers — which only happens before they drop
	// to LB — are sorted by their LB exit round (captured naturally as
	// the `last loss` since Challonge resends them to LB).
	function eliminationDepth(round: number): number {
		// Grand-Finals (positive round) outranks any losers-bracket round.
		// We add `maxLosersAbsRound` to positive rounds so they always
		// sort above any negative round of equal absolute value.
		return round > 0 ? round + maxLosersAbsRound : Math.abs(round);
	}

	function rankKey(playerId: number, losses: number): readonly number[] {
		// (losses asc, elimination-depth desc, last-round-reached desc)
		const lossRound = lastLossRound.get(playerId);
		const depth = lossRound === undefined ? Number.POSITIVE_INFINITY : eliminationDepth(lossRound);
		const lastReached = Math.abs(lastRoundReached.get(playerId) ?? 0);
		return [losses, -depth, -lastReached];
	}

	out.sort((a, b) => {
		const ka = rankKey(a.player_id, a.losses);
		const kb = rankKey(b.player_id, b.losses);
		for (let i = 0; i < ka.length; i++) {
			if (ka[i] !== kb[i]) return ka[i] - kb[i];
		}
		if (b.wins !== a.wins) return b.wins - a.wins;
		return a.seed - b.seed;
	});
	for (let i = 0; i < out.length; i++) out[i].rank = i + 1;
	return out;
}

// ---------------------------------------------------------------------------
// Public extractor
// ---------------------------------------------------------------------------

export interface ExtractOptions {
	/** Source URL for the snapshot (recorded in `source.url`). */
	url?: string;
}

export function extractChallongeTournament(
	html: string,
	options: ExtractOptions = {},
): ChallongeTournamentSnapshot {
	const tournamentStore = findStore<RawTournamentStore>(html, "TournamentStore");
	if (!tournamentStore) {
		throw new Error(
			"extractChallongeTournament: window._initialStoreState['TournamentStore'] not found",
		);
	}
	const userStore = findStore<RawCurrentUserStore>(html, "CurrentUserStore");

	// Aggregate all matches from matches_by_round + third_place_match + consolation_matches.
	const matches: ChallongeMatch[] = [];
	for (const round of Object.keys(tournamentStore.matches_by_round)) {
		for (const m of tournamentStore.matches_by_round[round]) matches.push(m);
	}
	if (tournamentStore.third_place_match) matches.push(tournamentStore.third_place_match);
	for (const m of tournamentStore.consolation_matches ?? []) matches.push(m);

	// Round summary (label + bracket kind + match count).
	const roundCounts = new Map<number, number>();
	for (const m of matches) roundCounts.set(m.round, (roundCounts.get(m.round) ?? 0) + 1);
	const totalWinners = Math.max(0, ...Array.from(roundCounts.keys()).filter((r) => r > 0));
	const totalLosers = Math.min(0, ...Array.from(roundCounts.keys()).filter((r) => r < 0));
	const rounds: ChallongeRoundInfo[] = [];
	for (const r of [...roundCounts.keys()].sort((a, b) => a - b)) {
		rounds.push({
			round: r,
			bracket: bracketKindFromRound(r),
			match_count: roundCounts.get(r) ?? 0,
			round_label: roundLabel(r, totalWinners, totalLosers),
		});
	}

	// Participants : dedup from match players.
	const participantsMap = new Map<number, ChallongePlayer>();
	for (const m of matches) {
		if (m.player1) participantsMap.set(m.player1.id, m.player1);
		if (m.player2) participantsMap.set(m.player2.id, m.player2);
	}
	const participants = [...participantsMap.values()].sort((a, b) => a.seed - b.seed);

	// Tournament meta — combine TournamentStore.tournament + meta tags + gon.
	const tStore = tournamentStore.tournament;
	const ogTitle = findMetaContent(html, "og:title", "property");
	const ogDescription = findMetaContent(html, "og:description", "property");
	const ogImage = findMetaContent(html, "og:image", "property");
	const ogUrl = findMetaContent(html, "og:url", "property");

	let canonicalLang: string | null = null;
	const langMatch = ogUrl?.match(/^https?:\/\/[^/]+\/([a-z]{2})\//i);
	if (langMatch) canonicalLang = langMatch[1];

	const tournament: ChallongeTournamentMeta = {
		id: tStore.id,
		name: ogTitle ? ogTitle.replace(/\s+-\s+Challonge$/i, "").trim() : null,
		description: ogDescription,
		og_image: ogImage,
		tournament_type: String(tStore.tournament_type ?? "unknown"),
		state: String(tStore.state ?? "unknown"),
		progress_meter: Number(tStore.progress_meter ?? 0),
		is_team: Boolean(tStore.is_team),
		hide_seeds: Boolean(tStore.hide_seeds),
		hide_identifiers: Boolean(tStore.hide_identifiers),
		animated: Boolean(tStore.animated),
		accept_attachments: Boolean(tStore.accept_attachments),
		participants_per_match: Number(tStore.participants_per_match ?? 2),
		participant_count_to_advance: Number(tStore.participant_count_to_advance ?? 1),
		split_participants: Boolean(tStore.split_participants),
		predict_the_losers_bracket: Boolean(tStore.predict_the_losers_bracket),
		quick_advance: Boolean(tStore.quick_advance),
		participants_swappable: Boolean(tStore.participants_swappable),
		voting_underway: Boolean(tStore.voting_underway),
		show_station_and_time: Boolean(tStore.show_station_and_time),
		only_start_matches_with_stations: Boolean(tStore.only_start_matches_with_stations),
		grand_finals_modifier: (tStore.grand_finals_modifier as string | null) ?? null,
		group_stage_progress_meter: Number(tStore.group_stage_progress_meter ?? 0),
		admin_ids: Array.isArray(tStore.admin_ids) ? (tStore.admin_ids as number[]) : [],
		owner_ids: Array.isArray(tStore.owner_ids) ? (tStore.owner_ids as number[]) : [],
		url: options.url ?? null,
		full_url: ogUrl,
		canonical_lang: canonicalLang,
	};

	// gon globals.
	const adminIdsRaw = (findGonAssign(html, "adminIds") as number[] | null) ?? tournament.admin_ids;
	const gon: ChallongeGonState = {
		admin_ids: adminIdsRaw,
		participant_user_id_map:
			(findGonAssign(html, "participantUserIdMap") as Record<string, number> | null) ?? {},
		targeting: (findGonAssign(html, "targetingKeyValues") as Record<string, string> | null) ?? {},
		csrf_token: findMetaContent(html, "csrf-token", "name"),
		asset_host: findMetaContent(html, "asset-host", "name"),
		locale: userStore?.locale ?? canonicalLang,
	};

	const standings = deriveStandings(matches, gon.admin_ids);

	return {
		source: {
			url: options.url ?? null,
			canonical: ogUrl,
			lang: canonicalLang ?? userStore?.locale ?? "en",
		},
		tournament,
		rounds,
		matches,
		matches_by_round: tournamentStore.matches_by_round,
		third_place_match: tournamentStore.third_place_match,
		consolation_matches: tournamentStore.consolation_matches ?? [],
		groups: tournamentStore.groups ?? [],
		participants,
		standings,
		react: findReactMount(html),
		gon,
	};
}

/**
 * Convenience : extract from a path on disk (Bun.file).
 */
export async function extractChallongeTournamentFromFile(
	path: string,
	options: ExtractOptions = {},
): Promise<ChallongeTournamentSnapshot> {
	const html = await Bun.file(path).text();
	return extractChallongeTournament(html, options);
}
