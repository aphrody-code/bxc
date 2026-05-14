/**
 * Runner: playwright
 *
 * Playwright with Chromium channel. Similar to the puppeteer runner but using
 * the Playwright API, which has better auto-wait semantics.
 *
 * Characteristics:
 *   - Full JS execution, real Chromium
 *   - Cold start: ~800-1500 ms (browser reused across pages in a scenario)
 *   - Per-page warm: ~100-400 ms
 *   - RAM: ~150-300 MB
 *   - Cloudflare: detectable (standard Chromium automation markers)
 *
 * Skipped if: playwright package is not installed OR chromium channel not available.
 *
 * Install: bun add playwright
 *
 * Note: playwright's chromium binary download is ~150 MB. In CI, set
 * PLAYWRIGHT_BROWSERS_PATH or run `bunx playwright install chromium` first.
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";

export const RUNNER_ID = "playwright";

let browserInstance: import("playwright").Browser | null = null;
let SKIP_REASON: string | null = null;
let initialized = false;

async function ensureBrowser(): Promise<import("playwright").Browser | null> {
	if (browserInstance) return browserInstance;
	if (initialized) return null;

	initialized = true;

	try {
		const { chromium } = await import("playwright");
		browserInstance = await chromium.launch({
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-gpu",
			],
		});
		return browserInstance;
	} catch (err) {
		SKIP_REASON = `playwright launch failed: ${err instanceof Error ? err.message : String(err)}. Run: bunx playwright install chromium`;
		return null;
	}
}

export { SKIP_REASON };

export async function run(url: string): Promise<RunResult> {
	const browser = await ensureBrowser();

	if (!browser) {
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
	const t0 = performance.now();

	let page: import("playwright").Page | null = null;
	try {
		const ctx = await browser.newContext({
			userAgent:
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		});
		page = await ctx.newPage();

		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});

		const content = await page.content();
		const latencyMs = Math.round(performance.now() - t0);
		const ramAfter = rssNow();

		await ctx.close();

		return {
			runner: RUNNER_ID,
			url,
			success: content.length > 100,
			latencyMs,
			ramMb: Math.max(ramBefore, ramAfter),
			contentLength: content.length,
			statusCode: response?.status() ?? 0,
		};
	} catch (err) {
		await page?.close().catch(() => undefined);
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

export async function warmup(): Promise<void> {
	await ensureBrowser();
}

export async function cleanup(): Promise<void> {
	await browserInstance?.close().catch(() => undefined);
	browserInstance = null;
	initialized = false;
}
