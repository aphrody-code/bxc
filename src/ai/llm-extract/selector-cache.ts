// SQLite-backed cache for LLM-generated CSS selector maps, keyed by
// (hostname, schema-fingerprint). One LLM call per (site, schema) pair —
// every subsequent page reuses the cached selectors and runs through Zig DOM
// natively.
//
// Pattern mirrors `src/google/cache.ts` (bun:sqlite, WAL, prepared stmts).

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { SelectorMap } from "./selector-extract.ts";

export interface SelectorCacheOptions {
	readonly path?: string;
	readonly ttlMs?: number;
	readonly maxEntries?: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX = 5000;

interface Row {
	readonly key: string;
	readonly selectors: string;
	readonly hits: number;
}

export class SelectorCache {
	readonly #db: Database;
	readonly #ttl: number;
	readonly #max: number;
	readonly #getStmt: ReturnType<Database["prepare"]>;
	readonly #setStmt: ReturnType<Database["prepare"]>;
	readonly #hitStmt: ReturnType<Database["prepare"]>;
	readonly #countStmt: ReturnType<Database["prepare"]>;
	readonly #evictStmt: ReturnType<Database["prepare"]>;

	constructor(opts: SelectorCacheOptions = {}) {
		const path = opts.path ?? this.#defaultPath();
		this.#db = new Database(path, { create: true, strict: true });
		this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS selector_cache (
				key TEXT PRIMARY KEY,
				selectors TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS idx_sc_expires ON selector_cache(expires_at);
		`);
		this.#ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.#max = opts.maxEntries ?? DEFAULT_MAX;
		this.#getStmt = this.#db.prepare(
			"SELECT selectors, hits FROM selector_cache WHERE key = $key AND expires_at > $now",
		);
		this.#setStmt = this.#db.prepare(
			"INSERT OR REPLACE INTO selector_cache (key, selectors, created_at, expires_at, hits) VALUES ($key, $selectors, $created, $expires, 0)",
		);
		this.#hitStmt = this.#db.prepare(
			"UPDATE selector_cache SET hits = hits + 1 WHERE key = $key",
		);
		this.#countStmt = this.#db.prepare(
			"SELECT COUNT(*) AS n FROM selector_cache",
		);
		this.#evictStmt = this.#db.prepare(
			"DELETE FROM selector_cache WHERE key IN (SELECT key FROM selector_cache ORDER BY hits ASC, created_at ASC LIMIT $limit)",
		);
	}

	#defaultPath(): string {
		const home = Bun.env.HOME ?? "/tmp";
		const dir = join(home, ".bxc");
		try {
			mkdirSync(dir, { recursive: true });
		} catch {
			/* swallow — path will be opened in-memory if needed */
		}
		return join(dir, "selector-cache.sqlite");
	}

	get(key: string): SelectorMap | null {
		const row = this.#getStmt.get({ key, now: Date.now() }) as Pick<
			Row,
			"selectors" | "hits"
		> | null;
		if (!row) return null;
		this.#hitStmt.run({ key });
		try {
			return JSON.parse(row.selectors) as SelectorMap;
		} catch {
			return null;
		}
	}

	set(key: string, selectors: SelectorMap, ttlMs?: number): void {
		const now = Date.now();
		this.#setStmt.run({
			key,
			selectors: JSON.stringify(selectors),
			created: now,
			expires: now + (ttlMs ?? this.#ttl),
		});
		this.#maybeEvict();
	}

	size(): number {
		return (this.#countStmt.get() as { n: number }).n;
	}

	close(): void {
		this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
		this.#db.close();
	}

	#maybeEvict(): void {
		const n = this.size();
		if (n <= this.#max) return;
		this.#evictStmt.run({ $limit: n - this.#max });
	}
}

let _shared: SelectorCache | null = null;
export function sharedSelectorCache(): SelectorCache {
	if (!_shared) _shared = new SelectorCache();
	return _shared;
}

/**
 * Stable, fast cache key: hostname + 64-bit hash of the schema fields.
 * Uses Bun.hash (xxHash3, no `node:crypto`).
 */
export function cacheKey(
	url: string,
	schemaFields: ReadonlyArray<string>,
): string {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		host = "_";
	}
	const fp = Bun.hash(JSON.stringify([...schemaFields].sort())).toString(36);
	return `${host}::${fp}`;
}
