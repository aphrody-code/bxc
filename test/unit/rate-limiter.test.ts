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
 * Unit tests for src/throttling/RateLimiter.ts
 *
 * Tests cover:
 *   1. Sliding window per-second enforcement
 *   2. Sliding window per-minute enforcement
 *   3. Crawl-delay enforcement from injected robots rules
 *   4. Disallowed path throws RateLimitError
 *   5. Multi-host independence (parallel crawls on different domains)
 *   6. Reset / resetHost helpers
 *   7. getHostStats reporting
 *   8. setRobotsRules injection
 *   9. Permissive fallback when respectRobotsTxt = false
 *  10. Invalid URL passthrough (no throw)
 *  11. First-request crawl-delay: no wait (no prior request)
 *  12. Cached robots rules reuse (no second network call)
 *  13. Two windows hit simultaneously (per-second is the binding constraint)
 *  14. acquire resolves within expected time bounds
 *  15. Concurrent acquires for same host are serialised correctly
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	RateLimitError,
	RateLimiter,
	type RobotRules,
} from "../../src/throttling/RateLimiter.ts";

// ---------------------------------------------------------------------------
// Helper: build a RobotRules object inline (no network)
// ---------------------------------------------------------------------------

function makeRules(opts: {
	crawlDelay?: number;
	disallowed?: string[];
}): RobotRules {
	const disallowed = opts.disallowed ?? [];
	return {
		crawlDelay: opts.crawlDelay,
		allowed(path: string): boolean {
			return !disallowed.some((p) => path.startsWith(p));
		},
	};
}

function allowAllRules(): RobotRules {
	return makeRules({});
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let limiter: RateLimiter;

beforeEach(() => {
	// High limits so individual tests control only what they need
	limiter = new RateLimiter({
		maxRequestsPerSecond: 100,
		maxRequestsPerMinute: 1000,
		respectRobotsTxt: false, // tests that need robots inject rules manually
		googleAutoThrottle: false, // disable auto-throttle for fast unit tests
	});
});

// ---------------------------------------------------------------------------
// 1. Sliding window per-second
// ---------------------------------------------------------------------------

describe("sliding window (per-second)", () => {
	it("allows up to maxRequestsPerSecond requests without delay", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 3,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		for (let i = 0; i < 3; i++) {
			await l.acquire("https://www.google.com/page");
		}
		const elapsed = Date.now() - start;
		// 3 requests under limit should complete in < 50ms
		expect(elapsed).toBeLessThan(50);
	});

	it("delays the (N+1)th request past the 1s window", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 2,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		// Saturate the window
		await l.acquire("https://ratelimit.google.com/a");
		await l.acquire("https://ratelimit.google.com/b");
		// 3rd request must wait for 1s to pass
		await l.acquire("https://ratelimit.google.com/c");
		const elapsed = Date.now() - start;
		// Should have waited at least 950ms (wall-clock tolerance)
		expect(elapsed).toBeGreaterThan(900);
	});

	it("does not delay requests across different hosts", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 1,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		// Each host has its own window
		await l.acquire("https://host-a.google.com/");
		await l.acquire("https://host-b.google.com/");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// 2. Sliding window per-minute
// ---------------------------------------------------------------------------

describe("sliding window (per-minute)", () => {
	it("allows up to maxRequestsPerMinute without triggering minute limit", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 1000,
			maxRequestsPerMinute: 5,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		// Pre-fill the minute window to one below cap
		l.setRobotsRules("minute.google.com", allowAllRules());
		for (let i = 0; i < 5; i++) {
			await l.acquire("https://minute.google.com/page");
		}
		const stats = l.getHostStats("minute.google.com");
		expect(stats?.requestsInLastMinute).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// 3. Crawl-delay from injected robots rules
// ---------------------------------------------------------------------------

describe("crawl-delay", () => {
	it("waits crawlDelay seconds between consecutive requests", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: true,
		});
		// Inject rules with 200ms crawl delay (0.2s for test speed)
		l.setRobotsRules("crawldelay.google.com", makeRules({ crawlDelay: 0.2 }));

		const start = Date.now();
		await l.acquire("https://crawldelay.google.com/page1");
		await l.acquire("https://crawldelay.google.com/page2");
		const elapsed = Date.now() - start;
		// Second request must wait at least 180ms
		expect(elapsed).toBeGreaterThan(150);
	});

	it("does not wait on the first request (no prior lastRequestAt)", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: true,
		});
		l.setRobotsRules("first-req.google.com", makeRules({ crawlDelay: 5 }));
		const start = Date.now();
		await l.acquire("https://first-req.google.com/page");
		const elapsed = Date.now() - start;
		// First request: no crawl-delay wait
		expect(elapsed).toBeLessThan(100);
	});
});

