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

import { describe, it, expect, beforeEach } from "bun:test";
import { RateLimiter, RateLimitError } from "../../src/throttling/RateLimiter.ts";
import type { RobotRules } from "../../src/throttling/robots.ts";

// ---------------------------------------------------------------------------
// Helper: build a RobotRules object inline (no network)
// ---------------------------------------------------------------------------

function makeRules(opts: { crawlDelay?: number; disallowed?: string[] }): RobotRules {
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
		});
		const start = Date.now();
		for (let i = 0; i < 3; i++) {
			await l.acquire("https://example.com/page");
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
		});
		const start = Date.now();
		// Saturate the window
		await l.acquire("https://ratelimit-test.com/a");
		await l.acquire("https://ratelimit-test.com/b");
		// 3rd request must wait for 1s to pass
		await l.acquire("https://ratelimit-test.com/c");
		const elapsed = Date.now() - start;
		// Should have waited at least 950ms (wall-clock tolerance)
		expect(elapsed).toBeGreaterThan(900);
	});

	it("does not delay requests across different hosts", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 1,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
		});
		const start = Date.now();
		// Each host has its own window
		await l.acquire("https://host-a.example.com/");
		await l.acquire("https://host-b.example.com/");
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
		});
		// Pre-fill the minute window to one below cap
		l.setRobotsRules("minute-test.com", allowAllRules());
		for (let i = 0; i < 5; i++) {
			await l.acquire("https://minute-test.com/page");
		}
		const stats = l.getHostStats("minute-test.com");
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
		l.setRobotsRules("crawldelay.example.com", makeRules({ crawlDelay: 0.2 }));

		const start = Date.now();
		await l.acquire("https://crawldelay.example.com/page1");
		await l.acquire("https://crawldelay.example.com/page2");
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
		l.setRobotsRules("first-req.example.com", makeRules({ crawlDelay: 5 }));
		const start = Date.now();
		await l.acquire("https://first-req.example.com/page");
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
		l.setRobotsRules("blocked.example.com", makeRules({ disallowed: ["/private/"] }));

		let thrown = false;
		try {
			await l.acquire("https://blocked.example.com/private/secret");
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
		l.setRobotsRules("blocked.example.com", makeRules({ disallowed: ["/private/"] }));
		// Should not throw
		await l.acquire("https://blocked.example.com/public/page");
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
		});
		// Saturate host-a
		await l.acquire("https://host-a.test/1");
		await l.acquire("https://host-a.test/2");

		// host-b has its own empty window — should not block
		const start = Date.now();
		await l.acquire("https://host-b.test/1");
		await l.acquire("https://host-b.test/2");
		expect(Date.now() - start).toBeLessThan(50);
	});

	it("concurrent acquires for different hosts resolve quickly", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
		});
		const start = Date.now();
		await Promise.all([
			l.acquire("https://alpha.test/"),
			l.acquire("https://beta.test/"),
			l.acquire("https://gamma.test/"),
		]);
		expect(Date.now() - start).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// 6. Reset helpers
// ---------------------------------------------------------------------------

describe("reset / resetHost", () => {
	it("reset() clears all host state", async () => {
		await limiter.acquire("https://example.com/page");
		limiter.reset();
		expect(limiter.getHostStats("example.com")).toBeUndefined();
	});

	it("resetHost() clears only the specified host", async () => {
		await limiter.acquire("https://alpha.example.com/page");
		await limiter.acquire("https://beta.example.com/page");
		limiter.resetHost("alpha.example.com");
		expect(limiter.getHostStats("alpha.example.com")).toBeUndefined();
		expect(limiter.getHostStats("beta.example.com")).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 7. getHostStats reporting
// ---------------------------------------------------------------------------

describe("getHostStats", () => {
	it("returns undefined for unknown host", () => {
		expect(limiter.getHostStats("unknown.example.com")).toBeUndefined();
	});

	it("returns correct counts after requests", async () => {
		await limiter.acquire("https://stats.example.com/a");
		await limiter.acquire("https://stats.example.com/b");
		const stats = limiter.getHostStats("stats.example.com");
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
		const l = new RateLimiter({ respectRobotsTxt: true });
		l.setRobotsRules("inject.example.com", makeRules({ disallowed: ["/blocked/"] }));

		let threw = false;
		try {
			await l.acquire("https://inject.example.com/blocked/page");
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
		const l = new RateLimiter({ respectRobotsTxt: false });
		l.setRobotsRules("norobots.com", makeRules({ disallowed: ["/everything/"] }));
		// Should not throw even though path is disallowed
		await l.acquire("https://norobots.com/everything/secret");
	});

	it("does not apply crawl-delay", async () => {
		const l = new RateLimiter({
			maxRequestsPerSecond: 100,
			maxRequestsPerMinute: 1000,
			respectRobotsTxt: false,
		});
		l.setRobotsRules("nodelay.com", makeRules({ crawlDelay: 5 }));
		const start = Date.now();
		await l.acquire("https://nodelay.com/a");
		await l.acquire("https://nodelay.com/b");
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
		const l = new RateLimiter({ respectRobotsTxt: true });
		const rules = allowAllRules();
		l.setRobotsRules("cached.example.com", rules);

		// Two calls to getRobotsRules should hit the same cached entry
		const r1 = await l.getRobotsRules("cached.example.com");
		const r2 = await l.getRobotsRules("cached.example.com");
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
		});
		const start = Date.now();
		await l.acquire("https://binding.test/1");
		// Window at capacity: second request must wait
		await l.acquire("https://binding.test/2");
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
		});
		const start = Date.now();
		await l.acquire("https://fast.test/page");
		expect(Date.now() - start).toBeLessThan(30);
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
		});
		const host = "concurrent.test";
		// Fire 5 concurrent requests (all should fit in the window)
		const start = Date.now();
		await Promise.all(Array.from({ length: 5 }, (_, i) => l.acquire(`https://${host}/page${i}`)));
		const elapsed = Date.now() - start;
		// 5 requests fit within maxRequestsPerSecond=5: should complete quickly
		expect(elapsed).toBeLessThan(200);

		const stats = l.getHostStats(host);
		expect(stats?.requestsInLastSecond).toBeLessThanOrEqual(5);
	});
});
