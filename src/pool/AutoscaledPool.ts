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
 * @module bxc/pool/AutoscaledPool
 *
 * Dynamically adjusts task concurrency based on real-time CPU and RSS memory
 * pressure.  Inspired by Crawlee's AutoscaledPool
 * (packages/core/src/autoscaling/autoscaled_pool.ts) but rewritten Bun-native:
 *
 *  - Uses `process.memoryUsage().rss` and `os.loadavg()` directly (no Snapshotter).
 *  - No external dependencies.
 *  - Works with any async task producer via the `runTaskFunction` / `isTaskReady`
 *    / `isFinished` callback triad (same API as Crawlee for easy migration).
 *
 * Scaling algorithm:
 *  - Every `autoscaleIntervalMs`:
 *      * Sample RSS and 1-minute load average.
 *      * If RSS > `maxMemoryRatio * totalMemory` OR load > `maxLoadRatio * cpuCount`
 *        → scale DOWN by `scaleDownStep` (min: `minConcurrency`).
 *      * Else if current concurrency is at desired and not overloaded
 *        → scale UP by `scaleUpStep` (max: `maxConcurrency`).
 *  - Tasks are launched whenever `currentConcurrency < desiredConcurrency` and
 *    `isTaskReady()` returns true.
 *
 * @example
 * ```ts
 * const items = ["url1", "url2", "url3"];
 * let idx = 0;
 *
 * const pool = new AutoscaledPool({
 *   minConcurrency: 1,
 *   maxConcurrency: 20,
 *   runTaskFunction: async () => {
 *     const url = items[idx++];
 *     await fetch(url);
 *   },
 *   isTaskReadyFunction: async () => idx < items.length,
 *   isFinishedFunction: async () => idx >= items.length,
 * });
 *
 * await pool.run();
 * ```
 */

import { cpus, freemem, totalmem, loadavg } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoscaledPoolOptions {
	/** Called to execute one unit of work. Must resolve (or reject) per task. */
	runTaskFunction: () => Promise<unknown>;
	/** Return `true` if a new task should start; `false` to pause launching. */
	isTaskReadyFunction: () => Promise<boolean>;
	/**
	 * Return `true` when there is no more work to do AND none pending.
	 * The pool calls this only when `isTaskReadyFunction` returns `false`.
	 */
	isFinishedFunction: () => Promise<boolean>;

	/** Minimum concurrency floor.  Default: 1 */
	minConcurrency?: number;
	/** Maximum concurrency ceiling.  Default: 50 */
	maxConcurrency?: number;
	/**
	 * Starting desired concurrency.
	 * Defaults to `minConcurrency`.
	 */
	desiredConcurrency?: number;

	/**
	 * Fractional step added to `desiredConcurrency` on scale-up.
	 * Clamped to at least 1. Default: 0.05 (5 %).
	 */
	scaleUpStepRatio?: number;
	/**
	 * Fractional step subtracted from `desiredConcurrency` on scale-down.
	 * Default: 0.05.
	 */
	scaleDownStepRatio?: number;

	/**
	 * Maximum RSS/totalMemory ratio before scaling down.
	 * Default: 0.80 (80 % of total RAM).
	 */
	maxMemoryRatio?: number;
	/**
	 * Maximum load-average-per-CPU ratio before scaling down.
	 * Default: 0.85.
	 */
	maxLoadRatio?: number;

	/** How often to evaluate autoscaling (ms). Default: 10_000 */
	autoscaleIntervalMs?: number;
	/** How often to poll for new tasks (ms). Default: 500 */
	maybeRunIntervalMs?: number;
	/** Timeout for a single task (ms). 0 = disabled. Default: 0 */
	taskTimeoutMs?: number;
}

export interface AutoscaledPoolStats {
	currentConcurrency: number;
	desiredConcurrency: number;
	completedTasks: number;
	failedTasks: number;
	rssBytes: number;
	loadAvg: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// AutoscaledPool
// ---------------------------------------------------------------------------

export class AutoscaledPool {
	// ---- configurable ----
	readonly #minConcurrency: number;
	readonly #maxConcurrency: number;
	readonly #scaleUpStepRatio: number;
	readonly #scaleDownStepRatio: number;
	readonly #maxMemoryRatio: number;
	readonly #maxLoadRatio: number;
	readonly #autoscaleIntervalMs: number;
	readonly #maybeRunIntervalMs: number;
	readonly #taskTimeoutMs: number;
	readonly #runTaskFunction: () => Promise<unknown>;
	readonly #isTaskReadyFunction: () => Promise<boolean>;
	readonly #isFinishedFunction: () => Promise<boolean>;

	// ---- internal state ----
	#desiredConcurrency: number;
	#currentConcurrency = 0;
	#completedTasks = 0;
	#failedTasks = 0;
	#isStopped = false;

	// ---- resolve/reject for the run() promise ----
	#resolve: (() => void) | null = null;
	#reject: ((err: unknown) => void) | null = null;

	// ---- interval handles ----
	#autoscaleTimer: Timer | null = null;
	#maybeRunTimer: Timer | null = null;

	constructor(opts: AutoscaledPoolOptions) {
		this.#minConcurrency = opts.minConcurrency ?? 1;
		this.#maxConcurrency = opts.maxConcurrency ?? 50;
		this.#scaleUpStepRatio = opts.scaleUpStepRatio ?? 0.05;
		this.#scaleDownStepRatio = opts.scaleDownStepRatio ?? 0.05;
		this.#maxMemoryRatio = opts.maxMemoryRatio ?? 0.8;
		this.#maxLoadRatio = opts.maxLoadRatio ?? 0.85;
		this.#autoscaleIntervalMs = opts.autoscaleIntervalMs ?? 10_000;
		this.#maybeRunIntervalMs = opts.maybeRunIntervalMs ?? 500;
		this.#taskTimeoutMs = opts.taskTimeoutMs ?? 0;
		this.#desiredConcurrency = clamp(
			opts.desiredConcurrency ?? this.#minConcurrency,
			this.#minConcurrency,
			this.#maxConcurrency,
		);

