/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Unit tests for Statistics tracker.
 * Tests: register, snapshot, reset, percentiles, error breakdown, runtime tracking.
 */

import { describe, expect, test } from "bun:test";
import { Statistics } from "../../src/stats/Statistics.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStats(): Statistics {
	return new Statistics({ maxSamples: 100 });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Statistics — initial state", () => {
	test("snapshot returns zeros on fresh instance", () => {
		const stats = makeStats();
		const snap = stats.snapshot();
		expect(snap.requestsTotal).toBe(0);
		expect(snap.requestsFinished).toBe(0);
		expect(snap.requestsFailed).toBe(0);
		expect(snap.requestsRetried).toBe(0);
		expect(snap.requestAvgFinishedDurationMs).toBe(0);
		expect(snap.p50DurationMs).toBe(0);
		expect(snap.p95DurationMs).toBe(0);
		expect(snap.requestsPerMinute).toBe(0);
		expect(snap.crawlerRuntimeMillis).toBe(0);
		expect(snap.successRate).toBe(1); // 1.0 when no requests
		expect(snap.errorBreakdown).toEqual({});
	});
});

describe("Statistics — register successful requests", () => {
	test("single success increments finished and total", () => {
		const stats = makeStats();
		stats.register(100, true);
		const snap = stats.snapshot();
		expect(snap.requestsFinished).toBe(1);
		expect(snap.requestsFailed).toBe(0);
		expect(snap.requestsTotal).toBe(1);
	});

	test("multiple successes accumulate correctly", () => {
		const stats = makeStats();
		for (let i = 0; i < 5; i++) stats.register(200, true);
		const snap = stats.snapshot();
		expect(snap.requestsFinished).toBe(5);
		expect(snap.requestsTotal).toBe(5);
	});

	test("avg duration is correct after uniform durations", () => {
		const stats = makeStats();
		stats.register(100, true);
		stats.register(200, true);
		stats.register(300, true);
		const snap = stats.snapshot();
		// avg = (100+200+300)/3 = 200
		expect(snap.requestAvgFinishedDurationMs).toBe(200);
	});
});

describe("Statistics — register failed requests", () => {
	test("failure increments failed and total", () => {
		const stats = makeStats();
		stats.register(50, false);
		const snap = stats.snapshot();
		expect(snap.requestsFailed).toBe(1);
		expect(snap.requestsFinished).toBe(0);
		expect(snap.requestsTotal).toBe(1);
	});

	test("failure with errorType goes into breakdown", () => {
		const stats = makeStats();
		stats.register(50, false, "TimeoutError");
		stats.register(80, false, "TimeoutError");
		stats.register(30, false, "NetworkError");
		const snap = stats.snapshot();
		expect(snap.errorBreakdown["TimeoutError"]).toBe(2);
		expect(snap.errorBreakdown["NetworkError"]).toBe(1);
	});

	test("failure without errorType uses UnknownError key", () => {
		const stats = makeStats();
		stats.register(100, false);
		const snap = stats.snapshot();
		expect(snap.errorBreakdown["UnknownError"]).toBe(1);
	});

	test("success rate is correct with mixed requests", () => {
		const stats = makeStats();
		stats.register(100, true);
		stats.register(100, true);
		stats.register(100, false);
		const snap = stats.snapshot();
		// 2 out of 3 succeeded
		expect(snap.successRate).toBeCloseTo(2 / 3, 5);
	});
});

describe("Statistics — percentiles", () => {
	test("p50 and p95 with known distribution", () => {
		const stats = makeStats();
		// Register 100 requests with durations 1..100 ms
		for (let i = 1; i <= 100; i++) {
			stats.register(i, true);
		}
		const snap = stats.snapshot();
		// p50 of 1..100 = ~50.5
		expect(snap.p50DurationMs).toBeGreaterThanOrEqual(50);
		expect(snap.p50DurationMs).toBeLessThanOrEqual(51);
		// p95 of 1..100 = ~95.05
		expect(snap.p95DurationMs).toBeGreaterThanOrEqual(95);
		expect(snap.p95DurationMs).toBeLessThanOrEqual(96);
	});

	test("p50 equals single value when only one sample", () => {
		const stats = makeStats();
		stats.register(250, true);
		const snap = stats.snapshot();
		expect(snap.p50DurationMs).toBe(250);
		expect(snap.p95DurationMs).toBe(250);
	});

	test("percentiles are 0 when no successful requests", () => {
		const stats = makeStats();
		stats.register(100, false);
		const snap = stats.snapshot();
		expect(snap.p50DurationMs).toBe(0);
		expect(snap.p95DurationMs).toBe(0);
	});
});

describe("Statistics — retries", () => {
	test("registerRetry increments counter", () => {
		const stats = makeStats();
		stats.registerRetry();
		stats.registerRetry();
		const snap = stats.snapshot();
		expect(snap.requestsRetried).toBe(2);
	});
});

describe("Statistics — reset", () => {
	test("reset clears all counters and durations", () => {
		const stats = makeStats();
		stats.register(100, true);
		stats.register(50, false, "Timeout");
		stats.registerRetry();
		stats.reset();
		const snap = stats.snapshot();
		expect(snap.requestsTotal).toBe(0);
		expect(snap.requestsFinished).toBe(0);
		expect(snap.requestsFailed).toBe(0);
		expect(snap.requestsRetried).toBe(0);
		expect(snap.requestAvgFinishedDurationMs).toBe(0);
		expect(snap.p50DurationMs).toBe(0);
		expect(snap.p95DurationMs).toBe(0);
		expect(snap.errorBreakdown).toEqual({});
	});
});

describe("Statistics — runtime tracking", () => {
	test("crawlerRuntimeMillis is 0 before startTracking", () => {
		const stats = makeStats();
		stats.register(100, true);
		expect(stats.snapshot().crawlerRuntimeMillis).toBe(0);
	});

	test("crawlerRuntimeMillis increases after startTracking", async () => {
		const stats = makeStats();
		stats.startTracking();
		await Bun.sleep(50);
		const runtime = stats.snapshot().crawlerRuntimeMillis;
		expect(runtime).toBeGreaterThanOrEqual(40);
	});

	test("stopTracking freezes the runtime", async () => {
		const stats = makeStats();
		stats.startTracking();
		await Bun.sleep(50);
		stats.stopTracking();
		const t1 = stats.snapshot().crawlerRuntimeMillis;
		await Bun.sleep(50);
		const t2 = stats.snapshot().crawlerRuntimeMillis;
		// Both should be the same frozen value (allow small float drift)
		expect(Math.abs(t2 - t1)).toBeLessThan(5);
	});

	test("requestsPerMinute > 0 after startTracking and registering", async () => {
		const stats = makeStats();
		stats.startTracking();
		for (let i = 0; i < 10; i++) stats.register(10, true);
		await Bun.sleep(10);
		const snap = stats.snapshot();
		expect(snap.requestsPerMinute).toBeGreaterThan(0);
	});
});

describe("Statistics — sliding window / maxSamples", () => {
	test("exceeding maxSamples does not throw and mean stays correct", () => {
		// maxSamples = 5, register 10 samples of 100ms
		const stats = new Statistics({ maxSamples: 5 });
		for (let i = 0; i < 10; i++) stats.register(100, true);
		const snap = stats.snapshot();
		// Average should still be ~100ms after eviction
		expect(snap.requestAvgFinishedDurationMs).toBe(100);
		// Duration array capped at 5
		expect(snap.p50DurationMs).toBe(100);
	});
});
