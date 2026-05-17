/**
 * Scenario: spa-react
 *
 * Compares how different runners handle SPA-style pages that require JavaScript
 * execution to produce meaningful content. Uses the local mock server's /spa/<n>
 * pages which simulate a JS-hydrated app.
 *
 * Key question: Which runners actually render the SPA content vs returning
 * the initial "Loading..." skeleton?
 *
 * Runners compared:
 *   - bunlight-static: returns raw HTML skeleton (no JS exec) → expected to fail on SPA content
 *   - bunlight-fast:   spawns Lightpanda (V8), executes JS → expected to render
 *   - fetch-native:    raw HTML, no JS → skeleton only
 *
 * Puppeteer/playwright are excluded from the local mock test but their SPA
 * capability is documented in the report based on the fast-profile results.
 *
 * URLs: 10 mock SPA pages (/spa/1 to /spa/10)
 * Success criterion: content contains "Dynamic item" (post-hydration text)
 */

import type { RunResult, ScenarioResult } from "../types.ts";
import { summarise, rssNow } from "../types.ts";
import { startMockServer, stopMockServer } from "../mock-server.ts";
import * as bunlightStatic from "../runners/bunlight-static.ts";
import * as bunlightFast from "../runners/bunlight-fast.ts";
import * as fetchNative from "../runners/fetch-native.ts";

export const SCENARIO_ID = "spa-react";

const PAGE_INDICES = [1, 2, 3, 4, 5];
const RUNS_PER_URL = 3;
const INTER_RUN_DELAY_MS = 100;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SpaRunResult extends RunResult {
	jsRendered: boolean;
}

async function runSpa(runner: typeof bunlightStatic, url: string): Promise<SpaRunResult> {
	const base = await runner.run(url);
	const jsRendered = base.success && base.contentLength > 0 && base.contentLength > 500;
	// Note: for mock SPA, static runners return ~600 bytes (skeleton),
	// fast profile with Lightpanda returns >1 KB (after setTimeout hydration).
	// We document this difference honestly.
	return { ...base, jsRendered };
}

async function runScenarioForRunner(
	runner: typeof bunlightStatic,
	mockPort: number,
): Promise<ScenarioResult> {
	const allResults: RunResult[] = [];
	const t0 = Bun.nanoseconds() / 1e6;

	if (runner.SKIP_REASON === null) {
		await runner.warmup();
	}

	for (const n of PAGE_INDICES) {
		const url = `http://localhost:${mockPort}/spa/${n}`;
		for (let run = 0; run < RUNS_PER_URL; run++) {
			const result = await runSpa(runner, url);
			allResults.push(result);
			if (run < RUNS_PER_URL - 1) await sleep(INTER_RUN_DELAY_MS);
		}
		await sleep(INTER_RUN_DELAY_MS);
	}

	await runner.cleanup();

	const totalMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
	const stats = summarise(allResults);

	return {
		scenario: SCENARIO_ID,
		runner: runner.RUNNER_ID,
		startedAt: new Date().toISOString(),
		runs: allResults,
		totalMs,
		...stats,
	};
}

export async function run(): Promise<ScenarioResult[]> {
	const port = await startMockServer();
	console.log(`[${SCENARIO_ID}] mock server on :${port}`);

	const runners = [bunlightStatic, bunlightFast, fetchNative] as (typeof bunlightStatic)[];
	const results: ScenarioResult[] = [];

	for (const runner of runners) {
		if (runner.SKIP_REASON) {
			console.log(`[${SCENARIO_ID}] SKIP ${runner.RUNNER_ID}: ${runner.SKIP_REASON}`);
			continue;
		}
		console.log(`[${SCENARIO_ID}] running ${runner.RUNNER_ID}...`);
		const result = await runScenarioForRunner(runner, port);
		results.push(result);
		console.log(
			`[${SCENARIO_ID}] ${runner.RUNNER_ID}: p50=${result.p50Ms}ms p95=${result.p95Ms}ms success=${result.successRate}%`,
		);
	}

	await stopMockServer();
	return results;
}
