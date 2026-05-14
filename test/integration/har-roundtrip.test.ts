/**
 * Integration test: HAR record → save → load → replay → fetch roundtrip
 *
 * This test demonstrates the full workflow:
 *  1. Build a HAR log in-memory (simulating what HarRecorder would produce
 *     from a real Page).
 *  2. Save it to a temp .har file using Bun.write.
 *  3. Load it back via HarReplayer.load().
 *  4. Start the replay server with Bun.serve.
 *  5. Fetch from the replay server and verify the response matches what was
 *     recorded.
 *
 * No real network access is needed; the entire roundtrip is local.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { HarReplayer } from "../../src/recorder/HarReplayer.ts";
import type { HarEntry, HarFile } from "../../src/recorder/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHarEntry(
	method: string,
	url: string,
	status: number,
	body: string,
	contentType = "text/html",
	extraHeaders: Array<{ name: string; value: string }> = [],
): HarEntry {
	return {
		startedDateTime: new Date().toISOString(),
		time: 120,
		request: {
			method,
			url,
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [{ name: "accept", value: "*/*" }],
			queryString: [],
			headersSize: -1,
			bodySize: -1,
		},
		response: {
			status,
			statusText: status >= 200 && status < 300 ? "OK" : "Error",
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: [{ name: "content-type", value: contentType }, ...extraHeaders],
			content: { size: body.length, mimeType: contentType, text: body },
			redirectURL: "",
			headersSize: -1,
			bodySize: body.length,
		},
		cache: {},
		timings: { blocked: -1, dns: 5, connect: 10, send: 2, wait: 80, receive: 23, ssl: -1 },
	};
}

async function writeHarFile(entries: HarEntry[]): Promise<string> {
	const harFile: HarFile = {
		log: {
			version: "1.2",
			creator: { name: "Bunlight", version: "0.1.0" },
			browser: { name: "Bunlight", version: "0.1.0" },
			pages: [
				{
					startedDateTime: new Date().toISOString(),
					id: "page_1",
					title: "Integration Test Page",
					pageTimings: { onContentLoad: -1, onLoad: -1 },
				},
			],
			entries,
		},
	};
	const path = join(tmpdir(), `bunlight-har-roundtrip-${Date.now()}.har`);
	await Bun.write(path, JSON.stringify(harFile, null, 2));
	return path;
}

// ---------------------------------------------------------------------------
// Server cleanup
// ---------------------------------------------------------------------------

const serversToStop: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
	for (const s of serversToStop) {
		await s.stop().catch(() => undefined);
	}
	serversToStop.length = 0;
});

// ---------------------------------------------------------------------------
// Roundtrip tests
// ---------------------------------------------------------------------------

