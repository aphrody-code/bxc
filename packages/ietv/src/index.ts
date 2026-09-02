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
 * @module bxc/scrapers/ietv
 *
 * Dedicated, typed scraper for **Inazuma Eleven French YouTube channels** —
 * resolves seasons and episodes from multiple YouTube sources. Parses video
 * titles to extract episode numbering (S##E## format or fallback patterns).
 *
 * The scraper aggregates content from four canonical channels:
 *  - https://www.youtube.com/@inazumaelevenfrance1
 *  - https://www.youtube.com/@inazumatvfr
 *  - https://www.youtube.com/@inazumaelevengofrance
 *  - https://www.youtube.com/@InazumaTVFR__
 *
 * HTML-only extraction (no DOM, no JS execution): it parses the server-rendered
 * markup, so it works on cached pages just as well as on live responses.
 * Network fetching uses bxc's in-process `static` transport (zero browser spawn).
 *
 * @example
 * ```ts
 * import { IETVScraper } from "bxc/scrapers/ietv";
 *
 * const scraper = new IETVScraper();
 * const info = await scraper.getChannelEpisodes("inazumaelevenfrance1");
 * console.log(info.channel, info.seasons.length);  // inazumaelevenfrance1 5
 *
 * const s1 = info.seasons[0];
 * console.log(s1.season, s1.episodes.length);      // 1 51
 *
 * await scraper.close();
 * ```
 */

import { Browser } from "@aphrody/bxc";
import { detectPii, redactPii, redactObject, type PiiMatch } from "@aphrody/bxc/privacy";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import {
	cleEpisode,
	indexerChronologie,
	parserListeEpisodes,
	urlApiWiki,
	type EpisodeWiki,
} from "./wiki.ts";
import {
	extraireChannelId,
	langueDeChaine,
	parserFluxYoutube,
	urlFlux,
} from "./youtube-feed.ts";
import {
	identifiantOfficiel,
	parserMetaEpisode,
	parserCategories,
	parserEpisodes,
	urlYoutube,
	type CategorieOfficielle,
	type MetaEpisode,
} from "./official.ts";

type AnyPage = Awaited<ReturnType<typeof Browser.newPage>>;

// Bun native concurrency utilities
const CONCURRENT_FETCHES = 4; // Limit concurrent page fetches
const PAGE_CACHE_DIR = join(homedir(), ".cache", "ietv", "pages");
const DATA_CACHE_DIR = join(homedir(), ".cache", "ietv", "data");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LanguageVersion = "vf" | "vostfr" | "unknown";

export interface VideoRef {
	/** Raw video title from YouTube. */
	title: string;
	/** YouTube video ID (extracted from URL). */
	videoId: string;
	/** Absolute YouTube video URL. */
	url: string;
	/** Video description / synopsis, when available. */
	description: string | null;
	/** Thumbnail/poster image URL, when available. */
	thumbnail: string | null;
	/** Upload/publish date as string, when available. */
	publishDate: string | null;
	/** Parsed season number, when derivable. */
	season: number | null;
	/** Parsed episode number, when derivable. */
	episode: number | null;
	/** Language version: "vf" (dubbed French), "vostfr" (original + French subtitles), or "unknown". */
	language: LanguageVersion;
	/** Video duration in seconds, when available. */
	duration: number | null;
	/** View count, when available. */
	viewCount: string | null;
	/** Rendition label (`"1080p"`, …) when a source exposes one. */
	quality?: string | null;
	/** Titre japonais original, quand une source encyclopédique le donne. */
	titleJp?: string | null;
	/** Transcription rōmaji du titre japonais. */
	romaji?: string | null;
}

export interface SeasonInfo {
	/** Season number. */
	season: number;
	/**
	 * Nom de l'arc tel que la source le nomme — « Saison 1 », « Chrono Stones »,
	 * « Films ». Sans lui, le dixième arc s'affiche « Saison 10 » alors qu'il
	 * s'agit des films.
	 */
	name?: string | null;
	/** Episodes in this season, ordered by episode number (ascending). */
	episodes: VideoRef[];
	/** Total episode count (should equal episodes.length when complete). */
	totalEpisodes: number;
}

export interface ChannelInfo {
	/** YouTube channel handle (e.g. `"inazumaelevenfrance1"`). */
	channel: string;
	/** Display channel name / title. */
	title: string | null;
	/** Channel description / about. */
	description: string | null;
	/** Channel avatar URL. */
	avatar: string | null;
	/** All seasons found on this channel, ordered ascending by season number. */
	seasons: SeasonInfo[];
	/** Total episode count across all seasons. */
	totalEpisodes: number;
}

export interface IETVOptions {
	/** bxc transport profile. `static` (default) is fastest and zero-spawn. */
	profile?: "static" | "http" | "fast" | "stealth" | "max";
	/** Per-request navigation timeout in ms (default 30000). */
	timeoutMs?: number;
	/** Retries per fetch on transient failure (default 2). */
	retries?: number;
	/** YouTube Data API key for discovering additional channels (optional). */
	youtubeApiKey?: string;
}

export interface ScrapingStats {
	/** Nombre de chaînes scrappées. */
	channelsScraped: number;
	/** Nombre total d'épisodes trouvés. */
	totalEpisodes: number;
	/** Temps écoulé en millisecondes. */
	elapsedMs: number;
	/** Nombre de requêtes HTTP. */
	httpRequests: number;
	/** Nombre de hits cache. */
	cacheHits: number;
	/** Données suspectes détectées (PII). */
	suspiciousMatches: PiiMatch[];
}

export interface YouTubeChannelMetadata {
	/** Channel handle (e.g. "@inazumaelevenfrance1"). */
	handle: string;
	/** Channel ID (YouTube internal). */
	channelId: string;
	/** Display title. */
	title: string;
	/** Channel description. */
	description: string | null;
	/** Subscriber count. */
	subscriberCount: string | null;
	/** Video count. */
	videoCount: string | null;
}

// ---------------------------------------------------------------------------
// Credential loading (secure)
// ---------------------------------------------------------------------------

/**
 * Load YouTube API key from secure sources (in order of precedence):
 * 1. YOUTUBE_API_KEY environment variable
 * 2. ~/.ietv/auth.json (key field)
 * 3. ~/.aphrody/ietv-credentials.json (youtube_api_key field)
 * 4. gcloud auth application-default access token (fallback, requires gcloud CLI)
 */
export function loadYouTubeApiKey(): string | null {
	// 1. Environment variable
	const envKey = process.env.YOUTUBE_API_KEY?.trim();
	if (envKey) return envKey;

	// 2. ~/.ietv/auth.json
	try {
		const authPath = join(homedir(), ".ietv", "auth.json");
		if (existsSync(authPath)) {
			const content = readFileSync(authPath, "utf-8");
			const auth = JSON.parse(content);
			if (auth.key && typeof auth.key === "string") {
				return auth.key.trim();
			}
		}
	} catch {
		// Silently fail and continue to next source
	}

	// 3. ~/.aphrody/ietv-credentials.json
	try {
		const credsPath = join(homedir(), ".aphrody", "ietv-credentials.json");
		if (existsSync(credsPath)) {
			const content = readFileSync(credsPath, "utf-8");
			const creds = JSON.parse(content);
			if (creds.youtube_api_key && typeof creds.youtube_api_key === "string") {
				return creds.youtube_api_key.trim();
			}
		}
	} catch {
		// Silently fail
	}

	// 4. gcloud auth (requires gcloud CLI installed)
	// Note: This is a placeholder; full integration would require spawning gcloud process
	// For now, we return null and let the caller fall back to Google Search discovery

	return null;
}

/**
 * Load gcloud credentials for YouTube Data API.
 * Returns the path to the service account JSON file or access token.
 */
export function loadGCloudCredentials(): {
	type: "service-account" | "access-token" | null;
	path?: string;
	token?: string;
} {
	// 1. GOOGLE_APPLICATION_CREDENTIALS env var (gcloud default)
	const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
	if (credPath && existsSync(credPath)) {
		return { type: "service-account", path: credPath };
	}

	// 2. ~/.google/application_default_credentials.json (gcloud default path)
	const defaultPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
	if (existsSync(defaultPath)) {
		return { type: "service-account", path: defaultPath };
	}

	// 3. ~/.aphrody/gcloud-credentials.json (Aphrody convention)
	const aphrodyPath = join(homedir(), ".aphrody", "gcloud-credentials.json");
	if (existsSync(aphrodyPath)) {
		return { type: "service-account", path: aphrodyPath };
	}

	return { type: null };
}

// ---------------------------------------------------------------------------
// HTML helpers (pure)
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&[a-z]+;/g, (m) => {
			const entities: Record<string, string> = {
				"&amp;": "&",
				"&quot;": '"',
				"&apos;": "'",
				"&lt;": "<",
				"&gt;": ">",
				"&nbsp;": " ",
			};
			return entities[m] ?? m;
		})
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extract video ID from YouTube URL or return as-is if it looks like an ID.
 */
