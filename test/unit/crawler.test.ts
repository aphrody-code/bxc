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

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import {
	CheerioCrawler,
	type CheerioCrawlingContext,
} from "../../src/crawler/CheerioCrawler.ts";
import {
	BrowserCrawler,
	type BrowserCrawlingContext,
	BxcConfig,
} from "../../src/crawler/index.ts";
import { createRouter } from "../../src/crawler/Router.ts";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";
import { Dataset } from "../../src/storage/Dataset.ts";
import { KeyValueStore } from "../../src/storage/KeyValueStore.ts";

describe("Crawler Module", () => {
	let server: any;
	let serverUrl: string;
	const storageDir = join(import.meta.dir, "../../tmp/crawler-test-storage");

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/") {
					return new Response(
						`<html>
							<body>
								<h1>Home</h1>
								<a href="/item/1">Item 1</a>
								<a href="/item/2">Item 2</a>
							</body>
						</html>`,
						{ headers: { "Content-Type": "text/html" } },
					);
				}
				if (url.pathname.startsWith("/item/")) {
					const id = url.pathname.split("/").pop();
					return new Response(
						`<html>
							<body>
								<h1 class="title">Item Title ${id}</h1>
							</body>
						</html>`,
						{ headers: { "Content-Type": "text/html" } },
					);
				}
				return new Response("Not Found", { status: 404 });
			},
		});
		serverUrl = `http://127.0.0.1:${server.port}`;
	});

	afterAll(() => {
		server.stop();
		if (existsSync(storageDir)) {
			rmSync(storageDir, { recursive: true, force: true });
		}
	});

	test("CheerioCrawler should crawl recursively and use a Router", async () => {
		if (existsSync(storageDir)) {
			rmSync(storageDir, { recursive: true, force: true });
		}

		mkdirSync(storageDir, { recursive: true });
		const queue = RequestQueue.open(join(storageDir, "queue.db"));

		// Clean default dataset folder
		const defaultDatasetDir = join(
			import.meta.dir,
			"../../storage/datasets/default",
		);
		if (existsSync(defaultDatasetDir)) {
			rmSync(defaultDatasetDir, { recursive: true, force: true });
		}

		const router = createRouter<CheerioCrawlingContext>();

		// Default handler enqueues detail links with labels
		router.addDefaultHandler(async ({ enqueueLinks }) => {
			await enqueueLinks({
				selector: "a[href]",
				userData: { label: "detail" },
			});
		});

		// Detail handler extracts titles and pushes them
		router.addHandler("detail", async ({ $, request, pushData }) => {
			const title = $(".title").text();
			await pushData({ url: request.url, title });
		});

		const crawler = new CheerioCrawler({
			requestQueue: queue,
			requestHandler: router.createRequestHandler(),
			maxRequestsPerCrawl: 5,
		});

		await crawler.run([serverUrl]);

		const ds = await Dataset.open("default");
		const count = await ds.getItemCount();
		expect(count).toBe(2);

		const items = await ds.getData();
		expect(items[0].title).toContain("Item Title");

		// Test XML and HTML export features
		const xmlPath = join(storageDir, "export.xml");
		const htmlPath = join(storageDir, "export.html");
		const multiDir = join(storageDir, "multi-export");
		await ds.exportToXml(xmlPath);
		await ds.exportToHtml(htmlPath);
		await ds.exportToDirectory(multiDir);

		expect(existsSync(xmlPath)).toBe(true);
		expect(existsSync(htmlPath)).toBe(true);
		expect(existsSync(multiDir)).toBe(true);
		expect(existsSync(join(multiDir, "000000001.json"))).toBe(true);
		expect(existsSync(join(multiDir, "000000002.json"))).toBe(true);

		const xmlContent = await Bun.file(xmlPath).text();
		const htmlContent = await Bun.file(htmlPath).text();

		expect(xmlContent).toContain("<?xml version=");
		expect(xmlContent).toContain("<title>");
		expect(htmlContent).toContain("<!DOCTYPE html>");
		expect(htmlContent).toContain("<table");

		await ds.close();
		queue.close();
	});

	test("CheerioCrawler should accept autoscale options and run successfully", async () => {
		if (existsSync(storageDir)) {
			rmSync(storageDir, { recursive: true, force: true });
		}
		mkdirSync(storageDir, { recursive: true });
		const queue = RequestQueue.open(join(storageDir, "queue2.db"));

		const crawler = new CheerioCrawler({
			requestQueue: queue,
			requestHandler: async () => {},
			minConcurrency: 2,
			maxConcurrency: 5,
			autoscaleIntervalMs: 50,
			maxRequestsPerCrawl: 2,
		});

		await crawler.run([serverUrl]);
		queue.close();
	});

	test("BxcConfig should manage global settings and named resolution", async () => {
		const config = BxcConfig.getGlobal();
		const oldDir = config.storageDir;

		const testStorageDir = join(import.meta.dir, "../../tmp/bxc-config-test");
		config.storageDir = testStorageDir;
		expect(config.storageDir).toBe(testStorageDir);

		// Check name-based resolution of KeyValueStore
		const kv = KeyValueStore.open("test-store");
		await kv.set("hello", { world: true });
		const val = await kv.get<{ world: boolean }>("hello");
		expect(val?.world).toBe(true);
		kv.close();

		expect(
			existsSync(join(testStorageDir, "key_value_stores", "test-store.db")),
		).toBe(true);

		// Check name-based resolution of RequestQueue
		const queue = RequestQueue.open("test-queue");
		queue.addRequest("https://example.com");
		expect(queue.stats().pending).toBe(1);
		queue.close();

		expect(
			existsSync(join(testStorageDir, "request_queues", "test-queue.db")),
		).toBe(true);

		// Check purgeOnStart
		config.purgeOnStart = true;
		config.purgeDefaultStorages();
		expect(existsSync(join(testStorageDir, "key_value_stores"))).toBe(false);
		expect(existsSync(join(testStorageDir, "request_queues"))).toBe(false);

		// Cleanup
		config.storageDir = oldDir;
		config.purgeOnStart = false;
		if (existsSync(testStorageDir)) {
			rmSync(testStorageDir, { recursive: true, force: true });
		}
	});

	test("BrowserCrawler with useWorkers should crawl and process via worker threads", async () => {
		const testWorkerStorage = join(
			import.meta.dir,
			"../../tmp/browser-worker-test",
		);
		if (existsSync(testWorkerStorage)) {
			rmSync(testWorkerStorage, { recursive: true, force: true });
		}
		mkdirSync(testWorkerStorage, { recursive: true });

		const queue = RequestQueue.open(join(testWorkerStorage, "queue.db"));

		// Clean default dataset folder
		const defaultDatasetDir = join(
			import.meta.dir,
			"../../storage/datasets/default",
		);
		if (existsSync(defaultDatasetDir)) {
			rmSync(defaultDatasetDir, { recursive: true, force: true });
		}

		// Instantiate BrowserCrawler in worker mode with profile static
		const crawler = new BrowserCrawler({
			requestQueue: queue,
			requestHandler: async ({ $, request, pushData }) => {
				const title = $("h1").text();
				await pushData({ url: request.url, title });
			},
			profile: "static",
			useWorkers: true,
			maxRequestsPerCrawl: 1,
		});

		await crawler.run([serverUrl]);

		const ds = await Dataset.open("default");
		const count = await ds.getItemCount();
		expect(count).toBe(1);

		const items = await ds.getData();
		expect(items[0].title).toContain("Home");

		await ds.close();
		queue.close();

		if (existsSync(testWorkerStorage)) {
			rmSync(testWorkerStorage, { recursive: true, force: true });
		}
	});
});
