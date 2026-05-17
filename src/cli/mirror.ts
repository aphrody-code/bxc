#!/usr/bin/env bun
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
 * `bunlight mirror <url> <out-dir>` — download a complete site (HTML/CSS/JS/
 * fonts/images) into a relocatable directory with rewritten relative links.
 *
 * Pipeline (see src/mirror/mirror.ts) :
 *
 *   1. Fetch seed via the chosen bunlight profile (default `http` =
 *      curl-impersonate Chrome 131 + cookies, passes Cloudflare when
 *      cookie jar is provided).
 *   2. Walk HTML with `Bun.HTMLRewriter` to enumerate every asset URL.
 *   3. Concurrently download via worker pool, recurse into CSS for
 *      nested url(...) and @import.
 *   4. Rewrite every URL in HTML and CSS to point at the local copy.
 *   5. Emit `manifest.json` (sha256 + bytes + content-type per asset).
 *
 * Output contract :
 *   stdout — JSON summary { totalAssets, totalBytes, failed, durationMs,
 *                            rootHtmlPath, manifestPath }
 *   exit   — 0 OK, 2 misuse, 65 fetch / IO error, 70 software error
 */

import { resolve as resolvePath } from "node:path";
import { type MirrorProfile, mirrorSite } from "../mirror/index.ts";

interface CliOptions {
	url: string;
	outDir: string;
	profile: MirrorProfile;
	cookies?: string;
	concurrency: number;
	timeoutMs: number;
	sameOriginOnly: boolean;
	maxAssetBytes: number;
	userAgent?: string;
	verbose: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bunlight mirror — download a complete site to a local directory

Usage:
  bunlight mirror <url> <out-dir> [options]

Options:
  --profile <name>      http (default) | static | fast
  --cookies <path>      Cookie jar JSON (Playwright/CDP/Netscape)
  --concurrency <N>     parallel asset downloads (default: 6)
  --timeout <ms>        per-request timeout (default: 15000)
  --same-origin-only    skip cross-origin assets (default: include)
  --max-asset-bytes <N> per-asset cap, bytes (default: 50000000)
  --user-agent <str>    override User-Agent (default: bunlight-mirror/0.1)
  --verbose             log every step to stderr
  --help, -h            this help

Examples:
  bunlight mirror https://google.com ./mirror-hn
  bunlight mirror https://challonge.com/fr/B_TS5 ./mirror-bts5 \\
      --cookies cookies/private/challonge.json --verbose

Notes:
  - The seed page is opened via the chosen bunlight profile so that TLS /
    cookie / fingerprint behaviour matches the live browser, including
    Cloudflare-gated sites when cookies are valid.
  - Asset downloads use plain fetch (assets are usually public). For
    private CDNs, pass them through the same cookie jar by host and
    extend MirrorOptions.filter.
  - The output is relocatable : the seed lives at <out-dir>/<host>/<path>
    and cross-origin assets at <out-dir>/_external/<host>/<path>.

Exit codes: 0 OK, 2 misuse, 65 fetch / IO error, 70 software error
`,
	);
}

function parseArgs(argv: readonly string[]): CliOptions | null {
	const opts: CliOptions = {
		url: "",
		outDir: "",
		profile: "http",
		concurrency: 6,
		timeoutMs: 15_000,
		sameOriginOnly: false,
		maxAssetBytes: 50_000_000,
		verbose: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i];
				if (v !== "static" && v !== "fast" && v !== "http") {
					Bun.stderr.write(`Invalid profile: ${v} (expected static|fast|http)\n`);
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
			case "--timeout":
				opts.timeoutMs = parseInt(argv[++i] ?? "15000", 10);
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
		Bun.stderr.write("bunlight mirror: requires <url> and <out-dir>\n");
		return null;
	}
	opts.url = positional[0];
	opts.outDir = positional[1];
	return opts;
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(2);
	}

	const log = opts.verbose
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
		Bun.stderr.write(`bunlight mirror: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(65);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
