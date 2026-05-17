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
 * Unit tests for HarReplayer
 *
 * Tests cover:
 *  - HarReplayer.load() from disk
 *  - HarReplayer.fromEntries() factory
 *  - size property reflects entry count
 *  - lookup() by method + URL (exact match)
 *  - lookup() fallback to GET for non-GET methods
 *  - serve() starts a Bun.serve server
 *  - serve() responds with HAR entry status + headers + body
 *  - serve() returns 404 for unknown URLs
 *  - stop() releases the server port
 *  - URL-encoded path routing
 *  - Query-parameter routing (?url=...)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarReplayer } from "../../src/recorder/HarReplayer.ts";
import type { HarEntry, HarFile } from "../../src/recorder/types.ts";

// ---------------------------------------------------------------------------
// Helpers: build minimal HarEntry objects
// ---------------------------------------------------------------------------

function makeHarEntry(
	method: string,
	url: string,
	status: number,
	body: string,
	contentType = "text/plain",
	headers: Array<{ name: string; value: string }> = [],
): HarEntry {
	return {
		startedDateTime: new Date().toISOString(),
		time: 50,
		request: {
			method,
			url,
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [],
			queryString: [],
			headersSize: -1,
			bodySize: -1,
		},
		response: {
			status,
			statusText: status === 200 ? "OK" : String(status),
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [{ name: "content-type", value: contentType }, ...headers],
			content: { size: body.length, mimeType: contentType, text: body },
			redirectURL: "",
			headersSize: -1,
			bodySize: body.length,
		},
		cache: {},
		timings: { blocked: -1, dns: -1, connect: -1, send: 5, wait: 40, receive: 5 },
	};
}

/** Writes a HAR file to a temp path and returns it. */
async function writeTempHar(entries: HarEntry[]): Promise<string> {
	const harFile: HarFile = {
		log: {
			version: "1.2",
			creator: { name: "test", version: "1.0" },
			pages: [],
			entries,
		},
	};
	const path = join(tmpdir(), `har-replayer-test-${Date.now()}.har`);
	await Bun.write(path, JSON.stringify(harFile));
	return path;
}

// ---------------------------------------------------------------------------
// Track servers to stop in afterEach
// ---------------------------------------------------------------------------

const serversToStop: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
	for (const s of serversToStop) {
		await s.stop().catch(() => undefined);
	}
	serversToStop.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Factory methods
// ---------------------------------------------------------------------------

describe("HarReplayer factory", () => {
	test("fromEntries() creates a replayer with correct size", () => {
		const entries = [
			makeHarEntry("GET", "https://google.com/", 200, "<html></html>"),
			makeHarEntry("GET", "https://google.com/api", 200, "{}"),
		];
		const replayer = HarReplayer.fromEntries(entries);
		expect(replayer.size).toBe(2);
	});

	test("fromEntries() with empty array gives size 0", () => {
		const replayer = HarReplayer.fromEntries([]);
		expect(replayer.size).toBe(0);
	});

	test("load() reads valid HAR file from disk", async () => {
		const entries = [makeHarEntry("GET", "https://google.com/", 200, "<html></html>")];
		const path = await writeTempHar(entries);
		const replayer = await HarReplayer.load(path);
		expect(replayer.size).toBe(1);
	});

	test("load() throws on invalid HAR JSON", async () => {
		const path = join(tmpdir(), `invalid-${Date.now()}.har`);
		await Bun.write(path, '{"not": "har"}');
		await expect(HarReplayer.load(path)).rejects.toThrow();
	});

	test("load() deduplicates entries by method+url (first wins)", async () => {
		const entries = [
			makeHarEntry("GET", "https://google.com/", 200, "first"),
			makeHarEntry("GET", "https://google.com/", 200, "second"),
		];
		const path = await writeTempHar(entries);
		const replayer = await HarReplayer.load(path);
		expect(replayer.size).toBe(1);
		const entry = replayer.lookup("GET", "https://google.com/");
		expect(entry?.response.content.text).toBe("first");
	});
});

// ---------------------------------------------------------------------------
// 2. lookup()
// ---------------------------------------------------------------------------

