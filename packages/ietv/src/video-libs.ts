/**
 * Video Libraries Integration — Best-in-class 2024-2025
 *
 * Based on research findings:
 * - Player: media-chrome + hls.js (lightweight) OR vidstack@next (batteries-included)
 * - Compression: mediabunny + @mediabunny/server (Bun-native WebCodecs + FFmpeg)
 * - Search: mediainfo.js (metadata WASM) + mediabunny CanvasSink (thumbnails)
 *
 * Status: Integration template (awaiting npm package additions)
 */

/**
 * Video Player Options
 *
 * Option A: media-chrome + hls.js (Recommended for IETV)
 * - Lightweight (41.9 KB + 177 KB)
 * - Web Components (zero framework lock-in)
 * - Active maintenance (hls.js pushed 2026-09-01)
 * - Bun-safe (no Node APIs)
 *
 * Usage:
 *   npm install media-chrome hls.js
 *   import MediaChromePlayer from 'media-chrome/player'
 *   import HLS from 'hls.js'
 */
export interface VideoPlayerOption {
	type: "media-chrome" | "vidstack" | "video.js" | "shaka-player";
	description: string;
	size: string; // gzipped
	maintenance: "active" | "stable" | "legacy";
	dependencies: number;
	bestFor: string;
}

export const VIDEO_PLAYER_OPTIONS: Record<string, VideoPlayerOption> = {
	"media-chrome": {
		type: "media-chrome",
		description: "Web Components UI layer for <video> + HLS.js/DASH.js",
		size: "41.9 KB",
		maintenance: "active",
		dependencies: 1,
		bestFor: "Lightweight, framework-agnostic, accessible controls",
	},

	"hls.js": {
		type: "media-chrome", // Often paired
		description: "HLS protocol implementation (Disney, Canal+, Twitch standard)",
		size: "177 KB",
		maintenance: "active",
		dependencies: 0,
		bestFor: "HLS-only streaming (most video CDNs)",
	},

	"vidstack@next": {
		type: "vidstack",
		description: "Batteries-included player (wraps HLS.js/DASH.js internally)",
		size: "~100 KB base",
		maintenance: "active",
		dependencies: "minimal",
		bestFor: "React/Vue/Svelte/Web Components, multi-framework support",
	},

	"video.js": {
		type: "video.js",
		description: "Mature, large ecosystem (12 deps, 203 KB gzipped)",
		size: "203 KB",
		maintenance: "stable",
		dependencies: 12,
		bestFor: "Legacy integrations, extensive plugin ecosystem",
	},

	"shaka-player": {
		type: "shaka-player",
		description: "Google's DASH player (dash.js alternative)",
		size: "~180 KB",
		maintenance: "active",
		dependencies: 0,
		bestFor: "DASH streaming (less common than HLS)",
	},
};

/**
 * Video Compression Options
 *
 * Top Pick: mediabunny + @mediabunny/server
 * - Bun-native (works Node/Bun/Deno)
 * - WebCodecs API (hardware acceleration when available)
 * - Supports: AVC, HEVC, VP9, AV1, ProRes
 * - CRF mode (constant quality vs bitrate)
 * - Zero external dependencies
 * - 167 KB full (tree-shakable to 5 KB)
 *
 * Usage:
 *   npm install mediabunny @mediabunny/server
 *   import { Conversion } from 'mediabunny'
 *
 * Alternative: FFmpeg CLI via Bun.spawn
 * - More mature (decades of optimization)
 * - SVT-AV1 codec (Netflix/Intel reference)
 * - 20-50% bitrate savings vs H.264 (at equal quality)
 */
export interface CompressionOption {
	library: string;
	type: "webcodecs" | "ffmpeg-native" | "wasm";
	codecs: string[];
	mode: "crf" | "bitrate" | "both";
	multithread: boolean;
	bunSupport: boolean;
	activelyMaintained: boolean;
	notes: string;
}

export const COMPRESSION_OPTIONS: Record<string, CompressionOption> = {
	mediabunny: {
		library: "mediabunny + @mediabunny/server",
		type: "webcodecs",
		codecs: ["AVC", "HEVC", "VP9", "AV1", "ProRes"],
		mode: "both",
		multithread: true,
		bunSupport: true,
		activelyMaintained: true,
		notes:
			"WebCodecs API with hardware accel; @mediabunny/server adds node-av for native encoders; published 2026-08-31",
	},

	"ffmpeg-cli": {
		library: "ffmpeg-static + Bun.spawn",
		type: "ffmpeg-native",
		codecs: ["AVC", "HEVC", "VP9", "AV1", "ProRes", "custom"],
		mode: "both",
		multithread: true,
		bunSupport: true,
		activelyMaintained: true,
		notes:
			"Binaries via ffmpeg-static; spawn(['ffmpeg', ...args]); SVT-AV1 recommended for AV1",
	},

	"@ffmpeg/ffmpeg": {
		library: "@ffmpeg/ffmpeg (WASM)",
		type: "wasm",
		codecs: ["AVC", "HEVC", "VP9"],
		mode: "bitrate",
		multithread: false,
		bunSupport: false,
		activelyMaintained: true,
		notes: "Browser/edge-focused; slow encoding; no hardware acceleration",
	},
};

