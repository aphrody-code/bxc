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
 * @file test/integration/crawlee-patterns.test.ts
 *
 * Integration tests for Bxc's Crawlee-inspired patterns.
 * Each `describe` block covers one feature from the audit.
 *
 * Run with:
 *   bun test test/integration/crawlee-patterns.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutoscaledPool } from "../../src/pool/AutoscaledPool.ts";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";
import { Dataset } from "../../src/storage/Dataset.ts";
import { KeyValueStore } from "../../src/storage/KeyValueStore.ts";
import { RobotsFile } from "../../src/utils/robots.ts";
import {
	collectSitemapUrls,
	discoverSitemapsFromRobots,
	parseSitemap,
} from "../../src/utils/sitemap.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
	const dir = join(tmpdir(), `bxc-test-${prefix}-${Date.now()}`);
	Bun.spawnSync(["mkdir", "-p", dir], { stdin: "ignore" });
	return dir;
}

// ---------------------------------------------------------------------------
// 1. RequestQueue — persistent, crash-safe, SQLite-backed
// ---------------------------------------------------------------------------

describe("RequestQueue", () => {
	let q: RequestQueue;

	beforeEach(() => {
		// Use in-memory SQLite for isolation
		q = RequestQueue.open(":memory:", { maxRetries: 2 });
	});

	afterEach(() => {
		q.close();
	});

	test("addRequest inserts new URL and deduplicates", () => {
		const first = q.addRequest("https://google.com/a");
		const second = q.addRequest("https://google.com/a"); // duplicate
		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(q.stats().total).toBe(1);
	});

	test("addRequests bulk-inserts and returns count of new items", () => {
		const count = q.addRequests([
			"https://google.com/1",
			"https://google.com/2",
			"https://google.com/1", // dup
		]);
		expect(count).toBe(2);
		expect(q.stats().pending).toBe(2);
	});

	test("fetchBatch transitions requests PENDING → LOCKED", () => {
		q.addRequest("https://google.com/a");
		q.addRequest("https://google.com/b");
		q.addRequest("https://google.com/c");

		const batch = q.fetchBatch(2);
		expect(batch.length).toBe(2);
		expect(batch[0].state).toBe("LOCKED");
		expect(batch[1].state).toBe("LOCKED");

		const stats = q.stats();
		expect(stats.locked).toBe(2);
		expect(stats.pending).toBe(1);
	});

	test("markDone transitions LOCKED → DONE", () => {
		q.addRequest("https://google.com/x");
		const [req] = q.fetchBatch(1);
		q.markDone(req.id);
		expect(q.stats().done).toBe(1);
		expect(q.stats().locked).toBe(0);
	});

	test("markFailed re-queues until maxRetries then dead-letter", () => {
		q.addRequest("https://google.com/flaky");
		const [r1] = q.fetchBatch(1);
		q.markFailed(r1.id, "timeout"); // retries: 0 → re-queued as PENDING

		const [r2] = q.fetchBatch(1);
		q.markFailed(r2.id, "timeout"); // retries: 1 → re-queued

		const [r3] = q.fetchBatch(1);
		q.markFailed(r3.id, "timeout"); // retries: 2 = maxRetries → FAILED

		const stats = q.stats();
		expect(stats.failed).toBe(1);
		expect(stats.pending).toBe(0);
		expect(q.deadLetterQueue().length).toBe(1);
	});

	test("recoverStaleLocks re-queues timed-out locked requests", async () => {
		const shortQ = RequestQueue.open(":memory:", { maxRetries: 1, lockTimeoutMs: 10 });
		shortQ.addRequest("https://google.com/stale");
		shortQ.fetchBatch(1); // locks it
		await Bun.sleep(20); // let lock expire
		const recovered = shortQ.recoverStaleLocks();
		expect(recovered).toBe(1);
		expect(shortQ.stats().pending).toBe(1);
		shortQ.close();
	});

	test("forefront requests are dequeued first", () => {
		q.addRequest("https://google.com/normal");
		q.addRequest("https://google.com/priority", { forefront: true });
		const [first] = q.fetchBatch(1);
		expect(first.url).toBe("https://google.com/priority");
	});

	test("has() checks existence without dequeuing", () => {
		q.addRequest("https://google.com/check");
		expect(q.has("https://google.com/check")).toBe(true);
		expect(q.has("https://google.com/not-there")).toBe(false);
	});

	test("replayFailed resets dead-letter queue", () => {
		// exhaust retries on 1 request
		q.addRequest("https://google.com/bad");
		const [r1] = q.fetchBatch(1);
		q.markFailed(r1.id, "e");
		const [r2] = q.fetchBatch(1);
		q.markFailed(r2.id, "e");
		const [r3] = q.fetchBatch(1);
		q.markFailed(r3.id, "e"); // now FAILED (maxRetries=2, so 3rd fails)
		expect(q.stats().failed).toBe(1);
		q.replayFailed();
		expect(q.stats().pending).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// 2. AutoscaledPool — dynamic concurrency based on system pressure
// ---------------------------------------------------------------------------

describe("AutoscaledPool", () => {
	test("runs all tasks and resolves", async () => {
		const results: number[] = [];
		const items = [1, 2, 3, 4, 5];
		let idx = 0;

		const pool = new AutoscaledPool({
			minConcurrency: 1,
			maxConcurrency: 3,
			runTaskFunction: async () => {
				const n = items[idx++];
				results.push(n);
			},
			isTaskReadyFunction: async () => idx < items.length,
			isFinishedFunction: async () => idx >= items.length,
		});

		await pool.run();
		expect(results.length).toBe(5);
	});

	test("respects maxConcurrency ceiling", async () => {
		let peak = 0;
		let current = 0;
		let idx = 0;
		const total = 20;

		const pool = new AutoscaledPool({
			minConcurrency: 1,
			maxConcurrency: 4,
			runTaskFunction: async () => {
				current++;
				peak = Math.max(peak, current);
				await Bun.sleep(10);
				current--;
				idx++;
			},
			isTaskReadyFunction: async () => idx < total,
			isFinishedFunction: async () => idx >= total,
		});

		await pool.run();
		expect(peak).toBeLessThanOrEqual(4);
		expect(idx).toBe(total);
	});

	test("abort() stops the pool gracefully", async () => {
		let ran = 0;
		const pool = new AutoscaledPool({
			minConcurrency: 1,
			maxConcurrency: 2,
			runTaskFunction: async () => {
				await Bun.sleep(5);
				ran++;
			},
			isTaskReadyFunction: async () => true, // infinite supply
			isFinishedFunction: async () => false,
		});

		const runPromise = pool.run();
		await Bun.sleep(30);
		pool.abort();
		await runPromise; // should resolve without hanging
		expect(ran).toBeGreaterThan(0);
	});

	test("getStats() returns current metrics", async () => {
		const pool = new AutoscaledPool({
			minConcurrency: 1,
			maxConcurrency: 5,
			runTaskFunction: async () => {
				/* noop */
			},
			isTaskReadyFunction: async () => false,
			isFinishedFunction: async () => true,
		});
		const runP = pool.run();
		const stats = pool.getStats();
		expect(stats.desiredConcurrency).toBeGreaterThanOrEqual(1);
		expect(typeof stats.rssBytes).toBe("number");
		await runP;
	});

	test("taskTimeoutMs causes timed-out tasks to count as failed", async () => {
		let idx = 0;
		const pool = new AutoscaledPool({
			minConcurrency: 1,
			maxConcurrency: 2,
			taskTimeoutMs: 20,
			runTaskFunction: async () => {
				idx++;
				await Bun.sleep(100); // longer than timeout
			},
			isTaskReadyFunction: async () => idx < 3,
			isFinishedFunction: async () => idx >= 3,
		});

		await pool.run();
		const stats = pool.getStats();
		expect(stats.failedTasks).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 3. Sitemap parser — XML + txt, streaming, dedup
// ---------------------------------------------------------------------------

describe("sitemap parser", () => {
	const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://google.com/page1</loc>
    <lastmod>2024-01-15</lastmod>
    <priority>0.8</priority>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>https://google.com/page2</loc>
    <priority>0.5</priority>
  </url>
</urlset>`;

	const TEXT_SITEMAP = `https://google.com/a
https://google.com/b
# comment line
https://google.com/c`;

	// Mutable routes map — updated per-test without restarting the server
	const routes: Record<string, string> = {};
	let server: ReturnType<typeof Bun.serve> | null = null;
	let port = 0;

	beforeEach(async () => {
		if (server === null) {
			server = Bun.serve({
				port: 0,
				fetch(req) {
					const url = new URL(req.url);
					const body = routes[url.pathname];
					if (!body) return new Response("Not Found", { status: 404 });
					const ct = url.pathname.endsWith(".xml") ? "application/xml" : "text/plain";
					return new Response(body, { headers: { "Content-Type": ct } });
				},
			});
			port = server.port ?? 0;
		}

		// Reset routes to defaults (index dynamically references known port)
		routes["/sitemap.xml"] = SIMPLE_XML;
		routes["/sitemap.txt"] = TEXT_SITEMAP;
		routes["/sitemap-posts.xml"] = SIMPLE_XML;
		routes["/sitemap-index.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>http://localhost:${port}/sitemap-posts.xml</loc>
  </sitemap>
</sitemapindex>`;
		routes["/robots.txt"] =
			`User-agent: *\nDisallow: /private\nSitemap: http://localhost:${port}/sitemap.xml`;
	});

	afterEach(() => {
		// Keep server alive across tests in this describe block; stop in the last afterEach
	});

	// One-time teardown: stop server after all tests in this describe
	// bun:test doesn't have afterAll per-describe, so we stop lazily in the last test
	// Actually we stop it after each and recreate (port 0 = random, safe to reuse)

	test("parseSitemap yields correct URLs from XML urlset", async () => {
		const urls: string[] = [];
		for await (const u of parseSitemap(`http://localhost:${port}/sitemap.xml`)) {
			urls.push(u.loc);
		}
		expect(urls).toEqual(["https://google.com/page1", "https://google.com/page2"]);
	});

	test("parseSitemap parses metadata (lastmod, priority, changefreq)", async () => {
		const [first] = await collectSitemapUrls(`http://localhost:${port}/sitemap.xml`);
		expect(first.priority).toBe(0.8);
		expect(first.changefreq).toBe("weekly");
		expect(first.lastmod instanceof Date).toBe(true);
		expect(first.originSitemapUrl).toContain("/sitemap.xml");
	});

	test("parseSitemap handles .txt format", async () => {
		const urls = await collectSitemapUrls(`http://localhost:${port}/sitemap.txt`);
		expect(urls.map((u) => u.loc)).toEqual([
			"https://google.com/a",
			"https://google.com/b",
			"https://google.com/c",
		]);
	});

	test("parseSitemap follows sitemapindex recursively", async () => {
		// routes["/sitemap-index.xml"] already references localhost:port/sitemap-posts.xml
		const urls = await collectSitemapUrls(`http://localhost:${port}/sitemap-index.xml`);
		expect(urls.length).toBe(2);
	});

	test("parseSitemap respects maxUrls limit", async () => {
		const urls = await collectSitemapUrls(`http://localhost:${port}/sitemap.xml`, {
			maxUrls: 1,
		});
		expect(urls.length).toBe(1);
	});

	test("discoverSitemapsFromRobots finds Sitemap: directives", async () => {
		// routes["/robots.txt"] already has a Sitemap: directive pointing to localhost
		const sitemaps = await discoverSitemapsFromRobots(`http://localhost:${port}`);
		expect(sitemaps.length).toBeGreaterThan(0);
		expect(sitemaps[0]).toContain("sitemap.xml");
		// Cleanup server after last sitemap test
		server?.stop();
		server = null;
	});
});

// ---------------------------------------------------------------------------
// 4. RobotsFile — RFC 9309 parser
// ---------------------------------------------------------------------------

describe("RobotsFile", () => {
	const ROBOTS_CONTENT = `
User-agent: *
Disallow: /private/
Disallow: /admin/
Allow: /admin/public/
Crawl-delay: 2
Sitemap: https://google.com/sitemap.xml

User-agent: Googlebot
Disallow: /noindex/
Allow: /noindex/allowed/

User-agent: BadBot
Disallow: /
`;

	test("isAllowed returns true for unrestricted paths", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.isAllowed("https://google.com/public/page", "*")).toBe(true);
		expect(robots.isAllowed("https://google.com/about", "*")).toBe(true);
	});

	test("isAllowed returns false for disallowed paths", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.isAllowed("https://google.com/private/data", "*")).toBe(false);
		expect(robots.isAllowed("https://google.com/admin/", "*")).toBe(false);
	});

	test("Allow rule wins over Disallow when more specific (longer match)", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		// /admin/ is disallowed but /admin/public/ is allowed (more specific)
		expect(robots.isAllowed("https://google.com/admin/public/index.html", "*")).toBe(true);
	});

	test("BadBot is blocked from everything", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.isAllowed("https://google.com/", "BadBot")).toBe(false);
		expect(robots.isAllowed("https://google.com/public", "BadBot")).toBe(false);
	});

	test("Googlebot has its own rules", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.isAllowed("https://google.com/noindex/page", "Googlebot")).toBe(false);
		expect(robots.isAllowed("https://google.com/noindex/allowed/", "Googlebot")).toBe(true);
	});

	test("crawlDelay returns correct values", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.crawlDelay("*")).toBe(2);
	});

	test("sitemaps directive is extracted", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", ROBOTS_CONTENT);
		expect(robots.sitemaps).toContain("https://google.com/sitemap.xml");
	});

	test("wildcard patterns (* and $) work correctly", () => {
		const content = `User-agent: *\nDisallow: /cache/*.html\nDisallow: /page$`;
		const robots = RobotsFile.parse("https://google.com/robots.txt", content);
		expect(robots.isAllowed("https://google.com/cache/index.html", "*")).toBe(false);
		expect(robots.isAllowed("https://google.com/cache/index.json", "*")).toBe(true);
		expect(robots.isAllowed("https://google.com/page", "*")).toBe(false);
		expect(robots.isAllowed("https://google.com/page/sub", "*")).toBe(true);
	});

	test("empty robots.txt allows everything", () => {
		const robots = RobotsFile.parse("https://google.com/robots.txt", "");
		expect(robots.isAllowed("https://google.com/anything", "*")).toBe(true);
	});

	test("404 from fetch returns permissive instance", async () => {
		let server: ReturnType<typeof Bun.serve> | null = null;
		try {
			server = Bun.serve({
				port: 0,
				fetch() {
					return new Response("Not Found", { status: 404 });
				},
			});
			const robots = await RobotsFile.fetch(`http://localhost:${server.port}/`);
			expect(robots.isAllowed("/anything", "*")).toBe(true);
		} finally {
			server?.stop();
		}
	});
});

