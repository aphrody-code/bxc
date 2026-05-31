/**
 * scripts/refresh_combos_wayback.ts
 *
 * Refreshes the rpbey "Combos" search-engine dataset
 * (apps/web/data/wbo-combos.json) from the canonical WBO BBX winning-combos
 * thread, fetched through the Wayback Machine (web.archive.org is NOT behind
 * Cloudflare, unlike the live worldbeyblade.org which 403s from the VPS IP).
 *
 * Strategy:
 *   1. CDX: list every canonical page of the thread (page 1 = bare URL, then
 *      ?page=2..N). For each page take the MOST RECENT statuscode-200 snapshot.
 *   2. Fetch each page raw via .../web/<ts>id_/<url> (archived HTML, no toolbar)
 *      with a ~500ms politeness delay between requests.
 *   3. Parse each page with the canonical bxc analytics
 *      (parsePodiumFromPostHtml on each div.post_body).
 *   4. Map podium -> rpbey events/placements/combos, write non-destructively
 *      (skip write + exit 2 if 0 events, preserving the existing dump).
 *
 * Usage:
 *   cd /home/ubuntu/bxc
 *   bun scripts/refresh_combos_wayback.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import {
	parsePodiumFromPostHtml,
	type WBOAnomaly,
} from "../src/scrapers/worldbeyblade/analytics.ts";
import type { WBOCombo } from "../src/scrapers/worldbeyblade/types.ts";

const THREAD_SLUG =
	"Thread-Winning-Combinations-at-WBO-Organized-Events-Beyblade-X-BBX";
const THREAD_URL = `https://worldbeyblade.org/${THREAD_SLUG}`;
const OUT_PATH = "/home/ubuntu/rpbey/apps/web/data/wbo-combos.json";
const RULES_PID = 1857608;
const DELAY_MS = 500;

interface RpbeyCombo {
	blade: string;
	ratchet: string;
	bit: string;
	stage: string;
}
interface RpbeyPlacement {
	placement: number;
	player: string;
	combos: RpbeyCombo[];
}
interface RpbeyEvent {
	name: string;
	date: string;
	matchType: string;
	playerCount: number | null;
	ranked: boolean;
	placements: RpbeyPlacement[];
}

const log = (m: string) => console.log(`[wayback] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MONTHS: Record<string, string> = {
	jan: "01",
	feb: "02",
	mar: "03",
	apr: "04",
	may: "05",
	jun: "06",
	jul: "07",
	aug: "08",
	sep: "09",
	oct: "10",
	nov: "11",
	dec: "12",
};

// MyBB post date: "Dec. 28, 2025  5:56 AM", "03-29-2026, 01:23 PM" or
// "2026-03-29" -> YYYY-MM-DD.
function normDate(raw: string | null): string {
	if (!raw) return "";
	const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	const mdy = raw.match(/(\d{2})-(\d{2})-(\d{4})/);
	if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
	// "Dec. 28, 2025" / "December 28, 2025"
	const named = raw.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
	if (named?.[1] && named[2] && named[3]) {
		const mo = MONTHS[named[1].slice(0, 3).toLowerCase()];
		if (mo) return `${named[3]}-${mo}-${named[2].padStart(2, "0")}`;
	}
	return "";
}

function extractEventName(contentHtml: string, fallback: string): string {
	const text = contentHtml
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\s+/g, " ").trim();
		if (line.length < 3) continue;
		if (/^(1st|2nd|3rd|first|second|third)\b/i.test(line)) continue;
		if (/^(link|photo|video|pics|footage|rules|banlist|format)\b/i.test(line))
			continue;
		return line.slice(0, 140);
	}
	return fallback;
}

function extractMatchType(contentHtml: string): string {
	const text = contentHtml
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ");
	const m =
		text.match(
			/(\d+\s*on\s*\d+[^\n]*?(?:elimination|swiss|round robin)[^\n]*)/i,
		) ??
		text.match(/((?:single|double)\s+elimination[^\n]*)/i) ??
		text.match(/(\d+\s*on\s*\d+)/i);
	return m?.[1] ? m[1].replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

function extractPlayerCount(contentHtml: string): number | null {
	const text = contentHtml.replace(/<[^>]+>/g, " ");
	const m =
		text.match(/(\d+)\s*(?:players?|participants?|bladers?|attendees?)/i) ??
		text.match(/(?:players?|participants?|attendance)\s*[:-]?\s*(\d+)/i);
	const n = m?.[1] ? parseInt(m[1], 10) : NaN;
	return Number.isFinite(n) ? n : null;
}

function extractPlayers(contentHtml: string): {
	first: string;
	second: string;
	third: string;
} {
	const text = contentHtml
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ");
	const out = { first: "", second: "", third: "" };
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\s+/g, " ").trim();
		const grab = (re: RegExp) => {
			const m = line.match(re);
			if (!m?.[1]) return "";
			let p = m[1]
				.replace(/\bplace\b/gi, "")
				.replace(/^[\s:\-–—()]+/, "")
				.replace(/[\s:\-–—()]+$/, "")
				.trim();
			if (/^\(?(by|player|blader)\b/i.test(p))
				p = p.replace(/^\(?(by|player|blader)\b[\s:]*/i, "");
			return p.length > 1 && p.length < 40 && !/\d-\d/.test(p) ? p : "";
		};
		if (!out.first && /^(?:1st|first)\b/i.test(line))
			out.first = grab(/^(?:1st|first)\b\s*(?:place)?\s*[:\-–—]?\s*(.+)$/i);
		if (!out.second && /^(?:2nd|second)\b/i.test(line))
			out.second = grab(/^(?:2nd|second)\b\s*(?:place)?\s*[:\-–—]?\s*(.+)$/i);
		if (!out.third && /^(?:3rd|third)\b/i.test(line))
			out.third = grab(/^(?:3rd|third)\b\s*(?:place)?\s*[:\-–—]?\s*(.+)$/i);
	}
	return out;
}

