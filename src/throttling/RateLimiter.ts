/**
 * @module bunlight/throttling/RateLimiter
 *
 * Per-domain rate limiter with sliding window + robots.txt Crawl-delay support.
 *
 * Design goals:
 *   - Polite crawling: honour `Crawl-delay` from robots.txt automatically.
 *   - Token bucket / sliding window: cap requests per second and per minute
 *     per hostname, independently of other hosts.
 *   - No external npm packages: pure Bun-native implementation.
 *   - Automatic robots.txt caching with 1-hour TTL (in-memory, no sqlite needed
 *     for this transient data).
 *   - Thread-safe (single-threaded Bun event loop; awaits are atomic within a
 *     turn).
 *
 * Sliding window algorithm:
 *   - Per hostname, we keep two ring buffers of timestamps: one for the
 *     per-second window (size = maxRequestsPerSecond) and one for the
 *     per-minute window (size = maxRequestsPerMinute).
 *   - On `acquire(url)`:
 *       1. Evict timestamps older than 1s / 60s.
 *       2. If either window is full, compute the earliest slot opening time
 *          and sleep until then.
 *       3. Record the current timestamp in both windows.
 *   - `Crawl-delay` from robots.txt is enforced by tracking the last request
 *     time per host and sleeping the remaining delay.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxRequestsPerSecond: 2, respectRobotsTxt: true });
 *
 * // Somewhere in your crawl loop:
 * await limiter.acquire("https://example.com/page");
 * const html = await fetch("https://example.com/page").then(r => r.text());
 * ```
 */

import { fetchRobotRules } from "./robots.ts";
import type { RobotRules } from "./robots.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
	/**
	 * Maximum number of requests per second per hostname.
	 * Default: 4
	 */
	maxRequestsPerSecond?: number;
	/**
	 * Maximum number of requests per minute per hostname.
	 * Default: 100
	 */
	maxRequestsPerMinute?: number;
	/**
	 * Whether to fetch and honour robots.txt Crawl-delay directives.
	 * Default: true
	 */
	respectRobotsTxt?: boolean;
	/**
	 * User-Agent sent when fetching robots.txt (also used for rule matching).
	 * Default: "Bunlight/1.0"
	 */
	userAgent?: string;
	/**
	 * Timeout (ms) for fetching robots.txt.
	 * Default: 8000
	 */
	robotsFetchTimeoutMs?: number;
	/**
	 * Cache TTL for robots.txt responses (ms).
	 * Default: 3_600_000 (1 hour)
	 */
	robotsCacheTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Internal per-host state
// ---------------------------------------------------------------------------

interface HostState {
	/** Timestamps (ms) of requests in the sliding per-second window. */
	secondWindow: number[];
	/** Timestamps (ms) of requests in the sliding per-minute window. */
	minuteWindow: number[];
	/** Timestamp (ms) of the last completed request (for crawl-delay). */
	lastRequestAt: number;
}

interface CachedRobots {
	rules: RobotRules;
	fetchedAt: number;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
	readonly #maxPerSecond: number;
	readonly #maxPerMinute: number;
	readonly #respectRobotsTxt: boolean;
	readonly #userAgent: string;
	readonly #robotsFetchTimeoutMs: number;
	readonly #robotsCacheTtlMs: number;

	/** Per-hostname sliding window state. */
	readonly #hostState = new Map<string, HostState>();
	/** Cached robots.txt rules per hostname. */
	readonly #robotsCache = new Map<string, CachedRobots>();
	/**
	 * In-flight robots.txt fetches.  Prevents thundering herd when multiple
	 * concurrent calls for the same host arrive simultaneously.
	 */
	readonly #robotsFetching = new Map<string, Promise<RobotRules>>();

