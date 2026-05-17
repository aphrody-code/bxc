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

export class BunlightDB {
    private db: Database;

    constructor(path?: string) {
        const dbPath = path ?? Bun.env.BUNLIGHT_DB_PATH ?? resolve(process.cwd(), "data/bunlight.sqlite");

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
    }

    public saveScrape(url: string, profile: string, status: number, content: string, metadata: any) {
        const query = this.db.prepare(`
            INSERT INTO scrapes (url, profile, status, content, metadata)
            VALUES (?, ?, ?, ?, ?)
        `);
        return query.run(url, profile, status, content, JSON.stringify(metadata));
    }

    public getRecentScrapes(limit = 10) {
        return this.db.query("SELECT * FROM scrapes ORDER BY timestamp DESC LIMIT ?").all(limit);
    }

    public close() {
        this.db.close();
    }
}
