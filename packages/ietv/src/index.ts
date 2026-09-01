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
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

type AnyPage = Awaited<ReturnType<typeof Browser.newPage>>;

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
}

export interface SeasonInfo {
	/** Season number. */
	season: number;
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
	// Uses word boundaries and case-insensitive matching to catch Episode/Épisode variants
	const m2 = /[Éè]?[Ee]pisod[eéèê]\s*(\d{1,3})|épis(?:od)?[eéèê]\s*(\d{1,3})/i.exec(title);
	if (m2) {
		// Try to guess season from context (if contains "Saison" or "Season")
		const season = (() => {
			const sm = /[Ss]aison\s*(\d{1,2})/i.exec(title);
			return sm ? parseInt(sm[1], 10) : 1;
		})();
		return {
			season,
			episode: parseInt(m2[1] || m2[2], 10),
		};
	}

	// Pattern 3: Ep. 5 (short form)
	const m3 = /\bEp\.?\s*(\d{1,3})/i.exec(title);
	if (m3) {
		const season = (() => {
			const sm = /[Ss](?:aison|eason)?\s*(\d{1,2})/i.exec(title);
			return sm ? parseInt(sm[1], 10) : 1;
		})();
		return {
			season,
			episode: parseInt(m3[1], 10),
		};
	}

	// Pattern 4: Trailing number (last sequence of 1-3 digits)
	const m4 = /(\d{1,3})(?!\d)/i.exec(title);
	if (m4) {
		const season = (() => {
			const sm = /[Ss](?:aison|eason)?\s*(\d{1,2})/i.exec(title);
			return sm ? parseInt(sm[1], 10) : 1;
		})();
		return {
			season,
			episode: parseInt(m4[1], 10),
		};
	}

	return { season: null, episode: null };
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class IETVScraper {
	private readonly profile: NonNullable<IETVOptions["profile"]>;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private readonly youtubeApiKey: string | null;
	private page: AnyPage | null = null;

	constructor(opts: IETVOptions = {}) {
		// YouTube requires JavaScript execution to load videos, so we default to "fast"
		// "static" mode will not work for YouTube's dynamic content.
		this.profile = opts.profile ?? "fast";
		this.timeoutMs = opts.timeoutMs ?? 30_000;
		this.retries = opts.retries ?? 2;
		// Try to load API key from secure sources if not provided
		this.youtubeApiKey = opts.youtubeApiKey ?? loadYouTubeApiKey();
	}

	private async getPage(): Promise<AnyPage> {
		if (!this.page)
			this.page = await Browser.newPage({ profile: this.profile });
		return this.page;
	}

	/** Fetch raw HTML for a URL with basic retry. */
	async fetchHtml(url: string): Promise<{ status: number; html: string }> {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			try {
				const page = await this.getPage();
				const resp = await page.goto(url, {
					timeoutMs: this.timeoutMs,
				});
				const html = await page.content();
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
	async getChannelEpisodes(channelHandleOrUrl: string): Promise<ChannelInfo> {
		// Normalize channel identifier
		let channelUrl: string;
		if (channelHandleOrUrl.startsWith("http")) {
			channelUrl = channelHandleOrUrl;
		} else if (channelHandleOrUrl.startsWith("@")) {
			channelUrl = `https://www.youtube.com/${channelHandleOrUrl}/videos`;
		} else {
			channelUrl = `https://www.youtube.com/@${channelHandleOrUrl}/videos`;
		}

		const handle = channelHandleOrUrl.replace(/^@/, "");
		const { status, html } = await this.fetchHtml(channelUrl);

		if (status !== 200) {
			throw new Error(`getChannelEpisodes(${channelUrl}): HTTP ${status}`);
		}

		// Parse videos and metadata
		const videos = this.parseChannelVideos(html);
		const meta = this.parseChannelMeta(html, handle);

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

		// Sort episodes within each season
		for (const eps of seasonMap.values()) {
			eps.sort((a, b) => {
				const aEp = a.episode ?? 0;
				const bEp = b.episode ?? 0;
				return aEp - bEp;
			});
		}

		// Build season array
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

		return {
			channel: handle,
			title: meta.title,
			description: meta.description,
			avatar: meta.avatar,
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
	 * Aggregate episodes from multiple Inazuma Eleven French channels.
	 */
	async getAllChannelEpisodes(): Promise<Array<ChannelInfo>> {
		const channels = [
			"inazumaelevenfrance1",
			"inazumatvfr",
			"inazumaelevengofrance",
			"InazumaTVFR__",
		];

		const results: ChannelInfo[] = [];
		for (const handle of channels) {
			try {
				const info = await this.getChannelEpisodes(handle);
				results.push(info);
			} catch (err) {
				console.warn(`Failed to fetch ${handle}: ${String(err)}`);
			}
		}

		return results;
	}

	/** Release the underlying page. */
	async close(): Promise<void> {
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