	constructor(config: RateLimitConfig = {}) {
		this.#maxPerSecond = config.maxRequestsPerSecond ?? 4;
		this.#maxPerMinute = config.maxRequestsPerMinute ?? 100;
		this.#respectRobotsTxt = config.respectRobotsTxt ?? true;
		this.#userAgent = config.userAgent ?? "Bunlight/1.0";
		this.#robotsFetchTimeoutMs = config.robotsFetchTimeoutMs ?? 8_000;
		this.#robotsCacheTtlMs = config.robotsCacheTtlMs ?? 3_600_000;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Acquire a request slot for the given URL.
	 *
	 * Blocks (via async sleep) until:
	 *   1. The sliding-window rate limit allows another request for this host.
	 *   2. The Crawl-delay from robots.txt (if any) has elapsed since the last
	 *      request to this host.
	 *
	 * If robots.txt disallows the path, throws an error rather than silently
	 * fetching a disallowed URL.
	 */
	async acquire(url: string): Promise<void> {
		const parsed = this.#parseUrl(url);
		if (parsed === null) {
			// Unparseable URL: allow without throttling
			return;
		}
		const { host, path } = parsed;

		// Step 1: Enforce robots.txt rules (crawl-delay + allow check)
		if (this.#respectRobotsTxt) {
			const rules = await this.getRobotsRules(host);

			// Throw if path is disallowed
			if (!rules.allowed(path)) {
				throw new RateLimitError(`robots.txt disallows crawling ${path} on ${host}`, "disallowed");
			}

			// Honour Crawl-delay
			if (rules.crawlDelay !== undefined && rules.crawlDelay > 0) {
				await this.#enforceCrawlDelay(host, rules.crawlDelay * 1_000);
			}
		}

		// Step 2: Apply sliding-window rate limits
		await this.#enforceSliding(host);

		// Step 3: Record this request
		const state = this.#getOrCreateState(host);
		const now = Date.now();
		state.secondWindow.push(now);
		state.minuteWindow.push(now);
		state.lastRequestAt = now;
	}

	/**
	 * Retrieve (and cache) robots.txt rules for a hostname.
	 *
	 * The cache is keyed by hostname.  Entries expire after `robotsCacheTtlMs`.
	 * Concurrent fetches for the same host are coalesced.
	 *
	 * Returns a permissive (allow-all) rule set on fetch failure.
	 */
	async getRobotsRules(
		host: string,
	): Promise<{ crawlDelay?: number; allowed: (path: string) => boolean }> {
		const now = Date.now();

		// Return cached entry if fresh
		const cached = this.#robotsCache.get(host);
		if (cached !== undefined && now - cached.fetchedAt < this.#robotsCacheTtlMs) {
			return cached.rules;
		}

		// If a fetch is already in-flight for this host, wait for it
		const inflight = this.#robotsFetching.get(host);
		if (inflight !== undefined) {
			return inflight;
		}

		// Start a new fetch
		const fetchPromise = fetchRobotRules(`https://${host}/`, this.#userAgent, {
			timeoutMs: this.#robotsFetchTimeoutMs,
		})
			.then((rules) => {
				this.#robotsCache.set(host, { rules, fetchedAt: Date.now() });
				this.#robotsFetching.delete(host);
				return rules;
			})
			.catch((_err: unknown) => {
				// On error, cache a permissive rule set so we don't hammer the host
				const permissive = buildPermissiveRules();
				this.#robotsCache.set(host, { rules: permissive, fetchedAt: Date.now() });
				this.#robotsFetching.delete(host);
				return permissive;
			});

		this.#robotsFetching.set(host, fetchPromise);
		return fetchPromise;
	}

	/**
	 * Reset all internal state (windows, cache, last-request times).
	 * Primarily useful in tests to avoid cross-test pollution.
	 */
	reset(): void {
		this.#hostState.clear();
		this.#robotsCache.clear();
		this.#robotsFetching.clear();
	}

	/**
	 * Reset only the sliding-window state for one host.
	 * Does not affect the robots cache.
	 */
	resetHost(host: string): void {
		this.#hostState.delete(host);
	}

	/**
	 * Manually inject robots.txt rules for a host (bypasses network fetch).
	 * Useful for testing or for pre-configuring known hosts.
	 */
	setRobotsRules(host: string, rules: RobotRules): void {
		this.#robotsCache.set(host, { rules, fetchedAt: Date.now() });
	}

	/**
	 * Return current statistics for a hostname.
	 * Returns undefined if no requests have been made yet for this host.
	 */
	getHostStats(
		host: string,
	):
		| { requestsInLastSecond: number; requestsInLastMinute: number; lastRequestAt: number }
		| undefined {
		const state = this.#hostState.get(host);
		if (state === undefined) return undefined;
		const now = Date.now();
		const inSecond = state.secondWindow.filter((t) => now - t < 1_000).length;
		const inMinute = state.minuteWindow.filter((t) => now - t < 60_000).length;
		return {
			requestsInLastSecond: inSecond,
			requestsInLastMinute: inMinute,
			lastRequestAt: state.lastRequestAt,
		};
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/** Parse a URL into host + path, returning null for invalid URLs. */
	#parseUrl(url: string): { host: string; path: string } | null {
		try {
			const u = new URL(url);
			return { host: u.host, path: u.pathname + u.search };
		} catch {
			return null;
		}
	}

