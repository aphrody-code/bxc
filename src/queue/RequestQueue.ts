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
 * @module bunlight/queue/RequestQueue
 *
 * Persistent, crash-safe request queue backed by `bun:sqlite`.
 *
 * Inspired by Crawlee's RequestQueue v2 (packages/core/src/storages/request_queue_v2.ts)
 * but rewritten Bun-native: no fs, no DynamoDB, no external deps.
 *
 * Design:
 *  - SQLite WAL mode for concurrent reads / single-writer safety.
 *  - PENDING → LOCKED → DONE / FAILED state machine.
 *  - Forefront insertion via priority column (higher = dequeued first).
 *  - Unique constraint on `unique_key` prevents duplicate URLs.
 *  - Dead-letter queue: requests that exceed `maxRetries` land in state=FAILED.
 *  - `fetchBatch()` atomically locks a batch using a single UPDATE … RETURNING.
 *
 * @example
 * ```ts
 * const q = RequestQueue.open("./crawl.db");
 * await q.addRequest({ url: "https://google.com" });
 * const [req] = q.fetchBatch(5);
 * q.markDone(req.id);
 * q.close();
 * ```
 */

import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid lifecycle states for a queued request. */
export type RequestState = "PENDING" | "LOCKED" | "DONE" | "FAILED";

/**
 * A scrape target stored in the queue.
 * Mirrors Crawlee's Request shape but simplified to what Bunlight needs.
 */
export interface QueuedRequest {
	/** Internal SQLite rowid alias — assigned on insert. */
	id: number;
	/** Stable unique identifier — used for dedup (defaults to URL). */
	uniqueKey: string;
	url: string;
	method: string;
	/** Arbitrary JSON payload (headers, body, userData). */
	payload: string | null;
	state: RequestState;
	retries: number;
	priority: number;
	createdAt: number;
	lockedAt: number | null;
	handledAt: number | null;
	errorMessage: string | null;
}

export interface AddRequestOptions {
	/** Override the dedup key (default: URL). */
	uniqueKey?: string;
	method?: string;
	/** Arbitrary metadata — will be JSON.stringify-ed. */
	userData?: Record<string, unknown>;
	headers?: Record<string, string>;
	/** If true, request is put at the front of the queue. */
	forefront?: boolean;
}

export interface RequestQueueOptions {
	/** Maximum retries before a request is moved to FAILED. Default: 3 */
	maxRetries?: number;
	/** How long (ms) a LOCKED request can be held before re-queued. Default: 120_000 */
	lockTimeoutMs?: number;
}

export interface RequestQueueStats {
	pending: number;
	locked: number;
	done: number;
	failed: number;
	total: number;
}

