// SPDX-License-Identifier: Apache-2.0
/**
 * `@aphrody/frames` — retrouver une image dans un anime, image par image.
 *
 * Deux façons de répondre à « d'où vient cette capture ? » coexistent ici :
 *
 *  - **l'index local** : on indexe soi-même les épisodes qu'on possède, une
 *    empreinte de 33 octets par trame échantillonnée. Aucun quota, aucune
 *    limite de débit, aucune image envoyée à un tiers, et surtout : ça marche
 *    sur ce que les index publics n'ont pas — les VF, les séries récentes, les
 *    films, tout ce qui n'a jamais été indexé ailleurs ;
 *  - **trace.moe** : 1,7 milliard de trames déjà indexées, mais 100 recherches
 *    par jour et rien pour ce qu'il ne connaît pas.
 *
 * {@link FrameSearch} enchaîne les deux : local d'abord, distant seulement si
 * le local ne répond pas — et alors sous forme de **vecteur**, pas d'image
 * (33 entiers partent, la capture reste sur la machine).
 */

export {
	CL_DIMS,
	CL_C_COUNT,
	CL_Y_COUNT,
	DISTANCE_SCALE,
	colorLayoutDistance,
	decodeVector,
	encodeVector,
	extractColorLayout,
	packVector,
	similarityFromDistance,
	unpackVector,
	type ColorLayoutVector,
	type PixelData,
} from "./descriptor.ts";

export {
	buildFrameArgs,
	buildProbeArgs,
	buildStillArgs,
	decodeStill,
	iterateFrames,
	parseProbe,
	probeMedia,
	timecode,
	type DecodedFrame,
	type FfmpegDeps,
	type FrameStreamOptions,
	type MediaInfo,
	type SpawnedProcess,
	type Spawner,
} from "./ffmpeg.ts";

export {
	FrameIndex,
	defaultIndexPath,
	type FrameRow,
	type IndexStats,
	type MediaMeta,
	type MediaRow,
} from "./store.ts";

export {
	SCENE_MAX_SPAN_MS,
	SCENE_TOLERANCE,
	formatTimecode,
	searchIndex,
	type SceneMatch,
	type SearchOptions,
} from "./search.ts";

export {
	TRACE_MOE_ENDPOINT,
	TraceMoeClient,
	TraceMoeError,
	type AnilistInfo,
	type TraceMoeErrorKind,
	type TraceMoeOptions,
	type TraceMoeQuota,
	type TraceMoeResponse,
	type TraceMoeResult,
	type TraceMoeSearchOptions,
} from "./trace-moe.ts";

import { extractColorLayout, packVector, type ColorLayoutVector } from "./descriptor.ts";
import { decodeStill, iterateFrames, probeMedia, type FfmpegDeps } from "./ffmpeg.ts";
import { FrameIndex, type MediaMeta } from "./store.ts";
import { searchIndex, type SceneMatch, type SearchOptions } from "./search.ts";
import {
	TraceMoeClient,
	type TraceMoeOptions,
	type TraceMoeResult,
	type TraceMoeSearchOptions,
} from "./trace-moe.ts";

/** Seuil au-dessous duquel un résultat est réputé faux, des deux côtés. */
export const CONFIDENCE_THRESHOLD = 0.9;

/** Réglages d'une indexation. */
export interface IndexVideoOptions {
	/** Trames indexées par seconde de vidéo (défaut : 1). */
	fps?: number;
	/** Côté de la vignette décodée (défaut : 128). */
	size?: number;
	title?: string;
	season?: number | null;
	episode?: number | null;
	/** Réindexer même si le média est déjà présent avec la même cadence. */
	force?: boolean;
	/** Appelé tous les `progressEvery` trames — pour un affichage de progression. */
	onProgress?: (indexed: number, tMs: number) => void;
	progressEvery?: number;
}

