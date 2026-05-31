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
 * @module bxc/pool/ProxyPool
 *
 * Proxy rotation with two strategies:
 *
 *   - `round-robin`: every call to `next()` advances the cursor.  Suitable for
 *     bulk fetches where requests are independent.
 *   - `sticky-by-domain`: the first proxy chosen for a hostname is reused for
 *     every subsequent request to the same hostname.  Required when a target
 *     site (e.g. Cloudflare) issues a session cookie tied to the source IP —
 *     rotating proxies mid-session would invalidate the cookie.
 *
 * A lightweight health check marks proxies as down after consecutive failures
 * and skips them until they recover.  Health state is not persisted across
 * processes — call sites that need a quorum should instantiate one
 * `ProxyPool` per worker.
 *
 * @example
 * ```ts
 * const pool = new ProxyPool({
 *   proxies: ["http://u:p@host1:8080", "http://u:p@host2:8080"],
 *   strategy: "sticky-by-domain",
 * });
 * const { url, agent } = pool.next("https://google.com/page");
 * await fetch("https://google.com/page", { proxy: url });
 * ```
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProxyStrategy = "round-robin" | "sticky-by-domain";

export interface ProxyPoolOptions {
	/** Proxy URLs.  Format: `http(s)://[user:pass@]host:port`. */
	proxies: string[];
	/** Selection strategy.  Default: `"round-robin"`. */
	strategy?: ProxyStrategy;
	/**
	 * Number of consecutive failures that disable a proxy.  Default: 3.
	 * Set to `Infinity` to disable health-checking.
	 */
	failureThreshold?: number;
	/**
	 * Time (ms) after which a disabled proxy is given another chance.  Default:
	 * 60_000 (1 minute).
	 */
	cooldownMs?: number;
}

export interface ProxyHandle {
	/** The proxy URL string (suitable for `fetch({ proxy })` or undici Agent). */
	url: string;
	/**
	 * An object usable as the `agent`/`dispatcher` argument to common HTTP
	 * libraries.  In Bun + undici contexts callers typically want to construct
	 * their own — this field carries the URL so it is always available.
	 */
	agent: { url: string };
	/** Internal id (index into the original array) — useful for logging. */
	id: number;
}

/** Snapshot of proxy health. */
export interface ProxyStatus {
	url: string;
	id: number;
	failures: number;
	disabledUntil: number; // ms epoch; 0 means healthy
}

// ---------------------------------------------------------------------------
// ProxyPool
// ---------------------------------------------------------------------------

interface ProxyEntry {
	id: number;
	url: string;
	failures: number;
	disabledUntil: number;
}

export class ProxyPool {
	readonly #entries: ProxyEntry[];
	readonly #strategy: ProxyStrategy;
	readonly #failureThreshold: number;
	readonly #cooldownMs: number;

	#cursor = 0;
	readonly #stickyByHost = new Map<string, number>();

	constructor(opts: ProxyPoolOptions) {
		if (!opts.proxies || opts.proxies.length === 0) {
			throw new Error("ProxyPool: at least one proxy URL is required");
		}
		this.#entries = opts.proxies.map((url, id) => ({
			id,
			url,
			failures: 0,
			disabledUntil: 0,
		}));
		this.#strategy = opts.strategy ?? "round-robin";
		this.#failureThreshold = opts.failureThreshold ?? 3;
		this.#cooldownMs = opts.cooldownMs ?? 60_000;
	}

	/**
	 * Returns the next proxy for the given URL.  Throws if every proxy is
	 * currently disabled and none has cooled down.
	 *
	 * @param targetUrl  Used to derive a sticky key when strategy is
	 *                   `"sticky-by-domain"`.  Pass the request URL.
	 */
	next(targetUrl?: string): ProxyHandle {
		const now = Date.now();
		// Auto-recover proxies whose cooldown has expired.
		for (const e of this.#entries) {
			if (e.disabledUntil !== 0 && e.disabledUntil <= now) {
				e.disabledUntil = 0;
				e.failures = 0;
			}
		}

		if (this.#strategy === "sticky-by-domain") {
			const host = ProxyPool.#hostnameOf(targetUrl);
			if (host) {
				const sticky = this.#stickyByHost.get(host);
				if (sticky !== undefined && this.#isHealthy(this.#entries[sticky])) {
					return this.#toHandle(this.#entries[sticky]);
				}
				const picked = this.#pickHealthy();
				this.#stickyByHost.set(host, picked.id);
				return this.#toHandle(picked);
			}
		}

		const picked = this.#pickHealthy();
		return this.#toHandle(picked);
	}

	/** Records a successful use of `id`.  Resets its failure counter. */
	reportSuccess(id: number): void {
		const e = this.#entries[id];
		if (!e) return;
		e.failures = 0;
		e.disabledUntil = 0;
	}

	/**
	 * Records a failure of `id`.  Disables the proxy when it crosses the
	 * threshold; the caller can pick again from the pool.
	 */
	reportFailure(id: number): void {
		const e = this.#entries[id];
		if (!e) return;
		e.failures++;
		if (e.failures >= this.#failureThreshold) {
			e.disabledUntil = Date.now() + this.#cooldownMs;
		}
	}

	/** Returns a snapshot of every proxy's current health. */
	status(): ProxyStatus[] {
		return this.#entries.map((e) => ({
			url: e.url,
			id: e.id,
			failures: e.failures,
			disabledUntil: e.disabledUntil,
		}));
	}

	/** Number of proxies currently considered healthy. */
	healthyCount(): number {
		return this.#entries.filter((e) => this.#isHealthy(e)).length;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	#pickHealthy(): ProxyEntry {
		const n = this.#entries.length;
		for (let attempts = 0; attempts < n; attempts++) {
			const e = this.#entries[this.#cursor % n];
			this.#cursor = (this.#cursor + 1) % n;
			if (this.#isHealthy(e)) return e;
		}
		// Last-resort: pick the one with the soonest cooldown expiry.
		const sorted = [...this.#entries].sort(
			(a, b) => a.disabledUntil - b.disabledUntil,
		);
		const chosen = sorted[0];
		if (!chosen) throw new Error("ProxyPool: no proxies configured");
		return chosen;
	}

	#isHealthy(e: ProxyEntry): boolean {
		return e.disabledUntil === 0 || e.disabledUntil <= Date.now();
	}

	#toHandle(e: ProxyEntry): ProxyHandle {
		return { id: e.id, url: e.url, agent: { url: e.url } };
	}

	static #hostnameOf(u: string | undefined): string | null {
		if (!u) return null;
		try {
			return new URL(u).hostname;
		} catch {
			return null;
		}
	}
}
