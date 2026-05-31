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
import {
	getBxcDir,
	getCookiesDir,
	resolveCookiePath,
} from "../../src/utils/paths.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const TEST_DIR = join(import.meta.dir, "../../dist/test-bxc-dir");

describe("paths", () => {
	beforeAll(() => {
		// Set BXC_DIR to avoid clobbering the host's actual ~/.bxc during tests
		Bun.env.BXC_DIR = TEST_DIR;
	});

	afterAll(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
		delete Bun.env.BXC_DIR;
	});

	test("getBxcDir resolves BXC_DIR override and ensures existence", () => {
		const dir = getBxcDir();
		expect(dir).toBe(TEST_DIR);
		expect(existsSync(TEST_DIR)).toBe(true);
	});

	test("getCookiesDir creates and resolves cookies folder", () => {
		const cookiesDir = getCookiesDir();
		expect(cookiesDir).toBe(join(TEST_DIR, "cookies"));
		expect(existsSync(cookiesDir)).toBe(true);
	});

	test("resolveCookiePath handles simple names as shortcuts", () => {
		const resolved = resolveCookiePath("google");
		expect(resolved).toBe(join(TEST_DIR, "cookies", "google.json"));
	});

	test("resolveCookiePath leaves full paths unchanged", () => {
		const fullPath = "./some/path/cookies.json";
		const resolved = resolveCookiePath(fullPath);
		expect(resolved).toBe(fullPath);
	});
});
