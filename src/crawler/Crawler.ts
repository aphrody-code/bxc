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
 * @module bxc/crawler/Crawler
 *
 * Base crawler class managing request queues, concurrency, limits, and dataset pushing.
 */

import { RequestQueue } from "../queue/RequestQueue.ts";
import { Dataset } from "../storage/Dataset.ts";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

export interface CrawlContext {
	request: {
		id: number;
		url: string;
		method: string;
		uniqueKey: string;
		payload: string | null;
		headers?: Record<string, string> | null;
		userData?: Record<string, unknown> | null;
	};
	enqueueLinks: (options?: {
		selector?: string;
		allowedDomains?: string[];
		userData?: Record<string, unknown>;
	}) => Promise<void>;
	pushData: (
		data: Record<string, unknown> | Record<string, unknown>[],
	) => Promise<void>;
	log: (msg: string) => void;
}

export interface BasicCrawlerOptions<ContextType extends CrawlContext> {
	requestQueue?: RequestQueue;
	requestHandler: (context: ContextType) => Promise<void>;
	minConcurrency?: number;
	maxConcurrency?: number;
	maxRequestsPerCrawl?: number;
	log?: (msg: string) => void;
	// Autoscale settings
	autoscaleIntervalMs?: number;
	maxUsedCpuRatio?: number;
	maxUsedMemoryRatio?: number;
	maxBlockedMillis?: number;
}

export abstract class BasicCrawler<ContextType extends CrawlContext> {
	protected requestQueue: RequestQueue;
	protected requestHandler: (context: ContextType) => Promise<void>;
	protected minConcurrency: number;
	protected maxConcurrency: number;
	protected maxRequestsPerCrawl: number;
	protected log: (msg: string) => void;
	protected dataset: Dataset | null = null;
	protected count = 0;
	protected options: BasicCrawlerOptions<ContextType>;

	// Autoscale thresholds
	protected autoscaleIntervalMs: number;
	protected maxUsedCpuRatio: number;
	protected maxUsedMemoryRatio: number;
	protected maxBlockedMillis: number;

	constructor(options: BasicCrawlerOptions<ContextType>) {
		this.options = options;
		this.requestQueue = options.requestQueue ?? RequestQueue.open(":memory:");
		this.requestHandler = options.requestHandler;
		this.minConcurrency = options.minConcurrency ?? 2;
		this.maxConcurrency = options.maxConcurrency ?? 20;
		this.maxRequestsPerCrawl = options.maxRequestsPerCrawl ?? Infinity;
		this.log = options.log ?? ((msg) => console.log(`[crawler] ${msg}`));

		// Defaults matching Crawlee heuristics
		this.autoscaleIntervalMs = options.autoscaleIntervalMs ?? 5000;
		this.maxUsedCpuRatio = options.maxUsedCpuRatio ?? 0.85;
		this.maxUsedMemoryRatio = options.maxUsedMemoryRatio ?? 0.9;
		this.maxBlockedMillis = options.maxBlockedMillis ?? 50;
	}

	abstract processRequest(request: any): Promise<void>;

