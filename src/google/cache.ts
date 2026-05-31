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
 * @module bxc/google/cache
 *
 * Reinforced SQLite-backed cache for Google SERP / fetch results.
 *
 * Features:
 * - High-performance Bun native SQLite driver (Zig-powered).
 * - WAL (Write-Ahead Logging) enabled for concurrent read/write.
 * - Native BLOB support for binary snapshots (compressed HTML/images).
 * - Strict parameter binding.
 * - Automatic eviction (LRU-ish based on creation time).
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface CacheOptions {
	/**
	 * Path to sqlite file.
	 * Defaults to `~/.bxc/cache.sqlite` or `:memory:`.
	 */
	path?: string;
	/** Default TTL in ms. Defaults to 24h. */
	defaultTtlMs?: number;
	/** Cap entries (LRU-style purge). Defaults to 10000. */
	maxEntries?: number;
	/** Enable strict mode for binding. */
	strict?: boolean;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10000;

import { getCacheFile } from "../utils/paths.ts";

export class GoogleCache {
	readonly #db: Database;
	readonly #ttl: number;
	readonly #max: number;

	// Prepared statements for maximum speed (compiled once)
	readonly #getStmt: any;
	readonly #setStmt: any;
	readonly #delStmt: any;
	readonly #purgeStmt: any;
	readonly #countStmt: any;
	readonly #evictStmt: any;

	constructor(opts: CacheOptions = {}) {
		let dbPath = opts.path;

		if (!dbPath) {
			try {
				dbPath = getCacheFile("cache.sqlite");
			} catch {
				dbPath = ":memory:";
			}
		}

		this.#db = new Database(dbPath ?? ":memory:", {
			create: true,
			strict: opts.strict ?? true,
		});

		// WAL mode is crucial for performance on VPS with multiple workers
		this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				key TEXT PRIMARY KEY,
				payload BLOB NOT NULL,
				is_json INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
		`);

		this.#ttl = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
		this.#max = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

		this.#getStmt = this.#db.prepare(
			"SELECT payload, is_json FROM cache WHERE key = ? AND expires_at > ?",
		);
		this.#setStmt = this.#db.prepare(
			"INSERT OR REPLACE INTO cache (key, payload, is_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
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

	/**
	 * Retrieve a value from the cache.
	 * Handles both JSON objects and raw Uint8Array (BLOB).
	 */
	get<T>(key: string): T | null {
		const row = this.#getStmt.get(key, Date.now()) as {
			payload: Uint8Array | string;
			is_json: number;
		} | null;

		if (!row) return null;

		if (row.is_json === 1) {
			try {
				// Bun handles Uint8Array -> string conversion efficiently
				const text =
					typeof row.payload === "string"
						? row.payload
						: new TextDecoder().decode(row.payload);
				return JSON.parse(text) as T;
			} catch {
				return null;
			}
		}

		return row.payload as unknown as T;
	}

	/**
	 * Store a value in the cache with an optional TTL.
	 * Automatically detects if the value should be stored as JSON or raw BLOB.
	 */
	set<T>(key: string, value: T, ttlMs?: number): void {
		const now = Date.now();
		const expires = now + (ttlMs ?? this.#ttl);

		let payload: Uint8Array | string;
		let isJson = 0;

		if (value instanceof Uint8Array) {
			payload = value;
		} else if (typeof value === "string") {
			payload = value;
		} else {
			payload = JSON.stringify(value);
			isJson = 1;
		}

		this.#setStmt.run(key, payload, isJson, now, expires);

		this.#maybeEvict();
	}

	delete(key: string): void {
		this.#delStmt.run(key);
	}

	/**
	 * Remove all expired entries. Returns number of removed rows.
	 */
	purgeExpired(): number {
		const res = this.#purgeStmt.run(Date.now());
		return res.changes;
	}

	/**
	 * Returns the current number of entries in the cache.
	 */
	size(): number {
		const row = this.#countStmt.get() as { n: number };
		return row.n;
	}

	/**
	 * Force a WAL checkpoint and close the database.
	 */
	close(): void {
		this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
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
 * Global reinforced cache instance for the Bxc process.
 */
export function sharedCache(): GoogleCache {
	if (!_shared) _shared = new GoogleCache();
	return _shared;
}
