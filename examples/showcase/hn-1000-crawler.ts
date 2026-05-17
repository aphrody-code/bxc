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
 * HackerNews 1000 articles crawler — showcase
 *
 * Demonstrates:
 *   - RequestQueue (bun:sqlite, persistent + crash-safe, auto-resume)
 *   - AutoscaledPool (dynamic concurrency based on CPU/RAM)
 *   - Auto-routing via detectFromPage + suggestStrategy
 *   - Dataset (append-only JSONL output via Bun.file().writer())
 *   - SHOWCASE_LIMIT env var to cap articles (default: 1000)
 *
 * Usage:
 *   bun examples/showcase/hn-1000-crawler.ts            # full 1000
 *   SHOWCASE_LIMIT=5 bun examples/showcase/hn-1000-crawler.ts   # smoke test
 *   SHOWCASE_LIMIT=10 bun examples/showcase/hn-1000-crawler.ts  # resume from previous run
 *
 * Output:
 *   ./storage/datasets/hn-articles/data.jsonl
 *   ./hn-queue.sqlite  (persistent queue — delete to restart from scratch)
 */

import { Browser } from "../../src/api/browser.ts";
import type { PageLike } from "../../src/detect.ts";
import { detectFromPage } from "../../src/detect.ts";
import { AutoscaledPool } from "../../src/pool/AutoscaledPool.ts";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";
import { suggestStrategy } from "../../src/router/framework-strategy.ts";
import { Dataset } from "../../src/storage/Dataset.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SHOWCASE_LIMIT = parseInt(Bun.env.SHOWCASE_LIMIT ?? "1000", 10);
const QUEUE_DB = Bun.env.HN_QUEUE_DB ?? "./hn-queue.sqlite";
const DATASET_NAME = Bun.env.HN_DATASET_NAME ?? "hn-articles";
const CONCURRENCY_MIN = parseInt(Bun.env.HN_CONCURRENCY_MIN ?? "2", 10);
const CONCURRENCY_MAX = parseInt(Bun.env.HN_CONCURRENCY_MAX ?? "10", 10);

// HN Algolia API base
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
const HN_TOPSTORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logSkip(reason: string): void {
	console.log(`[SKIP] ${reason}`);
}

/** Probe network availability. Returns false if fetch fails within 3s. */
async function isNetworkAvailable(): Promise<boolean> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 3_000);
		const res = await fetch("https://hacker-news.firebaseio.com/v0/maxitem.json", {
			signal: ctrl.signal,
		});
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// HN article type
// ---------------------------------------------------------------------------

interface HNItem {
	id: number;
	title?: string;
	url?: string;
	score?: number;
	by?: string;
	time?: number;
	descendants?: number;
	type?: string;
}

interface CrawledArticle extends Record<string, unknown> {
	hnId: number;
	hnTitle: string;
	hnUrl: string | null;
	hnScore: number;
	hnAuthor: string;
	pageTitle: string;
	pageUrl: string;
	contentLength: number;
	profile: string;
	techStack: string[];
	crawledAt: string;
	errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(
		`[HN Crawler] Starting — limit=${SHOWCASE_LIMIT} concurrency=${CONCURRENCY_MIN}-${CONCURRENCY_MAX}`,
	);

	// --- 1. Network check ---
	const online = await isNetworkAvailable();
	if (!online) {
		logSkip(
			"network unavailable — HN Firebase API unreachable. Delete hn-queue.sqlite to reset on next run.",
		);
		process.exit(0);
	}

	// --- 2. Open persistent queue (resumes on restart) ---
	const queue = RequestQueue.open(QUEUE_DB, { maxRetries: 2, lockTimeoutMs: 60_000 });

	// --- 3. Open dataset (append-only, resumes on restart) ---
	const dataset = await Dataset.open(DATASET_NAME);
	const alreadyCrawled = dataset.getItemCount();
	console.log(`[HN Crawler] Queue DB: ${QUEUE_DB}, dataset already has ${alreadyCrawled} items`);

