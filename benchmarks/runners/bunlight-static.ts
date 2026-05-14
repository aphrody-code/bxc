/**
 * Runner: bunlight-static
 *
 * Uses Bunlight's in-process StaticDomTransport (profile: "static").
 * This is the fastest profile: pure Bun fetch + in-process HTML parsing,
 * zero spawn, zero WebSocket.
 *
 * Characteristics:
 *   - No JS execution in page — static HTML only
 *   - RAM: ~30-50 MB (shared transport, no per-page overhead)
 *   - Latency: dominated by network RTT + HTML parse
 *   - Cloudflare: fails on JS challenges, succeeds on plain HTML
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";
import { Browser } from "../../src/api/browser.ts";

export const RUNNER_ID = "bunlight-static";
export const SKIP_REASON: string | null = null;

export async function run(url: string): Promise<RunResult> {
	const ramBefore = rssNow();
	const t0 = performance.now();

	try {
		await using page = await Browser.newPage({ profile: "static" });
		await page.goto(url, { timeoutMs: 15_000 });
		const content = await page.content();
		const latencyMs = Math.round(performance.now() - t0);
		const ramAfter = rssNow();

		return {
			runner: RUNNER_ID,
			url,
			success: content.length > 100,
			latencyMs,
			ramMb: Math.max(ramBefore, ramAfter),
			contentLength: content.length,
			statusCode: 200,
		};
	} catch (err) {
		return {
			runner: RUNNER_ID,
			url,
			success: false,
			latencyMs: Math.round(performance.now() - t0),
			ramMb: rssNow(),
			contentLength: 0,
			statusCode: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Warm-up: pre-initialise the shared transport so cold-start cost is not
 * attributed to the first benchmark URL.
 */
export async function warmup(): Promise<void> {
	try {
		await using page = await Browser.newPage({ profile: "static" });
		await page.goto("data:text/html,<h1>warmup</h1>");
	} catch {
		// ignore warmup failures
	}
}

export async function cleanup(): Promise<void> {
	await Browser.close().catch(() => undefined);
}