		this.#runTaskFunction = opts.runTaskFunction;
		this.#isTaskReadyFunction = opts.isTaskReadyFunction;
		this.#isFinishedFunction = opts.isFinishedFunction;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Start the pool and run until `isFinishedFunction` returns `true`. */
	run(): Promise<void> {
		if (this.#resolve !== null) {
			return Promise.reject(new Error("AutoscaledPool.run() already called"));
		}

		return new Promise<void>((resolve, reject) => {
			this.#resolve = resolve;
			this.#reject = reject;
			this.#isStopped = false;

			// Start autoscale evaluation interval
			this.#autoscaleTimer = setInterval(() => {
				void this.#evaluateAutoscale();
			}, this.#autoscaleIntervalMs);

			// Start the "maybe run" polling interval
			this.#maybeRunTimer = setInterval(() => {
				void this.#maybeRunTask();
			}, this.#maybeRunIntervalMs);

			// Kick off initial tasks immediately
			void this.#maybeRunTask();
		});
	}

	/** Gracefully stop the pool after current tasks finish. */
	abort(): void {
		this.#isStopped = true;
		this.#cleanup();
		this.#resolve?.();
		this.#resolve = null;
		this.#reject = null;
	}

	/** Get current concurrency and system-pressure metrics. */
	getStats(): AutoscaledPoolStats {
		const mem = process.memoryUsage();
		const [load1] = loadavg() ?? [0];
		return {
			currentConcurrency: this.#currentConcurrency,
			desiredConcurrency: this.#desiredConcurrency,
			completedTasks: this.#completedTasks,
			failedTasks: this.#failedTasks,
			rssBytes: mem.rss,
			loadAvg: load1,
		};
	}

	// ---------------------------------------------------------------------------
	// Private — scaling logic
	// ---------------------------------------------------------------------------

	#evaluateAutoscale(): void {
		const totalMem = totalmem();
		const usedMem = totalMem - freemem();
		const memRatio = usedMem / totalMem;

		// Load average is 1-min average per CPU core
		const [load1] = loadavg() ?? [0];
		const numCpus = cpus().length || 1;
		const loadRatio = load1 / numCpus;

		const overloaded =
			memRatio > this.#maxMemoryRatio || loadRatio > this.#maxLoadRatio;

		if (overloaded) {
			// Scale down
			const step = Math.max(
				1,
				Math.floor(this.#desiredConcurrency * this.#scaleDownStepRatio),
			);
			this.#desiredConcurrency = clamp(
				this.#desiredConcurrency - step,
				this.#minConcurrency,
				this.#maxConcurrency,
			);
		} else if (this.#currentConcurrency >= this.#desiredConcurrency * 0.9) {
			// At capacity and system is healthy — scale up
			const step = Math.max(
				1,
				Math.floor(this.#desiredConcurrency * this.#scaleUpStepRatio),
			);
			this.#desiredConcurrency = clamp(
				this.#desiredConcurrency + step,
				this.#minConcurrency,
				this.#maxConcurrency,
			);
		}
	}

	// ---------------------------------------------------------------------------
	// Private — task launching
	// ---------------------------------------------------------------------------

	async #maybeRunTask(): Promise<void> {
		if (this.#isStopped) return;

		// Try to fill up to desired concurrency
		while (this.#currentConcurrency < this.#desiredConcurrency) {
			const ready = await this.#isTaskReadyFunction().catch(() => false);
			if (!ready) break;
			void this.#spawnTask();
		}

		// If no slots are in use and task is not ready, check if we're done
		if (this.#currentConcurrency === 0) {
			const taskReady = await this.#isTaskReadyFunction().catch(() => false);
			if (!taskReady) {
				const finished = await this.#isFinishedFunction().catch(() => false);
				if (finished && !this.#isStopped) {
					this.#isStopped = true;
					this.#cleanup();
					this.#resolve?.();
					this.#resolve = null;
					this.#reject = null;
				}
			}
		}
	}

	async #spawnTask(): Promise<void> {
		this.#currentConcurrency++;
		try {
			let taskPromise = this.#runTaskFunction();
			if (this.#taskTimeoutMs > 0) {
				taskPromise = Promise.race([
					taskPromise,
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Task timeout")),
							this.#taskTimeoutMs,
						),
					),
				]);
			}
			await taskPromise;
			this.#completedTasks++;
		} catch (err) {
			this.#failedTasks++;
			// Propagate critical errors; non-critical errors are counted but swallowed.
			if (err instanceof Error && err.message === "Task timeout") {
				// Swallow timeout — task is counted as failed.
			} else if (!this.#isStopped) {
				// Re-throw unexpected errors to the run() promise.
				this.#isStopped = true;
				this.#cleanup();
				this.#reject?.(err);
				this.#reject = null;
				this.#resolve = null;
				return;
			}
		} finally {
			this.#currentConcurrency--;
		}
		// After each task, immediately try to launch more.
		void this.#maybeRunTask();
	}

	#cleanup(): void {
		if (this.#autoscaleTimer !== null) {
			clearInterval(this.#autoscaleTimer);
			this.#autoscaleTimer = null;
		}
		if (this.#maybeRunTimer !== null) {
			clearInterval(this.#maybeRunTimer);
			this.#maybeRunTimer = null;
		}
	}
}