// ---------------------------------------------------------------------------
// 5. Dataset — append-only JSONL, Bun.file writer
// ---------------------------------------------------------------------------

describe("Dataset", () => {
	let tmpDir: string;
	let ds: Dataset;

	beforeEach(async () => {
		tmpDir = makeTmpDir("dataset");
		ds = await Dataset.open("test", { storageDir: tmpDir });
	});

	afterEach(async () => {
		await ds.close();
		Bun.spawnSync(["rm", "-rf", tmpDir], { stdin: "ignore" });
	});

	test("pushData stores a single item and getItemCount reflects it", async () => {
		await ds.pushData({ title: "Widget", price: 9.99 });
		expect(ds.getItemCount()).toBe(1);
	});

	test("pushData stores multiple items in one call", async () => {
		await ds.pushData([{ a: 1 }, { b: 2 }, { c: 3 }]);
		expect(ds.getItemCount()).toBe(3);
	});

	test("getData retrieves all items in insertion order", async () => {
		await ds.pushData({ n: 1 });
		await ds.pushData({ n: 2 });
		await ds.pushData({ n: 3 });
		const items = await ds.getData();
		expect(items.length).toBe(3);
		expect((items[0] as { n: number }).n).toBe(1);
		expect((items[2] as { n: number }).n).toBe(3);
	});

	test("getData respects offset and limit", async () => {
		for (let i = 0; i < 10; i++) await ds.pushData({ i });
		const slice = await ds.getData({ offset: 2, limit: 3 });
		expect(slice.length).toBe(3);
		expect((slice[0] as { i: number }).i).toBe(2);
	});

	test("exportToJson writes valid JSON array to disk", async () => {
		await ds.pushData([{ x: 1 }, { x: 2 }]);
		const outPath = join(tmpDir, "out.json");
		await ds.exportToJson(outPath);
		const content = (await Bun.file(outPath).json()) as { x: number }[];
		expect(content.length).toBe(2);
		expect(content[0].x).toBe(1);
	});

	test("exportToCsv writes RFC-4180 CSV with header row", async () => {
		await ds.pushData([
			{ name: "Alice", score: 100 },
			{ name: "Bob, Jr", score: 95 },
		]);
		const outPath = join(tmpDir, "out.csv");
		await ds.exportToCsv(outPath);
		const csv = await Bun.file(outPath).text();
		expect(csv).toContain("name,score");
		expect(csv).toContain('"Bob, Jr"'); // comma escaped
	});

	test("clear() resets item count and empties data file", async () => {
		await ds.pushData([{ a: 1 }, { b: 2 }]);
		await ds.clear();
		expect(ds.getItemCount()).toBe(0);
		const items = await ds.getData();
		expect(items.length).toBe(0);
	});

	test("persists data across Dataset.open calls (reopen)", async () => {
		await ds.pushData({ persistent: true });
		await ds.close();

		const ds2 = await Dataset.open("test", { storageDir: tmpDir });
		expect(ds2.getItemCount()).toBe(1);
		const items = await ds2.getData();
		expect((items[0] as { persistent: boolean }).persistent).toBe(true);
		await ds2.close();
	});

	test("rejects non-object items", async () => {
		await expect(ds.pushData("string" as unknown as Record<string, unknown>)).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 6. KeyValueStore — SQLite + file-backed, atomic writes
// ---------------------------------------------------------------------------

describe("KeyValueStore", () => {
	let tmpDir: string;
	let kv: KeyValueStore;

	beforeEach(() => {
		tmpDir = makeTmpDir("kv");
		kv = KeyValueStore.open(join(tmpDir, "store.db"), { inlineThresholdBytes: 512 });
	});

	afterEach(() => {
		kv.close();
		Bun.spawnSync(["rm", "-rf", tmpDir], { stdin: "ignore" });
	});

	test("set/get roundtrip for JSON value", async () => {
		await kv.set("config", { maxPages: 100, ua: "Bxc" });
		const val = await kv.get<{ maxPages: number; ua: string }>("config");
		expect(val?.maxPages).toBe(100);
		expect(val?.ua).toBe("Bxc");
	});

	test("setText/getText roundtrip", async () => {
		await kv.setText("greeting", "Hello, Bxc!");
		const text = await kv.getText("greeting");
		expect(text).toBe("Hello, Bxc!");
	});

	test("setBytes/getBytes roundtrip for binary data", async () => {
		const original = new Uint8Array([1, 2, 3, 4, 255]);
		await kv.setBytes("binary-key", original);
		const retrieved = await kv.getBytes("binary-key");
		expect(retrieved).toEqual(original);
	});

	test("large values (>= threshold) are stored as blob files", async () => {
		const largeData = new Uint8Array(1024).fill(42); // 1 KiB > 512 B threshold
		await kv.setBytes("large-blob", largeData);

		// blob file should exist in <tmpDir>/blobs/
		const blobPath = join(tmpDir, "blobs", "large-blob");
		expect(await Bun.file(blobPath).exists()).toBe(true);

		// retrieval still works
		const back = await kv.getBytes("large-blob");
		expect(back?.length).toBe(1024);
		expect(back?.[0]).toBe(42);
	});

	test("has() returns correct boolean", async () => {
		expect(kv.has("missing")).toBe(false);
		await kv.set("present", { ok: true });
		expect(kv.has("present")).toBe(true);
	});

	test("delete() removes the key and returns true", async () => {
		await kv.set("temp", { data: "x" });
		const deleted = await kv.delete("temp");
		expect(deleted).toBe(true);
		expect(kv.has("temp")).toBe(false);
		const val = await kv.get("temp");
		expect(val).toBeUndefined();
	});

	test("delete() returns false for missing keys", async () => {
		const deleted = await kv.delete("does-not-exist");
		expect(deleted).toBe(false);
	});

	test("listKeys() returns metadata for all stored keys", async () => {
		await kv.set("k1", 1);
		await kv.set("k2", 2);
		const keys = kv.listKeys();
		expect(keys.length).toBe(2);
		const keyNames = keys.map((k) => k.key);
		expect(keyNames).toContain("k1");
		expect(keyNames).toContain("k2");
	});

	test("set() overwrites existing value (upsert)", async () => {
		await kv.set("mutable", { version: 1 });
		await kv.set("mutable", { version: 2 });
		const val = await kv.get<{ version: number }>("mutable");
		expect(val?.version).toBe(2);
		// Should still be just 1 key
		expect(kv.listKeys().length).toBe(1);
	});

	test("get() returns undefined for missing key", async () => {
		const val = await kv.get("ghost");
		expect(val).toBeUndefined();
	});
});
