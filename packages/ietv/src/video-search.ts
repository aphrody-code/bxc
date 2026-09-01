/**
 * Recherche d'épisodes — appariement flou par-dessus l'index FTS5 du cache.
 *
 * SQLite FTS5 (cf. `cache.ts`) couvre le catalogue IETV ; cette couche ajoute
 * le classement et la tolérance aux fautes de frappe côté application.
 */

import type { VideoRef, ChannelInfo } from "./index";
import { IETVCache } from "./cache";

export interface SearchResult {
	video: VideoRef;
	channel: string;
	score: number; // 0-100
	matchType: "title" | "episode" | "season" | "description";
	highlights: string[];
}

export interface SearchOptions {
	query?: string;
	season?: number;
	episode?: number;
	language?: "vf" | "vostfr";
	channel?: string;
	fuzzy?: boolean;
	limit?: number;
	sortBy?: "relevance" | "date" | "views";
}

/**
 * Fuzzy string matching (Levenshtein distance)
 */
function levenshteinDistance(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;
	const matrix: number[][] = [];

	for (let i = 0; i <= bLen; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= aLen; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= bLen; i++) {
		for (let j = 1; j <= aLen; j++) {
			if (b.charCodeAt(i - 1) === a.charCodeAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1, // insertion
					matrix[i - 1][j] + 1, // deletion
				);
			}
		}
	}

	return matrix[bLen][aLen];
}

/**
 * Calculate fuzzy match score
 */
function fuzzyScore(query: string, target: string): number {
	const distance = levenshteinDistance(query.toLowerCase(), target.toLowerCase());
	const maxLen = Math.max(query.length, target.length);
	return Math.max(0, 100 - (distance / maxLen) * 100);
}

/**
 * Video Search Engine
 */
export class VideoSearch {
	private cache: IETVCache;

	constructor(cachePath = "~/.cache/ietv/episodes.db") {
		this.cache = new IETVCache(cachePath);
	}

	/**
	 * Search videos with advanced options
	 */
	search(options: SearchOptions): SearchResult[] {
		const {
			query,
			season,
			episode,
			language,
			channel,
			fuzzy = true,
			limit = 50,
			sortBy = "relevance",
		} = options;

		// Get raw results from cache SQL
		const rawResults = this.cache.search({
			q: query,
			season,
			episode,
			language,
			channel,
			limit: limit * 2, // Get extra for ranking
		});

		// Score and rank results
		const scored: SearchResult[] = rawResults.map((video) => {
			let score = 0;
			const highlights: string[] = [];

			if (!query) {
				score = 100; // No query = perfect match
			} else {
				// Title match (primary)
				const titleScore = fuzzyScore(query, video.title);
				if (titleScore > 50) {
					score += titleScore * 0.6;
					highlights.push(`title: ${titleScore.toFixed(0)}%`);
				}

				// Season/Episode match
				const episodeStr = `S${video.season}E${video.episode}`;
				const episodeScore = fuzzyScore(query, episodeStr);
				if (episodeScore > 50) {
					score += episodeScore * 0.2;
					highlights.push(`episode: ${episodeScore.toFixed(0)}%`);
				}

				// Language bonus
				if (query.toLowerCase().includes("vf") && video.language === "vf") {
					score += 15;
					highlights.push("lang: VF");
				}
				if (query.toLowerCase().includes("vostfr") && video.language === "vostfr") {
					score += 15;
					highlights.push("lang: VOSTFR");
				}
			}

			return {
				video,
				channel: video.channel || "unknown",
				score: Math.min(100, score),
				matchType: this.detectMatchType(query || "", video),
				highlights,
			};
		});

		// Sort
		const sorted = scored.sort((a, b) => {
			if (sortBy === "relevance") return b.score - a.score;
			if (sortBy === "date") return (b.video.duration || 0) - (a.video.duration || 0);
			return 0;
		});

		return sorted.slice(0, limit);
	}

	/**
	 * Auto-complete suggestions
	 */
	autocomplete(prefix: string, limit = 10): string[] {
		const allChannels = this.cache.getAllChannels();
		const suggestions = new Set<string>();

		// Title suggestions
		for (const channel of allChannels) {
			for (const season of channel.seasons) {
				for (const episode of season.episodes) {
					if (episode.title.toLowerCase().startsWith(prefix.toLowerCase())) {
						suggestions.add(episode.title);
						if (suggestions.size >= limit) break;
					}
				}
				if (suggestions.size >= limit) break;
			}
		}

		return Array.from(suggestions).slice(0, limit);
	}

	/**
	 * Similar episodes (content-based recommendation)
	 */
	findSimilar(videoId: string, limit = 10): SearchResult[] {
		const allChannels = this.cache.getAllChannels();
		let sourceVideo: VideoRef | null = null;

		// Find source video
		for (const channel of allChannels) {
			for (const season of channel.seasons) {
				sourceVideo = season.episodes.find((ep) => ep.videoId === videoId) || null;
				if (sourceVideo) break;
			}
			if (sourceVideo) break;
		}

		if (!sourceVideo) return [];

		// Une saison ou une langue inconnue ne restreint rien : on omet le
		// critère plutôt que de chercher `null`.
		return this.search({
			...(sourceVideo.season !== null ? { season: sourceVideo.season } : {}),
			...(sourceVideo.language !== "unknown" ? { language: sourceVideo.language } : {}),
			limit,
			sortBy: "relevance",
		});
	}

	/**
	 * Trending episodes (most searched)
	 */
	getTrending(limit = 10): SearchResult[] {
		const allChannels = this.cache.getAllChannels();
		const allEpisodes: SearchResult[] = [];

		for (const channel of allChannels) {
			for (const season of channel.seasons) {
				for (const episode of season.episodes) {
					allEpisodes.push({
						video: episode,
						channel: channel.channel,
						score: 50, // Neutral score
						matchType: "title",
						highlights: [],
					});
				}
			}
		}

		// Saison décroissante ; les épisodes sans saison identifiée ferment
		// la marche.
		return allEpisodes
			.sort((a, b) => (b.video.season ?? -1) - (a.video.season ?? -1))
			.slice(0, limit);
	}

	/**
	 * Multi-language aggregation
	 */
	getLanguageStats() {
		return this.cache.getStats().byLanguage;
	}

	private detectMatchType(
		query: string,
		video: VideoRef,
	): "title" | "episode" | "season" | "description" {
		const q = query.toLowerCase();

		if (q.includes(`s${video.season}e${video.episode}`) || q.includes(`saison ${video.season}`)) {
			return "episode";
		}
		if (q.includes(`season ${video.season}`) || q.includes(`saison ${video.season}`)) {
			return "season";
		}
		if (video.title.toLowerCase().includes(q)) {
			return "title";
		}

		return "description";
	}

	close(): void {
		this.cache.close();
	}
}

export default VideoSearch;
