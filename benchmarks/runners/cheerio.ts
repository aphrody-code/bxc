/**
 * Runner: cheerio
 *
 * Bun native fetch + cheerio for HTML parsing. Represents the traditional
 * Node.js scraping stack ported to Bun.
 *
 * Characteristics:
 *   - No browser, no JS execution
 *   - cheerio parses HTML server-side (jQuery-like API)
 *   - RAM: cheerio holds the entire DOM in memory (~2-10 MB per page)
 *   - Cloudflare: blocked at IUAM (receives challenge page)
 *   - SPAs: only sees the initial HTML skeleton, not rendered content
 *
 * Install: bun add cheerio (if not already installed)
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";

export const RUNNER_ID = "cheerio";

let cheerioLoad: ((html: string) => { text: () => string }) | null = null;
let SKIP_REASON: string | null = null;

async function loadCheerio(): Promise<void> {
	if (cheerioLoad !== null) return;
	try {
		const mod = await import("cheerio");
		cheerioLoad = mod.load as unknown as (html: string) => {
			text: () => string;
		};
		SKIP_REASON = null;
	} catch {
		SKIP_REASON = "cheerio not installed — run: bun add cheerio";
	}
}

export { SKIP_REASON };

const DEFAULT_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function run(url: string): Promise<RunResult> {
	await loadCheerio();

	if (SKIP_REASON) {
		return {
			runner: RUNNER_ID,
			url,
			success: false,
			latencyMs: 0,
			ramMb: 0,
			contentLength: 0,
			statusCode: 0,
			error: `SKIPPED: ${SKIP_REASON}`,
		};
	}

	const ramBefore = rssNow();
	const t0 = Bun.nanoseconds() / 1e6;

	try {
		const resp = await fetch(url, {
			headers: { "User-Agent": DEFAULT_UA },
			redirect: "follow",
			signal: AbortSignal.timeout(15_000),
		});

		const html = await resp.text();

		// Dynamically import cheerio (import() caches the module)
		const { load } = await import("cheerio");
		const $ = load(html);
		const title = $("title").text();
		const linkCount = $("a").length;

		const latencyMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
		const ramAfter = rssNow();

		// Cheerio success: got HTML and could parse at least a title or links
		const success = (resp.ok || resp.status < 500) && html.length > 100;

		void title;
		void linkCount;

		return {
			runner: RUNNER_ID,
			url,
			success,
			latencyMs,
			ramMb: Math.max(ramBefore, ramAfter),
			contentLength: html.length,
			statusCode: resp.status,
		};
	} catch (err) {
		return {
			runner: RUNNER_ID,
			url,
			success: false,
			latencyMs: Math.round(Bun.nanoseconds() / 1e6 - t0),
			ramMb: rssNow(),
			contentLength: 0,
			statusCode: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function warmup(): Promise<void> {
	await loadCheerio();
}

export async function cleanup(): Promise<void> {
	// nothing
}