function videoIdFromUrl(url: string): string {
	// youtube.com/watch?v=XXX
	const m1 = /[?&]v=([a-zA-Z0-9_-]+)/.exec(url);
	if (m1) return m1[1];
	// youtu.be/XXX
	const m2 = /youtu\.be\/([a-zA-Z0-9_-]+)/.exec(url);
	if (m2) return m2[1];
	// Short ID or fallback
	if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
	return url;
}

/**
 * Parse a season/episode pattern from a video title.
 * Tries multiple patterns:
 * - "Season 1 Episode 5" or "S01E05"
 * - "Ep. 5" or "Episode 5" (assumes season 1 if none found)
 * - Trailing number is episode
 */
/**
 * Detect language version (VF or VOSTFR) from video title.
 * VF = Version Française (dubbed)
 * VOSTFR = Version Originale Sous-Titrée Française (original + French subtitles)
 */
export function detectLanguage(title: string): LanguageVersion {
	const titleLower = title.toLowerCase();

	// Check for explicit VOSTFR markers
	if (/vostfr|v\.o\.stfr|v\.o\. stfr|original.*sous-titr|japanese.*french|jp.*fr/.test(titleLower)) {
		return "vostfr";
	}

	// Check for explicit VF markers
	if (/\bvf\b|version.*fran[çc]aise|fran[çc]ais.*dub|doublage|dubbing.*fr/.test(titleLower)) {
		return "vf";
	}

	// Default heuristic: if contains "Saison" but no explicit marker, assume VF (most common)
	// This can be overridden by explicit markers above
	if (/saison|season/i.test(titleLower)) {
		return "vf";
	}

	return "unknown";
}

/** Saison explicitement nommée dans le titre, `null` si aucune. */
function saisonDuTitre(title: string): number | null {
	const trouve = /[Ss](?:aison|eason)\s*(\d{1,2})/i.exec(title);
	return trouve ? parseInt(trouve[1], 10) : null;
}

/**
 * Situe un épisode numéroté en CONTINU dans son arc.
 *
 * Les chaînes YouTube numérotent d'une traite (« Épisode 113 ») là où le
 * catalogue est découpé en arcs. Connaissant la taille de chaque arc, on
 * retrouve le couple saison/épisode : 113 avec des arcs de 26, 41 et 60 tombe
 * en saison 3, épisode 46.
 *
 * Rend `null` au-delà du total connu : mieux vaut un épisode non classé qu'un
 * épisode classé au hasard.
 */
export function situerAbsolu(
	numeroAbsolu: number,
	taillesParSaison: readonly { season: number; totalEpisodes: number }[]
): { season: number; episode: number } | null {
	if (!Number.isFinite(numeroAbsolu) || numeroAbsolu < 1) return null;

	let restant = numeroAbsolu;
	for (const arc of [...taillesParSaison].sort((a, b) => a.season - b.season)) {
		if (arc.totalEpisodes <= 0) continue;
		if (restant <= arc.totalEpisodes) return { season: arc.season, episode: restant };
		restant -= arc.totalEpisodes;
	}
	return null;
}

export function parseSeasonEpisode(title: string): { season: number | null; episode: number | null } {
	// Pattern 1: S##E## or Season 1 Episode 5 (or Saison 1 Épisode 5)
	const m1 = /[Ss](?:eason|aison)?\s*(\d{1,2})[^\d]*[Ee](?:pisode)?\s*(\d{1,3})/i.exec(title);
	if (m1) {
		return {
			season: parseInt(m1[1], 10),
			episode: parseInt(m1[2], 10),
		};
	}

	// Pattern 2: Episodé X (French) or Episode X — handles accented É/è
	//
	// ⚠ La saison vaut `null` quand le titre n'en nomme aucune, et c'est
	// délibéré : renvoyer 1 par défaut rangeait TOUTES les vidéos d'une chaîne
	// qui numérote en continu (« Épisode 113 ») dans la saison 1, y créant une
	// centaine de trous que la réparation automatique aurait retentés sans fin.
	// Une saison inconnue se déduit ailleurs, à partir des tailles réelles des
	// arcs (`situerAbsolu`), ou reste inconnue.
	const m2 = /[Éè]?[Ee]pisod[eéèê]\s*(\d{1,3})|épis(?:od)?[eéèê]\s*(\d{1,3})/i.exec(title);
	if (m2) {
		return {
			season: saisonDuTitre(title),
			episode: parseInt(m2[1] || m2[2], 10),
		};
	}

	// Pattern 3: Ep. 5 (short form)
	const m3 = /\bEp\.?\s*(\d{1,3})/i.exec(title);
	if (m3) {
		return { season: saisonDuTitre(title), episode: parseInt(m3[1], 10) };
	}

	// Pattern 4: Trailing number (last sequence of 1-3 digits)
	const m4 = /(\d{1,3})(?!\d)/i.exec(title);
	if (m4) {
		return { season: saisonDuTitre(title), episode: parseInt(m4[1], 10) };
	}

	return { season: null, episode: null };
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

/**
 * Concurrency-limited queue for parallel fetches (Bun native).
 */
class FetchQueue {
	private activeCount = 0;
	private readonly maxConcurrent: number;
	private queue: Array<() => Promise<void>> = [];

	constructor(maxConcurrent = CONCURRENT_FETCHES) {
		this.maxConcurrent = maxConcurrent;
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.activeCount >= this.maxConcurrent) {
			// Wait for a slot to open up
			await new Promise((resolve) => {
				this.queue.push(resolve as any);
			});
		}

		this.activeCount++;
		try {
			return await fn();
		} finally {
			this.activeCount--;
			const next = this.queue.shift();
			if (next) next();
		}
	}

	async drainQueue(): Promise<void> {
		while (this.activeCount > 0 || this.queue.length > 0) {
			await Bun.sleep(10);
		}
	}
}

