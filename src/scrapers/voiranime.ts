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
 * @module bxc/scrapers/voiranime
 *
 * Dedicated, typed scraper for **voir-anime.to** — a WordPress site running the
 * Madara / `wp-manga` theme repurposed for anime streaming. Reverse-engineered
 * from live pages (2026-05-28). The whole extraction layer is **HTML-only** (no
 * DOM, no JS execution): it parses the server-rendered markup, so it works on a
 * persisted mirror just as well as on a live response. Network fetching uses
 * bxc's in-process `static` transport (zero browser spawn).
 *
 * Page anatomy (what the parsers rely on) :
 *
 *  - **Series page** `/anime/<slug>/` :
 *      - `<div class="post-title"><h1>…</h1>` → display title.
 *      - `.summary_image img[src]` / `og:image` → poster.
 *      - `.post-content_item` rows ( `.summary-heading h5` + `.summary-content` )
 *        carry Native/Romaji/English titles, Type, Status, Studios, Episodes,
 *        Start/End date and Genre(s) (the latter as `.genres-content a`).
 *      - `input.rating-post-id[value]` → WordPress post id of the series.
 *      - `#averagerate` / `#countrate` → aggregate rating + vote count.
 *      - `li.wp-manga-chapter > a[href]` (+ `.chapter-release-date i`) → one row
 *        per episode, newest first.
 *  - **Episode page** `/anime/<series>/<episode>/` :
 *      - `var thisChapterSources = { "<label>": "<iframe…>" , … };` — **every**
 *        mirror/player embed for the episode, inline in the HTML (no AJAX).
 *      - `#wp-manga-current-chap[data-id][value]` → chapter post id + slug.
 *      - `.c-selectpicker[data-manga]` → parent series post id.
 *
 * Direct-source resolution (`resolveSource`) turns a player embed into the real
 * media URL. It is reliable for **vidmoly** (JW Player `sources:[{file}]`,
 * tokenised HLS) and for any JW-Player-based clone (filemoon / "MOON",
 * streamhide, yourupload …) including Dean-Edwards-packed payloads. Heavily
 * obfuscated hosts (voe, mail.ru) are best-effort and report a clear error when
 * JS rendering would be required.
 *
 * @example
 * ```ts
 * import { VoiranimeScraper } from "bxc/scrapers/voiranime";
 *
 * const va = new VoiranimeScraper();
 * const anime = await va.getAnime("dragon-ball-vf");
 * console.log(anime.title, anime.episodes.length);          // Dragon Ball (VF) 153
 *
 * const ep = await va.getEpisode(anime.episodes.at(-1)!.url); // episode 001
 * console.log(ep.players.map((p) => `${p.name}:${p.provider}`));
 *
 * const src = await va.resolveSource(ep.players[0]);
 * console.log(src.type, src.url);                            // hls https://….m3u8
 * await va.close();
 * ```
 */

import { Browser } from "../api/browser.ts";

type AnyPage = Awaited<ReturnType<typeof Browser.newPage>>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnimeMeta {
	/** Display title (e.g. `"Dragon Ball (VF)"`). */
	title: string;
	/** URL slug (e.g. `"dragon-ball-vf"`). */
	slug: string;
	/** Canonical series URL. */
	url: string;
	/** WordPress post id of the series, when present. */
	postId: number | null;
	/** Full-resolution poster URL, when resolvable. */
	poster: string | null;
	/** Plot synopsis (may be truncated to the meta description). */
	synopsis: string | null;
	/** Whether the series carries the site's `VF` (French dub) flag. */
	isVF: boolean;
	/** Format: `TV`, `Movie`, `ONA`, `OVA`, `Special`, … */
	type: string | null;
	/** Airing status (`TERMINÉ`, `EN COURS`, …). */
	status: string | null;
	/** Animation studios. */
	studios: string[];
	/** Genres. */
	genres: string[];
	/** Alternative titles (Native / Romaji / English). */
	alternativeTitles: { native?: string; romaji?: string; english?: string };
	/** Declared episode count from the meta panel (may differ from list length). */
	declaredEpisodes: number | null;
	/** Air dates as printed on the page (locale strings, not normalised). */
	startDate: string | null;
	endDate: string | null;
	/** Aggregate rating out of 5. */
	rating: number | null;
	/** Vote count as printed (e.g. `"2.4K"`). */
	ratingCount: string | null;
}

