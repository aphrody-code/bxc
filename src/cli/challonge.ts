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
 * `bxc challonge <url-or-path>` — extract a full typed snapshot
 * of a Challonge tournament page.
 */

import { isAbsolute, resolve as resolvePath } from "node:path";
import { Browser } from "../api/browser.ts";
import {
	type ChallongeTournamentSnapshot,
	extractChallongeTournament,
	extractChallongeTournamentFromFile,
} from "../scrapers/challonge.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	target: string;
	cookies?: string;
	pretty: boolean;
	summary: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc challonge — extract a typed Challonge tournament snapshot

Usage:
  bxc challonge <url-or-path> [options]

Options:
  --cookies <path>     Cookie jar JSON for Cloudflare-gated tournaments
  --summary            print a one-screen ASCII summary instead of JSON
  --pretty             pretty-print JSON
  --help, -h           this help

`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		target: "",
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
		logger.error("requires <url-or-path>");
		return null;
	}
	opts.target = positional[0];
	return opts;
}

async function loadFromTarget(opts: CliOptions): Promise<ChallongeTournamentSnapshot> {
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
			try { await page.close(); } catch {}
			await Browser.close().catch(() => undefined);
		}
	}

	const path = isAbsolute(opts.target) ? opts.target : resolvePath(opts.target);
	if (await Bun.file(path).exists()) {
		return extractChallongeTournamentFromFile(path);
	}
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
	throw new Error(`cannot locate a Challonge HTML at ${path}`);
}

function printSummary(snap: ChallongeTournamentSnapshot): void {
	const pad = (s: string, w: number) => s.padEnd(w);
	const t = snap.tournament;
	const out = process.stdout;
	out.write(`Tournament  ${t.name ?? "(unnamed)"}\n`);
	out.write(`Type        ${t.tournament_type}\n`);
	out.write(`State       ${t.state} (${t.progress_meter}% complete)\n`);
	out.write(`URL         ${t.full_url ?? "n/a"}\n`);
	out.write(`Game        ${snap.gon.targeting.game ?? "?"} (${snap.gon.targeting.category ?? "?"})\n`);
	out.write(`Participants ${snap.participants.length}\n`);
	out.write(`Matches     ${snap.matches.length} across ${snap.rounds.length} rounds\n`);
	out.write(`\n== Top 8 standings ==\n`);
	for (const s of snap.standings.slice(0, 8)) {
		out.write(`  rank ${s.rank.toString().padStart(2)}  ${pad(s.display_name, 22)} W${s.wins} L${s.losses}\n`);
	}
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	try {
		const snap = await loadFromTarget(opts);
		if (opts.summary) {
			printSummary(snap);
		} else {
			const output = JSON.stringify(snap, null, opts.pretty ? 2 : 0);
			Bun.stdout.write(output + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