describe("HarReplayer.lookup()", () => {
	test("exact method+url match returns entry", () => {
		const entry = makeHarEntry("GET", "https://google.com/page", 200, "hello");
		const replayer = HarReplayer.fromEntries([entry]);
		const found = replayer.lookup("GET", "https://google.com/page");
		expect(found).toBeDefined();
		expect(found?.response.status).toBe(200);
	});

	test("method case-insensitive lookup works", () => {
		const entry = makeHarEntry("POST", "https://google.com/submit", 201, "created");
		const replayer = HarReplayer.fromEntries([entry]);
		expect(replayer.lookup("post", "https://google.com/submit")).toBeDefined();
		expect(replayer.lookup("POST", "https://google.com/submit")).toBeDefined();
	});

	test("unknown URL returns undefined", () => {
		const replayer = HarReplayer.fromEntries([
			makeHarEntry("GET", "https://google.com/", 200, "x"),
		]);
		expect(replayer.lookup("GET", "https://unknown.google.com/")).toBeUndefined();
	});

	test("multiple entries are indexed independently", () => {
		const entries = [
			makeHarEntry("GET", "https://a.com/", 200, "a"),
			makeHarEntry("GET", "https://b.com/", 301, "b"),
			makeHarEntry("POST", "https://a.com/api", 201, "c"),
		];
		const replayer = HarReplayer.fromEntries(entries);
		expect(replayer.size).toBe(3);
		expect(replayer.lookup("GET", "https://a.com/")?.response.status).toBe(200);
		expect(replayer.lookup("GET", "https://b.com/")?.response.status).toBe(301);
		expect(replayer.lookup("POST", "https://a.com/api")?.response.status).toBe(201);
	});
});

// ---------------------------------------------------------------------------
// 3. serve()
// ---------------------------------------------------------------------------

describe("HarReplayer.serve()", () => {
	test("serve() starts server and returns port", async () => {
		const replayer = HarReplayer.fromEntries([]);
		const server = await replayer.serve();
		serversToStop.push(server);
		expect(typeof server.port).toBe("number");
		expect(server.port).toBeGreaterThan(0);
	});

	test("serve() responds to known URL with recorded status and body", async () => {
		const targetUrl = "https://google.com/test-page";
		const replayer = HarReplayer.fromEntries([
			makeHarEntry("GET", targetUrl, 200, "<h1>Hello HAR</h1>", "text/html"),
		]);
		const server = await replayer.serve();
		serversToStop.push(server);

		// Path-prefixed routing: /https://google.com/test-page
		const res = await fetch(`http://localhost:${server.port}/${encodeURIComponent(targetUrl)}`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe("<h1>Hello HAR</h1>");
	});

	test("serve() returns 404 for unknown URLs", async () => {
		const replayer = HarReplayer.fromEntries([
			makeHarEntry("GET", "https://google.com/", 200, "known"),
		]);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(
			`http://localhost:${server.port}/${encodeURIComponent("https://unknown.google.com/")}`,
		);
		expect(res.status).toBe(404);
	});

	test("serve() forwards custom response headers", async () => {
		const targetUrl = "https://api.google.com/data";
		const replayer = HarReplayer.fromEntries([
			makeHarEntry("GET", targetUrl, 200, '{"ok":true}', "application/json", [
				{ name: "x-request-id", value: "abc-123" },
			]),
		]);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(`http://localhost:${server.port}/${encodeURIComponent(targetUrl)}`);
		expect(res.headers.get("x-request-id")).toBe("abc-123");
		expect(res.headers.get("content-type")).toContain("application/json");
	});

	test("stop() releases the server", async () => {
		const replayer = HarReplayer.fromEntries([]);
		const server = await replayer.serve();
		const { port } = server;

		await server.stop();

		// After stop, connecting to the port should fail
		const result = await fetch(`http://localhost:${port}/`).catch(() => null);
		expect(result).toBeNull();
	});

	test("serve() with ?url= query parameter routing", async () => {
		const targetUrl = "https://google.com/query-route";
		const replayer = HarReplayer.fromEntries([
			makeHarEntry("GET", targetUrl, 200, "query-routed", "text/plain"),
		]);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(
			`http://localhost:${server.port}/?url=${encodeURIComponent(targetUrl)}`,
		);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe("query-routed");
	});
});
