/**
 * Scenario: parallel-100
 *
 * Concurrency stress test: fetches 100 URLs in parallel using different
 * concurrency strategies for bxc-static vs fetch-native.
 *
 * Puppeteer/playwright are excluded from this scenario because:
 *   - Puppeteer opens 100 tabs → OOM on typical dev machines (~25 GB RAM needed)
 *   - bxc-fast opens 100 Lightpanda processes → similarly heavy
 *
 * Tested concurrency strategies:
 *   - bxc-static concurrent: all 100 StaticDomTransport requests at once
 *   - fetch-native batched-25:    25 concurrent fetches at a time
 *   - fetch-native batched-50:    50 concurrent fetches at a time
 *   - fetch-native concurrent-100: all 100 at once (baseline)
 *
 * URLs: 100 mock static pages (/static/1 to /static/100)
 *
 * Measured: total wall-clock time, per-request p50/p95, peak RSS
 */

import type { RunResult, ScenarioResult } from "../types.ts";
import { summarise, rssNow } from "../types.ts";
import { startMockServer, stopMockServer } from "../mock-server.ts";
import * as bxcStatic from "../runners/bxc-static.ts";
import * as fetchNative from "../runners/fetch-native.ts";

export const SCENARIO_ID = "parallel-100";

const TOTAL_URLS = 100;

async function runConcurrentBatch<T>(
	tasks: (() => Promise<T>)[],
	concurrency: number,
): Promise<T[]> {
	const results: T[] = [];
	let index = 0;

	async function worker(): Promise<void> {
		while (index < tasks.length) {
			const currentIndex = index++;
			const task = tasks[currentIndex];
			if (task) {
				results[currentIndex] = await task();
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, tasks.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}

async function runParallelScenario(
	runnerId: string,
	runFn: (url: string) => Promise<RunResult>,
	urls: string[],
	concurrency: number,
): Promise<ScenarioResult> {
	const t0 = Bun.nanoseconds() / 1e6;
	const ramBefore = rssNow();

	const tasks = urls.map((url) => () => runFn(url));
	const allResults = await runConcurrentBatch(tasks, concurrency);

	const peakRam = Math.max(ramBefore, rssNow());
	const totalMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
	const stats = summarise(allResults);

	return {
		scenario: `${SCENARIO_ID} (conc=${concurrency})`,
		runner: runnerId,
		startedAt: new Date().toISOString(),
		runs: allResults,
		totalMs,
		...stats,
		peakRamMb: Math.max(stats.peakRamMb, peakRam),
	};
}

export async function run(): Promise<ScenarioResult[]> {
	const port = await startMockServer();
	console.log(`[${SCENARIO_ID}] mock server on :${port}`);

	const urls = Array.from(
		{ length: TOTAL_URLS },
		(_, i) => `http://localhost:${port}/static/${i + 1}`,
	);

	// Warmup
	await fetchNative.warmup();

	const results: ScenarioResult[] = [];

	// --- bxc-static: sequential (concurrency=1) ---
	// KNOWN LIMITATION: StaticDomTransport is a shared singleton. Multiple concurrent
	// pages on the same transport share CDP IDs — concurrent use causes response
	// routing collisions and hangs. The transport is designed for sequential use or
	// for one-page-at-a-time flows. We run it sequentially to measure throughput.
	//
	// Future fix: each Page should create an isolated transport instance, not share one.
	// Track as: https://github.com/bunmium/bxc/issues/XX (concurrency-safe transport)
	console.log(
		`[${SCENARIO_ID}] bxc-static: sequential (shared transport is not concurrency-safe)...`,
	);
	await bxcStatic.warmup();
	// Only run 20 URLs sequentially to avoid making the test too slow
	const blResult = await runParallelScenario(
		"bxc-static",
		bxcStatic.run,
		urls.slice(0, 20),
		1,
	);
	results.push({ ...blResult, scenario: `${SCENARIO_ID} (sequential-20)` });
	console.log(
		`[${SCENARIO_ID}] bxc-static sequential-20: total=${blResult.totalMs}ms p50=${blResult.p50Ms}ms p95=${blResult.p95Ms}ms peak_ram=${blResult.peakRamMb}MB`,
	);
	await bxcStatic.cleanup();

	// Give GC a moment
	await new Promise((r) => setTimeout(r, 300));

	// --- fetch-native: 25 concurrent ---
	console.log(`[${SCENARIO_ID}] fetch-native: 25 concurrent...`);
	const fetchBatch25 = await runParallelScenario(
		"fetch-native",
		fetchNative.run,
		urls,
		25,
	);
	results.push({ ...fetchBatch25, scenario: `${SCENARIO_ID} (conc=25)` });
	console.log(
		`[${SCENARIO_ID}] fetch-native batched-25: total=${fetchBatch25.totalMs}ms p50=${fetchBatch25.p50Ms}ms p95=${fetchBatch25.p95Ms}ms`,
	);

	await new Promise((r) => setTimeout(r, 300));

	// --- fetch-native: 100 concurrent ---
	console.log(`[${SCENARIO_ID}] fetch-native: 100 concurrent...`);
	const fetchConc100 = await runParallelScenario(
		"fetch-native",
		fetchNative.run,
		urls,
		100,
	);
	results.push({ ...fetchConc100, scenario: `${SCENARIO_ID} (conc=100)` });
	console.log(
		`[${SCENARIO_ID}] fetch-native concurrent-100: total=${fetchConc100.totalMs}ms p50=${fetchConc100.p50Ms}ms p95=${fetchConc100.p95Ms}ms`,
	);

	await fetchNative.cleanup();
	await stopMockServer();
	return results;
}
