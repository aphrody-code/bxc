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

import {
	describe,
	test,
	expect,
	beforeAll,
	beforeEach,
	afterAll,
} from "bun:test";
import { join } from "node:path";
import {
	existsSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { Actor } from "../../src/sdk/Actor.ts";

const TEST_STORAGE_DIR = join(import.meta.dir, "../../dist/test-actor-storage");

describe("Actor SDK Emulation", () => {
	beforeAll(() => {
		// Set storage dir environment variables
		process.env.BXC_STORAGE_DIR = TEST_STORAGE_DIR;
		process.env.APIFY_LOCAL_STORAGE_DIR = TEST_STORAGE_DIR;
		// Keep process.exit from exiting during tests
		process.env.NODE_ENV = "test";
	});

	beforeEach(() => {
		// Clean up storage directory before each test
		if (existsSync(TEST_STORAGE_DIR)) {
			rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_STORAGE_DIR, { recursive: true });

		// Reset Actor state
		// @ts-ignore (Accessing private properties for testing state reset)
		Actor.isInitialized = false;
		// @ts-ignore
		Actor.isExited = false;
		// @ts-ignore
		Actor.startedAt = undefined;
		// @ts-ignore
		Actor.finishedAt = undefined;
	});

	afterAll(() => {
		if (existsSync(TEST_STORAGE_DIR)) {
			rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
		}
	});

	test("Actor.getEnv() returns correct configuration", () => {
		const env = Actor.getEnv();
		expect(env.localStorageDir).toBe(TEST_STORAGE_DIR);
		expect(env.defaultKeyValueStoreId).toBe("default");
		expect(env.defaultDatasetId).toBe("default");
		expect(env.inputKey).toBe("INPUT");
	});

	test("Actor.init() and Actor.exit() manage lifecycle and metadata", async () => {
		await Actor.init();

		// @ts-ignore
		expect(Actor.isInitialized).toBe(true);

		await Actor.exit({ exitProcess: false });

		// @ts-ignore
		expect(Actor.isExited).toBe(true);

		// Check run metadata
		const metadataPath = join(
			TEST_STORAGE_DIR,
			"runs",
			"default",
			"metadata.json",
		);
		expect(existsSync(metadataPath)).toBe(true);

		const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
		expect(metadata.status).toBe("SUCCEEDED");
		expect(metadata.startedAt).toBeDefined();
		expect(metadata.finishedAt).toBeDefined();
		expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("Actor.fail() records failure and throws/exits", async () => {
		await Actor.init();

		expect(
			Actor.fail("Test failure message", { exitProcess: false }),
		).rejects.toThrow("Test failure message");

		const metadataPath = join(
			TEST_STORAGE_DIR,
			"runs",
			"default",
			"metadata.json",
		);
		expect(existsSync(metadataPath)).toBe(true);

		const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
		expect(metadata.status).toBe("FAILED");
		expect(metadata.error).toBe("Test failure message");
	});

	test("Actor.getInput() retrieves input from environment variables and storage", async () => {
		// 1. Env variable input
		process.env.BXC_INPUT = JSON.stringify({ source: "env", val: 42 });
		let input = await Actor.getInput();
		expect(input).toEqual({ source: "env", val: 42 });
		delete process.env.BXC_INPUT;

		// 2. Default store input
		const kvsDefaultDir = join(TEST_STORAGE_DIR, "key_value_stores", "default");
		mkdirSync(kvsDefaultDir, { recursive: true });
		writeFileSync(
			join(kvsDefaultDir, "INPUT.json"),
			JSON.stringify({ source: "file", val: 100 }),
			"utf8",
		);

		input = await Actor.getInput();
		expect(input).toEqual({ source: "file", val: 100 });
	});

	test("Actor.setValue() and Actor.getInput() work together", async () => {
		await Actor.setValue("test-key", { hello: "world" });

		const store = Actor.openKeyValueStore();
		const val = await store.getValue("test-key");
		expect(val).toEqual({ hello: "world" });

		// Clear key
		await Actor.setValue("test-key", null);
		const cleared = await store.getValue("test-key");
		expect(cleared).toBeNull();
	});

	test("Actor.pushData() pushes items into the dataset with correct naming", async () => {
		await Actor.pushData({ id: 1, name: "Alice" });
		await Actor.pushData([
			{ id: 2, name: "Bob" },
			{ id: 3, name: "Charlie" },
		]);

		const dataset = Actor.openDataset();
		const data = await dataset.getData();

		expect(data.items).toHaveLength(3);
		expect(data.items[0]).toEqual({ id: 1, name: "Alice" });
		expect(data.items[1]).toEqual({ id: 2, name: "Bob" });
		expect(data.items[2]).toEqual({ id: 3, name: "Charlie" });

		// Verify filenames
		const datasetDir = join(TEST_STORAGE_DIR, "datasets", "default");
		const files = readdirSync(datasetDir).sort();
		expect(files).toEqual([
			"000000001.json",
			"000000002.json",
			"000000003.json",
		]);
	});

	test("Actor Dataset export methods (JSON, CSV, XML, HTML)", async () => {
		const dataset = Actor.openDataset("export-test");
		await dataset.pushData([
			{ val: 10, label: "A" },
			{ val: 20, label: "B" },
		]);

		const jsonPath = join(TEST_STORAGE_DIR, "export-test.json");
		const csvPath = join(TEST_STORAGE_DIR, "export-test.csv");
		const xmlPath = join(TEST_STORAGE_DIR, "export-test.xml");
		const htmlPath = join(TEST_STORAGE_DIR, "export-test.html");

		await dataset.exportToJson(jsonPath);
		await dataset.exportToCsv(csvPath);
		await dataset.exportToXml(xmlPath);
		await dataset.exportToHtml(htmlPath);

		expect(existsSync(jsonPath)).toBe(true);
		expect(existsSync(csvPath)).toBe(true);
		expect(existsSync(xmlPath)).toBe(true);
		expect(existsSync(htmlPath)).toBe(true);

		const jsonContent = JSON.parse(readFileSync(jsonPath, "utf8"));
		expect(jsonContent).toHaveLength(2);
		expect(jsonContent[0].label).toBe("A");

		const csvContent = readFileSync(csvPath, "utf8");
		expect(csvContent).toContain("val,label");
		expect(csvContent).toContain("10,A");

		const xmlContent = readFileSync(xmlPath, "utf8");
		expect(xmlContent).toContain("<label>A</label>");

		const htmlContent = readFileSync(htmlPath, "utf8");
		expect(htmlContent).toContain("<table>");
	});

	test("Dataset.getData() offset and limit options", async () => {
		const dataset = Actor.openDataset("custom-dataset");
		await dataset.pushData([
			{ val: 1 },
			{ val: 2 },
			{ val: 3 },
			{ val: 4 },
			{ val: 5 },
		]);

		const resAll = await dataset.getData();
		expect(resAll.items).toHaveLength(5);

		const resSlice = await dataset.getData({ offset: 1, limit: 3 });
		expect(resSlice.items).toEqual([{ val: 2 }, { val: 3 }, { val: 4 }]);
	});

	test("Actor.init() purges default store and dataset (preserving INPUT)", async () => {
		const kvsDefaultDir = join(TEST_STORAGE_DIR, "key_value_stores", "default");
		mkdirSync(kvsDefaultDir, { recursive: true });
		writeFileSync(
			join(kvsDefaultDir, "INPUT.json"),
			JSON.stringify({ a: 1 }),
			"utf8",
		);
		writeFileSync(
			join(kvsDefaultDir, "other.json"),
			JSON.stringify({ b: 2 }),
			"utf8",
		);

		const datasetDefaultDir = join(TEST_STORAGE_DIR, "datasets", "default");
		mkdirSync(datasetDefaultDir, { recursive: true });
		writeFileSync(
			join(datasetDefaultDir, "000000001.json"),
			JSON.stringify({ item: 1 }),
			"utf8",
		);

		// Initialize, which triggers purge
		await Actor.init();

		// Check KV store: INPUT.json should remain, other.json should be deleted
		expect(existsSync(join(kvsDefaultDir, "INPUT.json"))).toBe(true);
		expect(existsSync(join(kvsDefaultDir, "other.json"))).toBe(false);

		// Check Dataset: should be completely empty or deleted
		if (existsSync(datasetDefaultDir)) {
			const datasetFiles = readdirSync(datasetDefaultDir);
			expect(datasetFiles).toHaveLength(0);
		} else {
			expect(existsSync(datasetDefaultDir)).toBe(false);
		}
	});

	test("Actor.main() runs successfully", async () => {
		let ran = false;
		await Actor.main(async () => {
			ran = true;
			await Actor.setValue("run-val", 42);
		});

		expect(ran).toBe(true);
		const val = await Actor.openKeyValueStore().getValue("run-val");
		expect(val).toBe(42);

		// Check metadata
		const metadataPath = join(
			TEST_STORAGE_DIR,
			"runs",
			"default",
			"metadata.json",
		);
		const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
		expect(metadata.status).toBe("SUCCEEDED");
	});

	test("Actor.openRequestQueue() opens SQLite request queue", async () => {
		const queue = await Actor.openRequestQueue("test-queue");
		expect(queue).toBeDefined();
		expect(queue.addRequest("https://google.com")).toBe(true);
		expect(queue.stats().total).toBe(1);
		queue.close();
	});

	test("Actor.useState() persists state on Actor.exit()", async () => {
		await Actor.init();
		const state = await Actor.useState("counter-state", { count: 0 });
		expect(state).toEqual({ count: 0 });
		state.count += 5;

		await Actor.exit({ exitProcess: false });

		const store = Actor.openKeyValueStore();
		const savedState = await store.getValue("counter-state");
		expect(savedState).toEqual({ count: 5 });
	});

	test("Actor.createProxyConfiguration() returns configured proxy helper", async () => {
		const config = await Actor.createProxyConfiguration({
			proxyUrls: ["http://proxy1:8080", "http://proxy2:8080"],
		});
		expect(config).toBeDefined();
		const url = await config.newUrl();
		expect(url).toBeDefined();
		expect(["http://proxy1:8080", "http://proxy2:8080"]).toContain(url!);

		const urlWithSession1 = await config.newUrl("sessionA");
		const urlWithSession2 = await config.newUrl("sessionA");
		expect(urlWithSession1).toBe(urlWithSession2);
	});

	test("Actor.isAtHome() environment check", () => {
		process.env.APIFY_IS_AT_HOME = "1";
		expect(Actor.isAtHome()).toBe(true);
		delete process.env.APIFY_IS_AT_HOME;
		expect(Actor.isAtHome()).toBe(false);
	});

	test("Actor.events emits correct events", async () => {
		await Actor.init();
		let cpuCalled = false;
		let persistCalled = false;

		Actor.on("cpuInfo", (data) => {
			expect(data.limitRatio).toBeDefined();
			cpuCalled = true;
		});

		Actor.on("persistState", (data) => {
			expect(data.isMigration).toBeDefined();
			persistCalled = true;
		});

		Actor.events.emit("cpuInfo", { limitRatio: 1.0, actualRatio: 0.2, isOverloaded: false });
		Actor.events.emit("persistState", { isMigration: false });

		expect(cpuCalled).toBe(true);
		expect(persistCalled).toBe(true);

		await Actor.exit({ exitProcess: false });
	});

	test("Actor metamorph and webhook mock methods run without crash", async () => {
		await Actor.metamorph("apify/web-scraper", { url: "https://newurl.com" });
		await Actor.addWebhook({ eventTypes: ["ACTOR.RUN.SUCCEEDED"], requestUrl: "https://webhook.site" });
		
		const store = Actor.openKeyValueStore();
		const input = await store.getValue("INPUT");
		expect(input).toEqual({ url: "https://newurl.com" });
	});
});