/**
 * Video Search / Metadata Options
 *
 * For IETV specifically:
 * - SQLite FTS5 (already in cache.ts) covers most search needs
 * - mediainfo.js for deep metadata extraction
 * - mediabunny CanvasSink for thumbnail generation
 * - YouTube thumbnails free via https://i.ytimg.com/vi/{videoId}/hqdefault.jpg
 */
export interface SearchOption {
	library: string;
	type: "fts" | "metadata" | "thumbnail" | "full-text-engine";
	searchType: "fuzzy" | "exact" | "full-text" | "typo-tolerant";
	useCase: string;
	activelyMaintained: boolean;
	selfHosted: boolean;
}

export const SEARCH_OPTIONS: Record<string, SearchOption> = {
	"sqlite-fts5": {
		library: "SQLite FTS5 (built-in)",
		type: "fts",
		searchType: "full-text",
		useCase: "IETV current scale (~1,200 episodes)",
		activelyMaintained: true,
		selfHosted: true,
	},

	"mediainfo.js": {
		library: "mediainfo.js (WASM port)",
		type: "metadata",
		searchType: "exact",
		useCase: "Extract codec/duration/HDR/chapters from video files",
		activelyMaintained: true,
		selfHosted: true,
	},

	"mediabunny-canvas": {
		library: "mediabunny CanvasSink",
		type: "thumbnail",
		searchType: "exact",
		useCase: "Generate thumbnails at multiple timestamps (batch extract)",
		activelyMaintained: true,
		selfHosted: true,
	},

	meilisearch: {
		library: "meilisearch (client)",
		type: "full-text-engine",
		searchType: "typo-tolerant",
		useCase: "Large scale search with typo tolerance + faceting",
		activelyMaintained: true,
		selfHosted: true, // Self-host only (privacy)
	},

	typesense: {
		library: "typesense (client)",
		type: "full-text-engine",
		searchType: "typo-tolerant",
		useCase: "Alternative to meilisearch with slightly different perf profile",
		activelyMaintained: true,
		selfHosted: true,
	},
};

/**
 * Integration Template for IETV
 */
export interface VideoIntegrationPlan {
	phase: number;
	component: string;
	library: string;
	priority: "immediate" | "high" | "medium" | "future";
	status: "done" | "ready" | "planned" | "research";
	notes: string;
}

export const IETV_INTEGRATION_PLAN: VideoIntegrationPlan[] = [
	{
		phase: 1,
		component: "Player",
		library: "media-chrome + hls.js",
		priority: "high",
		status: "ready",
		notes:
			"Lightweight, Bun-safe, Web Components. For Tauri/web clients. Install: npm install media-chrome hls.js",
	},

	{
		phase: 1,
		component: "Search",
		library: "SQLite FTS5 (existing)",
		priority: "immediate",
		status: "done",
		notes:
			"Already implemented in cache.ts. Covers 99% of IETV search needs at current scale.",
	},

	{
		phase: 2,
		component: "Compression",
		library: "mediabunny + @mediabunny/server",
		priority: "high",
		status: "ready",
		notes:
			"For self-hosted/cache-local mode. Bun-native, WebCodecs + FFmpeg backend. Install: npm install mediabunny @mediabunny/server",
	},

	{
		phase: 2,
		component: "Thumbnails",
		library: "YouTube free URLs + mediabunny CanvasSink (future)",
		priority: "medium",
		status: "ready",
		notes:
			"Short-term: fetch https://i.ytimg.com/vi/{videoId}/hqdefault.jpg. Long-term: mediabunny if self-hosted.",
	},

	{
		phase: 3,
		component: "Metadata",
		library: "mediainfo.js",
		priority: "medium",
		status: "planned",
		notes:
			"For deep codec/duration/HDR extraction from local video files (self-hosted mode). Optional.",
	},

	{
		phase: 3,
		component: "Advanced Search",
		library: "meilisearch (optional)",
		priority: "future",
		status: "planned",
		notes:
			"Only if IETV scales to 10k+ episodes. Typo-tolerant search, faceting. Self-host only.",
	},
];

/**
 * Recommended Stack for IETV (Next Version)
 */
export const RECOMMENDED_STACK = {
	player: "media-chrome (UI) + hls.js (protocol) OR vidstack@next (batteries-included)",
	compression: "mediabunny + @mediabunny/server (Bun-native, WebCodecs + FFmpeg)",
	search: "SQLite FTS5 (current) → meilisearch (if 10k+ episodes)",
	metadata: "mediainfo.js (optional, for local video files)",
	thumbnails: "YouTube free URLs (current) → mediabunny CanvasSink (if self-hosted)",
	deployment: "Docker + Bun (zero external FFmpeg needed if using WebCodecs)",
	estimate: "Add ~300KB npm deps (media-chrome + hls.js + mediabunny)",
};

export default {
	playerOptions: VIDEO_PLAYER_OPTIONS,
	compressionOptions: COMPRESSION_OPTIONS,
	searchOptions: SEARCH_OPTIONS,
	integrationPlan: IETV_INTEGRATION_PLAN,
	recommendedStack: RECOMMENDED_STACK,
};
