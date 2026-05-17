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
 * `bxc scrape <url> <css-selector>` — extract textContent of matched elements.
 *
 * Output contract:
 *   - stdout = JSON array of { index, text }
 *   - exit 0 success, 2 misuse, 65 fetch error, 70 software error
 */

import { Browser } from "../api/browser.ts";

type ScrapeProfile = "static" | "fast" | "http";

interface ScrapeOptions {
	url: string;
	selector: string;
	profile: ScrapeProfile;
	max: number;
	timeoutMs: number;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc scrape — extract textContent of CSS-selected elements

Usage:
  bxc scrape <url> <css-selector> [options]

Options:
  --profile <name>   static (default) | fast | http
  --max <N>          max elements returned (default: 50)
  --timeout <ms>     navigation timeout (default: 25000)
  --help, -h         this help

Examples:
  bxc scrape https://google.com "td.title > span.titleline > a"
  bxc scrape https://google.com h1 --profile fast

Exit codes: 0 OK, 2 misuse, 65 data error, 70 software
`,
	);
}

function parseArgs(argv: readonly string[]): ScrapeOptions | null {
	const opts: ScrapeOptions = {
		url: "",
		selector: "",
		profile: "static",
		max: 50,
		timeoutMs: 25_000,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i];
				if (v !== "static" && v !== "fast" && v !== "http") {
					Bun.stderr.write(`Invalid profile: ${v}\n`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--max":
				opts.max = parseInt(argv[++i], 10);
				break;
			case "--timeout":
				opts.timeoutMs = parseInt(argv[++i], 10);
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length < 2) {
		Bun.stderr.write("bxc scrape: requires <url> and <selector>\n");
		return null;
	}
	opts.url = positional[0];
	opts.selector = positional[1];
	return opts;
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(2);
	}

	let page: Awaited<ReturnType<typeof Browser.newPage>> | undefined;
	try {
		page = await Browser.newPage({
			profile: opts.profile,
			spawnOpts:
				opts.profile === "fast" ? { logLevel: "error", readyTimeoutMs: 10_000 } : undefined,
		});
		await page.goto(opts.url, { timeoutMs: opts.timeoutMs });
		const els = await page.$$(opts.selector);
		const out: Array<{ index: number; text: string }> = [];
		for (let i = 0; i < els.length && i < opts.max; i++) {
			const el = els[i] as unknown as { textContent?: () => Promise<string> };
			const text = (await el.textContent?.()) ?? "";
			out.push({ index: i, text: text.trim().slice(0, 500) });
		}
		Bun.stdout.write(JSON.stringify(out, null, 2) + "\n");
	} catch (err) {
		Bun.stderr.write(`bxc scrape: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(65);
	} finally {
		try {
			await page?.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
