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
 * @module bxc/pool/PagePool
 *
 * High-throughput page pool with bounded concurrency, page reuse (LRU
 * eviction), and back-pressured task scheduling.
 *
 * The pool wraps `Browser.newPage()` so callers get the right transport for
 * their profile (`static`, `fast`, `stealth`, `max`) without managing the
 * lifecycle themselves.
 *
 * @example
 * ```ts
 * import { PagePool } from "bxc/pool/PagePool";
 *
 * const pool = new PagePool({ profile: "fast", concurrency: 50, maxPages: 25 });
 * const results = await pool.run(urls, async (page, url) => {
 *   await page.goto(url);
 *   return page.title();
 * });
 * await pool.close();
 * ```
 */

import { Browser, type Page, type PageOptions } from "../api/browser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PagePoolOptions {
	/** Bxc profile to use for newly-created pages.  Default: `"static"`. */
	profile?: PageOptions["profile"];
	/**
	 * Maximum number of tasks running in parallel.  Acts as a semaphore so
	 * callers can flood `run()` with thousands of items without exhausting fds
	 * or RAM.  Default: 16.
	 */
	concurrency?: number;
	/**
	 * Maximum number of live `Page` objects kept in the pool for reuse.  When a
	 * task completes and the pool is over this size, the LRU page is closed.
	 * Default: 50.
	 */
	maxPages?: number;
	/**
	 * Forwarded to `Browser.newPage()` for every page created by the pool.
	 * Useful for `viewport`, `userAgent`, `spawnOpts`, etc.
	 */
	pageOptions?: Omit<PageOptions, "profile">;
}

/** Snapshot of pool counters. */
export interface PagePoolStats {
	active: number;
	queued: number;
	completed: number;
	failed: number;
	idle: number;
}

/**
 * Worker function executed for each input.  Receives a fresh-or-recycled
 * `Page` and the input value.  Throwing is fine — the pool will record a
 * failure and return the error object in the results array.
 */
export type PageTask<I, O> = (page: Page, input: I) => Promise<O>;

/** Result of a single task — `value` on success, `error` on failure. */
export type PageResult<O> = { ok: true; value: O } | { ok: false; error: Error };

// ---------------------------------------------------------------------------
// Internal worker queue (no external dep, p-queue-style).
// ---------------------------------------------------------------------------

interface Waiter {
	resolve: () => void;
}

class Semaphore {
	#available: number;
	#waiters: Waiter[] = [];

	constructor(permits: number) {
		this.#available = permits;
	}

	async acquire(): Promise<void> {
		if (this.#available > 0) {
			this.#available--;
			return;
		}
		await new Promise<void>((resolve) => {
			this.#waiters.push({ resolve });
		});
		this.#available--;
	}

	release(): void {
		this.#available++;
		const next = this.#waiters.shift();
		if (next) next.resolve();
	}
}

// ---------------------------------------------------------------------------
// PagePool
// ---------------------------------------------------------------------------

/**
 * Bounded-concurrency, page-reusing executor for crawl-style workloads.
 *
 * Lifecycle:
 *   1. `new PagePool({ profile, concurrency, maxPages })`
 *   2. `await pool.run(inputs, fn)` — drains all inputs through `fn`.
 *   3. `await pool.close()` — closes every cached page.
 */
export class PagePool {
	readonly #profile: PageOptions["profile"];
	readonly #concurrency: number;
	readonly #maxPages: number;
	readonly #pageOptions: Omit<PageOptions, "profile">;

	readonly #sem: Semaphore;

	/** Pages available for reuse, ordered LRU (oldest first). */
	readonly #idle: Page[] = [];
	/** Pages currently leased to a task. */
	readonly #leased = new Set<Page>();

	#completed = 0;
	#failed = 0;
	#queued = 0;
	#closed = false;

	constructor(opts: PagePoolOptions = {}) {
		this.#profile = opts.profile ?? "static";
		this.#concurrency = Math.max(1, opts.concurrency ?? 16);
		this.#maxPages = Math.max(1, opts.maxPages ?? 50);
		this.#pageOptions = opts.pageOptions ?? {};
		this.#sem = new Semaphore(this.#concurrency);
	}

