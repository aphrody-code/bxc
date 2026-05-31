/**
 * Runner: bxc-fast
 *
 * Uses Bxc's Lightpanda sub-process profile (profile: "fast").
 * Each page spawns a fresh Lightpanda process connected via CDP WebSocket.
 * This enables real JS execution (V8 inside Lightpanda).
 *
 * Characteristics:
 *   - Full JS execution for SPAs
 *   - Cold start: includes process spawn + readiness probe (~100-300 ms overhead)
 *   - Warm start: if sub-process is reused, ~50-100 ms per navigate
 *   - RAM: 60-80 MB per page (Lightpanda process + bun process overhead)
 *   - Cloudflare: fails on Turnstile / managed challenge (UA = "Lightpanda/1.0")
 *
 * Skipped if: BXC_LIGHTPANDA_BIN is not set AND lightpanda is not in PATH.
 */

import type { RunResult } from "../types.ts";
import { rssNow } from "../types.ts";
import { Browser } from "../../src/api/browser.ts";

export const RUNNER_ID = "bxc-fast";

const ROOT = new URL("../../", import.meta.url).pathname;
const KNOWN_CANDIDATES = [
	process.env.BXC_LIGHTPANDA_BIN,
	`${process.env.HOME}/bunmium/lightpanda`,
	`${process.env.HOME}/lightpanda`,
	`${ROOT}vendor/lightpanda-bin/linux-x64/lightpanda`,
	"/usr/local/bin/lightpanda",
	`${process.env.HOME}/.local/bin/lightpanda`,
	`${process.env.HOME}/.cache/lightpanda-node/lightpanda`,
].filter(Boolean) as string[];

function locateLightpanda(): string | null {
	const { existsSync } = require("node:fs");
	for (const candidate of KNOWN_CANDIDATES) {
		try {
			if (existsSync(candidate)) return candidate;
		} catch {
			// continue
		}
	}
	// Fall back to PATH
	try {
		const result = Bun.spawnSync(["which", "lightpanda"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode === 0) return result.stdout.toString().trim();
	} catch {
		// continue
	}
	return null;
}

const LIGHTPANDA_BIN: string | null = locateLightpanda();

export const SKIP_REASON: string | null = LIGHTPANDA_BIN
	? null
	: "lightpanda binary not found — set BXC_LIGHTPANDA_BIN or add lightpanda to PATH";

export async function run(url: string): Promise<RunResult> {
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
		await using page = await Browser.newPage({
			profile: "fast",
			spawnOpts: { binaryPath: LIGHTPANDA_BIN ?? undefined },
		});
		await page.goto(url, { timeoutMs: 30_000 });
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
			statusCode: 200,
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
	if (SKIP_REASON) return;
	// fast profile spawns a fresh process per page — no shared warmup possible
}

export async function cleanup(): Promise<void> {
	await Browser.close().catch(() => undefined);
}