	async run(initialUrls?: string[]): Promise<void> {
		if (initialUrls && initialUrls.length > 0) {
			this.requestQueue.addRequests(initialUrls);
		}

		this.dataset = await Dataset.open("default");

		const activePromises = new Set<Promise<void>>();
		let desiredConcurrency = this.minConcurrency;

		// 1. Set up event loop delay tracking
		const eventLoopMonitor = monitorEventLoopDelay({ resolution: 10 });
		eventLoopMonitor.enable();

		// 2. Initialize CPU tracking state
		let lastCpuSample = os.cpus();
		let currentCpuUsage = 0;

		// 3. Set up the dynamic autoscaling checker loop (non-blocking)
		const statsInterval = setInterval(() => {
			// A. Calculate CPU usage delta
			const nextCpuSample = os.cpus();
			let idleDiff = 0;
			let totalDiff = 0;
			for (let i = 0; i < lastCpuSample.length; i++) {
				const c1 = lastCpuSample[i];
				const c2 = nextCpuSample[i];
				if (!c1 || !c2) continue;
				idleDiff += c2.times.idle - c1.times.idle;
				totalDiff +=
					Object.values(c2.times).reduce((a, b) => a + b, 0) -
					Object.values(c1.times).reduce((a, b) => a + b, 0);
			}
			if (totalDiff > 0) {
				currentCpuUsage = 1 - idleDiff / totalDiff;
			}
			lastCpuSample = nextCpuSample;

			// B. Calculate Memory usage (System-wide + Process Heap)
			const totalMem = os.totalmem();
			const freeMem = os.freemem();
			const systemMemRatio = (totalMem - freeMem) / totalMem;

			const processRss = process.memoryUsage().rss;
			const processLimit = Math.min(1.5 * 1024 * 1024 * 1024, totalMem * 0.25); // Cap process RAM at 1.5GB or 25% system RAM
			const processMemRatio = processRss / processLimit;

			// C. Get Event Loop Delay (95th percentile)
			const loopLagMs = eventLoopMonitor.percentile(95) / 1_000_000;
			eventLoopMonitor.reset(); // Reset histogram after sampling

			// D. Determine overload status
			const cpuOverloaded = currentCpuUsage > this.maxUsedCpuRatio;
			const memOverloaded =
				systemMemRatio > this.maxUsedMemoryRatio ||
				processMemRatio > this.maxUsedMemoryRatio;
			const loopOverloaded = loopLagMs > this.maxBlockedMillis;
			const isOverloaded = cpuOverloaded || memOverloaded || loopOverloaded;

			const oldConcurrency = desiredConcurrency;
			if (isOverloaded) {
				// Scale down by 15% (step ratio)
				desiredConcurrency = Math.max(
					this.minConcurrency,
					Math.floor(desiredConcurrency * 0.85),
				);
				if (desiredConcurrency !== oldConcurrency) {
					this.log(
						`[autoscaler] System overloaded (CPU: ${(currentCpuUsage * 100).toFixed(0)}%, Mem: ${(systemMemRatio * 100).toFixed(0)}%, Event Loop Lag: ${loopLagMs.toFixed(1)}ms). Scaling down concurrency to ${desiredConcurrency}`,
					);
				}
			} else {
				// Scale up by 10% (step ratio) only if we are saturated (running tasks >= 90% of current limit)
				const running = activePromises.size;
				const isSaturated = running >= desiredConcurrency * 0.9;
				if (isSaturated && desiredConcurrency < this.maxConcurrency) {
					desiredConcurrency = Math.min(
						this.maxConcurrency,
						Math.ceil(desiredConcurrency * 1.1),
					);
					if (desiredConcurrency !== oldConcurrency) {
						this.log(
							`[autoscaler] System healthy. Pool saturated at ${running} tasks. Scaling up concurrency to ${desiredConcurrency}`,
						);
					}
				}
			}
		}, this.autoscaleIntervalMs);

		try {
			while (this.count < this.maxRequestsPerCrawl) {
				// Block loop if running task count reaches the current desired concurrency limit
				while (activePromises.size >= desiredConcurrency) {
					await Promise.race(activePromises);
				}

				const batch = this.requestQueue.fetchBatch(1);
				if (batch.length === 0) {
					const { locked, pending } = this.requestQueue.stats();
					if (locked === 0 && pending === 0) break;
					// Wait for currently running tasks to release locks or queue new tasks
					await Bun.sleep(100);
					continue;
				}

				const req = batch[0];
				this.count++;

				// Process the request asynchronously
				const p = (async () => {
					try {
						await this.processRequest(req);
						this.requestQueue.markDone(req.id);
					} catch (err) {
						this.log(`Error processing ${req.url}: ${err}`);
						this.requestQueue.markFailed(req.id, String(err));
					}
				})();

				activePromises.add(p);
				p.finally(() => {
					activePromises.delete(p);
				});
			}

			// Wait for remaining running tasks to finish
			await Promise.all(activePromises);
		} finally {
			// Ensure timers and monitors are cleaned up
			clearInterval(statsInterval);
			eventLoopMonitor.disable();
			this.log(`Crawler run finished. Processed ${this.count} requests.`);
			await this.dataset.close();
		}
	}
}
