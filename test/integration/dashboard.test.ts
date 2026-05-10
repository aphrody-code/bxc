/**
 * Integration tests for the live HTTP dashboard.
 * Tests: start, /api/stats JSON, HTML route, stop.
 *
 * Uses a random high port to avoid conflicts with the default 9229.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Statistics } from "../../src/stats/Statistics.ts";
import { startDashboard } from "../../src/stats/dashboard.ts";
import type { DashboardHandle } from "../../src/stats/dashboard.ts";

// Use a random high port to avoid conflicts
const TEST_PORT = 19_229;

let handle: DashboardHandle | null = null;

afterEach(async () => {
	if (handle !== null) {
		await handle.stop();
		handle = null;
	}
});

describe("Dashboard — startup", () => {
	test("startDashboard returns a handle with correct port and url", async () => {
		const stats = new Statistics();
		handle = await startDashboard(stats, TEST_PORT);
		expect(handle.port).toBe(TEST_PORT);
		expect(handle.url).toBe(`http://localhost:${TEST_PORT}`);
	});
});

describe("Dashboard — /api/stats endpoint", () => {
	test("GET /api/stats returns valid JSON snapshot", async () => {
		const stats = new Statistics();
		stats.startTracking();
		stats.register(100, true);
		stats.register(200, true);
		stats.register(50, false, "TimeoutError");

		handle = await startDashboard(stats, TEST_PORT);
		const res = await fetch(`${handle.url}/api/stats`);
		expect(res.ok).toBe(true);
		expect(res.headers.get("Content-Type")).toContain("application/json");

		const body = (await res.json()) as Record<string, unknown>;

		// Core fields present
		expect(typeof body.requestsTotal).toBe("number");
		expect(body.requestsTotal).toBe(3);
		expect(body.requestsFinished).toBe(2);
		expect(body.requestsFailed).toBe(1);
		expect(typeof body.p50DurationMs).toBe("number");
		expect(typeof body.p95DurationMs).toBe("number");
		expect(typeof body.successRate).toBe("number");
		expect(typeof body.requestsPerMinute).toBe("number");
		expect(typeof body.crawlerRuntimeMillis).toBe("number");
		expect(typeof body.errorBreakdown).toBe("object");

		// Error breakdown
		const breakdown = body.errorBreakdown as Record<string, number>;
		expect(breakdown["TimeoutError"]).toBe(1);
	});

	test("GET /api/stats includes CORS header", async () => {
		const stats = new Statistics();
		handle = await startDashboard(stats, TEST_PORT);
		const res = await fetch(`${handle.url}/api/stats`);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	test("snapshot reflects updated stats after additional register calls", async () => {
		const stats = new Statistics();
		handle = await startDashboard(stats, TEST_PORT);

		stats.register(300, true);
		const res = await fetch(`${handle.url}/api/stats`);
		const body = (await res.json()) as Record<string, number>;
		expect(body.requestsFinished).toBe(1);
		expect(body.p50DurationMs).toBe(300);
	});
});

describe("Dashboard — HTML route", () => {
	test("GET / returns HTML with correct Content-Type", async () => {
		const stats = new Statistics();
		handle = await startDashboard(stats, TEST_PORT);
		const res = await fetch(`${handle.url}/`);
		expect(res.ok).toBe(true);
		expect(res.headers.get("Content-Type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("Bunlight Stats Dashboard");
		expect(html).toContain("/api/stats");
	});
});

describe("Dashboard — stop", () => {
	test("stop() closes the server (subsequent fetch fails)", async () => {
		const stats = new Statistics();
		handle = await startDashboard(stats, TEST_PORT);
		await handle.stop();
		handle = null; // prevent afterEach double-stop

		let threw = false;
		try {
			await fetch(`http://localhost:${TEST_PORT}/api/stats`);
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});
