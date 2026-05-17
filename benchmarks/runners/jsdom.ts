/**
 * Runner: jsdom
 *
 * Bun native fetch + jsdom for full DOM parsing. jsdom implements the W3C DOM
 * spec in Node/Bun, giving a real `document` object without a browser process.
 *
 * Characteristics:
 *   - No real browser, but has a full DOM + limited CSS parsing
 *   - jsdom can execute inline scripts (not enabled here for safety/performance)
 *   - RAM: ~20-60 MB per page (jsdom DOM tree + JS context)
 *   - Cloudflare: blocked at IUAM
 *   - SPAs: only the initial HTML skeleton is parsed
 *
 * Install: bun add jsdom (if not already installed)
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";

export const RUNNER_ID = "jsdom";

let jsdomAvailable = false;
let SKIP_REASON: string | null = null;

async function checkJsdom(): Promise<void> {
	if (jsdomAvailable || SKIP_REASON) return;
	try {
		await import("jsdom");
		jsdomAvailable = true;
		SKIP_REASON = null;
	} catch {
		SKIP_REASON = "jsdom not installed — run: bun add jsdom";
	}
}

export { SKIP_REASON };

const DEFAULT_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function run(url: string): Promise<RunResult> {
	await checkJsdom();

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

		const { JSDOM } = await import("jsdom");
		const dom = new JSDOM(html, {
			url,
			// No JS execution — faster and safer for benchmarking
			runScripts: "outside-only",
			resources: "usable",
		});

		const title = dom.window.document.title;
		const linkCount = dom.window.document.querySelectorAll("a").length;
		// Free the window to release DOM memory
		dom.window.close();

		const latencyMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
		const ramAfter = rssNow();

		void title;
		void linkCount;

		return {
			runner: RUNNER_ID,
			url,
			success: (resp.ok || resp.status < 500) && html.length > 100,
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
	await checkJsdom();
}

export async function cleanup(): Promise<void> {
	// nothing
}
