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
 * `bxc ietv <action> [arg]` — Inazuma Eleven TV (YouTube channels) scraper
 */

import IETVScraper, { loadYouTubeApiKey, loadGCloudCredentials } from "@aphrody/ietv";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "list" | "channel" | "all" | "discover" | "check-auth" | "official";
	channel: string;
	profile: "static" | "fast" | "http" | "stealth" | "max";
	youtubeApiKey?: string;
	checkAuth?: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc ietv — Inazuma Eleven TV (IETV) — YouTube channel scraper

Usage:
  bxc ietv channel <handle>         Get episodes from a specific channel (e.g. "inazumaelevenfrance1")
  bxc ietv all                      Aggregate all episodes from all 4 IETV channels
  bxc ietv official                 Scrape official inazuma-eleven.fr site (most complete)
  bxc ietv discover                 Discover additional Inazuma Eleven channels via Google Search
  bxc ietv check-auth               Verify YouTube API credentials status
  bxc ietv list                     List available channels

Options:
  --profile <name>     static (default) | fast | http | stealth | max
  --youtube-api-key    YouTube Data API key for enhanced discovery
  --check-auth         Check authentication status
  --help, -h           this help

Credentials (auto-loaded in order):
  1. YOUTUBE_API_KEY environment variable
  2. ~/.ietv/auth.json (key field)
  3. ~/.aphrody/ietv-credentials.json (youtube_api_key field)

Available canonical channels:
  @inazumaelevenfrance1
  @inazumatvfr
  @inazumaelevengofrance
  @InazumaTVFR__

Examples:
  bxc ietv channel inazumaelevenfrance1
  bxc ietv all --profile fast
  bxc ietv discover
  bxc ietv list

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		action: "list",
		channel: "",
		profile: "static",
	};

	// Check for help first (highest priority)
	for (const a of argv) {
		if (a === "--help" || a === "-h") {
			return null;
		}
	}

	const actionStr = argv[0];
	if (actionStr === "channel") opts.action = "channel";
	else if (actionStr === "all") opts.action = "all";
	else if (actionStr === "discover") opts.action = "discover";
	else if (actionStr === "check-auth") opts.action = "check-auth";
	else if (actionStr === "official") opts.action = "official";
	else if (actionStr === "list") opts.action = "list";
	else if (actionStr === undefined || actionStr === "") {
		// Default to 'list'
		opts.action = "list";
	} else if (!actionStr.startsWith("-")) {
		// Treat as channel name shorthand
		opts.action = "channel";
		opts.channel = actionStr;
	}

	const positional: string[] = [];
	for (let i = (argv[0] === "channel" || argv[0] === "all" || argv[0] === "discover" || argv[0] === "official" ? 1 : 0); i < argv.length; i++) {
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
			case "--youtube-api-key": {
				opts.youtubeApiKey = argv[++i];
				break;
			}
			case "--check-auth": {
				opts.action = "check-auth";
				opts.checkAuth = true;
				break;
			}
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (opts.action === "channel") {
		if (positional.length < 1 && !opts.channel) {
			logger.error("channel action requires a channel handle");
			return null;
		}
		if (positional.length > 0) opts.channel = positional[0];
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

	const scraper = new IETVScraper({
		profile: opts.profile,
		timeoutMs: opts.timeoutMs,
		youtubeApiKey: opts.youtubeApiKey,
	});

	try {
		if (opts.action === "check-auth") {
			const apiKey = loadYouTubeApiKey();
			const gcloudCreds = loadGCloudCredentials();
			const status = {
				youtube_api_key: apiKey ? "✓ Found" : "✗ Not found",
				gcloud_credentials: gcloudCreds.type ? `✓ ${gcloudCreds.type}` : "✗ Not found",
				gcloud_path: gcloudCreds.path || null,
				sources: {
					env_youtube_api_key: !!process.env.YOUTUBE_API_KEY,
					ietv_auth_json: !!process.env.HOME && require("fs").existsSync(
						require("path").join(process.env.HOME, ".ietv", "auth.json")
					),
					aphrody_ietv_credentials: !!process.env.HOME && require("fs").existsSync(
						require("path").join(process.env.HOME, ".aphrody", "ietv-credentials.json")
					),
					google_application_credentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
				},
			};
			Bun.stdout.write(JSON.stringify(status, null, 2) + "\n");
		} else if (opts.action === "official") {
			const info = await scraper.scrapeOfficialSite();
			Bun.stdout.write(JSON.stringify(info, null, 2) + "\n");
		} else if (opts.action === "list") {
			Bun.stdout.write(
				JSON.stringify(
					{
						channels: [
							"inazumaelevenfrance1",
							"inazumatvfr",
							"inazumaelevengofrance",
							"InazumaTVFR__",
						],
					},
					null,
					2,
				) + "\n",
			);
		} else if (opts.action === "channel") {
			const info = await scraper.getChannelEpisodes(opts.channel);
			Bun.stdout.write(JSON.stringify(info, null, 2) + "\n");
		} else if (opts.action === "discover") {
			const channels = await scraper.discoverChannels();
			Bun.stdout.write(JSON.stringify(channels, null, 2) + "\n");
		} else {
			const allChannels = await scraper.getAllChannelEpisodes();
			Bun.stdout.write(JSON.stringify(allChannels, null, 2) + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		await scraper.close().catch(() => {});
	}
}
