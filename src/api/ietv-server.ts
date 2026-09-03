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
 * IETV REST API Server — Bun native HTTP server pour intégration bot/web/mobile/Tauri
 *
 * Endpoints:
 *   GET  /api/ietv/health                    — Health check
 *   GET  /api/ietv/channels                  — Liste des sources
 *   GET  /api/ietv/channels/:source          — Episodes d'une source (YouTube, official, pluto)
 *   GET  /api/ietv/all                       — Tous les épisodes (toutes sources)
 *   GET  /api/ietv/search?q=term&lang=vf    — Recherche par titre/saison/langue
 *   GET  /api/ietv/stats                     — Statistiques scraping
 */

import IETVScraper, { type ChannelInfo, type ScrapingStats } from "@aphrody/ietv";
import { defaultCachePath, IETVCache } from "@aphrody/ietv/cache";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

interface IETVServerConfig {
	port?: number;
	host?: string;
	cacheEnabled?: boolean;
	corsOrigins?: string[];
	cachePath?: string;
}

interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
	stats?: Partial<ScrapingStats>;
	timestamp: number;
}

interface SearchQuery {
	q?: string;
	season?: number;
	episode?: number;
	lang?: "vf" | "vostfr" | "unknown";
	source?: string;
	limit?: number;
}

// ============================================================================
// Layer de cache en mémoire (pour requêtes fréquentes)
// ============================================================================

class RequestCache<T> {
	private cache = new Map<string, { data: T; expiry: number }>();

	set(key: string, value: T, ttlMs = 60000): void {
		this.cache.set(key, {
			data: value,
			expiry: Date.now() + ttlMs,
		});
	}

	get(key: string): T | null {
		const item = this.cache.get(key);
		if (!item) return null;
		if (Date.now() > item.expiry) {
			this.cache.delete(key);
			return null;
		}
		return item.data;
	}

	clear(): void {
		this.cache.clear();
	}
}

// ============================================================================
// IETV REST Server
// ============================================================================

export class IETVRestServer {
	private scraper: IETVScraper;
	private sqliteCache: IETVCache;
	private requestCache: RequestCache<any>;
	private config: Required<IETVServerConfig>;
	private lastScrapeTime = 0;

	constructor(config: IETVServerConfig = {}) {
		this.scraper = new IETVScraper();
		const cachePath = config.cachePath ?? defaultCachePath();
		this.sqliteCache = new IETVCache(cachePath);
		this.requestCache = new RequestCache();
		this.config = {
			port: config.port ?? 3000,
			host: config.host ?? "0.0.0.0",
			cacheEnabled: config.cacheEnabled ?? true,
			corsOrigins: config.corsOrigins ?? ["*"],
			cachePath,
		};
	}

	/**
	 * Démarrer le serveur HTTP (Bun native).
	 */
	async start(): Promise<void> {
		const server = Bun.serve({
			port: this.config.port,
			hostname: this.config.host,
			fetch: (req) => this.handleRequest(req),
		});

		console.log(`[IETV API] Listening on http://${this.config.host}:${this.config.port}`);
		return new Promise(() => {}); // Never resolves
	}

	/**
	 * Handler principal des requêtes HTTP.
	 */
	private async handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname;
		const method = req.method;

		// CORS
		if (method === "OPTIONS") {
			return this.corsResponse();
		}

