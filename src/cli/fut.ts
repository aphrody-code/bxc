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
 * `bxc fut <action> <url>` — FIFA Ultimate Team scraper
 */

import { scrapeFutBinPrice, scrapeFutGgPlayer } from "@aphrody/fut";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "price" | "player";
	targetUrl: string;
	profile: "static" | "fast" | "http" | "stealth" | "max";
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc fut — FIFA Ultimate Team (FUT) scraper

Usage:
  bxc fut price <futbin-player-url> [options]    Get player price from FUTBin
  bxc fut player <futgg-player-url> [options]    Get player statistics from FUTGG

Options:
  --profile <name>     static | fast | http | stealth | max (default: static)
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
		action: "price",
		targetUrl: "",
		profile: "static",
	};

	const actionStr = argv[0];
	if (actionStr === "price") opts.action = "price";
	else if (actionStr === "player") opts.action = "player";
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
		logger.error("requires <player-url>");
		return null;
	}
	opts.targetUrl = positional[0];
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

	try {
		if (opts.action === "price") {
			// FUTBin often uses Cloudflare Turnstile, so profile="ghost" (or stealth/max) is recommended,
			// but we pass options profile. Map to scraper's expected type:
			const scraperProfile = opts.profile === "http" ? "http" : "ghost";
			const result = await scrapeFutBinPrice(opts.targetUrl, scraperProfile);
			Bun.stdout.write(JSON.stringify(result, null, 2) + "\n");
		} else {
			// FUTGG scraper. Map to scraper's expected type:
			const scraperProfile =
				opts.profile === "stealth" ||
				opts.profile === "max" ||
				opts.profile === "fast"
					? "ghost"
					: opts.profile === "http"
						? "http"
						: "static";
			const result = await scrapeFutGgPlayer(opts.targetUrl, scraperProfile);
			Bun.stdout.write(JSON.stringify(result, null, 2) + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}
