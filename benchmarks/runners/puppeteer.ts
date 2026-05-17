/**
 * Runner: puppeteer
 *
 * Puppeteer-core with bundled Chromium (via @puppeteer/browsers or the default
 * chromium channel). This is the industry-standard headless browser baseline.
 *
 * Characteristics:
 *   - Full JS execution, real Chromium
 *   - Cold start: Chromium spawn ~800-1500 ms (browser is reused across pages)
 *   - Per-page warm: ~100-400 ms (new tab)
 *   - RAM: ~120-250 MB (Chromium process always running)
 *   - Cloudflare: detectable (headless Chromium signatures visible)
 *
 * Skipped if: puppeteer-core is not installed OR chromium is not on PATH.
 *
 * Important: We reuse a single browser instance across all runs in a scenario
 * to match how production scrapers typically work (one browser, many pages).
 * Cold-start cost is measured separately in the first run.
 *
 * Install: bun add puppeteer-core (already in peerDeps)
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";

export const RUNNER_ID = "puppeteer";

// Browser instance reused across runs
let browserInstance: import("puppeteer-core").Browser | null = null;
let SKIP_REASON: string | null = null;
let initialized = false;

async function ensureBrowser(): Promise<import("puppeteer-core").Browser | null> {
	if (browserInstance) return browserInstance;
	if (initialized) return null; // already tried and failed

	initialized = true;

	try {
		const puppeteer = await import("puppeteer-core");

		// Attempt to find a Chromium/Chrome binary
		const chromiumPaths = [
			process.env.PUPPETEER_EXECUTABLE_PATH,
			"/usr/bin/chromium-browser",
			"/usr/bin/chromium",
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/snap/bin/chromium",
		].filter(Boolean) as string[];

		let executablePath: string | undefined;
		for (const p of chromiumPaths) {
			try {
				const result = Bun.spawnSync(["test", "-x", p], { stdout: "pipe", stderr: "pipe" });
				if (result.exitCode === 0) {
					executablePath = p;
					break;
				}
			} catch {
				// continue
			}
		}

		if (!executablePath) {
			SKIP_REASON =
				"No Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH or install chromium-browser.";
			return null;
		}

		browserInstance = await puppeteer.launch({
			executablePath,
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-gpu",
				"--no-first-run",
				"--no-zygote",
			],
		});

		return browserInstance;
	} catch (err) {
		SKIP_REASON = `puppeteer launch failed: ${err instanceof Error ? err.message : String(err)}`;
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
	const t0 = Bun.nanoseconds() / 1e6;

	let page: import("puppeteer-core").Page | null = null;
	try {
		page = await browser.newPage();
		await page.setUserAgent(
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		);
		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});

		const content = await page.content();
		const latencyMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
		const ramAfter = rssNow();

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
	} finally {
		await page?.close().catch(() => undefined);
	}
}

export async function warmup(): Promise<void> {
	// Launch the browser now so the first real run isn't charged with spawn cost
	await ensureBrowser();
}

export async function cleanup(): Promise<void> {
	await browserInstance?.close().catch(() => undefined);
	browserInstance = null;
	initialized = false;
}