export class IETVScraper {
	private readonly profile: NonNullable<IETVOptions["profile"]>;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private readonly youtubeApiKey: string | null;
	private page: AnyPage | null = null;
	private chronologieChargee: Promise<Map<string, EpisodeWiki>> | null = null;
	private readonly fetchQueue: FetchQueue;
	private readonly enableCache: boolean;
	private stats: ScrapingStats = {
		channelsScraped: 0,
		totalEpisodes: 0,
		elapsedMs: 0,
		httpRequests: 0,
		cacheHits: 0,
		suspiciousMatches: [],
	};
	private startTime = Date.now();

	constructor(opts: IETVOptions = {}) {
		// YouTube requires JavaScript execution to load videos, so we default to "fast"
		// "static" mode will not work for YouTube's dynamic content.
		this.profile = opts.profile ?? "fast";
		this.timeoutMs = opts.timeoutMs ?? 30_000;
		this.retries = opts.retries ?? 2;
		// Try to load API key from secure sources if not provided
		this.youtubeApiKey = opts.youtubeApiKey ?? loadYouTubeApiKey();
		this.fetchQueue = new FetchQueue(CONCURRENT_FETCHES);
		this.enableCache = true;
		this.startTime = Date.now();

		// Initialize cache directories
		try {
			mkdirSync(PAGE_CACHE_DIR, { recursive: true });
			mkdirSync(DATA_CACHE_DIR, { recursive: true });
		} catch {
			// Cache directories already exist or can't be created (OK)
		}
	}

	/**
	 * Generate cache key from URL (hash for performance with Bun).
	 */
	private cacheKey(url: string): string {
		// Use base64 for fast hash
		return Buffer.from(url).toString("base64").slice(0, 24).replace(/[^a-zA-Z0-9]/g, "");
	}

	/**
	 * Get cached HTML if available (Bun.file for fast I/O).
	 */
	private async getCachedHtml(url: string): Promise<string | null> {
		if (!this.enableCache) return null;
		try {
			const cachePath = join(PAGE_CACHE_DIR, `${this.cacheKey(url)}.html`);
			const cacheFile = Bun.file(cachePath);
			if (await cacheFile.exists()) {
				// Check if cache is fresh (< 24 hours)
				const stat = await Bun.file(cachePath).stat?.();
				const age = Date.now() - (stat?.mtime?.getTime() ?? 0);
				if (age < 24 * 60 * 60 * 1000) {
					this.stats.cacheHits++;
					return await cacheFile.text();
				}
			}
		} catch {
			// Cache miss or error (OK)
		}
		return null;
	}

	/**
	 * Cache HTML response (Bun.write for fast write).
	 */
	private async cacheHtml(url: string, html: string): Promise<void> {
		if (!this.enableCache) return;
		try {
			const cachePath = join(PAGE_CACHE_DIR, `${this.cacheKey(url)}.html`);
			await Bun.write(cachePath, html);
		} catch {
			// Cache write failed (non-fatal)
		}
	}

	private async getPage(): Promise<AnyPage> {
		if (!this.page)
			this.page = await Browser.newPage({ profile: this.profile });
		return this.page;
	}

	/** Fetch raw HTML for a URL with concurrency control, caching, and retry (Bun native). */
	async fetchHtml(url: string): Promise<{ status: number; html: string }> {
		// Check cache first (Bun.file I/O is very fast)
		const cached = await this.getCachedHtml(url);
		if (cached) {
			return { status: 200, html: cached };
		}

		// Use fetch queue to limit concurrency (Bun native)
		return await this.fetchQueue.run(async () => {
			let lastErr: unknown;
			for (let attempt = 0; attempt <= this.retries; attempt++) {
				try {
					const page = await this.getPage();
					const resp = await page.goto(url, {
						timeoutMs: this.timeoutMs,
					});
					const html = await page.content();

					// Cache the successful response
					await this.cacheHtml(url, html);

					return { status: resp.status, html };
				} catch (err) {
					lastErr = err;
					try {
						await this.page?.close();
					} catch {
						/* ignore */
					}
					this.page = null;
					if (attempt < this.retries) await Bun.sleep(400 * (attempt + 1));
				}
			}
			throw new Error(`fetchHtml(${url}) failed: ${String(lastErr)}`);
		});
	}

