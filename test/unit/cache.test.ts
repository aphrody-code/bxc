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

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GoogleCache } from "../../src/google/cache.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const TEST_DB = join(import.meta.dir, "../../dist/test-cache.sqlite");

describe("GoogleCache", () => {
	let cache: GoogleCache;

	beforeAll(() => {
		if (existsSync(TEST_DB)) {
			rmSync(TEST_DB, { force: true });
		}
		cache = new GoogleCache({ path: TEST_DB, maxEntries: 3 });
	});

	afterAll(() => {
		cache.close();
		if (existsSync(TEST_DB)) {
			rmSync(TEST_DB, { force: true });
		}
	});

	test("basic get/set operations", () => {
		cache.set("key1", "hello world");
		expect(cache.get<string>("key1")).toBe("hello world");
	});

	test("JSON get/set operations", () => {
		const obj = { foo: "bar", num: 42 };
		cache.set("key2", obj);
		expect(cache.get<typeof obj>("key2")).toEqual(obj);
	});

	test("dynamic compression on large values", () => {
		const largeStr = "a".repeat(1000); // Exceeds 512 bytes threshold
		cache.set("large-key", largeStr);
		expect(cache.get<string>("large-key")).toBe(largeStr);
	});

	test("LRU eviction based on maxEntries limit", () => {
		// Cache maxEntries is 3. Currently we have key1, key2, large-key in DB.
		// Let's add one more, which should evict key1 (the oldest).
		cache.set("key3", "some value");
		expect(cache.get<string>("key1")).toBeNull();
		expect(cache.get<string>("key3")).toBe("some value");
	});
});