	// --- 4. Seed queue with top stories if not already seeded ---
	const existingStats = queue.stats();
	const totalTracked = existingStats.total;

	if (totalTracked === 0) {
		console.log(`[HN Crawler] Fetching top ${SHOWCASE_LIMIT} HN story IDs...`);
		const res = await fetch(HN_TOPSTORIES_URL);
		if (!res.ok) {
			throw new Error(`HN topstories fetch failed: HTTP ${res.status}`);
		}
		const allIds = (await res.json()) as number[];
		const ids = allIds.slice(0, SHOWCASE_LIMIT);

		// Enqueue HN item API URLs (JSON) — we scrape HN item pages too
		const inserted = queue.addRequests(
			ids.map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}`, userData: { hnId: id } },
			})),
		);
		console.log(`[HN Crawler] Seeded queue: ${inserted}/${ids.length} new URLs (dedup applied)`);
	} else {
		console.log(
			`[HN Crawler] Resuming existing queue: pending=${existingStats.pending} done=${existingStats.done} failed=${existingStats.failed}`,
		);
		// Recover any stale LOCKED requests from crashed previous runs
		const recovered = queue.recoverStaleLocks();
		if (recovered > 0) {
			console.log(`[HN Crawler] Recovered ${recovered} stale locks`);
		}
	}

	// Guard: if all done, report and exit
	const statsAfterSeed = queue.stats();
	if (statsAfterSeed.pending === 0 && statsAfterSeed.locked === 0) {
		console.log(`[HN Crawler] All ${statsAfterSeed.done} articles already crawled. Nothing to do.`);
		await dataset.close();
		queue.close();
		await Browser.close();
		return;
	}

	// --- 5. Build the scrape task ---

	// Cursor into the drain generator — AutoscaledPool uses callbacks,
	// so we maintain a batch buffer fed by the queue.drain() generator.
	let drainIterator: AsyncGenerator<
		import("../../src/queue/RequestQueue.ts").QueuedRequest[],
		void,
		unknown
	> | null = null;

	// Current batch being processed
	let currentBatch: import("../../src/queue/RequestQueue.ts").QueuedRequest[] = [];
	let batchIndex = 0;
	let drainExhausted = false;

	// Ensure we have the drain iterator
	function getDrainIterator() {
		if (!drainIterator) {
			drainIterator = queue.drain(CONCURRENCY_MAX, 300);
		}
		return drainIterator;
	}

	// isTaskReadyFunction: true when there's a request available
	async function isTaskReady(): Promise<boolean> {
		if (drainExhausted) return false;
		// Still have items in the current batch
		if (batchIndex < currentBatch.length) return true;
		// Fetch next batch from drain generator
		const iter = getDrainIterator();
		const result = await iter.next();
		if (result.done || !result.value || result.value.length === 0) {
			drainExhausted = true;
			return false;
		}
		currentBatch = result.value;
		batchIndex = 0;
		return true;
	}

	// isFinishedFunction: true when drain is exhausted and no current items
	async function isFinished(): Promise<boolean> {
		if (!drainExhausted) return false;
		if (batchIndex < currentBatch.length) return false;
		const stats = queue.stats();
		return stats.pending === 0 && stats.locked === 0;
	}

	// runTaskFunction: grab next request, scrape it
	async function runTask(): Promise<void> {
		// Pop next request from current batch
		const req = currentBatch[batchIndex++];
		if (!req) return;

		const hnId = req.id;
		let article: CrawledArticle | null = null;

		try {
			// Fetch the HN item JSON metadata
			const itemRes = await fetch(req.url, { signal: AbortSignal.timeout(10_000) });
			if (!itemRes.ok) {
				queue.markFailed(req.id, `HTTP ${itemRes.status} on ${req.url}`);
				return;
			}

			const item = (await itemRes.json()) as HNItem;
			if (item.type !== "story" || !item.title) {
				// Not a story (job, comment, etc.) — mark done, skip scraping
				queue.markDone(req.id);
				return;
			}

			const targetUrl = item.url ?? `https://google.com/item?id=${item.id}`;

			// Try to detect and route — use profile=static as base (fast + no Lightpanda required)
			// For full auto-routing, we'd need to fetch first, then detect
			let profile = "static";
			let pageTitle = item.title;
			let contentLength = 0;
			let techStack: string[] = [];
			let errorMsg: string | null = null;

			try {
				const page = await Browser.newPage({ profile: "static" });
				try {
					await page.goto(targetUrl, { timeoutMs: 15_000 });

					// Detect frameworks from rendered page
					const pageLike: PageLike = {
						url: () => page.url(),
						content: () => page.content(),
					};

					let detected: import("../../src/detect.ts").DetectedTech[] = [];
					try {
						detected = await detectFromPage(pageLike, { processTimeoutMs: 5_000 });
					} catch {
						// wappalyzergo may not be available — continue without detection
					}

					const strategy = suggestStrategy(detected);
					profile = strategy.profile;
					techStack = detected.map((t) => t.name);

					const html = await page.content();
					contentLength = html.length;

					const rawTitle = await page.title();
					pageTitle = rawTitle || item.title || "";
				} finally {
					await page.close();
				}
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : String(err);
				// Still record what we know from the HN API metadata
			}

			article = {
				hnId: item.id,
				hnTitle: item.title,
				hnUrl: item.url ?? null,
				hnScore: item.score ?? 0,
				hnAuthor: item.by ?? "",
				pageTitle,
				pageUrl: targetUrl,
				contentLength,
				profile,
				techStack,
				crawledAt: new Date().toISOString(),
				errorMessage: errorMsg,
			};

			await dataset.pushData(article);
			queue.markDone(req.id);

			const count = dataset.getItemCount();
			if (count % 10 === 0 || count <= 5) {
				const qStats = queue.stats();
				console.log(
					`[HN Crawler] ${count} articles saved | queue: pending=${qStats.pending} done=${qStats.done}`,
				);
			}

			// Stop if we've hit the limit
			if (count >= SHOWCASE_LIMIT) {
				drainExhausted = true;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			queue.markFailed(req.id, msg);
			console.error(`[HN Crawler] Error on item ${hnId}: ${msg}`);
		}
	}

