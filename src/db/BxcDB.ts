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

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export class BxcDB {
	private db: Database;

	constructor(path?: string) {
		const dbPath =
			path ?? Bun.env.BXC_DB_PATH ?? resolve(process.cwd(), "data/bxc.sqlite");

		// Ensure directory exists
		const dir = resolve(dbPath, "..");
		mkdirSync(dir, { recursive: true });

		this.db = new Database(dbPath);

		// --- Optimisations Production/VPS ---
		// 1. WAL Mode (Write-Ahead Logging) : lecture et écriture concurrentes sans blocage.
		this.db.exec("PRAGMA journal_mode = WAL;");
		// 2. Synchronous Normal : bon équilibre entre performance et sécurité (réduit les fsync).
		this.db.exec("PRAGMA synchronous = NORMAL;");
		// 3. Busy Timeout : évite les erreurs "database is locked" en attendant 5s si occupé.
		this.db.exec("PRAGMA busy_timeout = 5000;");
		// 4. Cache Size : 2000 pages (~8MB de RAM pour le cache).
		this.db.exec("PRAGMA cache_size = -2000;");

		this.initSchema();
	}

	private initSchema() {
		this.db.exec(`
            CREATE TABLE IF NOT EXISTS scrapes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                profile TEXT NOT NULL,
                status INTEGER,
                content TEXT,
                metadata TEXT, -- JSON
                markdown TEXT,
                json_data TEXT, -- JSON
                openapi_spec TEXT, -- JSON
                vector TEXT, -- JSON Float Array
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS cookie_jars (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL, -- JSON
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_scrapes_url ON scrapes(url);
            CREATE INDEX IF NOT EXISTS idx_scrapes_timestamp ON scrapes(timestamp);
        `);

		// Migration: alter table to add columns if they do not exist
		try {
			this.db.exec("ALTER TABLE scrapes ADD COLUMN markdown TEXT;");
		} catch {}
		try {
			this.db.exec("ALTER TABLE scrapes ADD COLUMN json_data TEXT;");
		} catch {}
		try {
			this.db.exec("ALTER TABLE scrapes ADD COLUMN openapi_spec TEXT;");
		} catch {}
		try {
			this.db.exec("ALTER TABLE scrapes ADD COLUMN vector TEXT;");
		} catch {}

		// FTS5 Virtual Table & Triggers setup
		try {
			this.db.exec(`
				CREATE VIRTUAL TABLE IF NOT EXISTS scrapes_fts USING fts5(url, title, markdown);
				
				CREATE TRIGGER IF NOT EXISTS after_scrapes_insert AFTER INSERT ON scrapes BEGIN
					INSERT INTO scrapes_fts(rowid, url, title, markdown)
					VALUES (new.id, new.url, coalesce(json_extract(new.metadata, '$.title'), ''), coalesce(new.markdown, ''));
				END;

				CREATE TRIGGER IF NOT EXISTS after_scrapes_delete AFTER DELETE ON scrapes BEGIN
					DELETE FROM scrapes_fts WHERE rowid = old.id;
				END;

				CREATE TRIGGER IF NOT EXISTS after_scrapes_update AFTER UPDATE ON scrapes BEGIN
					DELETE FROM scrapes_fts WHERE rowid = old.id;
					INSERT INTO scrapes_fts(rowid, url, title, markdown)
					VALUES (new.id, new.url, coalesce(json_extract(new.metadata, '$.title'), ''), coalesce(new.markdown, ''));
				END;
			`);

			// Backfill existing data if FTS table is empty
			const count = this.db.query("SELECT COUNT(*) as cnt FROM scrapes_fts").get() as any;
			if (count && count.cnt === 0) {
				this.db.exec(`
					INSERT INTO scrapes_fts(rowid, url, title, markdown)
					SELECT id, url, coalesce(json_extract(metadata, '$.title'), ''), coalesce(markdown, '') FROM scrapes;
				`);
			}
		} catch (err) {
			console.error("[db-fts] Failed to initialize FTS5 index and triggers:", err);
		}
	}

	public saveScrape(
		url: string,
		profile: string,
		status: number,
		content: string,
		metadata: any,
		markdown?: string,
		jsonData?: any,
		openapiSpec?: any,
		vector?: number[],
	) {
		const query = this.db.prepare(`
            INSERT INTO scrapes (url, profile, status, content, metadata, markdown, json_data, openapi_spec, vector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
		return query.run(
			url,
			profile,
			status,
			content,
			JSON.stringify(metadata),
			markdown ?? null,
			jsonData ? JSON.stringify(jsonData) : null,
			openapiSpec ? JSON.stringify(openapiSpec) : null,
			vector ? JSON.stringify(vector) : null,
		);
	}

	public getRecentScrapes(limit = 10) {
		return this.db
			.query("SELECT * FROM scrapes ORDER BY timestamp DESC LIMIT ?")
			.all(limit);
	}

	public getScrapeByUrl(url: string) {
		return this.db
			.query("SELECT * FROM scrapes WHERE url = ? ORDER BY timestamp DESC LIMIT 1")
			.get(url) as any;
	}

	public getAllScrapesWithVectors() {
		return this.db
			.query("SELECT url, metadata, markdown, vector FROM scrapes WHERE vector IS NOT NULL")
			.all() as any[];
	}

	public searchFullText(queryStr: string, limit = 10) {
		const sanitized = queryStr.replace(/[^\w\s]/g, " ").trim();
		if (!sanitized) return [];
		try {
			return this.db
				.query(`
					SELECT s.id, s.url, s.profile, s.status, s.metadata, s.markdown, s.timestamp, fts.rank
					FROM scrapes s
					JOIN scrapes_fts fts ON s.id = fts.rowid
					WHERE scrapes_fts MATCH ?
					ORDER BY rank
					LIMIT ?
				`)
				.all(sanitized, limit) as any[];
		} catch (err) {
			console.error("[db-fts] FTS query failed, falling back to LIKE:", err);
			return this.db
				.query(`
					SELECT id, url, profile, status, metadata, markdown, timestamp, 0.0 as rank
					FROM scrapes
					WHERE url LIKE ? OR markdown LIKE ?
					ORDER BY timestamp DESC
					LIMIT ?
				`)
				.all(`%${queryStr}%`, `%${queryStr}%`, limit) as any[];
		}
	}

	public close() {
		this.db.close();
	}
}
