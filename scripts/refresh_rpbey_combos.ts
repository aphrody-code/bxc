/**
 * scripts/refresh_rpbey_combos.ts
 *
 * Refreshes the rpbey "Combos" search-engine dataset
 * (apps/web/data/wbo-combos.json) from the canonical WBO BBX winning-combos
 * thread, using the canonical bxc WorldBeybladeScraper + analytics.
 *
 * Source thread: Winning Combinations at WBO Organized Events (Beyblade X / BBX)
 *
 * Non-destructive: if 0 events are extracted (e.g. Cloudflare block), the
 * existing JSON is preserved and the script exits non-zero without writing.
 *
 * Usage:
 *   cd /home/ubuntu/bxc
 *   bun scripts/refresh_rpbey_combos.ts
 *   bun scripts/refresh_rpbey_combos.ts --profile=http
 *   bun scripts/refresh_rpbey_combos.ts --cookies=/home/ubuntu/.bxc/cookies/worldbeyblade.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
	WorldBeybladeScraper,
	parsePodiumFromPostHtml,
	type WBOAnomaly,
	type WBOCombo,
	type WorldBeybladeThread,
} from "@aphrody-code/bxc/scrapers/worldbeyblade";

const ARGS = Bun.argv.slice(2);
const arg = (k: string) =>
	ARGS.find((a) => a.startsWith(`--${k}=`))
		?.split("=")
		.slice(1)
		.join("=");

const PROFILE = (arg("profile") ?? "ghost") as "ghost" | "http";
const COOKIES = arg("cookies");
const THREAD_SLUG =
	"Thread-Winning-Combinations-at-WBO-Organized-Events-Beyblade-X-BBX";
const THREAD_URL = `https://worldbeyblade.org/${THREAD_SLUG}`;
const OUT_PATH = "/home/ubuntu/rpbey/apps/web/data/wbo-combos.json";
const RULES_PID = 1857608;

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

function isCfChallenge(html: string): boolean {
	return (
		html.includes("Just a moment") ||
		html.includes("cf-browser-verification") ||
		html.includes("challenge-platform") ||
		/Checking if the site connection is secure/i.test(html)
	);
}

// MyBB post date like "03-29-2026, 01:23 PM" or "Yesterday, ..." -> YYYY-MM-DD
function normDate(raw: string | null): string {
	if (!raw) return "";
	const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/);
	if (m) return `${m[3]}-${m[1]}-${m[2]}`;
	const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	return "";
}

// Best-effort event name: first non-trivial text line of the post.
function extractEventName(contentHtml: string, fallback: string): string {
	const text = contentHtml
		.replace(/<br\s*\/?>(?=)/gi, "\n")
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

// Pull the player pseudo that sits on the placement header line, if any.
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
			if (!m) return "";
			// strip leading place token, trailing colon, "place"/"by"
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

async function main() {
	const scraper = new WorldBeybladeScraper();
	const log = (m: string) => console.log(`[refresh] ${m}`);

	const events: RpbeyEvent[] = [];
	const anomalies: WBOAnomaly[] = [];
	let pagesScraped = 0;
	let blockedHtml: string | null = null;

	try {
		log(`Init scraper (profile=${PROFILE}${COOKIES ? ", cookies=yes" : ""})`);
		await scraper.init({
			profile: PROFILE,
			cookies: COOKIES,
			log,
		});

		// Page 1 to discover totalPages + tid.
		let thread: WorldBeybladeThread = await scraper.getThread(THREAD_URL, 1);
		const rawHtml1 = await scraper.page.content();
		if (isCfChallenge(rawHtml1)) {
			blockedHtml = rawHtml1;
			throw new Error("CLOUDFLARE_CHALLENGE");
		}
		const tid = thread.tid;
		const totalPages = Math.max(1, thread.totalPages);
		log(`tid=${tid} title="${thread.title}" totalPages=${totalPages}`);

		const allPosts = [...thread.posts];
		pagesScraped = 1;
		for (let p = 2; p <= totalPages; p++) {
			const tp = await scraper.getThread(tid || THREAD_URL, p);
			const rawHtml = await scraper.page.content();
			if (isCfChallenge(rawHtml)) {
				blockedHtml = rawHtml;
				throw new Error("CLOUDFLARE_CHALLENGE");
			}
			allPosts.push(...tp.posts);
			pagesScraped = p;
		}
		log(`Collected ${allPosts.length} posts across ${pagesScraped} page(s)`);

		for (const post of allPosts) {
			if (post.pid === RULES_PID) continue;
			const podium = parsePodiumFromPostHtml(
				post.contentHtml,
				post.pid,
				post.postDate ?? "Unknown",
				anomalies,
			);
			if (!podium) continue;

			const players = extractPlayers(post.contentHtml);
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
			if (placements.length === 0) continue;

			events.push({
				name: extractEventName(post.contentHtml, `WBO Event pid_${post.pid}`),
				date: normDate(post.postDate),
				matchType: extractMatchType(post.contentHtml),
				playerCount: extractPlayerCount(post.contentHtml),
				ranked: true,
				placements,
			});
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "CLOUDFLARE_CHALLENGE") {
			const snippet = (blockedHtml ?? "").replace(/\s+/g, " ").slice(0, 300);
			console.error(
				`[refresh] BLOCKED: Cloudflare challenge on worldbeyblade.org (profile=${PROFILE}).`,
			);
			console.error(`[refresh] challenge snippet: ${snippet}`);
		} else {
			console.error(`[refresh] ERROR: ${msg}`);
		}
	} finally {
		await scraper.close().catch(() => {});
	}

	let totalCombos = 0;
	for (const e of events)
		for (const pl of e.placements) totalCombos += pl.combos.length;

	console.log(
		`[refresh] extracted events=${events.length} combos=${totalCombos} anomalies=${anomalies.length}`,
	);

	if (events.length === 0) {
		console.error(
			"[refresh] 0 events extracted — PRESERVING existing JSON (no write).",
		);
		if (existsSync(OUT_PATH)) {
			const prev = JSON.parse(readFileSync(OUT_PATH, "utf-8"));
			console.error(
				`[refresh] existing ${OUT_PATH}: scrapedAt=${prev.scrapedAt} totalEvents=${prev.totalEvents} (untouched)`,
			);
		}
		process.exit(2);
	}

	const payload = {
		scrapedAt: new Date().toISOString(),
		threadUrl: THREAD_URL,
		pagesScraped,
		totalEvents: events.length,
		events,
	};
	writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
	console.log(
		`[refresh] wrote ${OUT_PATH}: events=${events.length} combos=${totalCombos} pages=${pagesScraped}`,
	);
}

main();