	/** Snapshot of internal counters. */
	stats(): PagePoolStats {
		return {
			active: this.#leased.size,
			queued: this.#queued,
			completed: this.#completed,
			failed: this.#failed,
			idle: this.#idle.length,
		};
	}

	/**
	 * Drains `inputs` through `task`, returning results in the same order as
	 * the input array.  Each result is wrapped in `PageResult<O>` so a failing
	 * task does not abort the whole batch.
	 */
	async run<I, O>(inputs: readonly I[], task: PageTask<I, O>): Promise<PageResult<O>[]> {
		if (this.#closed) throw new Error("PagePool is closed");
		const results: PageResult<O>[] = Array.from({ length: inputs.length });
		
        let i = 0;
        for await (const result of this.runStream(inputs, task)) {
            results[i++] = result;
        }

		return results;
	}

    /**
     * Drains `inputs` through `task` as an async generator.
     * Yields results as soon as they are available, maintaining input order
     * via an internal re-sequencing buffer.
     */
    async *runStream<I, O>(inputs: readonly I[], task: PageTask<I, O>): AsyncGenerator<PageResult<O>> {
        if (this.#closed) throw new Error("PagePool is closed");
        this.#queued += inputs.length;

        const results = new Map<number, PageResult<O>>();
        let nextIndex = 0;
        
        // We use a helper promise to catch errors from the background tasks
        let backgroundError: Error | null = null;

        const launches = inputs.map(async (input, i) => {
            try {
                await this.#sem.acquire();
                if (this.#closed) throw new Error("Pool closed during task");
                
                this.#queued--;
                let page: Page | null = null;
                try {
                    page = await this.#acquirePage();
                    const value = await task(page, input);
                    results.set(i, { ok: true, value });
                    this.#completed++;
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    results.set(i, { ok: false, error });
                    this.#failed++;
                } finally {
                    if (page) this.#releasePage(page);
                    this.#sem.release();
                }
            } catch (e) {
                backgroundError = e instanceof Error ? e : new Error(String(e));
            }
        });

        // Loop until all inputs are processed and yielded
        while (nextIndex < inputs.length) {
            if (backgroundError) throw backgroundError;

            if (results.has(nextIndex)) {
                yield results.get(nextIndex)!;
                results.delete(nextIndex);
                nextIndex++;
            } else {
                // Wait for any task to finish before checking again
                await Promise.race(launches.slice(nextIndex, nextIndex + this.#concurrency));
                // Small sleep to prevent tight loop if race resolves but index isn't ready
                await Bun.sleep(0);
            }
        }
    }

	/**
	 * Convenience: like `run` but throws on the first failure and returns a
	 * plain array of results.
	 */
	async runStrict<I, O>(inputs: readonly I[], task: PageTask<I, O>): Promise<O[]> {
		const results = await this.run(inputs, task);
		const out: O[] = [];
		for (let i = 0; i < results.length; i++) {
			const r = results[i];
			if (!r.ok) throw (r as { ok: false; error: Error }).error;
			out.push(r.value);
		}
		return out;
	}

	/** Closes every cached page and prevents further `run()` calls. */
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const all = [...this.#idle, ...this.#leased];
		this.#idle.length = 0;
		this.#leased.clear();
		await Promise.all(all.map((p) => p.close().catch(() => undefined)));
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	async #acquirePage(): Promise<Page> {
		const idle = this.#idle.shift();
		if (idle) {
			this.#leased.add(idle);
			return idle;
		}
		// Cast: PagePool only supports static/fast/http profiles that return Page.
		// stealth/max profiles should use openStealthBrowser/openMaxBrowser directly.
		const page = (await Browser.newPage({
			profile: this.#profile,
			...this.#pageOptions,
		})) as Page;
		this.#leased.add(page);
		return page;
	}

	#releasePage(page: Page): void {
		this.#leased.delete(page);
		if (this.#closed) {
			page.close().catch(() => undefined);
			return;
		}
		this.#idle.push(page);
		// LRU eviction: trim the oldest pages if we exceed the cap.
		while (this.#idle.length > this.#maxPages) {
			const evict = this.#idle.shift();
			evict?.close().catch(() => undefined);
		}
	}
}