/** Bilan d'une indexation. */
export interface IndexVideoResult {
	mediaId: number;
	frames: number;
	durationMs: number;
	/** Vrai si le média était déjà indexé et n'a pas été retouché. */
	skipped: boolean;
}

/** Un résultat, quelle que soit sa provenance. */
export interface UnifiedMatch {
	title: string;
	episode: number | number[] | null;
	season: number | null;
	fromMs: number;
	atMs: number;
	toMs: number;
	similarity: number;
	/** Source locale (chemin du média) ou nom de fichier côté trace.moe. */
	source: string;
	/** Identifiant AniList, uniquement pour un résultat distant. */
	anilist?: number;
	/** Aperçus fournis par trace.moe, valables 5 minutes. */
	preview?: { image: string; video: string };
}

/** Réponse de {@link FrameSearch.search}. */
export interface UnifiedSearch {
	origin: "local" | "remote";
	matches: UnifiedMatch[];
	/** Renseigné après un appel distant. */
	quota?: { used: number; total: number };
}

/** Mode de recherche : local seul, distant seul, ou local puis distant. */
export type SearchMode = "auto" | "local" | "remote";

/** Réglages de {@link FrameSearch}. */
export interface FrameSearchOptions {
	index?: FrameIndex;
	indexPath?: string;
	ffmpeg?: FfmpegDeps;
	traceMoe?: TraceMoeClient | TraceMoeOptions;
	/**
	 * Côté de la vignette décodée, en pixels (défaut : 128).
	 *
	 * Une seule valeur pour l'indexation et pour les requêtes : deux tailles
	 * différentes donnent des descripteurs légèrement différents, donc des
	 * distances qui ne veulent plus rien dire.
	 */
	size?: number;
}

/**
 * Façade : indexe des vidéos, cherche en local, retombe sur trace.moe.
 */
export class FrameSearch {
	public readonly index: FrameIndex;
	public readonly traceMoe: TraceMoeClient;
	/** Côté de la vignette décodée, partagé par l'indexation et les requêtes. */
	public readonly size: number;
	private readonly ffmpeg: FfmpegDeps;

	constructor(opts: FrameSearchOptions = {}) {
		this.index = opts.index ?? new FrameIndex(opts.indexPath);
		this.ffmpeg = opts.ffmpeg ?? {};
		this.size = opts.size ?? 128;
		this.traceMoe =
			opts.traceMoe instanceof TraceMoeClient
				? opts.traceMoe
				: new TraceMoeClient(opts.traceMoe ?? {});
	}

	/**
	 * Indexe une vidéo : ffmpeg la décode en flux, chaque trame devient
	 * 33 octets. Rien n'est écrit sur disque à part la base.
	 */
	async indexVideo(source: string, opts: IndexVideoOptions = {}): Promise<IndexVideoResult> {
		const fps = opts.fps ?? 1;
		const size = opts.size ?? this.size;
		const existing = this.index.findMedia(source);
		if (existing && existing.frameCount > 0 && existing.fps === fps && !opts.force) {
			return {
				mediaId: existing.id,
				frames: existing.frameCount,
				durationMs: existing.durationMs,
				skipped: true,
			};
		}

		let durationMs = 0;
		try {
			durationMs = (await probeMedia(source, this.ffmpeg)).durationMs;
		} catch {
			// Un flux sans durée annoncée s'indexe quand même : on la déduira
			// du dernier horodatage.
		}

		const meta: MediaMeta = {
			source,
			title: opts.title ?? source.split("/").pop() ?? source,
			season: opts.season ?? null,
			episode: opts.episode ?? null,
			durationMs,
			fps,
		};
		const mediaId = this.index.upsertMedia(meta);
		this.index.clearFrames(mediaId);

		const every = opts.progressEvery ?? 250;
		let count = 0;
		let lastT = 0;
		const batch: Array<{ tMs: number; vector: Uint8Array }> = [];
		for await (const frame of iterateFrames(source, { fps, size }, this.ffmpeg)) {
			batch.push({ tMs: frame.tMs, vector: packVector(extractColorLayout(frame.pixels)) });
			lastT = frame.tMs;
			count++;
			if (batch.length >= 1000) {
				this.index.insertFrames(mediaId, batch.splice(0, batch.length));
			}
			if (opts.onProgress && count % every === 0) opts.onProgress(count, frame.tMs);
		}
		if (batch.length) this.index.insertFrames(mediaId, batch);
		if (!durationMs && lastT) {
			this.index.upsertMedia({ ...meta, durationMs: lastT });
			durationMs = lastT;
		}
		return { mediaId, frames: count, durationMs, skipped: false };
	}

