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
 * `bxc x <action> [args]` — native X / Twitter client (cookie auth).
 *
 * Wraps the `@aphrody-code/x` headless client. Authentication uses an
 * `auth_token` + `ct0` cookie pair, resolved from (in order):
 *   1. `--cookie "auth_token=...; ct0=..."`
 *   2. the session file (`~/.config/x-cli/session.json`)
 *   3. the `X_AUTH_TOKEN` / `X_CT0` environment variables
 */

import { XClient, XSession, getNews } from "@aphrody-code/x";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

type Action = "profile" | "tweets" | "news" | "search" | "whoami";

interface CliOptions extends CommonOptions {
	action: Action;
	positional: string[];
	count: number;
	cookie?: string;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc x — native X / Twitter client (cookie auth, no API key)

Usage:
  bxc x profile <handle>            Fetch a user profile (followers, bio, id...)
  bxc x tweets <handle> [--count N] Fetch a user's recent tweets (default 20)
  bxc x search <query> [--count N]  Search the Latest timeline
  bxc x news [--count N]            Fetch trending news from the Explore tabs
  bxc x whoami                      Resolve the authenticated account

Options:
  --count, -n <N>   Number of items to fetch (default 20)
  --cookie <str>    "auth_token=...; ct0=..." pair (overrides session/env)
  --json            Emit raw JSON (default)
  --help, -h        this help

Auth resolution order: --cookie > session file > X_AUTH_TOKEN / X_CT0 env.

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const actionStr = argv[0];
	const valid: Action[] = ["profile", "tweets", "news", "search", "whoami"];
	if (!valid.includes(actionStr as Action)) {
		if (actionStr && actionStr !== "--help" && actionStr !== "-h") {
			logger.error(`Unknown action: ${actionStr}`);
		}
		return null;
	}

	const opts: CliOptions = {
		...baseOpts,
		action: actionStr as Action,
		positional: [],
		count: 20,
	};

	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--count":
			case "-n":
				opts.count = parseInt(argv[++i], 10) || opts.count;
				break;
			case "--cookie":
				opts.cookie = argv[++i];
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) opts.positional.push(a);
		}
	}
	return opts;
}

function resolveSession(opts: CliOptions): XSession {
	if (opts.cookie) return XSession.fromCookieString(opts.cookie);
	return XSession.loadOrEnv();
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

	let session: XSession;
	try {
		session = resolveSession(opts);
	} catch (err) {
		logger.error(
			`no X session: ${err instanceof Error ? err.message : String(err)}. ` +
				`Pass --cookie "auth_token=...; ct0=..." or set X_AUTH_TOKEN / X_CT0.`,
		);
		process.exit(EXIT.MISUSE);
	}

	const client = new XClient(session);
	const emit = (data: unknown) =>
		Bun.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

	try {
		switch (opts.action) {
			case "profile": {
				const handle = opts.positional[0]?.replace(/^@/, "");
				if (!handle) {
					logger.error("requires <handle>");
					process.exit(EXIT.MISUSE);
				}
				emit(await client.userByScreenName(handle));
				break;
			}
			case "tweets": {
				const handle = opts.positional[0]?.replace(/^@/, "");
				if (!handle) {
					logger.error("requires <handle>");
					process.exit(EXIT.MISUSE);
				}
				const uid = await client.userIdFor(handle);
				emit(await client.userTweets(uid, opts.count, undefined, 1));
				break;
			}
			case "search": {
				const query = opts.positional.join(" ").trim();
				if (!query) {
					logger.error("requires <query>");
					process.exit(EXIT.MISUSE);
				}
				emit(await client.search(query, opts.count));
				break;
			}
			case "news": {
				emit(await getNews(client, opts.count));
				break;
			}
			case "whoami": {
				emit(await client.whoami());
				break;
			}
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}
