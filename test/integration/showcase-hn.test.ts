/**
 * Integration test — HN showcase crawler (mock fetch, 5 IDs)
 *
 * Verifies:
 *   - RequestQueue seeds properly with mock HN data
 *   - AutoscaledPool drains queue and processes all items
 *   - Dataset receives the expected number of entries
 *   - Queue resume: re-opening same DB with additional IDs deduplicates
 *
 * Uses in-memory queue (:memory:) and temp dataset dir to avoid side effects.
 * No network access — fetch is mocked via Bun's globalThis.fetch override.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";
import { AutoscaledPool } from "../../src/pool/AutoscaledPool.ts";
import { Dataset } from "../../src/storage/Dataset.ts";
import type { QueuedRequest } from "../../src/queue/RequestQueue.ts";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_IDS: number[] = [1001, 1002, 1003, 1004, 1005];

const MOCK_ITEMS: Record<number, object> = {
	1001: {
		id: 1001,
		type: "story",
		title: "Ask HN: Best TypeScript tips for 2026",
		url: "https://news.ycombinator.com/item?id=1001",
		score: 412,
		by: "alice",
		time: 1715000000,
		descendants: 87,
	},
	1002: {
		id: 1002,
		type: "story",
		title: "Bun 2.0 released — 10x faster than Node",
		url: "https://bun.sh/blog/bun-2",
		score: 893,
		by: "bob",
		time: 1715001000,
		descendants: 214,
	},
	1003: {
		id: 1003,
		type: "job",
		title: "Anthropic is hiring",
		url: "https://anthropic.com/jobs",
		score: 1,
		by: "anthropic",
		time: 1715002000,
	},
	1004: {
		id: 1004,
		type: "story",
		title: "Lightpanda v2.0: Blazing-fast headless browser in Zig",
		url: "https://lightpanda.io/blog/v2",
		score: 567,
		by: "charlie",
		time: 1715003000,
		descendants: 42,
	},
	1005: {
		id: 1005,
		type: "story",
		title: "Understanding WebAssembly in 2026",
		url: null,
		score: 234,
		by: "dave",
		time: 1715004000,
		descendants: 19,
	},
};

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const HN_TOPSTORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";

function makeMockFetch(): (url: string | URL | Request, _init?: RequestInit) => Promise<Response> {
	return async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
		const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

		if (urlStr === HN_TOPSTORIES_URL) {
			return new Response(JSON.stringify(MOCK_IDS), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}

		// Match item URLs: https://hacker-news.firebaseio.com/v0/item/1001.json
		const itemMatch = urlStr.match(/\/item\/(\d+)\.json$/);
		if (itemMatch) {
			const id = parseInt(itemMatch[1], 10);
			const item = MOCK_ITEMS[id];
			if (item) {
				return new Response(JSON.stringify(item), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify(null), { status: 200 });
		}

		// Default: return empty HTML for any other URL
		return new Response("<html><head><title>Mock Page</title></head><body>mock</body></html>", {
			status: 200,
			headers: { "content-type": "text/html" },
		});
	};
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal crawl pipeline using queue + pool + dataset (no Browser, no detect). */
async function runMiniCrawl(
	queue: RequestQueue,
	dataset: Dataset,
	limit: number,
): Promise<{ crawled: number; failed: number }> {
	let drainIterator: AsyncGenerator<QueuedRequest[], void, unknown> | null = null;
	let currentBatch: QueuedRequest[] = [];
	let batchIndex = 0;
	let drainExhausted = false;
	let crawled = 0;
	let failed = 0;

	function getIter() {
		if (!drainIterator) drainIterator = queue.drain(5, 50);
		return drainIterator;
	}

	async function isTaskReady(): Promise<boolean> {
		if (drainExhausted) return false;
		if (crawled >= limit) {
			drainExhausted = true;
			return false;
		}
		if (batchIndex < currentBatch.length) return true;
		const result = await getIter().next();
		if (result.done || !result.value || result.value.length === 0) {
			drainExhausted = true;
			return false;
		}
		currentBatch = result.value;
		batchIndex = 0;
		return true;
	}

	async function isFinished(): Promise<boolean> {
		if (!drainExhausted) return false;
		if (batchIndex < currentBatch.length) return false;
		const stats = queue.stats();
		return stats.pending === 0 && stats.locked === 0;
	}

	async function runTask(): Promise<void> {
		const req = currentBatch[batchIndex++];
		if (!req) return;

		try {
			// Mock: fetch HN item JSON
			const res = await fetch(req.url);
			const item = (await res.json()) as {
				id?: number;
				type?: string;
				title?: string;
				url?: string | null;
				score?: number;
				by?: string;
			} | null;

			if (!item || item.type !== "story" || !item.title) {
				queue.markDone(req.id);
				return;
			}

			await dataset.pushData({
				hnId: item.id ?? 0,
				hnTitle: item.title,
				hnUrl: item.url ?? null,
				hnScore: item.score ?? 0,
				hnAuthor: item.by ?? "",
				crawledAt: new Date().toISOString(),
			});

			queue.markDone(req.id);
			crawled++;
		} catch (err) {
			queue.markFailed(req.id, err instanceof Error ? err.message : String(err));
			failed++;
		}
	}

	const pool = new AutoscaledPool({
		minConcurrency: 1,
		maxConcurrency: 3,
		desiredConcurrency: 1,
		runTaskFunction: runTask,
		isTaskReadyFunction: isTaskReady,
		isFinishedFunction: isFinished,
		maybeRunIntervalMs: 50,
		autoscaleIntervalMs: 60_000,
	});

	await pool.run();
	return { crawled, failed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("showcase-hn — HN crawler integration (mock fetch)", () => {
	let originalFetch: typeof fetch;
	let tmpDir: string;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		// Install mock fetch
		(globalThis as { fetch: unknown }).fetch = makeMockFetch();
		tmpDir = `/tmp/bunlight-hn-test-${Date.now()}`;
	});

	afterEach(async () => {
		// Restore original fetch
		(globalThis as { fetch: typeof fetch }).fetch = originalFetch;
		// Cleanup temp files
		try {
			await Bun.spawn(["rm", "-rf", tmpDir]).exited;
		} catch {
			// best effort
		}
	});

	test("seeds queue with 5 mock HN IDs and crawls all stories", async () => {
		const queue = RequestQueue.open(":memory:");
		const dataset = await Dataset.open("hn-test-5", { storageDir: tmpDir });

		// Seed the queue
		const res = await fetch(HN_TOPSTORIES_URL);
		const ids = (await res.json()) as number[];
		expect(ids).toEqual(MOCK_IDS);

		const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
		const inserted = queue.addRequests(
			ids.map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}`, userData: { hnId: id } },
			})),
		);
		expect(inserted).toBe(5);

		const stats = queue.stats();
		expect(stats.pending).toBe(5);
		expect(stats.total).toBe(5);

		// Run crawl
		const { crawled } = await runMiniCrawl(queue, dataset, 10);

		// 5 IDs total: 4 stories + 1 job (type=job filtered out) = 4 crawled
		expect(crawled).toBe(4);
		expect(dataset.getItemCount()).toBe(4);

		const finalStats = queue.stats();
		expect(finalStats.pending).toBe(0);
		expect(finalStats.done).toBe(5); // 5 total marked done (including job)
		expect(finalStats.failed).toBe(0);

		await dataset.close();
		queue.close();
	}, 30_000);

	test("deduplicates: adding same IDs twice does not create duplicates", async () => {
		const queue = RequestQueue.open(":memory:");

		const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
		const ids = [1001, 1002, 1003];

		// Add once
		const first = queue.addRequests(
			ids.map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}` },
			})),
		);
		expect(first).toBe(3);

		// Add again — should be 0 inserts
		const second = queue.addRequests(
			ids.map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}` },
			})),
		);
		expect(second).toBe(0);

		// Queue still has exactly 3
		expect(queue.stats().total).toBe(3);
		queue.close();
	}, 10_000);

	test("resume: adding new IDs to existing queue only inserts new ones", async () => {
		const queue = RequestQueue.open(":memory:");
		const dataset = await Dataset.open("hn-test-resume", { storageDir: tmpDir });

		const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

		// First run: seed 3 IDs
		queue.addRequests(
			[1001, 1002, 1003].map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}` },
			})),
		);

		const firstCrawl = await runMiniCrawl(queue, dataset, 10);
		expect(firstCrawl.crawled).toBe(2); // 1001=story, 1002=story, 1003=job (filtered)

		// Simulate resume: add 5 IDs (1001-1003 already done, 1004-1005 new)
		const newlyInserted = queue.addRequests(
			[1001, 1002, 1003, 1004, 1005].map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}` },
			})),
		);
		expect(newlyInserted).toBe(2); // only 1004 and 1005 are new

		// Stats: 3 done + 2 new pending
		const stats = queue.stats();
		expect(stats.done).toBe(3);
		expect(stats.pending).toBe(2);

		// Second crawl — processes remaining 2
		const secondCrawl = await runMiniCrawl(queue, dataset, 10);
		expect(secondCrawl.crawled).toBe(2); // 1004=story, 1005=story

		// Dataset now has 4 stories total (1001, 1002, 1004, 1005)
		expect(dataset.getItemCount()).toBe(4);

		const finalStats = queue.stats();
		expect(finalStats.done).toBe(5);
		expect(finalStats.pending).toBe(0);

		await dataset.close();
		queue.close();
	}, 30_000);

	test("dataset export: crawled items are valid JSON and contain expected fields", async () => {
		const queue = RequestQueue.open(":memory:");
		const dataset = await Dataset.open("hn-test-export", { storageDir: tmpDir });

		const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
		queue.addRequests(
			[1001, 1002].map((id) => ({
				url: `${HN_ITEM_URL}/${id}.json`,
				opts: { uniqueKey: `hn-item-${id}` },
			})),
		);

		await runMiniCrawl(queue, dataset, 10);
		await dataset.close();

		// Re-open and read data
		const ds2 = await Dataset.open("hn-test-export", { storageDir: tmpDir });
		const items = await ds2.getData();
		expect(items.length).toBe(2);

		for (const item of items) {
			expect(typeof item.hnId).toBe("number");
			expect(typeof item.hnTitle).toBe("string");
			expect(typeof item.crawledAt).toBe("string");
		}

		await ds2.close();
		queue.close();
	}, 20_000);

	test("queue stats: track pending/locked/done/failed lifecycle", () => {
		const queue = RequestQueue.open(":memory:");

		queue.addRequest("https://hacker-news.firebaseio.com/v0/item/1001.json");
		queue.addRequest("https://hacker-news.firebaseio.com/v0/item/1002.json");

		expect(queue.stats().pending).toBe(2);

		const batch = queue.fetchBatch(1);
		expect(batch.length).toBe(1);
		expect(queue.stats().locked).toBe(1);
		expect(queue.stats().pending).toBe(1);

		queue.markDone(batch[0].id);
		expect(queue.stats().done).toBe(1);
		expect(queue.stats().locked).toBe(0);

		const batch2 = queue.fetchBatch(1);
		queue.markFailed(batch2[0].id, "timeout");
		// With maxRetries=3 (default), failed request is re-queued as PENDING
		expect(queue.stats().pending).toBe(1);
		expect(queue.stats().failed).toBe(0);

		queue.close();
	});
});
