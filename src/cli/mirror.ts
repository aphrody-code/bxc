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
 * `bxc mirror <url> <out-dir>` — download a complete site (HTML/CSS/JS/
 * fonts/images) into a relocatable directory with rewritten relative links.
 */

import { resolve as resolvePath } from "node:path";
import { type MirrorProfile, mirrorSite } from "../mirror/index.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	url: string;
	outDir: string;
	profile: MirrorProfile;
	cookies?: string;
	concurrency: number;
	sameOriginOnly: boolean;
	maxAssetBytes: number;
	userAgent?: string;
	verbose: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc mirror — download a complete site to a local directory

Usage:
  bxc mirror <url> <out-dir> [options]

Options:
  --profile <name>      http (default) | static | fast
  --cookies <path>      Cookie jar JSON (Playwright/CDP/Netscape)
  --concurrency <N>     parallel asset downloads (default: 6)
  --same-origin-only    skip cross-origin assets
  --max-asset-bytes <N> per-asset cap, bytes (default: 50000000)
  --user-agent <str>    override User-Agent
  --verbose             log every step to stderr
  --help, -h            this help

`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		url: "",
		outDir: "",
		profile: "http",
		concurrency: 6,
		sameOriginOnly: false,
		maxAssetBytes: 50_000_000,
		verbose: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as any;
				if (v !== "static" && v !== "fast" && v !== "http") {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--cookies":
				opts.cookies = argv[++i];
				break;
			case "--concurrency":
				opts.concurrency = parseInt(argv[++i] ?? "6", 10);
				break;
			case "--same-origin-only":
				opts.sameOriginOnly = true;
				break;
			case "--max-asset-bytes":
				opts.maxAssetBytes = parseInt(argv[++i] ?? "50000000", 10);
				break;
			case "--user-agent":
				opts.userAgent = argv[++i];
				break;
			case "--verbose":
			case "-v":
				opts.verbose = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length < 2) {
		logger.error("requires <url> and <out-dir>");
		return null;
	}
	opts.url = positional[0];
	opts.outDir = positional[1];
	return opts;
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const log = (opts.verbose || !opts.quiet)
		? (msg: string): void => {
				Bun.stderr.write(`${msg}\n`);
			}
		: undefined;

	try {
		const manifest = await mirrorSite(opts.url, {
			outDir: resolvePath(opts.outDir),
			profile: opts.profile,
			cookies: opts.cookies,
			concurrency: opts.concurrency,
			timeoutMs: opts.timeoutMs,
			sameOriginOnly: opts.sameOriginOnly,
			maxAssetBytes: opts.maxAssetBytes,
			userAgent: opts.userAgent,
			log,
			insecure: opts.insecure,
		});

		Bun.stdout.write(
			JSON.stringify(
				{
					seed: manifest.seed,
					rootHtmlPath: manifest.rootHtmlPath,
					manifestPath: "manifest.json",
					totalAssets: manifest.totalAssets,
					totalBytes: manifest.totalBytes,
					failed: manifest.failed,
					durationMs: Math.round(manifest.durationMs),
					startedAt: manifest.startedAt,
					completedAt: manifest.completedAt,
				},
				null,
				2,
			) + "\n",
		);
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
