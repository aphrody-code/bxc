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

type ScrapeProfile = "static" | "fast" | "http";

interface ScrapeOptions extends CommonOptions {
	url: string;
	selector: string;
	profile: ScrapeProfile;
	max: number;
	markdown: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc scrape — extract textContent of CSS-selected elements

Usage:
  bxc scrape <url> <css-selector> [options]
  bxc scrape <url> --markdown [options]

Options:
  --profile <name>   static (default) | fast | http
  --markdown         convert the entire page to GFM Markdown
  --max <N>          max elements returned (default: 50)
  --help, -h         this help

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): ScrapeOptions | null {
	const opts: ScrapeOptions = {
		...baseOpts,
		url: "",
		selector: "",
		profile: "static",
		max: 50,
		markdown: false,
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
			case "--markdown":
				opts.markdown = true;
				break;
			case "--max":
				opts.max = parseInt(argv[++i], 10);
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length < 1) {
		logger.error("requires <url>");
		return null;
	}
	if (!opts.markdown && positional.length < 2) {
		logger.error("requires <selector> (unless --markdown is set)");
		return null;
	}
	opts.url = positional[0];
	opts.selector = positional[1] ?? "body";
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

	let page: Awaited<ReturnType<typeof Browser.newPage>> | undefined;
	try {
		page = await Browser.newPage({
			profile: opts.profile,
			spawnOpts:
				opts.profile === "fast"
					? { logLevel: "error", readyTimeoutMs: 10_000 }
					: undefined,
		});
		await page.goto(opts.url, { timeoutMs: opts.timeoutMs });

		if (opts.markdown) {
			const md = await page.markdown();
			Bun.stdout.write(md + "\n");
			return;
		}

		const els = await page.$$(opts.selector);
		const out: Array<{ index: number; text: string }> = [];
		for (let i = 0; i < els.length && i < opts.max; i++) {
			const el = els[i] as unknown as { textContent?: () => Promise<string> };
			const text = (await el.textContent?.()) ?? "";
			out.push({ index: i, text: text.trim().slice(0, 500) });
		}
		Bun.stdout.write(JSON.stringify(out, null, 2) + "\n");
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		try {
			await page?.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
