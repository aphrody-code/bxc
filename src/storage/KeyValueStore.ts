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
 * @module bxc/storage/KeyValueStore
 *
 * Persistent key-value store with dual backing:
 *  - Small values (< `inlineThresholdBytes`): stored in `bun:sqlite` for fast
 *    random access.
 *  - Large values (>= `inlineThresholdBytes`): stored as individual files in a
 *    subdirectory, with the SQLite row pointing to the file path.
 *
 * Inspired by Crawlee's KeyValueStore
 * (packages/core/src/storages/key_value_store.ts) but rewritten Bun-native:
 *  - `bun:sqlite` instead of fs readFile/writeFile loops.
 *  - `Bun.write` for atomic file writes (sendfile-optimized).
 *  - `Bun.file().arrayBuffer()` for reading blobs.
 *  - No external dependencies.
 *
 * Typical uses in a crawler:
 *  - Persist crawler input / output JSON (`INPUT`, `OUTPUT` keys).
 *  - Store screenshots as binary blobs.
 *  - Cache intermediate state for crash recovery.
 *  - Store per-domain metadata.
 *
 * @example
 * ```ts
 * const kv = KeyValueStore.open("./storage/kv/default.db");
 *
 * // Store JSON (auto-serialized)
 * await kv.set("config", { maxPages: 100, timeout: 30 });
 *
 * // Retrieve
 * const cfg = await kv.get<{ maxPages: number }>("config");
 *
 * // Store binary (screenshot)
 * const png = await Bun.file("screenshot.png").arrayBuffer();
 * await kv.setBytes("screenshot-home", new Uint8Array(png), "image/png");
 *
 * // List all keys
 * const keys = kv.listKeys();
 *
 * kv.close();
 * ```
 */

import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyValueStoreOptions {
	/**
	 * Values smaller than this (in bytes) are stored inline in SQLite.
	 * Larger values are stored as files in `<dbDir>/blobs/<key>`.
	 * Default: 65_536 (64 KiB).
	 */
	inlineThresholdBytes?: number;
}

