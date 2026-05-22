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
 * `bxc profile <target|url>` — precision profiler of the Google web stack.
 *
 * Captures real HTML + CSS/JS/font graph + network/API surface + frameworks +
 * live JS globals, then reinforces the persistent corpus so each run makes the
 * next one smarter. Targets: google.com, cloud, console, design, material,
 * antigravity, gemini, aistudio, fonts — or any URL.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
	GOOGLE_TARGETS,
	profileSite,
	type GoogleProfile,
} from "../google/profiler.ts";
import { corpusDir } from "../google/corpus.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

type ScrapeProfile = "static" | "fast" | "http" | "stealth" | "max";

interface ProfileCliOptions extends CommonOptions {
	target: string;
	profile: ScrapeProfile;
	chromeProfile: string;
	out?: string;
	all: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc profile — precision profiler of the Google web stack (self-reinforcing)

Usage:
  bxc profile <target|url> [options]

Targets:
  ${Object.keys(GOOGLE_TARGETS).join(", ")}

Options:
  --profile <name>      max (default, real Chrome) | static | http | fast | stealth
  --chrome-profile <p>  Chrome profile dir for the max path (default: $BXC_CHROME_PROFILE or "Profile 5")
  --all                 profile every known Google target in sequence
  --out <file>          write the full profile JSON to <file>
  --json                emit the profile JSON to stdout (else a human summary)
  --help, -h            this help

Each run feeds the corpus at ${corpusDir()} so bxc gets stronger every scrape.

`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): ProfileCliOptions | null {
	const opts: ProfileCliOptions = {
		...baseOpts,
		target: "",
		profile: "max",
		chromeProfile: Bun.env["BXC_CHROME_PROFILE"] ?? "Profile 5",
		all: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as ScrapeProfile;
				if (!["static", "fast", "http", "stealth", "max"].includes(v)) {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--chrome-profile":
				opts.chromeProfile = argv[++i];
				break;
			case "--out":
				opts.out = argv[++i];
				break;
			case "--all":
				opts.all = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (!opts.all && positional.length < 1) {
		logger.error("requires a <target|url> (or --all)");
		return null;
	}
	opts.target = positional[0] ?? "";
	return opts;
}

function summarize(p: GoogleProfile): string {
	const top = (xs: string[], n = 8) =>
		xs.slice(0, n).join(", ") + (xs.length > n ? ` … (+${xs.length - n})` : "");
	const lines = [
		`# ${p.target} — ${p.finalUrl}`,
		`status ${p.status} · ${(p.htmlBytes / 1024).toFixed(1)} KB HTML · profile=${p.profile} · ${p.capturedAt}`,
		`title: ${p.title || "—"}`,
		"",
		`frameworks (${p.frameworks.length}): ${top(p.frameworks)}`,
		`globals (${p.globals.length}): ${top(p.globals)}`,
		`css (${p.css.length}) · js (${p.js.length}) · fonts (${p.fonts.length})`,
		`apis (${p.apis.length}): ${top(p.apis, 12)}`,
	];
	const known = p.knowledge;
	lines.push(
		"",
		`corpus[${known.host}]: ${known.scrapes} scrapes · ` +
			`${Object.keys(known.frameworks).length} frameworks · ` +
			`${Object.keys(known.apis).length} API patterns learned`,
	);
	if (p.priorHints.apis.length > 0) {
		lines.push(`primed from prior scrapes: ${top(p.priorHints.apis, 6)}`);
	}
	return lines.join("\n");
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const targets = opts.all ? Object.keys(GOOGLE_TARGETS) : [opts.target];
	const results: GoogleProfile[] = [];

	for (const target of targets) {
		try {
			logger.error(`[profile] ${target} …`);
			const p = await profileSite(target, {
				profile: opts.profile,
				timeoutMs: opts.timeoutMs,
				insecure: opts.insecure,
				chromeProfile: opts.chromeProfile,
			});
			results.push(p);
			if (!opts.json) Bun.stdout.write(summarize(p) + "\n\n");
		} catch (err) {
			logger.error(`[profile] ${target} failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (results.length === 0) process.exit(EXIT.DATA_ERR);

	if (opts.out) {
		await mkdir(join(opts.out, "..").replace(/[/\\][^/\\]*$/, "") || ".", {
			recursive: true,
		}).catch(() => undefined);
		const payload = opts.all ? results : results[0];
		await Bun.write(opts.out, JSON.stringify(payload, null, 2));
		logger.error(`[profile] wrote ${opts.out}`);
	}

	if (opts.json) {
		Bun.stdout.write(JSON.stringify(opts.all ? results : results[0], null, 2) + "\n");
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