		// Routes
		if (path === "/api/ietv/health") {
			return this.handleHealth();
		} else if (path === "/api/ietv/channels") {
			return this.handleChannels();
		} else if (path.startsWith("/api/ietv/channels/")) {
			const source = path.replace("/api/ietv/channels/", "");
			return this.handleChannelSource(source);
		} else if (path === "/api/ietv/all") {
			return this.handleAll();
		} else if (path === "/api/ietv/search") {
			const params = Object.fromEntries(url.searchParams) as SearchQuery;
			return this.handleSearch(params);
		} else if (path === "/api/ietv/stats") {
			return this.handleStats();
		} else {
			return this.jsonResponse({ success: false, error: "Not found" }, 404);
		}
	}

	/**
	 * GET /api/ietv/health
	 */
	private handleHealth(): Response {
		return this.jsonResponse({
			success: true,
			data: {
				status: "ok",
				version: "1.0.0",
				uptime: process.uptime(),
			},
		});
	}

	/**
	 * GET /api/ietv/channels
	 */
	private handleChannels(): Response {
		return this.jsonResponse({
			success: true,
			data: {
				channels: [
					{ id: "youtube-france1", name: "@inazumaelevenfrance1", type: "youtube" },
					{ id: "youtube-tvfr", name: "@inazumatvfr", type: "youtube" },
					{ id: "youtube-go", name: "@inazumaelevengofrance", type: "youtube" },
					{ id: "youtube-tvfr2", name: "@InazumaTVFR__", type: "youtube" },
					{ id: "official", name: "inazuma-eleven.fr", type: "official" },
					{ id: "pluto-no", name: "Pluto.tv (NO)", type: "pluto" },
					{ id: "pluto-fr", name: "Pluto.tv (FR)", type: "pluto" },
				],
			},
		});
	}

	/**
	 * GET /api/ietv/channels/:source
	 */
	private async handleChannelSource(source: string): Promise<Response> {
		const cacheKey = `channel-${source}`;

		// L1: Check in-memory cache (60s)
		const cached = this.requestCache.get(cacheKey);
		if (cached) return this.jsonResponse({ success: true, data: cached });

		// L2: Check SQLite cache
		const sqliteCached = this.sqliteCache.getChannel(source);
		if (sqliteCached && this.config.cacheEnabled) {
			this.requestCache.set(cacheKey, sqliteCached, 60000); // 1m request cache
			return this.jsonResponse({ success: true, data: sqliteCached });
		}

		try {
			let data: ChannelInfo;

			if (source === "official") {
				data = await this.scraper.scrapeOfficialSite();
			} else if (source.startsWith("pluto-")) {
				const region = source.replace("pluto-", "");
				data = await this.scraper.scrapePlutuTv(region);
			} else if (source.startsWith("youtube-")) {
				const handle = source.replace("youtube-", "").replace(/-/g, "");
				data = await this.scraper.getChannelEpisodes(handle);
			} else {
				return this.jsonResponse({ success: false, error: "Unknown source" }, 400);
			}

			// Persist to SQLite
			if (this.config.cacheEnabled) {
				this.sqliteCache.saveChannel(data);
				this.requestCache.set(cacheKey, data, 60000);
			}

			this.lastScrapeTime = Date.now();
			return this.jsonResponse({ success: true, data });
		} catch (err) {
			return this.jsonResponse(
				{ success: false, error: String(err) },
				500,
			);
		}
	}

	/**
	 * GET /api/ietv/all (toutes sources parallèle)
	 */
	private async handleAll(): Promise<Response> {
		const cacheKey = "all-episodes";

		// L1: Check in-memory cache (60s)
		const cached = this.requestCache.get(cacheKey);
		if (cached) return this.jsonResponse({ success: true, data: cached });

		// L2: Check SQLite cache
		if (this.config.cacheEnabled) {
			const sqliteCached = this.sqliteCache.getAllChannels();
			if (sqliteCached.length > 0) {
				const response = {
					channels: sqliteCached,
					totalChannels: sqliteCached.length,
					totalEpisodes: sqliteCached.reduce((sum, ch) => sum + ch.totalEpisodes, 0),
					elapsedMs: 0,
					fromCache: true,
				};
				this.requestCache.set(cacheKey, response, 60000);
				return this.jsonResponse({ success: true, data: response });
			}
		}

		try {
			const startTime = Date.now();
			const data = await this.scraper.getAllChannelEpisodes();
			const elapsedMs = Date.now() - startTime;
			const stats = this.scraper.getStats();

			// Save to SQLite
			for (const channel of data) {
				this.sqliteCache.saveChannel(channel);
			}

			const response = {
				channels: data,
				totalChannels: data.length,
				totalEpisodes: data.reduce((sum, ch) => sum + ch.totalEpisodes, 0),
				elapsedMs,
				fromCache: false,
			};

			if (this.config.cacheEnabled) {
				this.requestCache.set(cacheKey, response, 60000);
			}

			this.lastScrapeTime = Date.now();
			return this.jsonResponse({ success: true, data: response, stats });
		} catch (err) {
			return this.jsonResponse(
				{ success: false, error: String(err) },
				500,
			);
		}
	}

	/**
	 * GET /api/ietv/search?q=term&lang=vf&season=1
	 * Utilise SQLite pour des requêtes rapides + pas de scrape live
	 */
	private handleSearch(params: SearchQuery): Response {
		const { q, season, episode, lang, source, limit = 100 } = params;

		if (!q && !season && !episode && !lang && !source) {
			return this.jsonResponse(
				{ success: false, error: "Provide q, season, episode, lang, or source" },
				400,
			);
		}

		try {
			// Query SQLite cache (zero scraping)
			const results = this.sqliteCache.search({
				q,
				season: season ? Number(season) : undefined,
				episode: episode ? Number(episode) : undefined,
				language: lang === "vf" || lang === "vostfr" ? lang : undefined,
				channel: source,
				limit: Number(limit),
			});

			return this.jsonResponse({
				success: true,
				data: {
					results,
					count: results.length,
					fromCache: true,
					queryParams: { q, season, episode, lang, source, limit },
				},
			});
		} catch (err) {
			return this.jsonResponse({ success: false, error: String(err) }, 500);
		}
	}

	/**
	 * GET /api/ietv/stats
	 * Retourne les stats du scraper + cache SQLite
	 */
	private handleStats(): Response {
		const stats = this.scraper.getStats();
		const cacheStats = this.sqliteCache.getStats();

		return this.jsonResponse({
			success: true,
			data: {
				...stats,
				cache: cacheStats,
				lastScrapeTime: this.lastScrapeTime,
				cacheEnabled: this.config.cacheEnabled,
				cachePath: this.config.cachePath,
			},
		});
	}

	// ========================================================================
	// Helpers
	// ========================================================================

	private jsonResponse<T>(
		body: Omit<ApiResponse<T>, "timestamp">,
		status = 200
	): Response {
		const data: ApiResponse<T> = { ...body, timestamp: Date.now() };
		return new Response(JSON.stringify(data), {
			status,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": this.config.corsOrigins.join(", "),
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Cache-Control": "public, max-age=3600",
			},
		});
	}

	private corsResponse(): Response {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			},
		});
	}

	async close(): Promise<void> {
		await this.scraper.close();
		this.sqliteCache.close();
		this.requestCache.clear();
	}
}

// ============================================================================
// CLI
// ============================================================================

if (import.meta.main) {
	const server = new IETVRestServer({
		port: parseInt(process.env.PORT || "3000", 10),
		host: process.env.HOST || "0.0.0.0",
		cacheEnabled: process.env.CACHE !== "false",
	});

	await server.start();
}

export default IETVRestServer;