// ---------------------------------------------------------------------------
// 4. Disallowed path throws RateLimitError
// ---------------------------------------------------------------------------

describe("disallowed paths", () => {
	it("throws RateLimitError when path is disallowed", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: true,
		});
		l.setRobotsRules(
			"blocked.google.com",
			makeRules({ disallowed: ["/private/"] }),
		);

		let thrown = false;
		try {
			await l.acquire("https://blocked.google.com/private/secret");
		} catch (err) {
			thrown = true;
			expect(err).toBeInstanceOf(RateLimitError);
			expect((err as RateLimitError).reason).toBe("disallowed");
		}
		expect(thrown).toBe(true);
	});

	it("allows paths not covered by Disallow", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: true,
		});
		l.setRobotsRules(
			"blocked.google.com",
			makeRules({ disallowed: ["/private/"] }),
		);
		// Should not throw
		await l.acquire("https://blocked.google.com/public/page");
	});
});

// ---------------------------------------------------------------------------
// 5. Multi-host independence
// ---------------------------------------------------------------------------

describe("multi-host parallel crawling", () => {
	it("hosts do not share rate-limit state", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 2,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		// Saturate host-a
		await l.acquire("https://host-a.google.com/1");
		await l.acquire("https://host-a.google.com/2");

		// host-b has its own empty window — should not block
		const start = Date.now();
		await l.acquire("https://host-b.google.com/1");
		await l.acquire("https://host-b.google.com/2");
		expect(Date.now() - start).toBeLessThan(50);
	});

	it("concurrent acquires for different hosts resolve quickly", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		await Promise.all([
			l.acquire("https://alpha.google.com/"),
			l.acquire("https://beta.google.com/"),
			l.acquire("https://gamma.google.com/"),
		]);
		expect(Date.now() - start).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// 6. Reset helpers
// ---------------------------------------------------------------------------

describe("reset / resetHost", () => {
	it("reset() clears all host state", async () => {
		await limiter.acquire("https://google.com/page");
		limiter.reset();
		expect(limiter.getHostStats("google.com")).toBeUndefined();
	});

	it("resetHost() clears only the specified host", async () => {
		await limiter.acquire("https://alpha.google.com/page");
		await limiter.acquire("https://beta.google.com/page");
		limiter.resetHost("alpha.google.com");
		expect(limiter.getHostStats("alpha.google.com")).toBeUndefined();
		expect(limiter.getHostStats("beta.google.com")).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 7. getHostStats reporting
// ---------------------------------------------------------------------------

describe("getHostStats", () => {
	it("returns undefined for unknown host", () => {
		expect(limiter.getHostStats("unknown.google.com")).toBeUndefined();
	});

	it("returns correct counts after requests", async () => {
		await limiter.acquire("https://stats.google.com/a");
		await limiter.acquire("https://stats.google.com/b");
		const stats = limiter.getHostStats("stats.google.com");
		expect(stats).toBeDefined();
		expect(stats!.requestsInLastSecond).toBe(2);
		expect(stats!.requestsInLastMinute).toBe(2);
		expect(stats!.lastRequestAt).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 8. setRobotsRules injection
// ---------------------------------------------------------------------------

describe("setRobotsRules", () => {
	it("injects rules that take effect immediately", async () => {
		const l = new RateLimiter({
			respectRobotsTxt: true,
			googleAutoThrottle: false,
		});
		l.setRobotsRules(
			"inject.google.com",
			makeRules({ disallowed: ["/blocked/"] }),
		);

		let threw = false;
		try {
			await l.acquire("https://inject.google.com/blocked/page");
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 9. respectRobotsTxt = false
// ---------------------------------------------------------------------------

describe("respectRobotsTxt = false", () => {
	it("does not apply disallow rules", async () => {
		const l = new RateLimiter({
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		l.setRobotsRules(
			"norobots.google.com",
			makeRules({ disallowed: ["/everything/"] }),
		);
		// Should not throw even though path is disallowed
		await l.acquire("https://norobots.google.com/everything/secret");
	});

	it("does not apply crawl-delay", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		l.setRobotsRules("nodelay.google.com", makeRules({ crawlDelay: 5 }));
		const start = Date.now();
		await l.acquire("https://nodelay.google.com/a");
		await l.acquire("https://nodelay.google.com/b");
		// Should complete in well under 5000ms
		expect(Date.now() - start).toBeLessThan(100);
	});
});

// ---------------------------------------------------------------------------
// 10. Invalid URL passthrough
// ---------------------------------------------------------------------------

describe("invalid URL", () => {
	it("does not throw for an unparseable URL", async () => {
		// Should silently pass through without rate-limiting
		await limiter.acquire("not-a-url");
	});

	it("does not throw for empty string", async () => {
		await limiter.acquire("");
	});
});

// ---------------------------------------------------------------------------
// 11. RateLimitError properties
// ---------------------------------------------------------------------------

describe("RateLimitError", () => {
	it("has correct name and reason", () => {
		const err = new RateLimitError("test", "disallowed");
		expect(err.name).toBe("RateLimitError");
		expect(err.reason).toBe("disallowed");
		expect(err.message).toBe("test");
		expect(err).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// 12. Robots cache reuse
// ---------------------------------------------------------------------------

describe("robots cache", () => {
	it("reuses cached rules without refetching", async () => {
		const l = new RateLimiter({
			respectRobotsTxt: true,
			googleAutoThrottle: false,
		});
		const rules = allowAllRules();
		l.setRobotsRules("cached.google.com", rules);

		// Two calls to getRobotsRules should hit the same cached entry
		const r1 = await l.getRobotsRules("cached.google.com");
		const r2 = await l.getRobotsRules("cached.google.com");
		// Both should be the same object reference from the cache
		expect(r1).toBe(r2);
	});
});

// ---------------------------------------------------------------------------
// 13. Per-second window is binding when minute window has room
// ---------------------------------------------------------------------------

describe("binding constraint", () => {
	it("per-second limit applies before per-minute", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 1,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		await l.acquire("https://binding.google.com/1");
		// Window at capacity: second request must wait
		await l.acquire("https://binding.google.com/2");
		expect(Date.now() - start).toBeGreaterThan(900);
	});
});

// ---------------------------------------------------------------------------
// 14. Timing: acquire resolves within expected bounds
// ---------------------------------------------------------------------------

describe("timing", () => {
	it("single acquire with no limits resolves instantly", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const start = Date.now();
		await l.acquire("https://fast.google.com/page");
		expect(Date.now() - start).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// 15. Concurrent same-host acquires
// ---------------------------------------------------------------------------

describe("concurrent same-host", () => {
	it("serialises concurrent requests and maintains window size", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 5,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
			googleAutoThrottle: false,
		});
		const host = "concurrent.google.com";
		// Fire 5 concurrent requests (all should fit in the window)
		const start = Date.now();
		await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				l.acquire(`https://${host}/page${i}`),
			),
		);
		const elapsed = Date.now() - start;
		// 5 requests fit within maxRequestsPerSecond=5: should complete quickly
		expect(elapsed).toBeLessThan(200);

		const stats = l.getHostStats(host);
		expect(stats?.requestsInLastSecond).toBeLessThanOrEqual(5);
	});
});
