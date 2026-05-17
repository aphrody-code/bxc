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
 * @module bunlight/google/rate-limit
 *
 * Specialized rate limiting and backoff for Google domains.
 */

import {
	type RateLimitConfig,
	RateLimiter,
} from "../throttling/RateLimiter.ts";

/**
 * Google-specific rate limiter.
 * Extends the generic limiter with predefined defaults for Google domains
 * and improved detection of 429 Retry-After.
 */
export class GoogleRateLimiter extends RateLimiter {
	constructor(config: RateLimitConfig = {}) {
		super({
			maxRequestsPerSecond: config.maxRequestsPerSecond ?? 2, // Google is sensitive
			maxRequestsPerMinute: config.maxRequestsPerMinute ?? 60,
			respectRobotsTxt: config.respectRobotsTxt ?? true,
			userAgent:
				config.userAgent ??
				"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", // Sometimes helps
			...config,
		});
	}

	/**
	 * Detect if a response indicates a Google rate limit.
	 */
	static isRateLimited(status: number, headers: Headers): boolean {
		if (status === 429) return true;

		// Google sometimes sends 403 for rate limits
		if (status === 403 && headers.get("x-google-gfe-request-trace")) {
			return true;
		}

		return false;
	}

	/**
	 * Get the suggested wait time from Google headers.
	 */
	static getRetryAfterMs(headers: Headers): number | null {
		const retryAfter = headers.get("retry-after");
		if (!retryAfter) return null;

		const seconds = Number.parseInt(retryAfter, 10);
		if (!Number.isNaN(seconds)) {
			return seconds * 1000;
		}

		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) {
			return Math.max(0, date - Date.now());
		}

		return null;
	}
}

/**
 * Adaptive token-bucket limiter — tunes its rate based on the most recent
 * Google response. Halves the budget on 429/403, restores by 10% on each
 * successful 200. Lock-free, single-instance per host.
 */
export class AdaptiveTokenBucket {
	#capacity: number;
	#tokens: number;
	#refillRate: number;
	#lastRefill: number;
	#minRate: number;
	#maxRate: number;

	constructor(
		opts: {
			capacity?: number;
			refillPerSec?: number;
			minRate?: number;
			maxRate?: number;
		} = {},
	) {
		this.#capacity = opts.capacity ?? 10;
		this.#refillRate = opts.refillPerSec ?? 2;
		this.#minRate = opts.minRate ?? 0.25;
		this.#maxRate = opts.maxRate ?? 10;
		this.#tokens = this.#capacity;
		this.#lastRefill = Date.now();
	}

	#refill(): void {
		const now = Date.now();
		const elapsed = (now - this.#lastRefill) / 1000;
		this.#tokens = Math.min(
			this.#capacity,
			this.#tokens + elapsed * this.#refillRate,
		);
		this.#lastRefill = now;
	}

	/** Block (await) until at least one token is available, then consume it. */
	async acquire(): Promise<void> {
		this.#refill();
		while (this.#tokens < 1) {
			const waitMs = Math.max(
				50,
				((1 - this.#tokens) / this.#refillRate) * 1000,
			);
			// Add 10-20% jitter
			const jitter = 1 + Math.random() * 0.2;
			await Bun.sleep(waitMs * jitter);
			this.#refill();
		}
		this.#tokens -= 1;
	}

	/** Update internal rate based on the latest response status. */
	observe(status: number): void {
		if (status === 429 || status === 503) {
			this.#refillRate = Math.max(this.#minRate, this.#refillRate / 2);
			this.#tokens = 0;
		} else if (status === 403) {
			this.#refillRate = Math.max(this.#minRate, this.#refillRate * 0.7);
		} else if (status >= 200 && status < 300) {
			this.#refillRate = Math.min(this.#maxRate, this.#refillRate * 1.1);
		}
	}

	get currentRate(): number {
		return this.#refillRate;
	}
}
