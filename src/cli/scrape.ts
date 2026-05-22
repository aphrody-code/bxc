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
 * `bxc scrape <url> <css-selector>` — extract textContent of matched elements.
 */

import { Browser } from "../api/browser.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

type ScrapeProfile = "static" | "fast" | "http" | "max";

interface ScrapeOptions extends CommonOptions {
	url: string;
	selector: string;
	profile: ScrapeProfile;
	max: number;
	/** Fall back to the real local Chrome profile if the primary render fails. */
	fallbackChrome: boolean;
	/** `--profile-directory` for the Chrome fallback (e.g. "Profile 5"). */
	chromeProfile: string;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc scrape — extract textContent of CSS-selected elements

Usage:
  bxc scrape <url> <css-selector> [options]

Options:
  --profile <name>      static (default) | fast | http | max
  --max <N>             max elements returned (default: 50)
  --chrome-profile <p>  Chrome profile dir for the fallback (default: $BXC_CHROME_PROFILE or "Profile 5")
  --no-fallback         disable the real-Chrome fallback on SPA render failure
  --help, -h            this help

On an SPA that the lightweight engine can't render (engine crash, empty result),
bxc automatically retries on your installed Chrome using the chosen profile, so
logged-in sessions and full JS execution are available. Disable with --no-fallback.

`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): ScrapeOptions | null {
	const opts: ScrapeOptions = {
		...baseOpts,
		url: "",
		selector: "",
		profile: "static",
		max: 50,
		fallbackChrome: true,
		chromeProfile: Bun.env["BXC_CHROME_PROFILE"] ?? "Profile 5",
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as any;
				if (v !== "static" && v !== "fast" && v !== "http" && v !== "max") {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--max":
				opts.max = parseInt(argv[++i], 10);
				break;
			case "--chrome-profile":
				opts.chromeProfile = argv[++i];
				break;
			case "--no-fallback":
				opts.fallbackChrome = false;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length < 2) {
		logger.error("requires <url> and <selector>");
		return null;
	}
	opts.url = positional[0];
	opts.selector = positional[1];
	return opts;
}

interface Extracted {
	index: number;
	text: string;
}

/** Render `url`, query `selector`, return up to `max` textContents. */
async function extractWith(
	profile: ScrapeProfile,
	chromeProfile: string,
	opts: ScrapeOptions,
): Promise<Extracted[]> {
	let page: Awaited<ReturnType<typeof Browser.newPage>> | undefined;
	try {
		page = await Browser.newPage({
			profile,
			// "max" drives the user's real Chrome with their logged-in profile.
			profileDirectory: profile === "max" ? chromeProfile : undefined,
			spawnOpts:
				profile === "fast"
					? { logLevel: "error", readyTimeoutMs: 10_000 }
					: undefined,
		});
		await page.goto(opts.url, { timeoutMs: opts.timeoutMs });
		const els = await page.$$(opts.selector);
		const limit = Math.min(els.length, opts.max);
		// Fetch all textContent values in parallel — each is an independent CDP
		// roundtrip so serial awaiting multiplies latency by `limit`.
		const texts = await Promise.all(
			Array.from({ length: limit }, (_, i) => {
				const el = els[i] as unknown as { textContent?: () => Promise<string> };
				return el.textContent?.() ?? Promise.resolve("");
			}),
		);
		const out: Extracted[] = texts.map((text, i) => ({
			index: i,
			text: text.trim().slice(0, 500),
		}));
		return out;
	} finally {
		try {
			await page?.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	// Whether the SPA-crash fallback is worth attempting: only when the primary
	// profile is a lightweight one and the user left the fallback enabled.
	const canFallback = opts.fallbackChrome && opts.profile !== "max";

	let out: Extracted[];
	try {
		out = await extractWith(opts.profile, opts.chromeProfile, opts);
		// An SPA rendered by the static/http path often yields zero matches even
		// without throwing — treat an empty result as a render miss worth a
		// real-Chrome retry.
		if (out.length === 0 && canFallback) {
			logger.error(
				`[scrape] no matches via "${opts.profile}" — retrying on your Chrome (profile "${opts.chromeProfile}")`,
			);
			out = await extractWith("max", opts.chromeProfile, opts);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!canFallback) {
			logger.error(msg);
			process.exit(EXIT.DATA_ERR);
		}
		logger.error(
			`[scrape] "${opts.profile}" failed (${msg}) — falling back to your Chrome (profile "${opts.chromeProfile}")`,
		);
		try {
			out = await extractWith("max", opts.chromeProfile, opts);
		} catch (err2) {
			logger.error(err2 instanceof Error ? err2.message : String(err2));
			process.exit(EXIT.DATA_ERR);
		}
	}

	Bun.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