export interface KVEntry {
	key: string;
	contentType: string;
	size: number;
	createdAt: number;
	updatedAt: number;
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS kv_store (
  key           TEXT    PRIMARY KEY NOT NULL,
  content_type  TEXT    NOT NULL DEFAULT 'application/octet-stream',
  value_inline  BLOB,
  value_path    TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
`;

// ---------------------------------------------------------------------------
// KeyValueStore
// ---------------------------------------------------------------------------

export class KeyValueStore {
	readonly #db: Database;
	readonly #blobDir: string;
	readonly #inlineThreshold: number;

	// Prepared statements
	readonly #stmtUpsert: ReturnType<Database["prepare"]>;
	readonly #stmtGet: ReturnType<Database["prepare"]>;
	readonly #stmtDelete: ReturnType<Database["prepare"]>;
	readonly #stmtList: ReturnType<Database["prepare"]>;
	readonly #stmtHas: ReturnType<Database["prepare"]>;

	private constructor(dbPath: string, opts: KeyValueStoreOptions = {}) {
		this.#inlineThreshold = opts.inlineThresholdBytes ?? 65_536;
		this.#blobDir = join(dirname(dbPath), "blobs");

		this.#db = new Database(dbPath, { create: true });
		this.#db.exec(DDL);

		this.#stmtUpsert = this.#db.prepare(`
      INSERT INTO kv_store (key, content_type, value_inline, value_path, size, created_at, updated_at)
      VALUES ($key, $contentType, $inline, $path, $size, $now, $now)
      ON CONFLICT(key) DO UPDATE SET
        content_type  = excluded.content_type,
        value_inline  = excluded.value_inline,
        value_path    = excluded.value_path,
        size          = excluded.size,
        updated_at    = excluded.updated_at
    `);

		this.#stmtGet = this.#db.prepare(`
      SELECT key, content_type, value_inline, value_path, size, created_at, updated_at
      FROM kv_store WHERE key = $key
    `);

		this.#stmtDelete = this.#db.prepare(`
      DELETE FROM kv_store WHERE key = $key
      RETURNING value_path
    `);

		this.#stmtList = this.#db.prepare(`
      SELECT key, content_type, size, created_at, updated_at FROM kv_store
      ORDER BY key ASC
    `);

		this.#stmtHas = this.#db.prepare(`
      SELECT 1 FROM kv_store WHERE key = $key LIMIT 1
    `);
	}

	// ---------------------------------------------------------------------------
	// Factory
	// ---------------------------------------------------------------------------

	/**
	 * Open (or create) a key-value store at the given SQLite path.
	 * Large-value blobs are stored in `<dirname(dbPath)>/blobs/`.
	 */
	static open(dbPath: string, opts?: KeyValueStoreOptions): KeyValueStore {
		return new KeyValueStore(dbPath, opts);
	}

	// ---------------------------------------------------------------------------
	// Write
	// ---------------------------------------------------------------------------

	/**
	 * Store a JSON-serializable value under `key`.
	 * The value is serialized to UTF-8 JSON and stored according to size policy.
	 */
	async set<T>(
		key: string,
		value: T,
		contentType = "application/json",
	): Promise<void> {
		const serialized = JSON.stringify(value);
		const bytes = new TextEncoder().encode(serialized);
		await this.#store(key, bytes, contentType);
	}

	/**
	 * Store raw bytes under `key`.
	 * Useful for screenshots, PDFs, or any binary data.
	 */
	async setBytes(
		key: string,
		data: Uint8Array,
		contentType = "application/octet-stream",
	): Promise<void> {
		await this.#store(key, data, contentType);
	}

	/**
	 * Store a plain string under `key`.
	 */
	async setText(
		key: string,
		text: string,
		contentType = "text/plain; charset=utf-8",
	): Promise<void> {
		const bytes = new TextEncoder().encode(text);
		await this.#store(key, bytes, contentType);
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	/**
	 * Retrieve a previously stored JSON value.
	 * Returns `undefined` if the key does not exist.
	 */
	async get<T = unknown>(key: string): Promise<T | undefined> {
		const bytes = await this.#load(key);
		if (bytes === undefined) return undefined;
		return JSON.parse(new TextDecoder().decode(bytes)) as T;
	}

	/**
	 * Retrieve raw bytes for `key`.
	 * Returns `undefined` if the key does not exist.
	 */
	async getBytes(key: string): Promise<Uint8Array | undefined> {
		return this.#load(key);
	}

	/**
	 * Retrieve a string value for `key`.
	 * Returns `undefined` if the key does not exist.
	 */
	async getText(key: string): Promise<string | undefined> {
		const bytes = await this.#load(key);
		if (bytes === undefined) return undefined;
		return new TextDecoder().decode(bytes);
	}

	/** Return `true` if `key` exists in the store. */
	has(key: string): boolean {
		return this.#stmtHas.get({ $key: key }) !== null;
	}

	// ---------------------------------------------------------------------------
	// Delete / list
	// ---------------------------------------------------------------------------

	/**
	 * Delete `key` from the store.
	 * If the value was stored as a file, the file is removed too.
	 * Returns `true` if the key existed.
	 */
	async delete(key: string): Promise<boolean> {
		const rows = this.#stmtDelete.all({ $key: key }) as Array<{
			value_path: string | null;
		}>;
		if (rows.length === 0) return false;
		const row = rows[0];
		if (row.value_path !== null) {
			// Remove the blob file (best-effort, don't throw)
			try {
				if (await Bun.file(row.value_path).exists())
					await Bun.write(row.value_path, new Uint8Array(0));
			} catch {
				/* ignore */
			}
		}
		return true;
	}

	/**
	 * List metadata for all stored keys.
	 */
	listKeys(): KVEntry[] {
		return (
			this.#stmtList.all() as Array<{
				key: string;
				content_type: string;
				size: number;
				created_at: number;
				updated_at: number;
			}>
		).map((r) => ({
			key: r.key,
			contentType: r.content_type,
			size: r.size,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	/** Close the underlying SQLite connection. */
	close(): void {
		this.#db.close();
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	async #store(
		key: string,
		data: Uint8Array,
		contentType: string,
	): Promise<void> {
		const now = Date.now();
		const size = data.byteLength;

		if (size < this.#inlineThreshold) {
			// Inline in SQLite
			this.#stmtUpsert.run({
				$key: key,
				$contentType: contentType,
				$inline: data,
				$path: null,
				$size: size,
				$now: now,
			});
		} else {
			// Write to blob file
			const blobPath = join(this.#blobDir, sanitizeKey(key));
			await Bun.write(blobPath, data);
			this.#stmtUpsert.run({
				$key: key,
				$contentType: contentType,
				$inline: null,
				$path: blobPath,
				$size: size,
				$now: now,
			});
		}
	}

	async #load(key: string): Promise<Uint8Array | undefined> {
		const row = this.#stmtGet.get({ $key: key }) as {
			value_inline: Uint8Array | null;
			value_path: string | null;
		} | null;

		if (row === null) return undefined;

		if (row.value_inline !== null) {
			return row.value_inline instanceof Uint8Array
				? row.value_inline
				: new Uint8Array(row.value_inline);
		}

		if (row.value_path !== null) {
			const buf = await Bun.file(row.value_path).arrayBuffer();
			return new Uint8Array(buf);
		}

		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an arbitrary key to a safe filename (preserves readability). */
function sanitizeKey(key: string): string {
	return key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
