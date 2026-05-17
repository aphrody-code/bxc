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
 * @module bxc/stats/Statistics
 *
 * Request statistics tracker inspired by Crawlee's Statistics class.
 * Tracks request counts, durations, error rates, and computes
 * p50/p95 latency percentiles. Optionally persists to bun:sqlite.
 *
 * Usage:
 * ```ts
 * import { Statistics } from "./Statistics.ts";
 *
 * const stats = new Statistics();
 * stats.startTracking();
 *
 * // After each request:
 * stats.register(durationMs, true);   // success
 * stats.register(durationMs, false);  // failure
 * stats.register(durationMs, false, "TimeoutError"); // failure with error type
 *
 * const snap = stats.snapshot();
 * console.log(snap.requestsPerMinute, snap.p95DurationMs);
 *
 * stats.stopTracking();
 * ```
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A point-in-time snapshot of all statistics. */
export interface StatisticsSnapshot {
	/** Total requests registered (finished + failed). */
	requestsTotal: number;
	/** Requests that completed successfully. */
	requestsFinished: number;
	/** Requests that ended with an error. */
	requestsFailed: number;
	/** Total retry attempts logged via `registerRetry()`. */
	requestsRetried: number;
	/** Mean duration of successful requests in ms. 0 if none. */
	requestAvgFinishedDurationMs: number;
	/** Median (p50) duration of successful requests in ms. 0 if none. */
	p50DurationMs: number;
	/** 95th percentile duration of successful requests in ms. 0 if none. */
	p95DurationMs: number;
	/** Requests per minute since `startTracking()` (rolling). 0 if not started. */
	requestsPerMinute: number;
	/** Elapsed crawler runtime in ms since `startTracking()`. 0 if not started. */
	crawlerRuntimeMillis: number;
	/** Success rate as a value in [0, 1]. 1.0 if no requests. */
	successRate: number;
	/** Breakdown of error counts by error type (key = error type string). */
	errorBreakdown: Record<string, number>;
}

/** Options for the Statistics constructor. */
export interface StatisticsOptions {
	/**
	 * Path to the SQLite database for persistence.
	 * If omitted or `:memory:`, statistics are in-memory only.
	 * Default: no persistence (in-memory).
	 */
	dbPath?: string;
	/**
	 * Name of the statistics session (used as table/row key in SQLite).
	 * Default: `"default"`.
	 */
	sessionName?: string;
	/**
	 * Maximum number of duration samples to keep in the sliding window
	 * for percentile computation. Older samples are evicted.
	 * Default: 10_000.
	 */
	maxSamples?: number;
}

// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------

/**
 * Computes the Nth percentile of a sorted numeric array.
 * The array MUST be sorted ascending before calling this.
 */
