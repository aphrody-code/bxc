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

	// --- CRAWL OPTIONS ---
	recursive: boolean;
	maxPages?: number;
	maxDepth?: number;
	compress: boolean;
	minify: boolean;
	optimizeImages: boolean;
	discoverHidden: boolean;
	resolveSubdomains: boolean;
	resolveCdns?: string[] | boolean;
	allowedDomains?: string[];
	excludedDomains?: string[];
	allowedPaths?: string[];
	excludedPaths?: string[];
	noParent: boolean;
	noHostDirectories: boolean;
	delayMs?: number;
	har?: string;

	// --- FFI / PROXY OPTIONS ---
	proxyAuth?: string;
	auth?: string;
	httpVersion?: "1.0" | "1.1" | "2.0" | "3.0" | "default";
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc mirror — download a complete site to a local directory

Usage:
  bxc mirror <url> <out-dir> [options]

Options:
  --profile <name>         http (default) | static | fast | stealth | max
  --cookies <path>         Cookie jar JSON (Playwright/CDP/Netscape)
  --concurrency <N>        parallel downloads/connections (default: 6)
  --same-origin-only       skip cross-origin assets
  --max-asset-bytes <N>    per-asset cap, bytes (default: 50000000)
  --user-agent <str>       override User-Agent
  --recursive              enable recursive multi-page crawling
  --max-pages <N>          maximum HTML pages to crawl (default: 100 if recursive)
  --max-depth <N>          maximum crawl depth (default: 10 if recursive)
  --compress               compress assets with gzip (.gz) sidecar files
  --minify                 minify HTML, CSS, and JS text assets
  --optimize-images        optimize PNG and JPEG images using pngquant/jpegoptim
  --discover-hidden        discover hidden pages via robots.txt and sitemaps
  --resolve-subdomains     crawl and resolve subdomains of the seed host
  --resolve-cdns <list>    comma-separated domains (or "true" for any CDN)
  --allowed-domains <list> comma-separated domains to allow
  --excluded-domains <list> comma-separated domains to exclude
  --allowed-paths <list>   comma-separated path prefixes to allow
  --excluded-paths <list>   comma-separated path prefixes to exclude
  --no-parent              only crawl pages under the seed URL directory path
  --no-host-directories    skip creating host-name directories for same-origin files
  --delay-ms <N>           throttle wait time (milliseconds) between crawls
  --har <path>             output path to save the crawl session as a HAR log
  --proxy-auth <user:pass> proxy credentials
  --auth <user:pass>       web server basic credentials
  --http-version <version> force HTTP version: 1.0 | 1.1 | 2.0 | 3.0 | default
  --verbose                log every step to stderr
  --help, -h               this help

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		url: "",
		outDir: "",
		profile: "http",
		concurrency: 6,
		sameOriginOnly: false,
		maxAssetBytes: 50_000_000,
		verbose: false,
		recursive: false,
		compress: false,
		minify: false,
		optimizeImages: false,
		discoverHidden: false,
		resolveSubdomains: false,
		noParent: false,
		noHostDirectories: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
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
			case "--recursive":
				opts.recursive = true;
				break;
			case "--max-pages":
				opts.maxPages = parseInt(argv[++i] ?? "100", 10);
				break;
			case "--max-depth":
				opts.maxDepth = parseInt(argv[++i] ?? "10", 10);
				break;
			case "--compress":
				opts.compress = true;
				break;
			case "--minify":
				opts.minify = true;
				break;
			case "--optimize-images":
				opts.optimizeImages = true;
				break;
			case "--discover-hidden":
				opts.discoverHidden = true;
				break;
			case "--resolve-subdomains":
				opts.resolveSubdomains = true;
				break;
			case "--resolve-cdns": {
				const val = argv[++i];
				if (val === "true") {
					opts.resolveCdns = true;
				} else {
					opts.resolveCdns = val ? val.split(",") : true;
				}
				break;
			}
			case "--allowed-domains":
				opts.allowedDomains = argv[++i]?.split(",");
				break;
			case "--excluded-domains":
				opts.excludedDomains = argv[++i]?.split(",");
				break;
			case "--allowed-paths":
				opts.allowedPaths = argv[++i]?.split(",");
				break;
			case "--excluded-paths":
				opts.excludedPaths = argv[++i]?.split(",");
				break;
			case "--no-parent":
				opts.noParent = true;
				break;
			case "--no-host-directories":
				opts.noHostDirectories = true;
				break;
			case "--delay-ms":
				opts.delayMs = parseInt(argv[++i] ?? "0", 10);
				break;
			case "--har":
				opts.har = argv[++i];
				break;
			case "--proxy-auth":
				opts.proxyAuth = argv[++i];
				break;
			case "--auth":
				opts.auth = argv[++i];
				break;
			case "--http-version":
				opts.httpVersion = argv[++i] as any;
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

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const log =
		opts.verbose || !opts.quiet
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
			proxy: opts.proxy,
			proxyAuth: opts.proxyAuth,
			auth: opts.auth,
			httpVersion: opts.httpVersion,
			verbose: opts.verbose,

			recursive: opts.recursive,
			maxPages: opts.maxPages,
			maxDepth: opts.maxDepth,
			compress: opts.compress,
			discoverHidden: opts.discoverHidden,
			resolveSubdomains: opts.resolveSubdomains,
			resolveCdns: opts.resolveCdns,
			allowedDomains: opts.allowedDomains,
			excludedDomains: opts.excludedDomains,
			allowedPaths: opts.allowedPaths,
			excludedPaths: opts.excludedPaths,
			noParent: opts.noParent,
			noHostDirectories: opts.noHostDirectories,
			delayMs: opts.delayMs,
			har: opts.har,
			minify: opts.minify,
			optimizeImages: opts.optimizeImages,
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
