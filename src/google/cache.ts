/**
 * @module bunlight/google/cache
 *
 * SQLite-backed cache for Google SERP / fetch results with TTL.
 * Uses bun:sqlite (WAL, prepared statements). Lazy-init, file-or-memory.
 */

import { Database } from "bun:sqlite";

export interface CacheEntry<T = unknown> {
	key: string;
	payload: T;
	createdAt: number;
	expiresAt: number;
}

export interface CacheOptions {
	/** Path to sqlite file. Defaults to in-memory. */
	path?: string;
	/** Default TTL in ms. Defaults to 6h. */
	defaultTtlMs?: number;
	/** Cap entries (LRU-style purge). Defaults to 5000. */
	maxEntries?: number;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export class GoogleCache {
	#db: Database;
	#ttl: number;
	#max: number;
	#getStmt: ReturnType<Database["prepare"]>;
	#setStmt: ReturnType<Database["prepare"]>;
	#delStmt: ReturnType<Database["prepare"]>;
	#purgeStmt: ReturnType<Database["prepare"]>;
	#countStmt: ReturnType<Database["prepare"]>;
	#evictStmt: ReturnType<Database["prepare"]>;

	constructor(opts: CacheOptions = {}) {
		this.#db = new Database(opts.path ?? ":memory:", { create: true });
		this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				key TEXT PRIMARY KEY,
				payload TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
		`);
		this.#ttl = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
		this.#max = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

		this.#getStmt = this.#db.prepare(
			"SELECT payload, created_at, expires_at FROM cache WHERE key = ? AND expires_at > ?",
		);
		this.#setStmt = this.#db.prepare(
			"INSERT OR REPLACE INTO cache (key, payload, created_at, expires_at) VALUES (?, ?, ?, ?)",
		);
		this.#delStmt = this.#db.prepare("DELETE FROM cache WHERE key = ?");
		this.#purgeStmt = this.#db.prepare(
			"DELETE FROM cache WHERE expires_at < ?",
		);
		this.#countStmt = this.#db.prepare("SELECT COUNT(*) AS n FROM cache");
		this.#evictStmt = this.#db.prepare(
			"DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY created_at ASC LIMIT ?)",
		);
	}

	get<T>(key: string): T | null {
		const row = this.#getStmt.get(key, Date.now()) as {
			payload: string;
			created_at: number;
			expires_at: number;
		} | null;
		if (!row) return null;
		try {
			return JSON.parse(row.payload) as T;
		} catch {
			return null;
		}
	}

	set<T>(key: string, value: T, ttlMs?: number): void {
		const now = Date.now();
		const expires = now + (ttlMs ?? this.#ttl);
		this.#setStmt.run(key, JSON.stringify(value), now, expires);
		this.#maybeEvict();
	}

	delete(key: string): void {
		this.#delStmt.run(key);
	}

	purgeExpired(): number {
		const res = this.#purgeStmt.run(Date.now());
		return Number(res.changes);
	}

	size(): number {
		const row = this.#countStmt.get() as { n: number };
		return row.n;
	}

	close(): void {
		this.#db.close();
	}

	#maybeEvict(): void {
		const n = this.size();
		if (n <= this.#max) return;
		this.#evictStmt.run(n - this.#max);
	}
}

let _shared: GoogleCache | null = null;

/**
 * Lazy shared in-memory cache instance (created on first call).
 */
export function sharedCache(): GoogleCache {
	if (!_shared) _shared = new GoogleCache();
	return _shared;
}
