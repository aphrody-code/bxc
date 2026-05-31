/**
 * Runner: fetch-native
 *
 * Pure Bun.fetch — no HTML parsing, no browser. The simplest possible
 * baseline: measures raw HTTP round-trip latency and download size.
 *
 * Characteristics:
 *   - Zero RAM overhead beyond Bun itself
 *   - No JS execution — SPAs return the initial HTML skeleton only
 *   - Cloudflare: will be blocked at IUAM (receives challenge HTML)
 *   - Useful as a floor for latency comparison
 *
 * Note: We do NOT use cheerio or jsdom in this runner so it stays independent
 * of those packages. See cheerio.ts and jsdom.ts for parsing runners.
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";

export const RUNNER_ID = "fetch-native";
export const SKIP_REASON: string | null = null;

const DEFAULT_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function run(url: string): Promise<RunResult> {
	const ramBefore = rssNow();
	const t0 = Bun.nanoseconds() / 1e6;

	try {
		const resp = await fetch(url, {
			headers: {
				"User-Agent": DEFAULT_UA,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
				"Accept-Encoding": "gzip, deflate, br",
			},
			redirect: "follow",
			signal: AbortSignal.timeout(15_000),
		});

		const body = await resp.text();
		const latencyMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
		const ramAfter = rssNow();

		return {
			runner: RUNNER_ID,
			url,
			success: resp.ok || resp.status < 500,
			latencyMs,
			ramMb: Math.max(ramBefore, ramAfter),
			contentLength: body.length,
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
	// Warm DNS / TLS session cache with a known-fast endpoint
	try {
		await fetch("https://bun.sh/", { signal: AbortSignal.timeout(5_000) });
	} catch {
		// ignore
	}
}

export async function cleanup(): Promise<void> {
	// nothing to clean up
}