	/**
	 * Parse a YouTube channel's videos list from HTML.
	 * Extracts title, video ID, and metadata from ytInitialData JSON or embedded links.
	 */
	private parseChannelVideos(html: string): VideoRef[] {
		const videos: VideoRef[] = [];
		const seen = new Set<string>();

		// First, try to extract ytInitialData (YouTube embeds video metadata as JSON)
		// This contains the structured data for all videos
		const ytDataMatches = html.matchAll(
			/var ytInitialData = (\{[\s\S]*?\});\s*(?:var|<\/script>)/g,
		);

		for (const match of ytDataMatches) {
			const jsonStr = match[1];
			try {
				// Use regex to extract video IDs and associated titles from the JSON
				// Pattern: "videoId":"XXXXX","thumbnail":{"thumbnails":[...]},...
				const videoRe =
					/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
				const titleRe =
					/"title"\s*:\s*{\s*"simpleText"\s*:\s*"([^"]+)"|"title"\s*:\s*"([^"]+)"/g;

				let videoMatch;
				const videoIds: Map<string, string> = new Map();

				// Extract all video IDs
				while ((videoMatch = videoRe.exec(jsonStr)) !== null) {
					const vid = videoMatch[1];
					if (!seen.has(vid)) {
						videoIds.set(vid, `Video ${vid}`);
						seen.add(vid);
					}
				}

				// Try to associate titles with video IDs
				// For now, we'll use the order they appear
				const videoIdArray = Array.from(videoIds.keys());
				const titlesMatches = Array.from(
					jsonStr.matchAll(
						/"simpleText"\s*:\s*"([^"]{10,}?)"|"title"\s*:\s*"([^"]{10,}?)"/g,
					),
				);

				for (let i = 0; i < Math.min(videoIdArray.length, titlesMatches.length); i++) {
					const title =
						titlesMatches[i][1] || titlesMatches[i][2] || videoIdArray[i];
					videoIds.set(videoIdArray[i], decodeURIComponent(title));
				}

				// Convert to VideoRef objects
				for (const [videoId, title] of videoIds) {
					const { season, episode } = parseSeasonEpisode(title);
					const language = detectLanguage(title);
					videos.push({
						title,
						videoId,
						url: `https://www.youtube.com/watch?v=${videoId}`,
						description: null,
						thumbnail: null,
						publishDate: null,
						season,
						episode,
						language,
						duration: null,
						viewCount: null,
					});
				}

				if (videos.length > 0) return videos;
			} catch (e) {
				// Continue to next data block or fallback
			}
		}

		// Fallback: parse from watch?v= links
		return this.parseChannelVideosFromLinks(html);
	}

	/**
	 * Parse videos from watch links in HTML.
	 */
	private parseChannelVideosFromLinks(
		html: string,
		preferredVideoIds?: string[],
	): VideoRef[] {
		const videos: VideoRef[] = [];
		const seen = new Set<string>();

		// If we have preferred video IDs, use those
		if (preferredVideoIds && preferredVideoIds.length > 0) {
			for (const videoId of preferredVideoIds) {
				if (seen.has(videoId)) continue;
				seen.add(videoId);

				// Find title for this video ID
				const titleMatch = /title="([^"]*${videoId}[^"]*)"/i.exec(html) ??
					/"title":\s*"([^"]*episode[^"]*)"/i.exec(html) ??
					/data-title="([^"]+)"/i.exec(html);

				const title = titleMatch ? stripHtml(titleMatch[1]) : `Video ${videoId}`;
				const { season, episode } = parseSeasonEpisode(title);
				const language = detectLanguage(title);

				videos.push({
					title,
					videoId,
					url: `https://www.youtube.com/watch?v=${videoId}`,
					description: null,
					thumbnail: null,
					publishDate: null,
					season,
					episode,
					language,
					duration: null,
					viewCount: null,
				});
			}
		}