	// --- 6. Run the pool ---
	const pool = new AutoscaledPool({
		minConcurrency: CONCURRENCY_MIN,
		maxConcurrency: CONCURRENCY_MAX,
		desiredConcurrency: CONCURRENCY_MIN,
		runTaskFunction: runTask,
		isTaskReadyFunction: isTaskReady,
		isFinishedFunction: isFinished,
		maybeRunIntervalMs: 200,
		autoscaleIntervalMs: 5_000,
		taskTimeoutMs: 30_000,
	});

	console.log(
		`[HN Crawler] Pool running with concurrency ${CONCURRENCY_MIN}-${CONCURRENCY_MAX}...`,
	);
	await pool.run();

	// --- 7. Final report ---
	const finalStats = queue.stats();
	const finalCount = dataset.getItemCount();
	const poolStats = pool.getStats();

	console.log(`\n[HN Crawler] Done!`);
	console.log(`  Articles saved  : ${finalCount}`);
	console.log(`  Queue pending   : ${finalStats.pending}`);
	console.log(`  Queue done      : ${finalStats.done}`);
	console.log(`  Queue failed    : ${finalStats.failed}`);
	console.log(`  Pool completed  : ${poolStats.completedTasks} tasks`);
	console.log(`  Pool failed     : ${poolStats.failedTasks} tasks`);
	console.log(`  Dataset path    : ./storage/datasets/${DATASET_NAME}/data.jsonl`);
	console.log(`  Queue DB        : ${QUEUE_DB}`);
	console.log(`\nRun again with SHOWCASE_LIMIT=${SHOWCASE_LIMIT} to resume from checkpoint.`);

	// --- 8. Cleanup ---
	await dataset.close();
	queue.close();
	await Browser.close();
}

main().catch((err: unknown) => {
	console.error("[HN Crawler] Fatal error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