export interface EpisodeRef {
	/** Parsed episode number, when derivable. */
	number: number | null;
	/** Raw chapter label (e.g. `"Dragon Ball - 001 VF - 001"`). */
	label: string;
	/** Episode URL slug (e.g. `"dragon-ball-001-vf"`). */
	slug: string;
	/** Absolute episode URL. */
	url: string;
	/** Release date string as printed, when present. */
	releaseDate: string | null;
}

export interface AnimeInfo extends AnimeMeta {
	/** Episode list, ordered ascending by number (oldest → newest). */
	episodes: EpisodeRef[];
}

export interface PlayerEmbed {
	/** Raw label from the source map (e.g. `"LECTEUR myTV"`). */
	label: string;
	/** Short player name (e.g. `"myTV"`). */
	name: string;
	/** Normalised provider key (`vidmoly`, `voe`, `streamtape`, …). */
	provider: string;
	/** The iframe `src` embed URL. */
	embedUrl: string;
}

export interface EpisodeInfo {
	/** Absolute episode URL. */
	url: string;
	/** Episode slug. */
	slug: string;
	/** Parsed episode number, when derivable. */
	number: number | null;
	/** Episode heading / title, when present. */
	title: string | null;
	/** WordPress chapter post id. */
	chapterId: number | null;
	/** Parent series post id. */
	mangaId: number | null;
	/** Parent series slug, derived from the URL. */
	seriesSlug: string | null;
	/** All available player embeds. */
	players: PlayerEmbed[];
	/** Embed shown by default in the page (`#chapter-video-frame iframe`). */
	defaultEmbed: string | null;
	/** Previous / next episode URLs, when present. */
	prev: string | null;
	next: string | null;
}

export interface MediaQuality {
	label: string;
	url: string;
	resolution?: string;
	bandwidth?: number;
}

export interface ResolvedSource {
	provider: string;
	embedUrl: string;
	/** `hls` for `.m3u8`, `mp4` for progressive, `unknown` otherwise. */
	type: "hls" | "mp4" | "unknown";
	/** The direct media URL, or `null` when resolution failed. */
	url: string | null;
	/** Poster / preview image declared by the player, when present. */
	poster: string | null;
	/** HLS variant streams, when the master playlist was enumerated. */
	qualities?: MediaQuality[];
	/** Request headers required for playback (notably `Referer`). */
	headers: Record<string, string>;
	/** Human-readable failure reason when `url` is `null`. */
	error: string | null;
}

export interface VoiranimeOptions {
	/** bxc transport profile. `static` (default) is fastest and zero-spawn. */
	profile?: "static" | "http" | "fast" | "stealth" | "max";
	/** Site origin override (default `https://voir-anime.to`). */
	baseUrl?: string;
	/** Per-request navigation timeout in ms (default 30000). */
	timeoutMs?: number;
	/** Retries per fetch on transient failure (default 2). */
	retries?: number;
}

// ---------------------------------------------------------------------------
// HTML helpers (pure)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	quot: '"',
	amp: "&",
	apos: "'",
	lt: "<",
	gt: ">",
	nbsp: " ",
	hellip: "…",
	laquo: "«",
	raquo: "»",
	eacute: "é",
	egrave: "è",
};

function decodeEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(
			/&([a-z]+);/gi,
			(m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m,
		);
}