function toRpbeyCombos(combos: WBOCombo[]): RpbeyCombo[] {
	return combos.map((c) => ({
		blade: c.blade,
		ratchet: c.ratchet,
		bit: c.bit,
		stage: "",
	}));
}

// CDX -> map page number -> most-recent (timestamp, originalUrl) with status 200.
async function discoverPages(): Promise<Map<number, { ts: string }>> {
	const cdxUrl =
		`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${THREAD_URL}*`)}` +
		`&output=json&collapse=urlkey&filter=statuscode:200&fl=timestamp,original`;
	const res = await fetch(cdxUrl);
	if (!res.ok) throw new Error(`CDX HTTP ${res.status}`);
	const rows = (await res.json()) as string[][];

	const pageMap = new Map<number, { ts: string }>();
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		if (!row) continue;
		const ts = row[0];
		const original = row[1];
		if (!ts || !original) continue;

		// Canonical thread pages only: bare URL (page 1) or ?page=N exactly.
		// Reject ?pid=, ?highlight=, etc.
		const qIdx = original.indexOf("?");
		let pageNum: number;
		if (qIdx === -1) {
			if (!original.endsWith(THREAD_SLUG)) continue;
			pageNum = 1;
		} else {
			const query = original.slice(qIdx + 1);
			const pm = query.match(/^page=(\d+)$/);
			if (!pm?.[1]) continue;
			pageNum = parseInt(pm[1], 10);
		}

		const existing = pageMap.get(pageNum);
		if (!existing || ts > existing.ts) pageMap.set(pageNum, { ts });
	}
	return pageMap;
}

async function fetchRawPage(ts: string, pageNum: number): Promise<string> {
	const url = pageNum === 1 ? THREAD_URL : `${THREAD_URL}?page=${pageNum}`;
	const waybackUrl = `http://web.archive.org/web/${ts}id_/${url}`;
	const res = await fetch(waybackUrl);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.text();
}