	/** Décode une image (ou une trame de vidéo) et rend son descripteur. */
	async vectorOf(
		source: string,
		opts: { atMs?: number; size?: number } = {},
	): Promise<ColorLayoutVector> {
		const pixels = await decodeStill(
			source,
			{ size: opts.size ?? this.size, atMs: opts.atMs },
			this.ffmpeg,
		);
		return extractColorLayout(pixels);
	}

	/** Recherche dans l'index local. */
	searchLocal(vector: ColorLayoutVector, opts: SearchOptions = {}): SceneMatch[] {
		return searchIndex(this.index, vector, opts);
	}

	/**
	 * Recherche sur trace.moe **par vecteur** : la capture ne quitte jamais la
	 * machine, seuls 33 entiers partent.
	 */
	async searchRemote(
		vector: ColorLayoutVector,
		opts: TraceMoeSearchOptions = {},
	): Promise<UnifiedSearch> {
		const response = await this.traceMoe.searchByVector(vector, { anilistInfo: true, ...opts });
		return {
			origin: "remote",
			matches: response.result.map(toUnified),
			quota: { used: response.quotaUsed, total: response.quota },
		};
	}

	/**
	 * Cherche d'où vient une image. En mode `auto`, l'index local répond seul
	 * s'il est sûr de lui ; sinon la question part chez trace.moe.
	 */
	async search(
		source: string,
		opts: {
			mode?: SearchMode;
			limit?: number;
			atMs?: number;
			threshold?: number;
			anilistID?: number;
		} = {},
	): Promise<UnifiedSearch> {
		const mode = opts.mode ?? "auto";
		const threshold = opts.threshold ?? CONFIDENCE_THRESHOLD;
		const vector = await this.vectorOf(source, { atMs: opts.atMs });

		if (mode !== "remote") {
			const local = this.searchLocal(vector, { limit: opts.limit ?? 5 });
			const best = local[0];
			if (mode === "local" || (best && best.similarity >= threshold)) {
				return {
					origin: "local",
					matches: local.map((m) => ({
						title: m.title,
						episode: m.episode,
						season: m.season,
						fromMs: m.fromMs,
						atMs: m.atMs,
						toMs: m.toMs,
						similarity: m.similarity,
						source: m.source,
					})),
				};
			}
		}
		return await this.searchRemote(vector, { anilistID: opts.anilistID });
	}

	close(): void {
		this.index.close();
	}
}

function toUnified(result: TraceMoeResult): UnifiedMatch {
	const anilist = typeof result.anilist === "number" ? { id: result.anilist } : result.anilist;
	const title =
		typeof result.anilist === "number"
			? result.filename
			: (result.anilist.title?.romaji ??
				result.anilist.title?.english ??
				result.anilist.title?.native ??
				result.filename);
	return {
		title,
		episode: result.episode ?? null,
		season: null,
		fromMs: Math.round(result.from * 1000),
		atMs: Math.round(result.at * 1000),
		toMs: Math.round(result.to * 1000),
		similarity: result.similarity,
		source: result.filename,
		anilist: anilist.id,
		preview: { image: result.image, video: result.video },
	};
}

export default FrameSearch;
