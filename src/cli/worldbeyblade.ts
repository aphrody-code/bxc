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

import { WorldBeybladeScraper } from "@aphrody/worldbeyblade";
import { EXIT, type CommonOptions, logger } from "./shared.ts";
import { existsSync } from "node:fs";

interface CliOptions extends CommonOptions {
	action:
		| "status"
		| "profile"
		| "thread"
		| "forum"
		| "search"
		| "inbox"
		| "sendpm";
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
  status                        Check if logged in
  profile <username|uid|url>    Get user profile information
  thread <tid|slug|url>         Get thread details and posts
  forum <fid|slug|url>          List threads in a subforum
  search <query>                Search the forums (requires ghost profile)
  inbox                         List PMs in inbox
  sendpm <to> <subj> <body>      Send a Private Message (requires ghost profile)

Options:
  --cookies <path>              Path to cookies JSON file (default: data/worldbeyblade_cookies.json)
  --user-agent <string>         Override User-Agent header or fingerprint
  --page <number>               Page number to fetch (for threads/forums, default: 1)
  --pretty                      Pretty print JSON outputs
  --help, -h                    Show this help

Examples:
  bxc worldbeyblade status --cookies data/worldbeyblade_cookies.json
  bxc worldbeyblade profile aphrody --pretty
  bxc worldbeyblade thread Thread-Beyblade-X-Rules --pretty
  bxc worldbeyblade forum Forum-Beyblade-X-Community --pretty
  bxc worldbeyblade search "Beyblade X" --pretty
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
	else if (actionStr === "forum") action = "forum";
	else if (actionStr === "search") action = "search";
	else if (actionStr === "inbox") action = "inbox";
	else if (actionStr === "sendpm") action = "sendpm";
	else return null;

	const defaultCookie = existsSync("data/worldbeyblade_cookies.json")
		? "data/worldbeyblade_cookies.json"
		: "worldbeyblade";

	const opts: CliOptions = {
		...baseOpts,
		action,
		target: "",
		page: 1,
		cookies: defaultCookie,
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

	if (
		action === "profile" ||
		action === "thread" ||
		action === "forum" ||
		action === "search"
	) {
		if (positional.length < 1) {
			logger.error(
				`action "${action}" requires target (query, username, ID, or URL)`,
			);
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
		// Initialize the scraper.
		// For sendpm and search actions, we must use the ghost browser.
		const useGhost = opts.action === "sendpm" || opts.action === "search";

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
				const profile = await scraper.getProfile(
					!isNaN(targetNum) ? targetNum : opts.target,
				);
				console.log(JSON.stringify(profile, null, opts.pretty ? 2 : 0));
				break;
			}
			case "thread": {
				const targetNum = parseInt(opts.target, 10);
				const thread = await scraper.getThread(
					!isNaN(targetNum) ? targetNum : opts.target,
					opts.page,
				);
				console.log(JSON.stringify(thread, null, opts.pretty ? 2 : 0));
				break;
			}
			case "forum": {
				const targetNum = parseInt(opts.target, 10);
				const forum = await scraper.getForum(
					!isNaN(targetNum) ? targetNum : opts.target,
					opts.page,
				);
				console.log(JSON.stringify(forum, null, opts.pretty ? 2 : 0));
				break;
			}
			case "search": {
				const results = await scraper.search(opts.target);
				console.log(JSON.stringify(results, null, opts.pretty ? 2 : 0));
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