describe("HAR roundtrip: record → save → replay → fetch", () => {
	test("basic GET response is replayed correctly", async () => {
		const targetUrl = "https://example.com/";
		const entries = [buildHarEntry("GET", targetUrl, 200, "<html><body>Example</body></html>")];
		const harPath = await writeHarFile(entries);

		// Load the HAR
		const replayer = await HarReplayer.load(harPath);
		expect(replayer.size).toBe(1);

		// Start the replay server
		const server = await replayer.serve();
		serversToStop.push(server);
		expect(server.port).toBeGreaterThan(0);

		// Fetch from the replay server
		const res = await fetch(`http://localhost:${server.port}/${encodeURIComponent(targetUrl)}`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe("<html><body>Example</body></html>");
	});

	test("JSON API response roundtrip", async () => {
		const apiUrl = "https://api.example.com/v1/users";
		const jsonBody = JSON.stringify({ users: [{ id: 1, name: "Alice" }] });
		const entries = [buildHarEntry("GET", apiUrl, 200, jsonBody, "application/json")];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(`http://localhost:${server.port}/${encodeURIComponent(apiUrl)}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");

		const data = (await res.json()) as { users: Array<{ id: number; name: string }> };
		expect(data.users[0].name).toBe("Alice");
	});

	test("multiple URLs are served correctly from one HAR", async () => {
		const entries = [
			buildHarEntry("GET", "https://example.com/", 200, "<html>home</html>"),
			buildHarEntry("GET", "https://example.com/about", 200, "<html>about</html>"),
			buildHarEntry("GET", "https://example.com/contact", 200, "<html>contact</html>"),
		];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		expect(replayer.size).toBe(3);

		const server = await replayer.serve();
		serversToStop.push(server);

		const [r1, r2, r3] = await Promise.all([
			fetch(`http://localhost:${server.port}/${encodeURIComponent("https://example.com/")}`),
			fetch(`http://localhost:${server.port}/${encodeURIComponent("https://example.com/about")}`),
			fetch(`http://localhost:${server.port}/${encodeURIComponent("https://example.com/contact")}`),
		]);

		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		expect(r3.status).toBe(200);

		expect(await r1.text()).toBe("<html>home</html>");
		expect(await r2.text()).toBe("<html>about</html>");
		expect(await r3.text()).toBe("<html>contact</html>");
	});

	test("non-200 status codes are replayed", async () => {
		const entries = [
			buildHarEntry("GET", "https://example.com/notfound", 404, "Not Found", "text/plain"),
			buildHarEntry("GET", "https://example.com/error", 500, "Internal Server Error", "text/plain"),
			buildHarEntry("GET", "https://example.com/moved", 301, "", "text/html", [
				{ name: "location", value: "https://example.com/new" },
			]),
		];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		const r404 = await fetch(
			`http://localhost:${server.port}/${encodeURIComponent("https://example.com/notfound")}`,
			{ redirect: "manual" },
		);
		expect(r404.status).toBe(404);

		const r500 = await fetch(
			`http://localhost:${server.port}/${encodeURIComponent("https://example.com/error")}`,
			{ redirect: "manual" },
		);
		expect(r500.status).toBe(500);
	});

	test("custom response headers survive the roundtrip", async () => {
		const targetUrl = "https://api.example.com/secure";
		const entries = [
			buildHarEntry("GET", targetUrl, 200, "data", "application/json", [
				{ name: "x-rate-limit", value: "100" },
				{ name: "x-request-id", value: "roundtrip-42" },
			]),
		];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(`http://localhost:${server.port}/${encodeURIComponent(targetUrl)}`);
		expect(res.headers.get("x-rate-limit")).toBe("100");
		expect(res.headers.get("x-request-id")).toBe("roundtrip-42");
	});

	test("HAR file is valid JSON with correct version field", async () => {
		const entries = [buildHarEntry("GET", "https://example.com/", 200, "ok")];
		const harPath = await writeHarFile(entries);

		const raw = await Bun.file(harPath).text();
		const parsed = JSON.parse(raw) as HarFile;
		expect(parsed.log.version).toBe("1.2");
		expect(parsed.log.creator.name).toBe("Bunlight");
		expect(parsed.log.entries).toHaveLength(1);
	});

	test("serve() returns 404 JSON for URLs not in HAR", async () => {
		const entries = [buildHarEntry("GET", "https://example.com/", 200, "ok")];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(
			`http://localhost:${server.port}/${encodeURIComponent("https://not-recorded.example.com/")}`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("No HAR entry");
	});

	test("query-parameter routing (?url=...) works end-to-end", async () => {
		const targetUrl = "https://example.com/query-test";
		const entries = [buildHarEntry("GET", targetUrl, 200, "query routing works")];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		const res = await fetch(
			`http://localhost:${server.port}/?url=${encodeURIComponent(targetUrl)}`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("query routing works");
	});

	test("HAR with POST entry is replayed for POST requests", async () => {
		const targetUrl = "https://api.example.com/submit";
		const entries = [buildHarEntry("POST", targetUrl, 201, '{"id":42}', "application/json")];
		const harPath = await writeHarFile(entries);

		const replayer = await HarReplayer.load(harPath);
		const server = await replayer.serve();
		serversToStop.push(server);

		// Use ?url= and ?method= routing for POST
		const res = await fetch(
			`http://localhost:${server.port}/?url=${encodeURIComponent(targetUrl)}&method=POST`,
			{ method: "GET" }, // actual HTTP method is GET to the replay server
		);
		expect(res.status).toBe(201);
		const data = (await res.json()) as { id: number };
		expect(data.id).toBe(42);
	});
});