	/** Get or initialise per-host sliding window state. */
	#getOrCreateState(host: string): HostState {
		let state = this.#hostState.get(host);
		if (state === undefined) {
			state = { secondWindow: [], minuteWindow: [], lastRequestAt: 0 };
			this.#hostState.set(host, state);
		}
		return state;
	}

	/**
	 * Enforce the crawl-delay constraint for a host.
	 * Sleeps for the remaining delay since the last request.
	 */
	async #enforceCrawlDelay(host: string, delayMs: number): Promise<void> {
		const state = this.#getOrCreateState(host);
		if (state.lastRequestAt === 0) return; // First request: no delay needed

		const elapsed = Date.now() - state.lastRequestAt;
		if (elapsed < delayMs) {
			await Bun.sleep(delayMs - elapsed);
		}
	}

	/**
	 * Enforce the sliding window limits for a host.
	 *
	 * Evicts stale timestamps from both windows, then if either window is
	 * full, sleeps until the earliest slot becomes available.
	 */
	async #enforceSliding(host: string): Promise<void> {
		const state = this.#getOrCreateState(host);

		// Retry loop: sleep-then-re-check until both windows have capacity.
		// In practice, at most 1-2 iterations are needed.
		while (true) {
			const now = Date.now();

			// Evict expired entries
			evictOlderThan(state.secondWindow, now, 1_000);
			evictOlderThan(state.minuteWindow, now, 60_000);

			const secondFull = state.secondWindow.length >= this.#maxPerSecond;
			const minuteFull = state.minuteWindow.length >= this.#maxPerMinute;

			if (!secondFull && !minuteFull) break;

			// Compute how long to sleep: earliest expiry in the blocking window
			let sleepMs: number;
			if (secondFull && minuteFull) {
				const secondWait = waitUntilExpiry(state.secondWindow, now, 1_000, this.#maxPerSecond);
				const minuteWait = waitUntilExpiry(state.minuteWindow, now, 60_000, this.#maxPerMinute);
				sleepMs = Math.min(secondWait, minuteWait);
			} else if (secondFull) {
				sleepMs = waitUntilExpiry(state.secondWindow, now, 1_000, this.#maxPerSecond);
			} else {
				sleepMs = waitUntilExpiry(state.minuteWindow, now, 60_000, this.#maxPerMinute);
			}

			// Add a small buffer to avoid waking up 1ms too early
			await Bun.sleep(Math.max(1, sleepMs + 1));
		}
	}
}

// ---------------------------------------------------------------------------
// Sliding window helpers
// ---------------------------------------------------------------------------

/**
 * Evict timestamps older than `windowMs` from the front of the array.
 * The array is maintained in insertion order (oldest first).
 */
function evictOlderThan(window: number[], now: number, windowMs: number): void {
	const threshold = now - windowMs;
	let i = 0;
	while (i < window.length && window[i] <= threshold) i++;
	if (i > 0) window.splice(0, i);
}

/**
 * Compute how many ms until there is room in the window.
 * Assumes the window is at capacity and timestamps are sorted.
 *
 * The oldest entry (window[0]) will expire at `window[0] + windowMs`.
 * We need it to expire so that we drop below `capacity`.
 * If the window has more entries than capacity (shouldn't happen), we look
 * further into the array.
 */
function waitUntilExpiry(
	window: number[],
	now: number,
	windowMs: number,
	capacity: number,
): number {
	// The entry that, once expired, will free a slot
	// That's the entry at index (window.length - capacity), i.e. the oldest
	// entry still contributing to the limit.
	const idx = window.length - capacity;
	if (idx < 0 || idx >= window.length) return 0;
	const expiresAt = window[idx] + windowMs;
	return Math.max(0, expiresAt - now);
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type RateLimitReason = "disallowed" | "rate-exceeded";

export class RateLimitError extends Error {
	readonly reason: RateLimitReason;

	constructor(message: string, reason: RateLimitReason) {
		super(message);
		this.name = "RateLimitError";
		this.reason = reason;
	}
}

// ---------------------------------------------------------------------------
// Helper: permissive rule set (allow all, no crawl-delay)
// ---------------------------------------------------------------------------

function buildPermissiveRules(): RobotRules {
	return {
		crawlDelay: undefined,
		allowed(_path: string): boolean {
			return true;
		},
	};
}
