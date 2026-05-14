#!/usr/bin/env bun
/**
 * `bunlight challonge <url-or-path>` — extract a full typed snapshot
 * of a Challonge tournament page.
 *
 * Two modes :
 *
 *   - **Live URL** (`https://challonge.com/...`) : fetch via the
 *     bunlight `http` profile (curl-impersonate Chrome 131) so the
 *     request matches an authentic browser. Pass `--cookies` for
 *     Cloudflare-gated tournaments.
 *
 *   - **Local path** (file or mirror dir) : read the HTML directly
 *     from disk. This is the fastest mode and the one used by the
 *     test suite : the file may be a single `B_TS5` HTML page or a
 *     mirror directory produced by `bunlight mirror`.
 *
 * Output : JSON snapshot to stdout — matches `ChallongeTournamentSnapshot`.
 *
 * Exit codes : 0 OK, 2 misuse, 65 upstream / IO error, 70 software error.
 */

import { isAbsolute, resolve as resolvePath } from "path";
import { Browser } from "../api/browser.ts";
import {
	type ChallongeTournamentSnapshot,
	extractChallongeTournament,
	extractChallongeTournamentFromFile,
} from "../scrapers/challonge.ts";

interface CliOptions {
	target: string;
	cookies?: string;
	timeoutMs: number;
	pretty: boolean;
	summary: boolean;
}

function printUsage(): void {
	process.stdout.write(
		`bunlight challonge — extract a typed Challonge tournament snapshot

Usage:
  bunlight challonge <url-or-path> [options]

Sources:
  - URL          https://challonge.com/<lang>/<slug> (live)
  - File path    /path/to/B_TS5 (HTML file from disk)
  - Mirror dir   /path/to/mirror (auto-resolves <host>/<lang>/<slug>)

Options:
  --cookies <path>     Cookie jar JSON for Cloudflare-gated tournaments
  --timeout <ms>       fetch timeout (default: 25000)
  --summary            print a one-screen ASCII summary instead of JSON
  --pretty             pretty-print JSON (default for tty stdout)
  --help, -h           this help

Examples:
  bunlight challonge https://challonge.com/fr/B_TS5 \\
      --cookies cookies/private/challonge.json
  bunlight challonge /tmp/mirror-bts5/challonge.com/fr/B_TS5 --summary
  bunlight challonge https://challonge.com/fr/B_TS5 | jq .standings[0]

Exit codes: 0 OK, 2 misuse, 65 upstream/IO error, 70 software error
`,
	);
}

function parseArgs(argv: readonly string[]): CliOptions | null {
	const opts: CliOptions = {
		target: "",
		timeoutMs: 25_000,
		pretty: process.stdout.isTTY,
		summary: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--cookies":
				opts.cookies = argv[++i];
				break;
			case "--timeout":
				opts.timeoutMs = parseInt(argv[++i] ?? "25000", 10);
				break;
			case "--summary":
				opts.summary = true;
				break;
			case "--pretty":
				opts.pretty = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length < 1) {
		process.stderr.write("bunlight challonge: requires <url-or-path>\n");
		return null;
	}
	opts.target = positional[0];
	return opts;
}

async function loadFromTarget(opts: CliOptions): Promise<ChallongeTournamentSnapshot> {
	// URL ?
	if (/^https?:\/\//.test(opts.target)) {
		const page = await Browser.newPage({
			profile: "http",
			cookies: opts.cookies,
			httpOpts: { profile: "chrome131" },
		});
		try {
			await page.goto(opts.target, { timeoutMs: opts.timeoutMs });
			const html = await page.content();
			return extractChallongeTournament(html, { url: opts.target });
		} finally {
			try {
				await page.close();
			} catch {
				/* noop */
			}
			await Browser.close().catch(() => undefined);
		}
	}

	// Local path : if it's a dir, find <host>/<lang>/<slug>.
	const path = isAbsolute(opts.target) ? opts.target : resolvePath(opts.target);
	const stat = await Bun.file(path).exists();
	if (stat) {
		// Single file — assume HTML.
		return extractChallongeTournamentFromFile(path);
	}
	// Try as a mirror dir : path/<host>/<...>
	const tryHosts = ["challonge.com"];
	for (const host of tryHosts) {
		const glob = new Bun.Glob(`${host}/**/*`);
		for await (const f of glob.scan({ cwd: path, absolute: true })) {
			const text = await Bun.file(f).text();
			if (text.includes("_initialStoreState['TournamentStore']")) {
				return extractChallongeTournament(text, {
					url: `https://${host}/${f.split(host + "/")[1]}`,
				});
			}
		}
	}
	throw new Error(`bunlight challonge: cannot locate a Challonge HTML at ${path}`);
}

function printSummary(snap: ChallongeTournamentSnapshot): void {
	const pad = (s: string, w: number) => s.padEnd(w);
	const t = snap.tournament;
	const out = process.stdout;
	out.write(`Tournament  ${t.name ?? "(unnamed)"}\n`);
	out.write(`Type        ${t.tournament_type}\n`);
	out.write(`State       ${t.state} (${t.progress_meter}% complete)\n`);
	out.write(`URL         ${t.full_url ?? "n/a"}\n`);
	out.write(
		`Game        ${snap.gon.targeting.game ?? "?"} (${snap.gon.targeting.category ?? "?"})\n`,
	);
	out.write(`Participants ${snap.participants.length}\n`);
	out.write(`Matches     ${snap.matches.length} across ${snap.rounds.length} rounds\n`);
	out.write(`Admins      ${snap.gon.admin_ids.length} ids\n`);
	out.write(`\n== Top 8 standings ==\n`);
	for (const s of snap.standings.slice(0, 8)) {
		out.write(
			`  rank ${s.rank.toString().padStart(2)}  ${pad(s.display_name, 22)} W${s.wins} L${s.losses}\n`,
		);
	}
	out.write(`\n== Last round ==\n`);
	const lastRound = Math.max(...snap.matches.map((m) => m.round));
	for (const m of snap.matches.filter((x) => x.round === lastRound)) {
		const winner = [m.player1, m.player2].find((p) => p?.id === m.winner_id);
		const score = m.scores ? m.scores.join("-") : "?";
		out.write(
			`  ${m.raw_identifier} ${pad(m.player1?.display_name ?? "?", 20)} ${score}  ${pad(
				m.player2?.display_name ?? "?",
				20,
			)} → ${winner?.display_name ?? "?"}\n`,
		);
	}
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(2);
	}

	try {
		const snap = await loadFromTarget(opts);
		if (opts.summary) {
			printSummary(snap);
		} else {
			process.stdout.write(JSON.stringify(snap, null, opts.pretty ? 2 : 0) + "\n");
		}
	} catch (err) {
		process.stderr.write(
			`bunlight challonge: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		process.exit(65);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
