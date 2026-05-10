#!/usr/bin/env bun
/**
 * `bunlight scrape <url> <css-selector>` — extract textContent of matched elements.
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
	process.stdout.write(
		`bunlight scrape — extract textContent of CSS-selected elements

Usage:
  bunlight scrape <url> <css-selector> [options]

Options:
  --profile <name>   static (default) | fast | http
  --max <N>          max elements returned (default: 50)
  --timeout <ms>     navigation timeout (default: 25000)
  --help, -h         this help

Examples:
  bunlight scrape https://news.ycombinator.com "td.title > span.titleline > a"
  bunlight scrape https://example.com h1 --profile fast

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
					process.stderr.write(`Invalid profile: ${v}\n`);
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
		process.stderr.write("bunlight scrape: requires <url> and <selector>\n");
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
			const el = els[i] as { textContent?: () => Promise<string> };
			const text = (await el.textContent?.()) ?? "";
			out.push({ index: i, text: text.trim().slice(0, 500) });
		}
		process.stdout.write(JSON.stringify(out, null, 2) + "\n");
	} catch (err) {
		process.stderr.write(`bunlight scrape: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(65);
	} finally {
		try {
			await page?.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err: unknown) => {
		process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
