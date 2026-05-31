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
 * `bxc xcom <action> <username>` — X.com (Twitter) profile scraper
 */

import { XComScraper } from "../scrapers/xcom.ts";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "profile";
	username: string;
	screenshot: boolean;
	aiExtract: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc xcom — X.com (Twitter) profile scraper

Usage:
  bxc xcom profile <username> [options]    Scrape public info from a Twitter profile

Options:
  --screenshot         Capture a PNG screenshot of the profile page
  --ai-extract         Extract structured details (followers, bio...) using local AI
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
		action: "profile",
		username: "",
		screenshot: false,
		aiExtract: false,
	};

	const actionStr = argv[0];
	if (actionStr === "profile") opts.action = "profile";
	else {
		logger.error(`Unknown action: ${actionStr}`);
		return null;
	}

	const positional: string[] = [];
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--screenshot":
				opts.screenshot = true;
				break;
			case "--ai-extract":
				opts.aiExtract = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (positional.length < 1) {
		logger.error("requires <username>");
		return null;
	}
	// Strip '@' if provided
	opts.username = positional[0].replace(/^@/, "");
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

	const scraper = new XComScraper();
	try {
		await scraper.init();
		const result = await scraper.extractProfile(opts.username, opts.screenshot);

		let aiInfo: any = null;
		if (opts.aiExtract) {
			try {
				aiInfo = await scraper.aiExtractProfileInfo();
			} catch (aiErr) {
				console.warn(
					`[XCom CLI] AI extraction failed: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
				);
			}
		}

		Bun.stdout.write(
			JSON.stringify(
				{
					username: result.username,
					markdown: result.markdownSnapshot,
					screenshotLength: result.screenshot?.byteLength ?? 0,
					aiInfo,
				},
				null,
				2,
			) + "\n",
		);
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		await scraper.close().catch(() => {});
	}
}
