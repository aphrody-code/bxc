/**
 * Offline tests for the Challonge tournament extractor. The fixture
 * is the full mirror produced by `bunlight mirror https://challonge.com/fr/B_TS5`
 * stored at `/tmp/mirror-bts5/challonge.com/fr/B_TS5`. If the mirror
 * is absent, the suite is skipped with a clear log line.
 *
 * The fixture covers a fully-completed double-elimination tournament
 * with 60 participants, 118 matches across 17 rounds — comprehensive
 * enough to exercise standings derivation, round labelling, and the
 * gon / store / meta extraction paths.
 */

import { describe, expect, test } from "bun:test";
import { extractChallongeTournament } from "../../src/scrapers/challonge.ts";

const FIXTURE = "/tmp/mirror-bts5/challonge.com/fr/B_TS5";

const fixtureExists = await Bun.file(FIXTURE).exists();
const html = fixtureExists ? await Bun.file(FIXTURE).text() : "";

describe.skipIf(!fixtureExists)("scrapers/challonge — B_TS5 mirror", () => {
	test("tournament meta", () => {
		const snap = extractChallongeTournament(html, { url: "https://challonge.com/fr/B_TS5" });
		expect(snap.tournament.id).toBe(17882054);
		expect(snap.tournament.name).toBe("Bey-Tamashii Séries #5");
		expect(snap.tournament.tournament_type).toBe("double elimination");
		expect(snap.tournament.state).toBe("complete");
		expect(snap.tournament.progress_meter).toBe(100);
		expect(snap.tournament.full_url).toBe("https://challonge.com/fr/B_TS5");
		expect(snap.source.lang).toBe("fr");
		expect(snap.gon.targeting.game).toBe("Beyblade X");
		expect(snap.gon.targeting.category).toBe("Tabletop Game");
		expect(snap.gon.csrf_token).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(snap.gon.asset_host).toBe("https://assets.challonge.com");
	});

	test("rounds — 17 total, signed integers, labelled", () => {
		const snap = extractChallongeTournament(html);
		expect(snap.rounds.length).toBe(17);
		expect(snap.rounds.find((r) => r.round === 7)?.round_label).toBe("Grand Finals");
		expect(snap.rounds.find((r) => r.round === 6)?.round_label).toBe("Winners Final");
		expect(snap.rounds.find((r) => r.round === 5)?.round_label).toBe("Winners Semifinals");
		expect(snap.rounds.find((r) => r.round === 4)?.round_label).toBe("Winners Quarterfinals");
		expect(snap.rounds.find((r) => r.round === -10)?.round_label).toBe("Losers Round 10");
		expect(snap.rounds.filter((r) => r.bracket === "winners").length).toBe(7);
		expect(snap.rounds.filter((r) => r.bracket === "losers").length).toBe(10);
	});

	test("matches — 118 total, all complete, players resolved", () => {
		const snap = extractChallongeTournament(html);
		expect(snap.matches.length).toBe(118);
		expect(snap.matches.every((m) => m.state === "complete")).toBe(true);
		expect(snap.matches.every((m) => m.player1 != null && m.player2 != null)).toBe(true);
		expect(snap.matches.every((m) => m.winner_id != null)).toBe(true);

		const grandFinals = snap.matches.find((m) => m.round === 7);
		expect(grandFinals).toBeDefined();
		expect(grandFinals?.player1?.display_name).toContain("Berserk91");
		expect(grandFinals?.player2?.display_name).toContain("Gelofy");
		expect(grandFinals?.winner_id).toBe(grandFinals?.player1?.id);
	});

	test("participants — 60 total, deduped from match graph, sorted by seed", () => {
		const snap = extractChallongeTournament(html);
		expect(snap.participants.length).toBe(60);
		expect(snap.participants[0].seed).toBe(1);
		expect(snap.participants[snap.participants.length - 1].seed).toBe(60);
		// All participants must have a portrait URL or fallback gravatar.
		expect(
			snap.participants.every((p) => p.portrait_url == null || p.portrait_url.startsWith("http")),
		).toBe(true);
	});

	test("standings — winner is rank 1, undefeated", () => {
		const snap = extractChallongeTournament(html);
		const top = snap.standings[0];
		expect(top.rank).toBe(1);
		expect(top.losses).toBe(0);
		expect(top.display_name).toContain("Berserk91");

		// Rank 2 must have exactly 2 losses (lost grand finals, plus prior LB loss
		// since Berserk91 was undefeated and they reached the GF through losers).
		const second = snap.standings[1];
		expect(second.rank).toBe(2);
		expect(second.losses).toBe(2);
		expect(second.display_name).toContain("Gelofy");

		// Tail of standings — players who lost in winners-bracket round 1
		// then went out in losers-bracket round 1 (2 losses total).
		const tail = snap.standings.slice(-5);
		expect(tail.every((s) => s.losses === 2)).toBe(true);
		expect(tail.every((s) => s.wins === 0)).toBe(true);
	});

	test("react mount — TournamentController + final-stage view", () => {
		const snap = extractChallongeTournament(html);
		expect(snap.react?.component).toBe("TournamentController");
		expect((snap.react?.props as { initialView?: string })?.initialView).toBe("final-stage");
	});

	test("performance — extracts under 50ms on a 230KB HTML", () => {
		const t0 = Bun.nanoseconds();
		extractChallongeTournament(html);
		const elapsed = (Bun.nanoseconds() - t0) / 1e6;
		expect(elapsed).toBeLessThan(50);
	});
});

describe("scrapers/challonge — error handling", () => {
	test("throws when TournamentStore is absent", () => {
		expect(() => extractChallongeTournament("<html><body>nope</body></html>")).toThrow(
			"TournamentStore",
		);
	});

	test("falls back to defaults when og:* meta tags are missing", () => {
		const minimal = `<html><script>window._initialStoreState['TournamentStore'] = {"tournament":{"id":42,"tournament_type":"single elimination","state":"pending","progress_meter":0},"requested_plotter":"X","rounds":[1],"matches_by_round":{"1":[]},"third_place_match":null,"consolation_matches":[],"groups":[]};</script></html>`;
		const snap = extractChallongeTournament(minimal);
		expect(snap.tournament.id).toBe(42);
		expect(snap.tournament.name).toBeNull();
		expect(snap.tournament.full_url).toBeNull();
		expect(snap.matches.length).toBe(0);
		expect(snap.participants.length).toBe(0);
		expect(snap.standings.length).toBe(0);
	});
});

if (!fixtureExists) {
	process.stderr.write(
		`skip: ${FIXTURE} not present — run \`bunlight mirror https://challonge.com/fr/B_TS5 /tmp/mirror-bts5 --cookies cookies/private/challonge.json\` first\n`,
	);
}