async function main() {
	log("Discovering thread pages via CDX...");
	const pageMap = await discoverPages();
	const pageNums = Array.from(pageMap.keys()).sort((a, b) => a - b);
	log(
		`CDX: ${pageNums.length} canonical page(s) with a 200 snapshot ` +
			`(min=${pageNums[0]} max=${pageNums[pageNums.length - 1]})`,
	);

	const events: RpbeyEvent[] = [];
	const anomalies: WBOAnomaly[] = [];
	const seenPids = new Set<number>();
	let pagesScraped = 0;

	for (const pageNum of pageNums) {
		const entry = pageMap.get(pageNum);
		if (!entry) continue;
		let html: string;
		try {
			html = await fetchRawPage(entry.ts, pageNum);
		} catch (err) {
			log(`page ${pageNum} (ts=${entry.ts}) FETCH FAILED: ${String(err)}`);
			await sleep(DELAY_MS);
			continue;
		}
		pagesScraped++;

		const $ = cheerio.load(html);
		let postsOnPage = 0;
		$("div.post_body").each((index, element) => {
			const pidAttr = $(element).attr("id");
			const pidStr = pidAttr ? pidAttr.replace("pid_", "") : `unknown_${index}`;
			const pid = parseInt(pidStr, 10) || 0;
			if (pid === RULES_PID) return;
			if (pid && seenPids.has(pid)) return; // de-dup across overlapping snapshots
			if (pid) seenPids.add(pid);

			let postDate = "Unknown";
			const postContainer = $(element).closest(".post");
			if (postContainer.length > 0) {
				const dateEl = postContainer.find(".post_date");
				if (dateEl.length > 0)
					postDate = dateEl
						.text()
						.replace(/&nbsp;/g, " ")
						.trim();
			}

			const postHtml = $(element).html();
			if (!postHtml) return;
			const podium = parsePodiumFromPostHtml(
				postHtml,
				pid,
				postDate,
				anomalies,
			);
			if (!podium) return;

			const players = extractPlayers(postHtml);
			const placements: RpbeyPlacement[] = [];
			if (podium.first_place.length > 0)
				placements.push({
					placement: 1,
					player: players.first,
					combos: toRpbeyCombos(podium.first_place),
				});
			if (podium.second_place.length > 0)
				placements.push({
					placement: 2,
					player: players.second,
					combos: toRpbeyCombos(podium.second_place),
				});
			if (podium.third_place.length > 0)
				placements.push({
					placement: 3,
					player: players.third,
					combos: toRpbeyCombos(podium.third_place),
				});
			if (placements.length === 0) return;

			events.push({
				name: extractEventName(postHtml, `WBO Event pid_${pid}`),
				date: normDate(postDate),
				matchType: extractMatchType(postHtml),
				playerCount: extractPlayerCount(postHtml),
				ranked: true,
				placements,
			});
			postsOnPage++;
		});
		log(
			`page ${pageNum} (ts=${entry.ts}): +${postsOnPage} event(s) ` +
				`[total=${events.length}]`,
		);
		await sleep(DELAY_MS);
	}

	let totalCombos = 0;
	for (const e of events)
		for (const pl of e.placements) totalCombos += pl.combos.length;

	log(
		`extracted events=${events.length} combos=${totalCombos} ` +
			`pages=${pagesScraped} anomalies=${anomalies.length}`,
	);

	if (events.length === 0) {
		console.error(
			"[wayback] 0 events extracted — PRESERVING existing JSON (no write).",
		);
		if (existsSync(OUT_PATH)) {
			const prev = JSON.parse(readFileSync(OUT_PATH, "utf-8"));
			console.error(
				`[wayback] existing ${OUT_PATH}: scrapedAt=${prev.scrapedAt} ` +
					`totalEvents=${prev.totalEvents} (untouched)`,
			);
		}
		process.exit(2);
	}

	const payload = {
		scrapedAt: new Date().toISOString(),
		threadUrl: THREAD_URL,
		source: "wayback",
		pagesScraped,
		totalEvents: events.length,
		events,
	};
	writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
	log(
		`wrote ${OUT_PATH}: events=${events.length} combos=${totalCombos} ` +
			`pages=${pagesScraped}`,
	);
}

main().catch((err) => {
	console.error("[wayback] FATAL:", err);
	process.exit(1);
});
