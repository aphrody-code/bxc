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
 * Unit tests for the serverless handler. No network — only the routes that
 * don't require a browser (health, autocomplete is mocked, validation).
 */

import { describe, expect, test } from "bun:test";
import { handler } from "../src/serverless/handler.ts";

describe("serverless handler — routing", () => {
	test("GET / returns ok health", async () => {
		const res = await handler(new Request("http://x/"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.runtime).toBe("bun");
	});

	test("GET /unknown returns 404", async () => {
		const res = await handler(new Request("http://x/no-such-route"));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("GET /scrape without url returns 400", async () => {
		const res = await handler(new Request("http://x/scrape"));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("missing 'url'");
	});

	test("GET /scrape with disallowed profile returns 400", async () => {
		const res = await handler(
			new Request("http://x/scrape?url=https://google.com&profile=stealth"),
		);
		expect(res.status).toBe(400);
	});

	test("GET /search without q returns 400", async () => {
		const res = await handler(new Request("http://x/search"));
		expect(res.status).toBe(400);
	});

	test("GET /detect without url returns 400", async () => {
		const res = await handler(new Request("http://x/detect"));
		expect(res.status).toBe(400);
	});

	test("GET /autocomplete without q returns 400", async () => {
		const res = await handler(new Request("http://x/autocomplete"));
		expect(res.status).toBe(400);
	});

	test("response headers include no-store cache-control", async () => {
		const res = await handler(new Request("http://x/"));
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("content-type")).toContain("application/json");
	});
});
