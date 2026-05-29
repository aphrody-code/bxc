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
 * `bxc worldbeyblade` — Command-line interface for worldbeyblade.org
 */

import { WorldBeybladeScraper } from "../scrapers/worldbeyblade.ts";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "status" | "profile" | "thread" | "inbox" | "sendpm";
	target: string;
	page: number;
	cookies?: string;
	userAgent?: string;
	pretty: boolean;
	pmTo?: string;
	pmSubject?: string;
	pmMessage?: string;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc worldbeyblade — worldbeyblade.org automation tools

Usage:
  bxc worldbeyblade <action> [options]

Actions:
  status                   Check if logged in
  profile <username|uid>   Get user profile information
  thread <tid>             Get thread details and posts
  inbox                    List PMs in inbox
  sendpm <to> <subj> <body> Send a Private Message (requires ghost profile)

Options:
  --cookies <path>         Path to cookies JSON file (default: data/worldbeyblade_cookies.json)
  --user-agent <string>    Override User-Agent header or fingerprint
  --page <number>          Page number to fetch (for threads, default: 1)
  --pretty                 Pretty print JSON outputs
  --help, -h               Show this help

Examples:
  bxc worldbeyblade status --cookies data/worldbeyblade_cookies.json
  bxc worldbeyblade profile aphrody --pretty
  bxc worldbeyblade thread 115799 --page 1 --pretty
  bxc worldbeyblade sendpm "aphrody" "Test Subject" "Hello from bxc CLI!"
`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	if (argv.length === 0) return null;
	const actionStr = argv[0];
	let action: CliOptions["action"];

	if (actionStr === "status") action = "status";
	else if (actionStr === "profile") action = "profile";
	else if (actionStr === "thread") action = "thread";
	else if (actionStr === "inbox") action = "inbox";
	else if (actionStr === "sendpm") action = "sendpm";
	else return null;

	const opts: CliOptions = {
		...baseOpts,
		action,
		target: "",
		page: 1,
		cookies: "data/worldbeyblade_cookies.json",
		pretty: process.stdout.isTTY,
	};

	const args = argv.slice(1);
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--cookies":
				opts.cookies = args[++i];
				break;
			case "--user-agent":
				opts.userAgent = args[++i];
				break;
			case "--page":
				opts.page = parseInt(args[++i] ?? "1", 10);
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

	if (action === "profile" || action === "thread") {
		if (positional.length < 1) {
			logger.error(`action "${action}" requires target (username/uid or tid)`);
			return null;
		}
		opts.target = positional[0];
	} else if (action === "sendpm") {
		if (positional.length < 3) {
			logger.error('action "sendpm" requires <to> <subject> <body>');
			return null;
		}
		opts.pmTo = positional[0];
		opts.pmSubject = positional[1];
		opts.pmMessage = positional[2];
	}

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

	const scraper = new WorldBeybladeScraper();

	try {
		// Initialize the scraper. For read actions, use the fast/http profile to bypass Turnstile.
		// For sendpm, we must use the ghost browser.
		const useGhost = opts.action === "sendpm";

		await scraper.init({
			profile: useGhost ? "ghost" : "http",
			cookies: opts.cookies,
			userAgent: opts.userAgent,
			log: opts.quiet ? () => {} : (msg) => logger.log(msg),
		});

		switch (opts.action) {
			case "status": {
				const isLoggedIn = await scraper.checkLoginStatus();
				if (opts.json) {
					console.log(JSON.stringify({ isLoggedIn }));
				} else {
					logger.log(`Logged in status: ${isLoggedIn ? "Yes" : "No"}`);
				}
				break;
			}
			case "profile": {
				const targetNum = parseInt(opts.target, 10);
				let profile;
				if (!isNaN(targetNum)) {
					profile = await scraper.getProfileByUid(targetNum);
				} else {
					profile = await scraper.getProfileByUsername(opts.target);
				}
				console.log(JSON.stringify(profile, null, opts.pretty ? 2 : 0));
				break;
			}
			case "thread": {
				const tid = parseInt(opts.target, 10);
				if (isNaN(tid)) {
					logger.error("Thread ID must be a number");
					process.exit(EXIT.MISUSE);
				}
				const thread = await scraper.getThread(tid, opts.page);
				console.log(JSON.stringify(thread, null, opts.pretty ? 2 : 0));
				break;
			}
			case "inbox": {
				const isLoggedIn = await scraper.checkLoginStatus();
				if (!isLoggedIn) {
					logger.error(
						"Cannot fetch PM inbox: Session is not authenticated. Please check your cookies.",
					);
					process.exit(EXIT.SOFTWARE);
				}
				const pms = await scraper.getInbox();
				console.log(JSON.stringify(pms, null, opts.pretty ? 2 : 0));
				break;
			}
			case "sendpm": {
				const isLoggedIn = await scraper.checkLoginStatus();
				if (!isLoggedIn) {
					logger.error(
						"Cannot send PM: Session is not authenticated. Please check your cookies.",
					);
					process.exit(EXIT.SOFTWARE);
				}
				const success = await scraper.sendPM(
					opts.pmTo!,
					opts.pmSubject!,
					opts.pmMessage!,
				);
				if (opts.json) {
					console.log(JSON.stringify({ success }));
				} else {
					logger.log(`PM delivery result: ${success ? "Success" : "Failed"}`);
				}
				break;
			}
		}
	} catch (err) {
		logger.error(
			err instanceof Error ? (err.stack ?? err.message) : String(err),
		);
		process.exit(EXIT.SOFTWARE);
	} finally {
		await scraper.close();
	}
}