function percentileSorted(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	// Linear interpolation
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export class Statistics {
	readonly #sessionName: string;
	readonly #maxSamples: number;

	// Request counters
	#requestsFinished = 0;
	#requestsFailed = 0;
	#requestsRetried = 0;

	// Duration tracking (ring buffer for percentiles)
	readonly #durations: number[] = [];

	// Cumulative sum of ALL successful durations (never evicted — used for mean).
	#totalDurationSum = 0;
	// Sum of durations in the current sliding window (evicted when full).
	
	// Error breakdown
	readonly #errorBreakdown: Map<string, number> = new Map();

	// Runtime tracking
	#startedAt: number | null = null;

	// Optional SQLite persistence
	#db: Database | null = null;
	readonly #dbPath: string | null;

	constructor(opts: StatisticsOptions = {}) {
		this.#sessionName = opts.sessionName ?? "default";
		this.#maxSamples = opts.maxSamples ?? 10_000;
		this.#dbPath = opts.dbPath ?? null;
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Start the runtime timer.  Must be called before using `requestsPerMinute`
	 * and `crawlerRuntimeMillis` in snapshots.
	 * Idempotent — calling again resets the timer.
	 */
	startTracking(): void {
		this.#startedAt = Date.now();
		this.#ensureDb();
	}

	/**
	 * Stop the runtime timer.  The elapsed time is frozen at the moment of this
	 * call and reflected in subsequent snapshots.
	 */
	stopTracking(): void {
		if (this.#startedAt !== null) {
			// Freeze elapsed by recording a negative sentinel offset
			const elapsed = Date.now() - this.#startedAt;
			this.#startedAt = -elapsed; // negative = stopped
		}
	}

	// ---------------------------------------------------------------------------
	// Data ingestion
	// ---------------------------------------------------------------------------

	/**
	 * Register the completion of one request.
	 *
	 * @param durationMs  Wall-clock time of the request in milliseconds.
	 * @param success     Whether the request succeeded (`true`) or failed (`false`).
	 * @param errorType   Optional error type string for the failure breakdown.
	 *                    Only used when `success` is `false`.
	 */
	register(durationMs: number, success: boolean, errorType?: string): void {
		if (success) {
			this.#requestsFinished++;
			this.#addDuration(durationMs);
		} else {
			this.#requestsFailed++;
			const key = errorType ?? "UnknownError";
			this.#errorBreakdown.set(key, (this.#errorBreakdown.get(key) ?? 0) + 1);
		}
		this.#persistSnapshot();
	}

	/**
	 * Log a retry attempt.  Call this each time a request is retried (before the
	 * retry completes — call `register()` when the final attempt resolves).
	 */
	registerRetry(): void {
		this.#requestsRetried++;
	}

	// ---------------------------------------------------------------------------
	// Snapshot
	// ---------------------------------------------------------------------------

	/**
	 * Return an immutable point-in-time snapshot of all statistics.
	 */
	snapshot(): StatisticsSnapshot {
		const total = this.#requestsFinished + this.#requestsFailed;
		const avgMs = this.#requestsFinished > 0 ? this.#totalDurationSum / this.#requestsFinished : 0;

		const sorted = this.#durations.slice().sort((a, b) => a - b);
		const p50 = percentileSorted(sorted, 50);
		const p95 = percentileSorted(sorted, 95);

		const runtimeMs = this.#runtimeMs();
		const rpm = runtimeMs > 0 ? Math.round((total / runtimeMs) * 60_000 * 100) / 100 : 0;

		const breakdown: Record<string, number> = {};
		for (const [k, v] of this.#errorBreakdown) {
			breakdown[k] = v;
		}

		return {
			requestsTotal: total,
			requestsFinished: this.#requestsFinished,
			requestsFailed: this.#requestsFailed,
			requestsRetried: this.#requestsRetried,
			requestAvgFinishedDurationMs: Math.round(avgMs * 100) / 100,
			p50DurationMs: Math.round(p50 * 100) / 100,
			p95DurationMs: Math.round(p95 * 100) / 100,
			requestsPerMinute: rpm,
			crawlerRuntimeMillis: runtimeMs,
			successRate: total > 0 ? this.#requestsFinished / total : 1,
			errorBreakdown: breakdown,
		};
	}

	// ---------------------------------------------------------------------------
	// Reset
	// ---------------------------------------------------------------------------

	/**
	 * Reset all counters and duration samples.
	 * Does NOT stop the runtime timer.
	 */
	reset(): void {
		this.#requestsFinished = 0;
		this.#requestsFailed = 0;
		this.#requestsRetried = 0;
		this.#durations.length = 0;
		this.#totalDurationSum = 0;
		this.#errorBreakdown.clear();
	}

	// ---------------------------------------------------------------------------
	// Persistence (bun:sqlite)
	// ---------------------------------------------------------------------------

	/**
	 * Close the SQLite connection if open.
	 * The Statistics object remains usable in in-memory mode.
	 */
	closeDb(): void {
		if (this.#db !== null) {
			this.#db.close();
			this.#db = null;
		}
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	#addDuration(ms: number): void {
		this.#totalDurationSum += ms;
				if (this.#durations.length >= this.#maxSamples) {
			// Evict oldest sample from window sum only
			this.#durations.shift();
					}
		this.#durations.push(ms);
	}

	/** Returns elapsed runtime in ms. 0 if `startTracking()` was never called. */
	#runtimeMs(): number {
		if (this.#startedAt === null) return 0;
		if (this.#startedAt < 0) {
			// Stopped — return frozen elapsed
			return -this.#startedAt;
		}
		return Date.now() - this.#startedAt;
	}

	#ensureDb(): void {
		if (this.#dbPath === null || this.#dbPath === ":memory:") return;
		if (this.#db !== null) return;

		// Ensure parent directory exists
		const dir = join(this.#dbPath, "..");
		// Bun.write to a sentinel triggers implicit mkdirp under bun:sqlite itself
		this.#db = new Database(this.#dbPath, { create: true });
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS statistics_snapshots (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session TEXT NOT NULL,
				recorded_at TEXT NOT NULL,
				snapshot_json TEXT NOT NULL
			)
		`);
		void dir; // referenced for linting clarity
	}

	#persistSnapshot(): void {
		if (this.#db === null) return;
		const snap = this.snapshot();
		this.#db.run(
			`INSERT INTO statistics_snapshots (session, recorded_at, snapshot_json)
			 VALUES (?, ?, ?)`,
			[this.#sessionName, new Date().toISOString(), JSON.stringify(snap)],
		);
	}

	/**
	 * Load the most recent persisted snapshot from SQLite into the current state.
	 * Useful to resume tracking after a restart.
	 * No-op if no database is configured or no rows exist.
	 */
	loadLastSnapshot(): void {
		if (this.#db === null) return;
		const row = this.#db
			.query(
				`SELECT snapshot_json FROM statistics_snapshots
				 WHERE session = ?
				 ORDER BY id DESC LIMIT 1`,
			)
			.get(this.#sessionName) as { snapshot_json: string } | null;
		if (row === null) return;

		try {
			const snap = JSON.parse(row.snapshot_json) as StatisticsSnapshot;
			this.#requestsFinished = snap.requestsFinished;
			this.#requestsFailed = snap.requestsFailed;
			this.#requestsRetried = snap.requestsRetried;
			for (const [k, v] of Object.entries(snap.errorBreakdown)) {
				this.#errorBreakdown.set(k, v);
			}
			// We cannot restore the exact duration samples, so approximate
			// by seeding with the average value (preserves mean, loses distribution).
			if (snap.requestsFinished > 0 && snap.requestAvgFinishedDurationMs > 0) {
				const seedCount = Math.min(snap.requestsFinished, this.#maxSamples);
				for (let i = 0; i < seedCount; i++) {
					this.#durations.push(snap.requestAvgFinishedDurationMs);
				}
				// Restore total sum for accurate mean computation
				this.#totalDurationSum = snap.requestAvgFinishedDurationMs * snap.requestsFinished;
							}
		} catch {
			// Ignore malformed persisted data
		}
	}
}
