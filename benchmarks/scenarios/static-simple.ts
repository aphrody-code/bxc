/**
 * Scenario: static-simple
 *
 * Tests all fetch+parse runners against a set of static HTML pages served
 * by the local mock server. This is the core comparison:
 *
 *   bunlight-static  vs  fetch-native  vs  cheerio  vs  jsdom
 *
 * Puppeteer and playwright are excluded because spawning a full browser for
 * static pages is not the intended use case and skews the comparison unfairly.
 *
 * URLs: 10 pages from the local mock server (static/1 through static/10)
 * Runs: 5 per URL per runner (first = cold, 2-5 = warm)
 */

import type { RunResult, ScenarioResult } from "../types.ts";
import { summarise, rssNow } from "../types.ts";
import { startMockServer, stopMockServer } from "../mock-server.ts";
import * as bunlightStatic from "../runners/bunlight-static.ts";
import * as fetchNative from "../runners/fetch-native.ts";
import * as cheerioRunner from "../runners/cheerio.ts";
import * as jsdomRunner from "../runners/jsdom.ts";

export const SCENARIO_ID = "static-simple";

// Each entry: [page_index, runs_per_url]
const PAGE_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RUNS_PER_URL = 5;
// Small delay between runs to avoid localhost saturation
const INTER_RUN_DELAY_MS = 50;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenarioForRunner(
	runner: typeof bunlightStatic,
	mockPort: number,
): Promise<ScenarioResult> {
	const allResults: RunResult[] = [];
	const t0 = performance.now();

	// Warmup
	if (runner.SKIP_REASON === null) {
		await runner.warmup();
	}

	for (const n of PAGE_INDICES) {
		const url = `http://localhost:${mockPort}/static/${n}`;
		for (let run = 0; run < RUNS_PER_URL; run++) {
			const result = await runner.run(url);
			allResults.push(result);
			if (run < RUNS_PER_URL - 1) await sleep(INTER_RUN_DELAY_MS);
		}
		await sleep(INTER_RUN_DELAY_MS);
	}

	await runner.cleanup();

	const totalMs = Math.round(performance.now() - t0);
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

	const runners = [
		bunlightStatic,
		fetchNative,
		cheerioRunner,
		jsdomRunner,
	] as (typeof bunlightStatic)[];

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