function stripTags(s: string): string {
	return decodeEntities(s.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function lastPathSegment(url: string): string {
	return (
		url
			.replace(/[?#].*$/, "")
			.replace(/\/+$/, "")
			.split("/")
			.pop() ?? ""
	);
}

function episodeNumberFrom(label: string, slug: string): number | null {
	// Prefer the trailing number of the label ("… - 001 VF - 001" → 1).
	const fromLabel = label.match(/(\d{1,4})(?!.*\d)/);
	if (fromLabel) return parseInt(fromLabel[1], 10);
	const fromSlug = slug.match(/(\d{1,4})(?:-vf)?$/);
	return fromSlug ? parseInt(fromSlug[1], 10) : null;
}

function metaContent(html: string, key: string): string | null {
	const re = new RegExp(
		`<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
		"i",
	);
	const m = re.exec(html);
	if (m) return decodeEntities(m[1]);
	const re2 = new RegExp(
		`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
		"i",
	);
	const m2 = re2.exec(html);
	return m2 ? decodeEntities(m2[1]) : null;
}

/** Strip Madara's `-WIDTHxHEIGHT` thumbnail suffix to recover the original. */
function originalImage(src: string): string {
	return src.replace(/-\d{2,4}x\d{2,4}(\.[a-z]{3,4})(\?.*)?$/i, "$1$2");
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const PROVIDER_MATCHERS: Array<[RegExp, string]> = [
	[/vidmoly/i, "vidmoly"],
	[/voe\.sx|voe\b|\bvoe/i, "voe"],
	[/streamtape|strtape|tapecontent|streamadblock/i, "streamtape"],
	[/streamhide|guccihide|haghalaz|movearnpre/i, "streamhide"],
	[/yourupload/i, "yourupload"],
	[/mail\.ru/i, "mailru"],
	[/weneverbeenfree|filemoon|moon|kerapoxy/i, "filemoon"],
	[/dood|dood\.|d000d|dooood|ds2play/i, "doodstream"],
	[/mp4upload/i, "mp4upload"],
	[/sendvid/i, "sendvid"],
];

export function providerFromUrl(embedUrl: string): string {
	for (const [re, name] of PROVIDER_MATCHERS)
		if (re.test(embedUrl)) return name;
	try {
		return new URL(embedUrl).hostname.replace(/^www\./, "");
	} catch {
		return "unknown";
	}
}

function playerNameFromLabel(label: string): string {
	return label.replace(/^\s*LECTEUR\s*/i, "").trim() || label.trim();
}

// ---------------------------------------------------------------------------
// Pure parsers (work on a string of HTML)
// ---------------------------------------------------------------------------

/** Extract the `.post-content_item` heading→value map of a series page. */
function parseMetaRows(html: string): Record<string, string> {
	const rows: Record<string, string> = {};
	const blocks = html.split('class="post-content_item"').slice(1);
	for (const block of blocks) {
		const h = /<h5>\s*([\s\S]*?)<\/h5>/.exec(block);
		const c = /class="summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
		if (!h || !c) continue;
		const key = stripTags(h[1]).toLowerCase();
		if (key && !(key in rows)) rows[key] = stripTags(c[1]);
	}
	return rows;
}

function pickRow(
	rows: Record<string, string>,
	...keys: string[]
): string | null {
	for (const k of keys) {
		const v = rows[k.toLowerCase()];
		if (v) return v;
	}
	return null;
}

/** Parse the metadata block of a series page into {@link AnimeMeta}. */
export function parseAnimeMeta(html: string, url: string): AnimeMeta {
	const slug = lastPathSegment(url);
	const rows = parseMetaRows(html);

	const h1 = /<div class="post-title">\s*<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
	const title =
		(h1 ? stripTags(h1[1]) : "") ||
		(metaContent(html, "og:title") ?? "")
			.replace(/^Regarder gratuitement\s+/i, "")
			.replace(/\s+en HD-?\s*Voiranime\s*$/i, "")
			.trim() ||
		slug;

	const imgMatch =
		/<div class="summary_image">[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(html);
	const poster = imgMatch
		? originalImage(imgMatch[1])
		: metaContent(html, "og:image");

	const synEl =
		/<div class="(?:summary__content|manga-excerpt|description-summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
			html,
		);
	const synopsis = synEl
		? stripTags(synEl[1])
		: metaContent(html, "og:description");

	const genres: string[] = [];
	const genresBlock = /<div class="genres-content">([\s\S]*?)<\/div>/i.exec(
		html,
	);
	if (genresBlock) {
		for (const m of genresBlock[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
			genres.push(decodeEntities(m[1]).trim());
		}
	}

	const postId = (() => {
		const m = /class="rating-post-id"\s+value="(\d+)"/.exec(html);
		return m ? parseInt(m[1], 10) : null;
	})();

	const rating = (() => {
		const m = /<span id="averagerate">\s*([\d.]+)/.exec(html);
		return m ? parseFloat(m[1]) : null;
	})();
	const ratingCount = (() => {
		const m = /<span id="countrate">\s*([^<]+)</.exec(html);
		return m ? m[1].trim() : null;
	})();

	const declaredRaw = pickRow(rows, "episodes", "episode");
	const declaredEpisodes = declaredRaw
		? parseInt(declaredRaw.replace(/[^\d]/g, ""), 10) || null
		: null;

	const studiosRaw = pickRow(rows, "studios", "studio", "studio(s)");
	const studios = studiosRaw
		? studiosRaw
				.split(/,|·/)
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

	return {
		title,
		slug,
		url,
		postId,
		poster,
		synopsis,
		isVF: /manga-vf-flag/i.test(html) || /\(VF\)/i.test(title),
		type: pickRow(rows, "type", "format"),
		status: pickRow(rows, "status", "statut"),
		studios,
		genres,
		alternativeTitles: {
			native: pickRow(rows, "native") ?? undefined,
			romaji: pickRow(rows, "romaji") ?? undefined,
			english: pickRow(rows, "english") ?? undefined,
		},
		declaredEpisodes,
		startDate: pickRow(
			rows,
			"start date",
			"date de sortie",
			"released",
			"aired",
		),
		endDate: pickRow(rows, "end date"),
		rating,
		ratingCount,
	};
}

/** Parse the `li.wp-manga-chapter` episode list of a series page. */
export function parseEpisodeList(html: string): EpisodeRef[] {
	const out: EpisodeRef[] = [];
	const blocks = html.split('class="wp-manga-chapter').slice(1);
	for (const block of blocks) {
		const a = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
		if (!a) continue;
		const url = a[1].trim();
		if (!/\/anime\//.test(url)) continue;
		const label = stripTags(a[2]);
		const slug = lastPathSegment(url);
		const dateM = /chapter-release-date[\s\S]*?<i>([^<]*)<\/i>/.exec(block);
		out.push({
			number: episodeNumberFrom(label, slug),
			label,
			slug,
			url,
			releaseDate: dateM ? stripTags(dateM[1]) : null,
		});
	}
	// Page lists newest-first; return ascending for stable consumption.
	out.sort((x, y) => {
		if (x.number != null && y.number != null) return x.number - y.number;
		return 0;
	});
	return out;
}

/** Parse a full series page (metadata + episode list). */
export function parseAnime(html: string, url: string): AnimeInfo {
	return { ...parseAnimeMeta(html, url), episodes: parseEpisodeList(html) };
}

/** Parse the player embeds (`thisChapterSources`) of an episode page. */
export function parsePlayers(html: string): PlayerEmbed[] {
	const m = /var\s+thisChapterSources\s*=\s*(\{[\s\S]*?\})\s*;/.exec(html);
	if (!m) return [];
	let map: Record<string, string>;
	try {
		map = JSON.parse(m[1]);
	} catch {
		return [];
	}
	const players: PlayerEmbed[] = [];
	for (const [label, iframe] of Object.entries(map)) {
		if (!iframe) continue;
		const src = /src=["']([^"']+)["']/i.exec(iframe);
		if (!src) continue;
		const embedUrl = src[1];
		players.push({
			label,
			name: playerNameFromLabel(label),
			provider: providerFromUrl(embedUrl),
			embedUrl,
		});
	}
	return players;
}

/** Parse a full episode page. */
export function parseEpisode(html: string, url: string): EpisodeInfo {
	const slug = lastPathSegment(url);
	const seriesSlug = (() => {
		const m = /\/anime\/([^/]+)\/[^/]+\/?$/.exec(url);
		return m ? m[1] : null;
	})();

	const chap =
		/id="wp-manga-current-chap"\s+data-id="(\d+)"\s+value="([^"]*)"/.exec(html);
	const mangaM = /class="c-selectpicker[^"]*"\s+data-manga="(\d+)"/.exec(html);

	const defM =
		/id="chapter-video-frame"[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(html);

	const titleM =
		/<h1[^>]+id="chapter-heading"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ??
		/class="breadcrumb"[\s\S]*?<li[^>]*>\s*([^<]+?)\s*<\/li>\s*<\/ol>/i.exec(
			html,
		);

	const nextM = /<a[^>]+href="([^"]+)"[^>]*>\s*(?:Next|Suivant)\b/i.exec(html);
	const prevM =
		/<a[^>]+href="([^"]+)"[^>]*>\s*(?:Prev(?:ious)?|Précédent)\b/i.exec(html);

	const label = chap ? chap[2] : slug;
	return {
		url,
		slug,
		number: episodeNumberFrom(label, slug),
		title: titleM ? stripTags(titleM[1]) : null,
		chapterId: chap ? parseInt(chap[1], 10) : null,
		mangaId: mangaM ? parseInt(mangaM[1], 10) : null,
		seriesSlug,
		players: parsePlayers(html),
		defaultEmbed: defM ? defM[1] : null,
		prev: prevM ? prevM[1] : null,
		next: nextM ? nextM[1] : null,
	};
}

// ---------------------------------------------------------------------------
// Direct-source resolution helpers
// ---------------------------------------------------------------------------

/** Unpack a Dean-Edwards `eval(function(p,a,c,k,e,d){…})` payload, if present. */
export function unpackPacker(source: string): string {
	const m =
		/}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\s*\.split\('\|'\)/.exec(
			source,
		);
	if (!m) return source;
	let payload = m[1];
	const a = parseInt(m[2], 10);
	let c = parseInt(m[3], 10);
	const k = m[4].split("|");
	payload = payload
		.replace(/\\'/g, "'")
		.replace(/\\\\/g, "\\")
		.replace(/\\n/g, "\n");
	const enc = (n: number): string => {
		const lo = n % a;
		const rest = Math.floor(n / a);
		const tok = lo > 35 ? String.fromCharCode(lo + 29) : lo.toString(36);
		return (n < a ? "" : enc(rest)) + tok;
	};
	while (c--) {
		if (k[c])
			payload = payload.replace(new RegExp("\\b" + enc(c) + "\\b", "g"), k[c]);
	}
	return payload;
}

function classifyMedia(u: string): "hls" | "mp4" | "unknown" {
	if (/\.m3u8(\?|$)/i.test(u)) return "hls";
	if (/\.mp4(\?|$)/i.test(u)) return "mp4";
	return "unknown";
}

/** Scan a player page body for a JW-Player source / bare media URL. */
function scanForMedia(body: string): {
	url: string | null;
	poster: string | null;
} {
	const unpacked = unpackPacker(body);
	const haystack = body + "\n" + unpacked;

	const fromSources =
		/sources?\s*:\s*\[\s*\{[^}]*?\bfile\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(
			haystack,
		) ??
		/\bfile\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(haystack) ??
		/["']?(?:hls|src|url)["']?\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(
			haystack,
		);
	let url = fromSources ? fromSources[1] : null;

	if (!url) {
		const bare = haystack.match(
			/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/i,
		);
		url = bare ? bare[0] : null;
	}

	const posterM = /\bimage\s*:\s*["']([^"']+)["']/i.exec(haystack);
	return {
		url: url ? url.replace(/\\\//g, "/") : null,
		poster: posterM ? posterM[1] : null,
	};
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class VoiranimeScraper {
	readonly baseUrl: string;
	private readonly profile: NonNullable<VoiranimeOptions["profile"]>;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private page: AnyPage | null = null;

	constructor(opts: VoiranimeOptions = {}) {
		this.baseUrl = (opts.baseUrl ?? "https://voir-anime.to").replace(
			/\/+$/,
			"",
		);
		this.profile = opts.profile ?? "static";
		this.timeoutMs = opts.timeoutMs ?? 30_000;
		this.retries = opts.retries ?? 2;
	}

	/** Resolve a slug or absolute URL to an absolute series/episode URL. */
	private animeUrl(slugOrUrl: string): string {
		if (/^https?:\/\//i.test(slugOrUrl)) return slugOrUrl;
		return `${this.baseUrl}/anime/${slugOrUrl.replace(/^\/+|\/+$/g, "")}/`;
	}

	private async getPage(): Promise<AnyPage> {
		if (!this.page)
			this.page = await Browser.newPage({ profile: this.profile });
		return this.page;
	}

	/** Fetch raw HTML for a URL with a site Referer and basic retry. */
	async fetchHtml(
		url: string,
		referer = `${this.baseUrl}/`,
	): Promise<{ status: number; html: string }> {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			try {
				const page = await this.getPage();
				const resp = await page.goto(url, {
					timeoutMs: this.timeoutMs,
					referer,
				});
				const html = await page.content();
				return { status: resp.status, html };
			} catch (err) {
				lastErr = err;
				// A dead socket can poison the reused page — drop it before retrying.
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

	/** Fetch + parse a full series page (metadata + episode list). */
	async getAnime(slugOrUrl: string): Promise<AnimeInfo> {
		const url = this.animeUrl(slugOrUrl);
		const { status, html } = await this.fetchHtml(url);
		if (status !== 200) throw new Error(`getAnime(${url}): HTTP ${status}`);
		return parseAnime(html, url);
	}

	/** Fetch + parse a single episode page (players + navigation). */
	async getEpisode(slugOrUrl: string): Promise<EpisodeInfo> {
		const url = /^https?:\/\//i.test(slugOrUrl)
			? slugOrUrl
			: this.animeUrl(slugOrUrl);
		const { status, html } = await this.fetchHtml(url);
		if (status !== 200) throw new Error(`getEpisode(${url}): HTTP ${status}`);
		return parseEpisode(html, url);
	}

	/**
	 * Search the site catalogue. Uses the server-rendered Madara search
	 * (`/page/N/?s=…&post_type=wp-manga`) and follows pagination until empty.
	 */
	async search(
		query: string,
		opts: { maxPages?: number } = {},
	): Promise<Array<{ slug: string; title: string; url: string }>> {
		const maxPages = opts.maxPages ?? 10;
		const seen = new Map<
			string,
			{ slug: string; title: string; url: string }
		>();
		for (let p = 1; p <= maxPages; p++) {
			const url = `${this.baseUrl}/page/${p}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
			const { status, html } = await this.fetchHtml(url);
			if (status !== 200) break;
			let added = 0;
			for (const m of html.matchAll(
				/<h3 class="h4"><a href="(https:\/\/[^"]+\/anime\/([a-z0-9-]+)\/)"[^>]*>([\s\S]*?)<\/a>/g,
			)) {
				if (!seen.has(m[2])) {
					seen.set(m[2], { slug: m[2], title: stripTags(m[3]), url: m[1] });
					added++;
				}
			}
			if (added === 0 && p > 1) break;
		}
		return [...seen.values()];
	}

	/**
	 * Resolve a player embed to a direct media URL.
	 *
	 * Reliable for vidmoly and JW-Player-based hosts; obfuscated hosts
	 * (voe, mail.ru) return `url: null` with an explanatory `error`.
	 */
	async resolveSource(
		player: PlayerEmbed | string,
		opts: { enumerateQualities?: boolean } = {},
	): Promise<ResolvedSource> {
		const embedUrl = typeof player === "string" ? player : player.embedUrl;
		const provider =
			typeof player === "string" ? providerFromUrl(embedUrl) : player.provider;
		const playbackReferer = (() => {
			try {
				return `${new URL(embedUrl).origin}/`;
			} catch {
				return `${this.baseUrl}/`;
			}
		})();
		const base: ResolvedSource = {
			provider,
			embedUrl,
			type: "unknown",
			url: null,
			poster: null,
			headers: { Referer: playbackReferer },
			error: null,
		};

		let status: number, html: string;
		try {
			({ status, html } = await this.fetchHtml(embedUrl, `${this.baseUrl}/`));
		} catch (err) {
			return { ...base, error: `fetch failed: ${String(err)}` };
		}
		if (status !== 200) return { ...base, error: `embed HTTP ${status}` };

		const { url, poster } = scanForMedia(html);
		if (!url) {
			const hint =
				provider === "voe" || provider === "mailru"
					? `${provider} is obfuscated — JS rendering (profile "fast") required`
					: "no JW-Player source / media URL found in embed";
			return { ...base, poster, error: hint };
		}

		const type = classifyMedia(url);
		const resolved: ResolvedSource = { ...base, type, url, poster };

		if (opts.enumerateQualities && type === "hls") {
			try {
				resolved.qualities = await this.enumerateHlsQualities(
					url,
					playbackReferer,
				);
			} catch {
				/* non-fatal */
			}
		}
		return resolved;
	}

	/** Fetch + parse an HLS master playlist into its variant streams. */
	async enumerateHlsQualities(
		masterUrl: string,
		referer: string,
	): Promise<MediaQuality[]> {
		const { status, html } = await this.fetchHtml(masterUrl, referer);
		if (status !== 200) return [];
		const text = html.replace(/<[^>]+>/g, "");
		const out: MediaQuality[] = [];
		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
			const res = /RESOLUTION=([0-9x]+)/.exec(line)?.[1];
			const bw = /BANDWIDTH=(\d+)/.exec(line)?.[1];
			const uri = (lines[i + 1] ?? "").trim();
			if (!uri || uri.startsWith("#")) continue;
			out.push({
				label:
					res ??
					(bw ? `${Math.round(+bw / 1000)}kbps` : `variant ${out.length + 1}`),
				url: uri,
				resolution: res,
				bandwidth: bw ? parseInt(bw, 10) : undefined,
			});
		}
		return out;
	}

	/**
	 * Map an episode end-to-end: its metadata, every player, and (optionally)
	 * the resolved direct source for each player.
	 */
	async mapEpisode(
		slugOrUrl: string,
		opts: { resolve?: boolean; enumerateQualities?: boolean } = {},
	): Promise<EpisodeInfo & { sources?: ResolvedSource[] }> {
		const ep = await this.getEpisode(slugOrUrl);
		if (!opts.resolve) return ep;
		const sources: ResolvedSource[] = [];
		for (const p of ep.players) {
			sources.push(
				await this.resolveSource(p, {
					enumerateQualities: opts.enumerateQualities,
				}),
			);
		}
		return { ...ep, sources };
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

export default VoiranimeScraper;