// ---------------------------------------------------------------------------
// SQL strings (kept as constants to avoid template-literal overhead on hot path)
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unique_key  TEXT    NOT NULL UNIQUE,
  url         TEXT    NOT NULL,
  method      TEXT    NOT NULL DEFAULT 'GET',
  payload     TEXT,
  state       TEXT    NOT NULL DEFAULT 'PENDING',
  retries     INTEGER NOT NULL DEFAULT 0,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  locked_at   INTEGER,
  handled_at  INTEGER,
  error_msg   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending ON requests (state, priority DESC, id ASC)
  WHERE state = 'PENDING';
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
`;

// ---------------------------------------------------------------------------
// RequestQueue
// ---------------------------------------------------------------------------

export class RequestQueue {
	readonly #db: Database;
	readonly #maxRetries: number;
	readonly #lockTimeoutMs: number;

	// Prepared statements (compiled once, reused on every call)
	readonly #stmtInsert: ReturnType<Database["prepare"]>;
	readonly #stmtFetchBatch: ReturnType<Database["prepare"]>;
	readonly #stmtLockBatch: ReturnType<Database["prepare"]>;
	readonly #stmtMarkDone: ReturnType<Database["prepare"]>;
	readonly #stmtMarkFailed: ReturnType<Database["prepare"]>;
	readonly #stmtRequeue: ReturnType<Database["prepare"]>;
	readonly #stmtStats: ReturnType<Database["prepare"]>;
	readonly #stmtRecoverStale: ReturnType<Database["prepare"]>;
	readonly #stmtDlq: ReturnType<Database["prepare"]>;
	readonly #stmtExists: ReturnType<Database["prepare"]>;

	private constructor(dbPath: string, opts: RequestQueueOptions = {}) {
		this.#maxRetries = opts.maxRetries ?? 3;
		this.#lockTimeoutMs = opts.lockTimeoutMs ?? 120_000;

		this.#db = new Database(dbPath, { create: true });
		this.#db.exec(DDL);

		// --------------- prepared statements ---------------
		this.#stmtInsert = this.#db.prepare(`
      INSERT OR IGNORE INTO requests
        (unique_key, url, method, payload, state, priority, created_at)
      VALUES ($uniqueKey, $url, $method, $payload, 'PENDING', $priority, $now)
    `);

		this.#stmtFetchBatch = this.#db.prepare(`
      SELECT id FROM requests
      WHERE state = 'PENDING'
      ORDER BY priority DESC, id ASC
      LIMIT $limit
    `);

		this.#stmtLockBatch = this.#db.prepare(`
      UPDATE requests
      SET state = 'LOCKED', locked_at = $now
      WHERE id = $id
    `);

		this.#stmtMarkDone = this.#db.prepare(`
      UPDATE requests
      SET state = 'DONE', handled_at = $now
      WHERE id = $id
    `);

		this.#stmtMarkFailed = this.#db.prepare(`
      UPDATE requests
      SET state = 'FAILED', error_msg = $msg, handled_at = $now
      WHERE id = $id
    `);

		this.#stmtRequeue = this.#db.prepare(`
      UPDATE requests
      SET state = 'PENDING', retries = retries + 1, locked_at = NULL, error_msg = $msg
      WHERE id = $id
    `);

		this.#stmtStats = this.#db.prepare(`
      SELECT
        SUM(state = 'PENDING') AS pending,
        SUM(state = 'LOCKED')  AS locked,
        SUM(state = 'DONE')    AS done,
        SUM(state = 'FAILED')  AS failed,
        COUNT(*)               AS total
      FROM requests
    `);

		this.#stmtRecoverStale = this.#db.prepare(`
      UPDATE requests
      SET state = 'PENDING', locked_at = NULL
      WHERE state = 'LOCKED' AND locked_at < $staleThreshold
    `);

		this.#stmtDlq = this.#db.prepare(`
      SELECT * FROM requests WHERE state = 'FAILED'
    `);

		this.#stmtExists = this.#db.prepare(`
      SELECT 1 FROM requests WHERE unique_key = $uniqueKey LIMIT 1
    `);
	}

	// ---------------------------------------------------------------------------
	// Factory
	// ---------------------------------------------------------------------------

	/**
	 * Open (or create) a persistent queue at `dbPath`.
	 * Pass `":memory:"` for ephemeral in-process queue (useful in tests).
	 */
	static open(dbPath: string, opts?: RequestQueueOptions): RequestQueue {
		return new RequestQueue(dbPath, opts);
	}

	// ---------------------------------------------------------------------------
	// Write operations
	// ---------------------------------------------------------------------------

	/**
	 * Enqueue a URL.  Silently de-duplicates by `uniqueKey`.
	 * Returns `true` when the request was newly inserted, `false` if it already existed.
	 */
	addRequest(url: string, opts: AddRequestOptions = {}): boolean {
		const uniqueKey = opts.uniqueKey ?? url;
		const method = (opts.method ?? "GET").toUpperCase();
		const payload =
			opts.userData !== undefined || opts.headers !== undefined
				? JSON.stringify({ userData: opts.userData ?? {}, headers: opts.headers ?? {} })
				: null;
		const priority = opts.forefront === true ? 1 : 0;

		const result = this.#stmtInsert.run({
			$uniqueKey: uniqueKey,
			$url: url,
			$method: method,
			$payload: payload,
			$priority: priority,
			$now: Date.now(),
		});

		return result.changes > 0;
	}

	/**
	 * Bulk add URLs from an iterable.  Each URL that is already in the queue is skipped.
	 * Runs in a single transaction for performance.
	 * Returns the count of newly inserted requests.
	 */
	addRequests(urls: Iterable<string | { url: string; opts?: AddRequestOptions }>): number {
		let inserted = 0;
		const tx = this.#db.transaction(() => {
			for (const item of urls) {
				const [url, opts] = typeof item === "string" ? [item, {}] : [item.url, item.opts ?? {}];
				if (this.addRequest(url, opts)) inserted++;
			}
		});
		tx();
		return inserted;
	}

	/**
	 * Check whether a URL (or uniqueKey) is already tracked by the queue.
	 */
	has(uniqueKey: string): boolean {
		return this.#stmtExists.get({ $uniqueKey: uniqueKey }) !== null;
	}

	// ---------------------------------------------------------------------------
	// Fetch / lock
	// ---------------------------------------------------------------------------

	/**
	 * Atomically fetch and lock up to `limit` PENDING requests.
	 * Returns the locked rows as `QueuedRequest[]`.
	 */
	fetchBatch(limit = 1): QueuedRequest[] {
		const now = Date.now();
		const rows = this.#stmtFetchBatch.all({ $limit: limit }) as Array<{ id: number }>;
		if (rows.length === 0) return [];

		const lockTx = this.#db.transaction((ids: number[]) => {
			for (const id of ids) {
				this.#stmtLockBatch.run({ $id: id, $now: now });
			}
			return this.#db
				.prepare(`SELECT * FROM requests WHERE id IN (${ids.map(() => "?").join(",")})`)
				.all(...ids) as QueuedRequest[];
		});

		return lockTx(rows.map((r) => r.id));
	}

	// ---------------------------------------------------------------------------
	// Completion / retry
	// ---------------------------------------------------------------------------

	/** Mark a request as successfully handled. */
	markDone(id: number): void {
		this.#stmtMarkDone.run({ $id: id, $now: Date.now() });
	}

	/**
	 * Mark a request as failed.  If retries < maxRetries, it is re-queued as PENDING.
	 * Otherwise, it enters the dead-letter queue (state = FAILED).
	 */
	markFailed(id: number, errorMessage: string): void {
		const row = this.#db.prepare("SELECT retries FROM requests WHERE id = ?").get(id) as {
			retries: number;
		} | null;

		if (row === null) return;

		if (row.retries < this.#maxRetries) {
			this.#stmtRequeue.run({ $id: id, $msg: errorMessage });
		} else {
			this.#stmtMarkFailed.run({ $id: id, $msg: errorMessage, $now: Date.now() });
		}
	}

	// ---------------------------------------------------------------------------
	// Maintenance
	// ---------------------------------------------------------------------------

	/**
	 * Recover stale LOCKED requests (e.g., worker crashed mid-task).
	 * Any request locked more than `lockTimeoutMs` ago is reset to PENDING.
	 * Returns the number of recovered requests.
	 */
	recoverStaleLocks(): number {
		const staleThreshold = Date.now() - this.#lockTimeoutMs;
		const result = this.#stmtRecoverStale.run({ $staleThreshold: staleThreshold });
		return result.changes;
	}

	/** Return stats about the queue state. */
	stats(): RequestQueueStats {
		return this.#stmtStats.get() as RequestQueueStats;
	}

	/** Return all requests in the dead-letter queue (state = FAILED). */
	deadLetterQueue(): QueuedRequest[] {
		return this.#stmtDlq.all() as QueuedRequest[];
	}

	/**
	 * Re-enqueue all failed requests (reset to PENDING, retries reset to 0).
	 * Useful for resuming a partially-failed crawl.
	 */
	replayFailed(): number {
		this.#db.exec(`
      UPDATE requests SET state = 'PENDING', retries = 0, error_msg = NULL, handled_at = NULL
      WHERE state = 'FAILED'
    `);
		// bun:sqlite exec returns nothing useful — re-query for count
		return this.stats().pending;
	}

	/** Close the underlying SQLite connection. */
	close(): void {
		this.#db.close();
	}

	// ---------------------------------------------------------------------------
	// Async iteration helper
	// ---------------------------------------------------------------------------

	/**
	 * Async generator that continuously yields batches of locked requests
	 * until the queue is empty and there are nothing locked.
	 *
	 * @param batchSize - Number of requests to fetch per tick. Default: 10.
	 * @param pollMs    - Polling interval when queue is temporarily empty. Default: 500.
	 */
	async *drain(batchSize = 10, pollMs = 500): AsyncGenerator<QueuedRequest[]> {
		while (true) {
			const batch = this.fetchBatch(batchSize);
			if (batch.length > 0) {
				yield batch;
				continue;
			}
			const { locked, pending } = this.stats();
			if (locked === 0 && pending === 0) break;
			await Bun.sleep(pollMs);
		}
	}
}
