/**
 * Cache SQLite intelligent pour IETV
 *
 * Tables:
 *   - channels (source, title, description, totalEpisodes, lastScrape)
 *   - seasons (channel_id, season, totalEpisodes)
 *   - episodes (channel_id, season, episode, videoId, title, url, description,
 *     thumbnail, publishDate, viewCount, language, duration, quality)
 *   - search_index (videoId, title_fts) pour recherche rapide
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChannelInfo, VideoRef } from "./index";

/** `VideoRef` tel que stocké en cache : le nom de chaîne d'origine en plus. */
export type CachedVideoRef = VideoRef & { channel?: string };

/** Filtres acceptés par {@link IETVCache.search}. */
export interface CacheSearchQuery {
	q?: string;
	season?: number;
	episode?: number;
	language?: "vf" | "vostfr";
	channel?: string;
	limit?: number;
}

/** Compteurs renvoyés par {@link IETVCache.getStats}. */
export interface CacheStats {
	channels: number;
	seasons: number;
	episodes: number;
	byLanguage: Record<string, number>;
	lastUpdate: number;
}

/**
 * Étend un `~` de tête sans passer par `process.env.HOME`, qui n'existe pas
 * sous Windows (`os.homedir()` y lit `USERPROFILE`).
 */
export function expandHome(input: string): string {
	if (input !== "~" && !input.startsWith("~/") && !input.startsWith("~\\")) {
		return input;
	}
	const rest = input.slice(1).replace(/^[\\/]/, "");
	return rest ? join(homedir(), ...rest.split(/[\\/]/)) : homedir();
}

/** Chemin par défaut du catalogue SQLite, valide sur les trois plateformes. */
export function defaultCachePath(): string {
	const fromEnv = (process.env.IETV_CACHE_PATH ?? "").trim();
	if (fromEnv !== "") return expandHome(fromEnv);
	return join(homedir(), ".cache", "ietv", "episodes.db");
}

export class IETVCache {
	private db: Database;
	private dbPath: string;

