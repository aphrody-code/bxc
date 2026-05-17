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
 * @module bunlight/throttling/rate-limiter
 *
 * Per-domain rate limiter with sliding window + robots.txt Crawl-delay support.
 */

import { RobotsFile as RobotsFileImpl } from "../utils/robots.ts";

/** Simplified interface for internal RateLimiter rules matching the old shape. */
export interface RobotRules {
	crawlDelay?: number;
	allowed(path: string): boolean;
}

export class RateLimitError extends Error {
	constructor(message: string, public readonly reason: "concurrency" | "rps" | "disallowed") {
		super(message);
		this.name = "RateLimitError";
	}
}

interface CachedRobots {
	rules: RobotRules;
	fetchedAt: number;
}

export interface RateLimitConfig {
	maxConcurrency?: number;
	maxRequestsPerSecond?: number;
	maxRequestsPerMinute?: number;
	obeyRobots?: boolean;
	respectRobotsTxt?: boolean; // alias for obeyRobots used in tests
	userAgent?: string;
	robotsFetchTimeoutMs?: number;
	robotsCacheTtlMs?: number;
	googleAutoThrottle?: boolean;
}

interface HostState {
	lastRequestAt: number;
	requestsInLastSecond: number[];
	requestsInLastMinute: number[];
}

export class RateLimiter {
	readonly #maxConcurrency: number;
	readonly #maxRequestsPerSecond: number;
	readonly #maxRequestsPerMinute: number;
	readonly #obeyRobots: boolean;
	readonly #userAgent: string;
	readonly #robotsFetchTimeoutMs: number;
	readonly #robotsCacheTtlMs: number;

	#activeRequests = 0;
	readonly #hostStates = new Map<string, HostState>();
	readonly #robotsCache = new Map<string, CachedRobots>();
	readonly #robotsFetching = new Map<string, Promise<RobotRules>>();

	constructor(config: RateLimitConfig = {}) {
		this.#maxConcurrency = config.maxConcurrency ?? 5;
		this.#maxRequestsPerSecond = config.maxRequestsPerSecond ?? 2;
		this.#maxRequestsPerMinute = config.maxRequestsPerMinute ?? 60;
		this.#obeyRobots = config.obeyRobots ?? config.respectRobotsTxt ?? false;
		this.#userAgent = config.userAgent ?? "Bunlight/1.0";
		this.#robotsFetchTimeoutMs = config.robotsFetchTimeoutMs ?? 8000;
		this.#robotsCacheTtlMs = config.robotsCacheTtlMs ?? 3600000;
	}

	async acquire(url: string): Promise<void> {
		if (!url || !url.startsWith("http")) return; // skip for invalid urls as per tests

		const u = new URL(url);
		const host = u.hostname;
		const path = u.pathname + u.search;

		const state = this.#getOrCreateState(host);

		if (this.#obeyRobots) {
			const rules = await this.getRobotsRules(host);
			if (!rules.allowed(path)) {
				throw new RateLimitError(`robots.txt disallows crawling ${path} on ${host}`, "disallowed");
			}
			if (rules.crawlDelay && state.lastRequestAt > 0) {
				const waitMs = (rules.crawlDelay * 1000) - (Date.now() - state.lastRequestAt);
				if (waitMs > 0) await Bun.sleep(waitMs);
			}
		}

		// Concurrency limit
		while (this.#activeRequests >= this.#maxConcurrency) {
			await Bun.sleep(100);
		}

		// Sliding window limits (Second & Minute)
		while (true) {
			const now = Date.now();
			this.#cleanState(state, now);

			if (state.requestsInLastSecond.length >= this.#maxRequestsPerSecond) {
				await Bun.sleep(200);
				continue;
			}
			if (state.requestsInLastMinute.length >= this.#maxRequestsPerMinute) {
				await Bun.sleep(1000);
				continue;
			}
			break;
		}

		const now = Date.now();
		state.requestsInLastSecond.push(now);
		state.requestsInLastMinute.push(now);
		state.lastRequestAt = now;
		this.#activeRequests++;
	}

	release(): void {
		this.#activeRequests = Math.max(0, this.#activeRequests - 1);
	}

	#getOrCreateState(host: string): HostState {
		let state = this.#hostStates.get(host);
		if (!state) {
			state = { lastRequestAt: 0, requestsInLastSecond: [], requestsInLastMinute: [] };
			this.#hostStates.set(host, state);
		}
		return state;
	}

	#cleanState(state: HostState, now: number) {
		while (state.requestsInLastSecond.length > 0 && state.requestsInLastSecond[0] < now - 1000) {
			state.requestsInLastSecond.shift();
		}
		while (state.requestsInLastMinute.length > 0 && state.requestsInLastMinute[0] < now - 60000) {
			state.requestsInLastMinute.shift();
		}
	}

	async getRobotsRules(host: string): Promise<RobotRules> {
		const cached = this.#robotsCache.get(host);
		const now = Date.now();
		if (cached && now - cached.fetchedAt < this.#robotsCacheTtlMs) {
			return cached.rules;
		}

		const inflight = this.#robotsFetching.get(host);
		if (inflight) return inflight;

		const fetchPromise = (async () => {
			try {
				const robots = await RobotsFileImpl.fetch(`https://${host}`, {
					userAgent: this.#userAgent,
					timeoutMs: this.#robotsFetchTimeoutMs,
				});
				const rules: RobotRules = {
					crawlDelay: robots.crawlDelay(this.#userAgent),
					allowed: (p: string) => robots.isAllowed(p, this.#userAgent),
				};
				this.#robotsCache.set(host, { rules, fetchedAt: Date.now() });
				return rules;
			} catch {
				const permissive: RobotRules = { allowed: () => true };
				this.#robotsCache.set(host, { rules: permissive, fetchedAt: Date.now() });
				return permissive;
			} finally {
				this.#robotsFetching.delete(host);
			}
		})();

		this.#robotsFetching.set(host, fetchPromise);
		return fetchPromise;
	}

	setRobotsRules(host: string, rules: RobotRules): void {
		this.#robotsCache.set(host, { rules, fetchedAt: Date.now() });
	}

	getHostStats(host: string) {
		const state = this.#hostStates.get(host);
		if (!state) return undefined;
		const now = Date.now();
		this.#cleanState(state, now);
		return {
			requestsInLastSecond: state.requestsInLastSecond.length,
			requestsInLastMinute: state.requestsInLastMinute.length,
			lastRequestAt: state.lastRequestAt,
		};
	}

	reset(): void {
		this.#hostStates.clear();
		this.#activeRequests = 0;
	}

	resetHost(host: string): void {
		this.#hostStates.delete(host);
	}

	clearCache(): void {
		this.#robotsCache.clear();
		this.#robotsFetching.clear();
	}
}
