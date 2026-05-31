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
 * `bxc voiranime <action> <arg>` — VoirAnime streaming scraper
 */

import { VoiranimeScraper } from "../scrapers/voiranime.ts";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "search" | "info" | "resolve";
	param: string;
	profile: "static" | "fast" | "http" | "stealth" | "max";
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc voiranime — VoirAnime streaming scraper

Usage:
  bxc voiranime search <query>       Search for anime on VoirAnime (e.g. "inazuma")
  bxc voiranime info <slug-or-url>   Get metadata and episodes list of an anime
  bxc voiranime resolve <embed-url>  Resolve a video embed to its direct streaming link

Options:
  --profile <name>     static (default) | fast | http | stealth | max
  --help, -h           this help

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		action: "search",
		param: "",
		profile: "static",
	};

	const actionStr = argv[0];
	if (actionStr === "search") opts.action = "search";
	else if (actionStr === "info") opts.action = "info";
	else if (actionStr === "resolve") opts.action = "resolve";
	else {
		logger.error(`Unknown action: ${actionStr}`);
		return null;
	}

	const positional: string[] = [];
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as any;
				if (
					v !== "static" &&
					v !== "fast" &&
					v !== "http" &&
					v !== "stealth" &&
					v !== "max"
				) {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (positional.length < 1) {
		logger.error("requires query/slug/URL argument");
		return null;
	}
	opts.param = positional.join(" ");
	return opts;
}

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const scraper = new VoiranimeScraper({
		profile: opts.profile,
		timeoutMs: opts.timeoutMs,
	});

	try {
		if (opts.action === "search") {
			const results = await scraper.search(opts.param);
			Bun.stdout.write(JSON.stringify(results, null, 2) + "\n");
		} else if (opts.action === "info") {
			const info = await scraper.getAnime(opts.param);
			Bun.stdout.write(JSON.stringify(info, null, 2) + "\n");
		} else {
			const source = await scraper.resolveSource(opts.param, {
				enumerateQualities: true,
			});
			Bun.stdout.write(JSON.stringify(source, null, 2) + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		await scraper.close().catch(() => {});
	}
}