	constructor(dbPath: string = defaultCachePath()) {
		this.dbPath = expandHome(dbPath);
		// `dirname` plutôt que `lastIndexOf("/")` : sous Windows le chemin est
		// séparé par `\\` et l'ancien calcul renvoyait `mkdirSync("")`.
		const dir = dirname(this.dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(this.dbPath, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA cache_size = -64000");
		this.initSchema();
	}

	private initSchema() {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT UNIQUE NOT NULL,
        title TEXT,
        description TEXT,
        avatar TEXT,
        totalEpisodes INTEGER DEFAULT 0,
        lastScrape INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
        updatedAt INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
      );

      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        name TEXT,
        totalEpisodes INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
        FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
        UNIQUE(channel_id, season)
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        videoId TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        thumbnail TEXT,
        titleJp TEXT,
        romaji TEXT,
        publishDate TEXT,
        viewCount TEXT,
        language TEXT CHECK(language IN ('vf', 'vostfr', 'unknown')),
        duration INTEGER,
        quality TEXT,
        createdAt INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
        FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
        UNIQUE(channel_id, season, episode, language)
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expiresAt INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_channel ON episodes(channel_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season);
      CREATE INDEX IF NOT EXISTS idx_episodes_language ON episodes(language);
      CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title COLLATE NOCASE);
    `);

		this.migrateSchema();
	}

	/**
	 * Ajoute les colonnes manquantes sur une base créée par une version
	 * antérieure — `CREATE TABLE IF NOT EXISTS` ne met pas à jour un schéma
	 * existant.
	 */
	private migrateSchema() {
		const addColumn = (table: string, column: string, type: string) => {
			const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
				name: string;
			}[];
			if (!cols.some((c) => c.name === column)) {
				this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
			}
		};

		addColumn("channels", "avatar", "TEXT");
		addColumn("seasons", "name", "TEXT");
		addColumn("episodes", "titleJp", "TEXT");
		addColumn("episodes", "romaji", "TEXT");
		addColumn("episodes", "description", "TEXT");
		addColumn("episodes", "publishDate", "TEXT");
		addColumn("episodes", "viewCount", "TEXT");
	}

	// =========================================================================
	// Channel operations
	// =========================================================================

	saveChannel(info: ChannelInfo) {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channels (channel, title, description, avatar, totalEpisodes, lastScrape, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

		const now = Date.now();
		stmt.run(
			info.channel,
			info.title,
			info.description || null,
			info.avatar || null,
			info.totalEpisodes,
			now,
			now
		);

		const channelId = this.db
			.prepare("SELECT id FROM channels WHERE channel = ?")
			.get(info.channel) as { id: number };

		// Save seasons
		for (const season of info.seasons) {
			this.db
				.prepare(
					"INSERT OR REPLACE INTO seasons (channel_id, season, name, totalEpisodes) VALUES (?, ?, ?, ?)"
				)
				.run(channelId.id, season.season, season.name ?? null, season.totalEpisodes);

			// Save episodes
			for (const ep of season.episodes) {
				this.db
					.prepare(
						`INSERT OR REPLACE INTO episodes
           (channel_id, season, episode, videoId, title, url, description, thumbnail,
            titleJp, romaji, publishDate, viewCount, language, duration, quality)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run(
						channelId.id,
						season.season,
						ep.episode,
						ep.videoId,
						ep.title,
						ep.url,
						ep.description || null,
						ep.thumbnail || null,
						ep.titleJp || null,
						ep.romaji || null,
						ep.publishDate || null,
						ep.viewCount || null,
						ep.language,
						ep.duration ?? null,
						ep.quality || null
					);
			}
		}
	}

	getChannel(channel: string): ChannelInfo | null {
		const ch = this.db
			.prepare(
				"SELECT id, channel, title, description, avatar, totalEpisodes FROM channels WHERE channel = ?"
			)
			.get(channel) as any;

		if (!ch) return null;

		const seasons = this.db
			.prepare(
				"SELECT season, name, totalEpisodes FROM seasons WHERE channel_id = ? ORDER BY season"
			)
			.all(ch.id) as any[];

		const result: ChannelInfo = {
			channel: ch.channel,
			title: ch.title,
			description: ch.description,
			avatar: ch.avatar,
			totalEpisodes: ch.totalEpisodes,
			seasons: seasons.map((s) => ({
				season: s.season,
				name: s.name ?? null,
				totalEpisodes: s.totalEpisodes,
				episodes: this.getEpisodesBySeason(ch.id, s.season),
			})),
		};

		return result;
	}

	getAllChannels(): ChannelInfo[] {
		const channels = this.db
			.prepare(
				"SELECT id, channel, title, description, avatar, totalEpisodes FROM channels ORDER BY channel"
			)
			.all() as any[];

		return channels.map((ch) => {
			const seasons = this.db
				.prepare(
					"SELECT season, name, totalEpisodes FROM seasons WHERE channel_id = ? ORDER BY season"
				)
				.all(ch.id) as any[];

			return {
				channel: ch.channel,
				title: ch.title,
				description: ch.description,
				avatar: ch.avatar,
				totalEpisodes: ch.totalEpisodes,
				seasons: seasons.map((s) => ({
					season: s.season,
					name: s.name ?? null,
					totalEpisodes: s.totalEpisodes,
					episodes: this.getEpisodesBySeason(ch.id, s.season),
				})),
			};
		});
	}

	// =========================================================================
	// Episode operations
	// =========================================================================

	private getEpisodesBySeason(channelId: number, season: number): VideoRef[] {
		return (
			this.db
				.prepare(
					`SELECT videoId, season, episode, title, url, description, thumbnail,
                titleJp, romaji, publishDate, viewCount, language, duration, quality
         FROM episodes WHERE channel_id = ? AND season = ? ORDER BY episode`
				)
				.all(channelId, season) as any[]
		).map((ep) => ({
			videoId: ep.videoId,
			title: ep.title,
			url: ep.url,
			description: ep.description ?? null,
			season: ep.season,
			episode: ep.episode,
			thumbnail: ep.thumbnail ?? null,
			titleJp: ep.titleJp ?? null,
			romaji: ep.romaji ?? null,
			publishDate: ep.publishDate ?? null,
			viewCount: ep.viewCount ?? null,
			language: ep.language,
			duration: ep.duration ?? null,
			quality: ep.quality ?? null,
		}));
	}

	search(query: CacheSearchQuery): CachedVideoRef[] {
		let sql = `
      SELECT DISTINCT e.videoId, e.season, e.episode, e.title, e.url, e.description, e.thumbnail,
             e.titleJp, e.romaji, e.publishDate, e.viewCount, e.language, e.duration, e.quality,
             c.channel, c.title as channel_title
      FROM episodes e
      JOIN channels c ON e.channel_id = c.id
      WHERE 1=1
    `;

		const params: any[] = [];

		if (query.q) {
			sql += ` AND (e.title LIKE ? OR c.title LIKE ?)`;
			const q = `%${query.q}%`;
			params.push(q, q);
		}
		if (query.season) {
			sql += ` AND e.season = ?`;
			params.push(query.season);
		}
		if (query.episode) {
			sql += ` AND e.episode = ?`;
			params.push(query.episode);
		}
		if (query.language) {
			sql += ` AND e.language = ?`;
			params.push(query.language);
		}
		if (query.channel) {
			sql += ` AND c.channel = ?`;
			params.push(query.channel);
		}

		sql += ` ORDER BY e.season DESC, e.episode DESC`;
		if (query.limit) {
			sql += ` LIMIT ?`;
			params.push(query.limit);
		}

		return (this.db.prepare(sql).all(...params) as any[]).map((ep) => ({
			videoId: ep.videoId,
			title: ep.title,
			url: ep.url,
			description: ep.description ?? null,
			season: ep.season,
			episode: ep.episode,
			thumbnail: ep.thumbnail ?? null,
			titleJp: ep.titleJp ?? null,
			romaji: ep.romaji ?? null,
			publishDate: ep.publishDate ?? null,
			viewCount: ep.viewCount ?? null,
			language: ep.language,
			duration: ep.duration ?? null,
			quality: ep.quality ?? null,
			channel: ep.channel,
		}));
	}

	// =========================================================================
	// Statistics
	// =========================================================================

	getStats(): CacheStats {
		const channels = this.db.prepare("SELECT COUNT(*) as count FROM channels").get() as any;
		const seasons = this.db.prepare("SELECT COUNT(*) as count FROM seasons").get() as any;
		const episodes = this.db.prepare("SELECT COUNT(*) as count FROM episodes").get() as any;
		const byLanguage = this.db
			.prepare(
				"SELECT language, COUNT(*) as count FROM episodes GROUP BY language ORDER BY language"
			)
			.all() as any[];

		const lastUpdate = this.db
			.prepare("SELECT MAX(lastScrape) as lastScrape FROM channels")
			.get() as any;

		return {
			channels: channels.count || 0,
			seasons: seasons.count || 0,
			episodes: episodes.count || 0,
			byLanguage: byLanguage.reduce<Record<string, number>>((acc, row) => {
				acc[row.language] = row.count;
				return acc;
			}, {}),
			lastUpdate: lastUpdate.lastScrape || 0,
		};
	}

	// =========================================================================
	// Metadata (cache expiration)
	// =========================================================================

	setMetadata(key: string, value: string, ttlMs?: number) {
		const expiresAt = ttlMs ? Date.now() + ttlMs : null;
		this.db
			.prepare("INSERT OR REPLACE INTO metadata (key, value, expiresAt) VALUES (?, ?, ?)")
			.run(key, value, expiresAt);
	}

	getMetadata(key: string): string | null {
		const row = this.db
			.prepare("SELECT value, expiresAt FROM metadata WHERE key = ?")
			.get(key) as any;

		if (!row) return null;
		if (row.expiresAt && row.expiresAt < Date.now()) {
			this.db.prepare("DELETE FROM metadata WHERE key = ?").run(key);
			return null;
		}

		return row.value;
	}

	// =========================================================================
	// Cleanup
	// =========================================================================

	clearExpired() {
		this.db.prepare("DELETE FROM metadata WHERE expiresAt IS NOT NULL AND expiresAt < ?").run(
			Date.now()
		);
	}

	clear() {
		this.db.exec("DELETE FROM episodes; DELETE FROM seasons; DELETE FROM channels;");
	}

	close() {
		this.db.close();
	}
}
