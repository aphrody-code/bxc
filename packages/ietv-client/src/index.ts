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
 * @module ietv-client
 *
 * Client universel pour API IETV REST
 * Utilisable dans: Discord bot, site web, app mobile, Tauri desktop
 */

export type LanguageVersion = "vf" | "vostfr" | "unknown";

export interface VideoRef {
	title: string;
	videoId: string;
	url: string;
	description: string | null;
	thumbnail: string | null;
	publishDate: string | null;
	season: number | null;
	episode: number | null;
	language: LanguageVersion;
	duration: number | null;
	viewCount: string | null;
}

export interface SeasonInfo {
	season: number;
	episodes: VideoRef[];
	totalEpisodes: number;
}

export interface ChannelInfo {
	channel: string;
	title: string | null;
	description: string | null;
	avatar: string | null;
	seasons: SeasonInfo[];
	totalEpisodes: number;
}

export interface ClientConfig {
	baseUrl?: string;
	timeout?: number;
	retries?: number;
	cache?: boolean;
}

export class IETVClient {
	private baseUrl: string;
	private timeout: number;
	private retries: number;
	private cache = new Map<string, { data: any; expiry: number }>();

	constructor(config: ClientConfig = {}) {
		this.baseUrl = config.baseUrl ?? "http://localhost:3000";
		this.timeout = config.timeout ?? 30000;
		this.retries = config.retries ?? 2;
	}

	/**
	 * Health check
	 */
	async health(): Promise<{ status: string; version: string; uptime: number }> {
		return this.request("/api/ietv/health");
	}

	/**
	 * Get list of available channels/sources
	 */
	async channels(): Promise<
		Array<{ id: string; name: string; type: string }>
	> {
		const res = await this.request("/api/ietv/channels");
		return res.channels;
	}

	/**
	 * Get episodes from a specific channel
	 */
	async channel(source: string): Promise<ChannelInfo> {
		return this.request(`/api/ietv/channels/${source}`);
	}

	/**
	 * Get all episodes from all sources (parallel)
	 */
	async all(): Promise<{
		channels: ChannelInfo[];
		totalChannels: number;
		totalEpisodes: number;
		elapsedMs: number;
	}> {
		return this.request("/api/ietv/all");
	}

	/**
	 * Search episodes
	 */
	async search(query: {
		q?: string;
		season?: number;
		episode?: number;
		lang?: LanguageVersion;
		source?: string;
		limit?: number;
	}): Promise<{ results: any[]; count: number }> {
		const params = new URLSearchParams();
		if (query.q) params.append("q", query.q);
		if (query.season) params.append("season", String(query.season));
		if (query.episode) params.append("episode", String(query.episode));
		if (query.lang) params.append("lang", query.lang);
		if (query.source) params.append("source", query.source);
		if (query.limit) params.append("limit", String(query.limit));

		return this.request(`/api/ietv/search?${params}`);
	}

	/**
	 * Get scraping statistics
	 */
	async stats(): Promise<any> {
		return this.request("/api/ietv/stats");
	}

	/**
	 * Make API request with retry + cache
	 */
	private async request(path: string): Promise<any> {
		const cacheKey = path;
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() < cached.expiry) {
			return cached.data;
		}

		let lastErr: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), this.timeout);

				const res = await fetch(`${this.baseUrl}${path}`, {
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}

				const json = await res.json();
				if (!json.success) {
					throw new Error(json.error || "Unknown error");
				}

				// Cache for 1 hour
				this.cache.set(cacheKey, {
					data: json.data,
					expiry: Date.now() + 3600000,
				});

				return json.data;
			} catch (err) {
				lastErr = err;
				if (attempt < this.retries) {
					await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
				}
			}
		}

		throw lastErr;
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache.clear();
	}
}

export default IETVClient;