		// Also scan for watch links not yet added
		const watchLinkRe = /href="(\/watch\?v=([a-zA-Z0-9_-]{11})[^"]*)"/g;
		let match;

		while ((match = watchLinkRe.exec(html)) !== null) {
			const fullUrl = "https://www.youtube.com" + match[1];
			const videoId = match[2];

			if (seen.has(videoId)) continue;
			seen.add(videoId);

			// Try to extract title
			const titleMatch = new RegExp(
				`title="([^"]*?)">\\s*<span[^>]*>${videoId}|title="([^"]+)"[^>]*href="[^"]*v=${videoId}`,
				"i",
			).exec(html);

			const title = titleMatch
				? stripHtml(titleMatch[1] || titleMatch[2])
				: `Video ${videoId}`;
			const { season, episode } = parseSeasonEpisode(title);
			const language = detectLanguage(title);

			videos.push({
				title,
				videoId,
				url: fullUrl,
				description: null,
				thumbnail: null,
				publishDate: null,
				season,
				episode,
				language,
				duration: null,
				viewCount: null,
			});
		}

		return videos;
	}

	/**
	 * Parse channel metadata from the HTML head and page.
	 */
	private parseChannelMeta(
		html: string,
		channelHandle: string,
	): { title: string | null; description: string | null; avatar: string | null } {
		// Try to extract from meta tags
		const titleRe = /<meta\s+property="og:title"\s+content="([^"]+)"/i;
		const descRe = /<meta\s+property="og:description"\s+content="([^"]+)"/i;
		const imgRe = /<meta\s+property="og:image"\s+content="([^"]+)"/i;

		const title = titleRe.exec(html)?.[1] ?? null;
		const description = descRe.exec(html)?.[1] ?? null;
		const avatar = imgRe.exec(html)?.[1] ?? null;

		return {
			title: title ? stripHtml(title) : null,
			description: description ? stripHtml(description) : null,
			avatar,
		};
	}

	/**
	 * Fetch + parse all episodes from a YouTube channel.
	 */
	/**
	 * Vidéos brutes d'une chaîne, via son flux Atom.
	 *
	 * La saison peut valoir `null` : les chaînes numérotent souvent en continu.
	 * C'est l'appelant qui décide quoi en faire — les écarter, ou les situer
	 * dans leur arc avec {@link situerAbsolu}.
	 */
	private async videosDeChaine(handle: string): Promise<{ videos: VideoRef[]; titre: string | null }> {
		// Une page de chaîne juste pour son identifiant : le flux Atom exige un
		// `channel_id`, et le handle ne suffit pas.
		const page = await this.fetchTexte(`https://www.youtube.com/@${handle}`);
		this.stats.httpRequests++;
		if (page.status !== 200) {
			throw new Error(`videosDeChaine(@${handle}) : HTTP ${page.status}`);
		}

		const channelId = extraireChannelId(page.html);
		if (!channelId) {
			throw new Error(
				`videosDeChaine(@${handle}) : identifiant de chaîne introuvable. ` +
					"La chaîne a peut-être été renommée ou supprimée."
			);
		}

		const flux = await this.fetchTexte(urlFlux(channelId));
		this.stats.httpRequests++;
		if (flux.status !== 200) {
			throw new Error(`videosDeChaine(@${handle}) : flux HTTP ${flux.status}`);
		}

		const entrees = parserFluxYoutube(flux.html);
		// Contexte de chaîne, faute de marqueur dans le titre de la vidéo.
		const langueChaine = langueDeChaine(handle, entrees[0]?.chaine ?? null);

		const videos = entrees.map((entree): VideoRef => {
			const { season, episode } = parseSeasonEpisode(entree.titre);
			const langueTitre = detectLanguage(entree.titre);
			return {
				title: entree.titre,
				videoId: entree.videoId,
				url: entree.url,
				description: null,
				thumbnail: `https://i.ytimg.com/vi/${entree.videoId}/hqdefault.jpg`,
				publishDate: entree.publie,
				season,
				episode,
				// Le marqueur du titre prime toujours sur le contexte de la chaîne.
				language: langueTitre !== "unknown" ? langueTitre : (langueChaine ?? "unknown"),
				duration: null,
				viewCount: null,
			};
		});

		return { videos, titre: entrees[0]?.chaine ?? null };
	}

	/** Regroupe des vidéos en saisons ; celles sans saison sont écartées. */
	private regrouperEnSaisons(videos: readonly VideoRef[]): SeasonInfo[] {
		const parSaison = new Map<number, VideoRef[]>();
		for (const video of videos) {
			if (video.season === null) continue;
			parSaison.set(video.season, [...(parSaison.get(video.season) ?? []), video]);
		}
		for (const eps of parSaison.values()) {
			eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
		}
		return [...parSaison.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([season, episodes]) => ({ season, episodes, totalEpisodes: episodes.length }));
	}

	async getChannelEpisodes(channelHandleOrUrl: string): Promise<ChannelInfo> {
		const handle = channelHandleOrUrl
			.replace(/^https?:\/\/[^/]+\/@?/, "")
			.replace(/^@/, "")
			.split("/")[0]!;

		const { videos, titre } = await this.videosDeChaine(handle);
		const seasons = this.regrouperEnSaisons(videos);
		const totalEpisodes = seasons.reduce((n, s) => n + s.totalEpisodes, 0);

		this.stats.channelsScraped++;
		this.stats.totalEpisodes += totalEpisodes;

		return {
			channel: handle,
			title: titre ?? handle,
			description: null,
			avatar: null,
			seasons,
			totalEpisodes,
		};
	}

	/**
	 * Discover additional Inazuma Eleven YouTube channels via search.
	 * Returns channel metadata for channels found (not full episode lists).
	 * Useful for finding new streaming sources.
	 */
	async discoverChannels(searchQuery = "Inazuma Eleven français"): Promise<YouTubeChannelMetadata[]> {
		const channels: YouTubeChannelMetadata[] = [];

		// If YouTube API key is provided, use YouTube API (higher quality results)
		if (this.youtubeApiKey) {
			return this.discoverChannelsViaYouTubeAPI(searchQuery);
		}

		// Fallback: use Google Search to find YouTube channels
		return this.discoverChannelsViaGoogle(searchQuery);
	}

	/**
	 * Discover channels via YouTube Data API (requires API key).
	 */
	private async discoverChannelsViaYouTubeAPI(
		searchQuery: string,
	): Promise<YouTubeChannelMetadata[]> {
		if (!this.youtubeApiKey) return [];

		const channels: YouTubeChannelMetadata[] = [];

		try {
			// YouTube Data API v3 search endpoint
			const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
			apiUrl.searchParams.set("key", this.youtubeApiKey);
			apiUrl.searchParams.set("q", searchQuery);
			apiUrl.searchParams.set("type", "channel");
			apiUrl.searchParams.set("part", "snippet");
			apiUrl.searchParams.set("maxResults", "50");

			const response = await fetch(apiUrl.toString());

			if (!response.ok) {
				console.warn(
					`YouTube API error: ${response.status} ${response.statusText}`,
				);
				return [];
			}

			const data = (await response.json()) as {
				items?: Array<{
					id?: { channelId?: string };
					snippet?: {
						title?: string;
						description?: string;
						channelId?: string;
					};
				}>;
			};

			if (!data.items) return [];

			for (const item of data.items) {
				const channelId = item.id?.channelId || item.snippet?.channelId;
				if (!channelId) continue;

				channels.push({
					handle: `@${(item.snippet?.title || channelId).toLowerCase().replace(/\s+/g, "")}`,
					channelId,
					title: item.snippet?.title || channelId,
					description: item.snippet?.description || null,
					subscriberCount: null, // Would require additional API call
					videoCount: null,
				});
			}
		} catch (err) {
			console.warn(`discoverChannelsViaYouTubeAPI failed: ${String(err)}`);
		}

		return channels;
	}

	/**
	 * Discover channels via Google Search (fallback method).
	 */
	private async discoverChannelsViaGoogle(
		searchQuery: string,
	): Promise<YouTubeChannelMetadata[]> {
		const channels: YouTubeChannelMetadata[] = [];

		// Query: "site:youtube.com @[handle] Inazuma Eleven français"
		const googleQuery = `site:youtube.com ${searchQuery} "Inazuma Eleven"`;

		try {
			const { status, html } = await this.fetchHtml(
				`https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`,
			);

			if (status === 200) {
				// Parse YouTube channel links from Google results
				// Pattern: https://www.youtube.com/@handle or /channel/ID
				const channelLinkRe =
					/https:\/\/(?:www\.)?youtube\.com\/(?:@([a-zA-Z0-9_-]+)|channel\/([a-zA-Z0-9_-]+))/g;
				const seen = new Set<string>();

				let match;
				while ((match = channelLinkRe.exec(html)) !== null) {
					const handle = match[1];
					const channelId = match[2];

					if (!handle && !channelId) continue;
					const key = handle || channelId;
					if (seen.has(key)) continue;
					seen.add(key);

					// Fetch channel metadata
					try {
						const info = await this.getChannelEpisodes(handle || channelId);
						channels.push({
							handle: handle || channelId,
							channelId: channelId || "unknown",
							title: info.title || handle || channelId,
							description: info.description,
							subscriberCount: null, // Not easily extractable from channel page
							videoCount: String(info.totalEpisodes),
						});
					} catch {
						// Skip channels that fail to load
					}
				}
			}
		} catch (err) {
			console.warn(`discoverChannelsViaGoogle failed: ${String(err)}`);
		}

		return channels;
	}

	/**
	 * Scrape Pluto.tv for Inazuma Eleven episodes (FAST streaming service).
	 * Supports multiple regions: no (Norvège), fr (France), etc.
	 */
	async scrapePlutuTv(region = "no"): Promise<ChannelInfo> {
		const baseUrl = `https://pluto.tv/${region}/shows/inazuma-eleven-ptv2`;

		try {
			// Try to fetch the show page which contains season/episode data
			const { status, html } = await this.fetchHtml(`${baseUrl}/season/1`);
			this.stats.httpRequests++;

			if (status !== 200) {
				// Try without season suffix for full listing
				const fullResp = await this.fetchHtml(baseUrl);
				this.stats.httpRequests++;
				if (fullResp.status !== 200) {
					throw new Error(`scrapePlutuTv: HTTP ${fullResp.status}`);
				}
				return this.parsePlutuTvPage(fullResp.html, baseUrl, region);
			}

			return this.parsePlutuTvPage(html, baseUrl, region);
		} catch (err) {
			throw new Error(`scrapePlutuTv(${region}): ${String(err)}`);
		}
	}

	/**
	 * Parse Pluto.tv show page for episodes (handles JSON-LD schema + DOM structure).
	 */
	private parsePlutuTvPage(html: string, baseUrl: string, region: string): ChannelInfo {
		const videos: VideoRef[] = [];

		// Try to extract from JSON-LD schema (most reliable)
		const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
		let match;

		while ((match = jsonLdRe.exec(html)) !== null) {
			try {
				const jsonData = JSON.parse(match[1]) as any;

				// Handle different JSON-LD structures
				if (jsonData.containsSeason && Array.isArray(jsonData.containsSeason)) {
					for (const season of jsonData.containsSeason) {
						if (season.episode && Array.isArray(season.episode)) {
							for (const ep of season.episode) {
								const title = ep.name || ep.episodeNumber || "";
								if (!title) continue;

								const { season: seasonNum, episode: epNum } = parseSeasonEpisode(
									title + (season.seasonNumber ? ` Season ${season.seasonNumber}` : ""),
								);
								const language = detectLanguage(title);

								videos.push({
									title,
									videoId: Buffer.from(`pluto-tv-${ep.url || title}`).toString("base64").slice(0, 11),
									url: ep.url || `${baseUrl}/season/${season.seasonNumber || 1}`,
									description: ep.description || null,
									thumbnail: ep.image || null,
									publishDate: ep.datePublished || null,
									season: seasonNum,
									episode: epNum,
									language,
									duration: ep.duration ? parseInt(ep.duration.replace(/\D/g, ""), 10) : null,
									viewCount: null,
								});
							}
						}
					}
				}
			} catch {
				// JSON-LD parse failed, try DOM parsing
			}
		}

		// Fallback: parse episode links from DOM
		if (videos.length === 0) {
			const episodeRe = /<a[^>]*href="([^"]*episode[^"]*)"[^>]*>[\s\S]*?<(?:h[2-4]|span)[^>]*>([^<]+)<\/(?:h[2-4]|span)>/gi;

			while ((match = episodeRe.exec(html)) !== null) {
				const url = match[1];
				const title = stripHtml(match[2]);

				if (title.length < 3) continue;

				const { season, episode } = parseSeasonEpisode(title);
				const language = detectLanguage(title);

				videos.push({
					title,
					videoId: Buffer.from(`pluto-tv-${url}`).toString("base64").slice(0, 11),
					url: url.startsWith("http") ? url : `${baseUrl}${url}`,
					description: null,
					thumbnail: null,
					publishDate: null,
					season,
					episode,
					language,
					duration: null,
					viewCount: null,
				});
			}
		}

		// Group by season
		const seasonMap = new Map<number, VideoRef[]>();
		let maxSeason = 0;

		for (const video of videos) {
			if (video.season === null) continue;
			if (!seasonMap.has(video.season)) {
				seasonMap.set(video.season, []);
				maxSeason = Math.max(maxSeason, video.season);
			}
			seasonMap.get(video.season)!.push(video);
		}

		for (const eps of seasonMap.values()) {
			eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
		}

		const seasons: SeasonInfo[] = [];
		for (let s = 1; s <= maxSeason; s++) {
			const episodes = seasonMap.get(s) ?? [];
			seasons.push({
				season: s,
				episodes,
				totalEpisodes: episodes.length,
			});
		}

		const totalEpisodes = videos.filter((v) => v.episode !== null).length;
		this.stats.channelsScraped++;
		this.stats.totalEpisodes += totalEpisodes;

		return {
			channel: `pluto-tv-${region}`,
			title: `Pluto.tv (${region.toUpperCase()}) - Inazuma Eleven`,
			description: "Free Ad-Supported Streaming Service (FAST)",
			avatar: null,
			seasons,
			totalEpisodes,
		};
	}

	/**
	 * Scrape inazuma-eleven.fr official site for complete episode list.
	 */
	/**
	 * Récupère une page en HTTP simple, sans navigateur.
	 *
	 * ── POURQUOI PAS `fetchHtml` ───────────────────────────────────────────
	 * Le site officiel rend son HTML côté serveur : un navigateur n'y apporte
	 * rien et y ajoute un mode de panne. Mesuré le 2026-09-02 : `fetchHtml`
	 * rendait la page d'INDEX (20 262 o, titre de l'index) pour *toutes* les
	 * URL de catégorie, y compris au tout premier appel, là où un `fetch` sur
	 * la même URL rend bien la page attendue (23 519 o, avec sa liste
	 * d'épisodes). Le contournement est aussi le bon choix : pas de navigateur
	 * pour du HTML statique.
	 */
	private async fetchTexte(url: string): Promise<{ status: number; html: string }> {
		const reponse = await fetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
				"Accept-Language": "fr-FR,fr;q=0.9",
			},
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		return { status: reponse.status, html: await reponse.text() };
	}

	/** Page Wikipédia des épisodes, en français. */
	private static readonly PAGE_WIKI = "Liste des épisodes d'Inazuma Eleven";

	/**
	 * Chronologie Wikipédia, chargée au plus une fois par instance.
	 *
	 * Enrichissement seulement : dates de première diffusion et titres
	 * japonais. Elle ne fait PAS autorité sur les comptes — Wikipédia liste 35
	 * épisodes d'Orion là où le site officiel en sert 49. Une source qui
	 * complète n'est pas une source qui arbitre.
	 */
	private async chronologie(): Promise<Map<string, EpisodeWiki>> {
		if (this.chronologieChargee) return this.chronologieChargee;

		this.chronologieChargee = (async () => {
			try {
				const reponse = await this.fetchTexte(
					urlApiWiki("fr.wikipedia.org", IETVScraper.PAGE_WIKI)
				);
				this.stats.httpRequests++;
				if (reponse.status !== 200) return new Map<string, EpisodeWiki>();

				const charge = JSON.parse(reponse.html) as { parse?: { text?: string } };
				const texte = charge.parse?.text;
				if (!texte) return new Map<string, EpisodeWiki>();

				return indexerChronologie(parserListeEpisodes(texte));
			} catch {
				// Wikipédia indisponible : le catalogue reste servi sans dates.
				// Une source d'enrichissement ne doit jamais faire échouer la
				// source principale.
				return new Map<string, EpisodeWiki>();
			}
		})();

		return this.chronologieChargee;
	}

	async scrapeOfficialSite(): Promise<ChannelInfo> {
		const racine = "https://inazuma-eleven.fr/tv/watch?lang=fr";

		const index = await this.fetchTexte(racine);
		this.stats.httpRequests++;
		if (index.status !== 200) {
			throw new Error(`scrapeOfficialSite: HTTP ${index.status} sur ${racine}`);
		}

		const categories = parserCategories(index.html);
		if (categories.length === 0) {
			throw new Error(
				"scrapeOfficialSite : aucune catégorie dans le JSON-LD de l'index. " +
					"Le site a probablement changé de balisage — vérifier `parserCategories`."
			);
		}

		// Une page par catégorie, en parallèle borné : `fetchHtml` passe déjà par
		// la file de concurrence du scraper.
		const parCategorie = await Promise.all(
			categories.map(async (categorie) => ({
				categorie,
				episodes: await this.episodesDeCategorie(categorie),
			}))
		);

		const seasons: SeasonInfo[] = parCategorie
			.filter((entree) => entree.episodes.length > 0)
			.map((entree) => ({
				season: entree.categorie.position,
				// Le nom du site fait autorité : « Films » ne doit pas s'afficher
				// « Saison 10 ».
				name: entree.categorie.nom,
				episodes: entree.episodes,
				totalEpisodes: entree.episodes.length,
			}))
			.sort((a, b) => a.season - b.season);

		const totalEpisodes = seasons.reduce((somme, saison) => somme + saison.totalEpisodes, 0);
		this.stats.channelsScraped++;
		this.stats.totalEpisodes += totalEpisodes;

		return {
			channel: "inazuma-eleven.fr (official)",
			title: "Site Officiel Inazuma Eleven France",
			description: "Plateforme de streaming officielle française",
			avatar: null,
			seasons,
			totalEpisodes,
		};
	}

	/**
	 * Identifiants YouTube des épisodes d'une catégorie, résolus une seule fois.
	 *
	 * ── POURQUOI UN CACHE SUR DISQUE ───────────────────────────────────────
	 * L'identifiant n'existe que sur la page de l'épisode : le résoudre coûte
	 * une requête par épisode, soit 355 requêtes au site à CHAQUE
	 * rafraîchissement — toutes les six heures, pour une donnée qui ne change
	 * jamais. Une fois connue, elle est écrite sur disque et plus jamais
	 * redemandée : en régime stable, seuls les épisodes nouveaux coûtent une
	 * requête.
	 */
	private async resoudreMetaEpisodes(
		categorie: CategorieOfficielle,
		episodes: readonly { numero: number; url: string }[]
	): Promise<Map<number, MetaEpisode>> {
		const fichier = join(DATA_CACHE_DIR, `meta-${categorie.slug}.json`);
		let connus: Record<string, MetaEpisode> = {};
		try {
			if (existsSync(fichier)) {
				connus = JSON.parse(readFileSync(fichier, "utf8")) as Record<string, MetaEpisode>;
			}
		} catch {
			// Cache illisible : on repart de zéro plutôt que d'échouer.
			connus = {};
		}

		const manquants = episodes.filter((episode) => !connus[String(episode.numero)]);
		let ajouts = 0;

		// Par paquets : 355 requêtes simultanées feraient tomber le site, et une
		// boucle strictement séquentielle prendrait plusieurs minutes.
		const LOT = 8;
		for (let i = 0; i < manquants.length; i += LOT) {
			const lot = manquants.slice(i, i + LOT);
			const resolus = await Promise.all(
				lot.map(async (episode) => {
					try {
						const page = await this.fetchTexte(episode.url);
						this.stats.httpRequests++;
						return page.status === 200
							? ([episode.numero, parserMetaEpisode(page.html)] as const)
							: ([episode.numero, null] as const);
					} catch {
						return [episode.numero, null] as const;
					}
				})
			);
			for (const [numero, meta] of resolus) {
				if (meta) {
					connus[String(numero)] = meta;
					ajouts++;
				}
			}
		}

		if (ajouts > 0) {
			try {
				if (!existsSync(DATA_CACHE_DIR)) mkdirSync(DATA_CACHE_DIR, { recursive: true });
				writeFileSync(fichier, JSON.stringify(connus), "utf8");
			} catch {
				// Cache non écrit : la résolution recommencera au prochain passage,
				// ce qui est lent mais pas faux.
			}
		}

		return new Map(
			Object.entries(connus).map(([numero, meta]) => [Number.parseInt(numero, 10), meta] as const)
		);
	}

	/**
	 * Épisodes d'une catégorie du site officiel.
	 *
	 * Une catégorie qui échoue rend une liste vide au lieu de faire tomber tout
	 * le scraping : neuf saisons valent mieux que zéro.
	 */
	private async episodesDeCategorie(categorie: CategorieOfficielle): Promise<VideoRef[]> {
		try {
			const page = await this.fetchTexte(categorie.url);
			this.stats.httpRequests++;
			if (page.status !== 200) return [];

			const listes = parserEpisodes(page.html);
			const [metas, chrono] = await Promise.all([
				this.resoudreMetaEpisodes(categorie, listes),
				this.chronologie(),
			]);

			return listes.map((episode) => {
				const meta = metas.get(episode.numero);
				const wiki = chrono.get(cleEpisode(categorie.position, episode.numero));
				const idYoutube = meta?.idYoutube ?? null;
				return {
					title: `${categorie.nom} — ${meta?.titre ?? episode.titre}`,
					// L'identifiant YouTube quand on l'a : il unifie cet épisode avec
					// la même vidéo vue par le flux d'une chaîne, au lieu d'en faire
					// deux entrées distinctes.
					videoId: idYoutube ?? identifiantOfficiel(categorie.slug, episode.numero),
					// L'URL YouTube est ce qui produit un LECTEUR dans Discord ; la
					// page du site n'y donne qu'une carte. On retombe sur la page
					// quand l'identifiant n'a pas pu être résolu.
					url: idYoutube ? urlYoutube(idYoutube) : episode.url,
					description: meta?.description ?? null,
					thumbnail:
						meta?.vignette ??
						(idYoutube ? `https://i.ytimg.com/vi/${idYoutube}/hqdefault.jpg` : null),
					// Le site officiel ne date rien ; la date de première diffusion
					// vient de la chronologie.
					publishDate: wiki?.diffusion ?? null,
					titleJp: wiki?.titreJp ?? null,
					romaji: wiki?.romaji ?? null,
					season: categorie.position,
					episode: episode.numero,
					// `?lang=fr` sert la version française doublée ; le site ne propose
					// pas de piste sous-titrée à cette adresse.
					language: "vf" as LanguageVersion,
					duration: null,
					viewCount: null,
				};
			});
		} catch {
			return [];
		}
	}

	/**
	 * Parse episodes from inazuma-eleven.fr official site.
	 */
	private parseOfficialSiteEpisodes(html: string): VideoRef[] {
		const videos: VideoRef[] = [];

		// Look for episode links in the site structure
		// Pattern: episode containers with title, link, thumbnail
		const episodeRe =
			/<(?:div|article)[^>]*class="[^"]*episode[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<(?:h[2-4]|span)[^>]*>([^<]+)<\/(?:h[2-4]|span)>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/(?:div|article)>/gi;

		let match;
		const seen = new Set<string>();

		while ((match = episodeRe.exec(html)) !== null) {
			const url = match[1];
			const title = stripHtml(match[2]);
			const thumbnail = match[3];

			// Extract video ID or use URL hash
			const videoId = url.match(/(?:id=|v=|\/)?([a-zA-Z0-9_-]{8,})/) ?.[1] ||
				Buffer.from(url).toString("base64").slice(0, 11);

			if (seen.has(videoId)) continue;
			seen.add(videoId);

			const { season, episode } = parseSeasonEpisode(title);
			const language = detectLanguage(title);

			videos.push({
				title,
				videoId,
				url: url.startsWith("http") ? url : `https://inazuma-eleven.fr${url}`,
				description: null,
				thumbnail: thumbnail.startsWith("http") ? thumbnail : `https://inazuma-eleven.fr${thumbnail}`,
				publishDate: null,
				season,
				episode,
				language,
				duration: null,
				viewCount: null,
			});
		}

		// Fallback: look for simple links containing episode patterns
		if (videos.length === 0) {
			const linkRe =
				/<a[^>]*href="([^"]*ep(?:isode|od)?[^"]*)"[^>]*>([^<]+)<\/a>/gi;
			while ((match = linkRe.exec(html)) !== null) {
				const url = match[1];
				const title = stripHtml(match[2]);

				if (title.length < 5 || seen.has(url)) continue;
				seen.add(url);

				const { season, episode } = parseSeasonEpisode(title);
				const language = detectLanguage(title);

				videos.push({
					title,
					videoId: Buffer.from(url).toString("base64").slice(0, 11),
					url: url.startsWith("http") ? url : `https://inazuma-eleven.fr${url}`,
					description: null,
					thumbnail: null,
					publishDate: null,
					season,
					episode,
					language,
					duration: null,
					viewCount: null,
				});
			}
		}

		return videos;
	}

	/**
	 * Scrape Pluto.tv across multiple regions (France, Norway, etc).
	 */
	async scrapePlutuTvRegions(regions = ["no", "fr"]): Promise<ChannelInfo[]> {
		const promises = regions.map(async (region) => {
			try {
				return await this.scrapePlutuTv(region);
			} catch (err) {
				console.warn(`Failed to fetch Pluto.tv ${region}: ${String(err)}`);
				return null;
			}
		});

		const results = await Promise.all(promises);
		return results.filter((info): info is ChannelInfo => info !== null);
	}

	/**
	 * Aggregate episodes from all sources: YouTube channels + official site + Pluto.tv (parallel).
	 */
	async getAllChannelEpisodes(): Promise<Array<ChannelInfo>> {
		const youtubeChannels = [
			"inazumaelevenfrance1",
			"inazumatvfr",
			"inazumaelevengofrance",
			"InazumaTVFR__",
		];

		const [chaines, officialSite, plutuResults] = await Promise.all([
			Promise.all(
				youtubeChannels.map(async (handle) => {
					try {
						return { handle, ...(await this.videosDeChaine(handle)) };
					} catch (err) {
						console.warn(`Failed to fetch ${handle}: ${String(err)}`);
						return null;
					}
				}),
			),
			(async () => {
				try {
					return await this.scrapeOfficialSite();
				} catch (err) {
					console.warn(`Failed to fetch official site: ${String(err)}`);
					return null;
				}
			})(),
			this.scrapePlutuTvRegions(["no", "fr"]).catch(() => []),
		]);

		// Le site officiel donne le découpage réel en arcs. Il sert de RÉFÉRENCE
		// pour situer les vidéos YouTube numérotées en continu (« Épisode 113 »),
		// qui sinon resteraient non classées. Sans lui, on ne devine rien : mieux
		// vaut un épisode non classé qu'un épisode classé au hasard.
		const arcs = (officialSite?.seasons ?? []).map((saison) => ({
			season: saison.season,
			totalEpisodes: saison.totalEpisodes,
		}));

		const allResults: ChannelInfo[] = [];
		if (officialSite) allResults.push(officialSite);

		for (const chaine of chaines) {
			if (!chaine) continue;

			const situees = chaine.videos.map((video) => {
				if (video.season !== null || video.episode === null || arcs.length === 0) return video;
				const place = situerAbsolu(video.episode, arcs);
				return place ? { ...video, season: place.season, episode: place.episode } : video;
			});

			const seasons = this.regrouperEnSaisons(situees);
			const totalEpisodes = seasons.reduce((n, s) => n + s.totalEpisodes, 0);
			this.stats.channelsScraped++;
			this.stats.totalEpisodes += totalEpisodes;

			allResults.push({
				channel: chaine.handle,
				title: chaine.titre ?? chaine.handle,
				description: null,
				avatar: null,
				seasons,
				totalEpisodes,
			});
		}

		allResults.push(...plutuResults);
		return allResults;
	}

	/**
	 * Scraping statistics (with PII detection from bxc/privacy).
	 */
	getStats(): ScrapingStats {
		return {
			...this.stats,
			elapsedMs: Date.now() - this.startTime,
		};
	}

	/**
	 * Redact sensitive data from channel info using bxc privacy module.
	 */
	redactChannelInfo(info: ChannelInfo): ChannelInfo {
		// Redact descriptions, titles, and other fields
		return redactObject(info, { salt: "ietv-anonymize" });
	}

	/**
	 * Détect potentially sensitive data in scraped content (PII).
	 */
	checkForSensitiveData(channels: ChannelInfo[]): PiiMatch[] {
		const allMatches: PiiMatch[] = [];
		for (const channel of channels) {
			const text = JSON.stringify(channel);
			const matches = detectPii(text);
			allMatches.push(...matches);
		}
		this.stats.suspiciousMatches = allMatches;
		return allMatches;
	}

	/**
	 * Export channel data to JSON file using Bun.write (fast).
	 */
	async exportData(channels: ChannelInfo[], filePath: string): Promise<void> {
		try {
			const jsonData = JSON.stringify(channels, null, 2);
			await Bun.write(filePath, jsonData);
		} catch (err) {
			console.warn(`Failed to export data to ${filePath}: ${String(err)}`);
		}
	}

	/**
	 * Get statistics on cached data (Bun.file for fast reads).
	 */
	async getCacheStats(): Promise<{
		cachedPages: number;
		cacheSize: number; // bytes
	}> {
		let count = 0;
		let size = 0;

		try {
			// Bun's native file I/O for directory scanning
			const dir = Bun.file(PAGE_CACHE_DIR);
			// Note: Full directory listing would require node:fs
			// For now, return estimates
			return { cachedPages: count, cacheSize: size };
		} catch {
			return { cachedPages: 0, cacheSize: 0 };
		}
	}

	/** Release the underlying page. */
	async close(): Promise<void> {
		// Drain any pending fetches
		await this.fetchQueue.drainQueue();

		if (this.page) {
			try {
				await this.page.close();
			} catch {
				/* ignore */
			}
			this.page = null;
		}
	}
}

export default IETVScraper;
