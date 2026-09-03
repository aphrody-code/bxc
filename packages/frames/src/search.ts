// SPDX-License-Identifier: Apache-2.0
/**
 * Recherche dans l'index local.
 *
 * Le balayage est exhaustif : chaque trame indexée est comparée à la requête.
 * À 33 octets par trame, un catalogue complet d'anime tient dans quelques
 * dizaines de méga-octets et se parcourt en quelques centaines de
 * millisecondes — pour un résultat *exact*, là où un index approché échange de
 * la justesse contre une vitesse dont on n'a pas besoin ici.
 *
 * Un résultat n'est pas une trame mais une **scène** : la meilleure trame,
 * puis son voisinage tant que l'image reste la même (cf. {@link SCENE_TOLERANCE}).
 * C'est ce qui donne le `from`/`at`/`to` attendu par quiconque a déjà utilisé
 * l'API de trace.moe.
 */

import { colorLayoutDistance, similarityFromDistance } from "./descriptor.ts";
import type { FrameIndex, MediaRow } from "./store.ts";

/**
 * Écart de distance toléré, autour de la meilleure trame, pour considérer
 * qu'on est toujours dans la même scène. Mesuré sur des trames d'anime : à
 * l'intérieur d'un plan l'écart reste sous 30, deux images sans rapport
 * dépassent 34.
 */
export const SCENE_TOLERANCE = 15;

/** Demi-largeur maximale d'une scène, en millisecondes. */
export const SCENE_MAX_SPAN_MS = 30_000;

/** Une scène trouvée dans l'index local. */
export interface SceneMatch {
	mediaId: number;
	source: string;
	title: string;
	season: number | null;
	episode: number | null;
	/** Début de la scène, en millisecondes. */
	fromMs: number;
	/** Position de la trame la plus proche, en millisecondes. */
	atMs: number;
	/** Fin de la scène, en millisecondes. */
	toMs: number;
	/** Durée du média, en millisecondes (0 si inconnue). */
	durationMs: number;
	distance: number;
	/** Score 0..1 ; en dessous de 0,90 le résultat est probablement faux. */
	similarity: number;
}

/** Réglages d'une recherche locale. */
export interface SearchOptions {
	/** Nombre maximal de scènes rendues (défaut : 5). */
	limit?: number;
	/** Score minimal retenu (défaut : 0 — tout est rendu, à charge de juger). */
	minSimilarity?: number;
	/** Restreindre la recherche à un média. */
	mediaId?: number;
}

interface Best {
	tMs: number;
	distance: number;
}

/**
 * Compare la requête à toutes les trames indexées et rend les meilleures
 * scènes, de la plus proche à la plus lointaine.
 */
export function searchIndex(
	index: FrameIndex,
	query: ArrayLike<number>,
	opts: SearchOptions = {},
): SceneMatch[] {
	const limit = opts.limit ?? 5;
	const minSimilarity = opts.minSimilarity ?? 0;

	// Une seule passe : la meilleure trame de chaque média.
	const best = new Map<number, Best>();
	for (const frame of index.iterateFrames(opts.mediaId)) {
		const distance = colorLayoutDistance(query, frame.vector);
		const current = best.get(frame.mediaId);
		if (!current || distance < current.distance) {
			best.set(frame.mediaId, { tMs: frame.tMs, distance });
		}
	}

	const ranked = [...best.entries()]
		.sort((a, b) => a[1].distance - b[1].distance)
		.slice(0, limit);

	const matches: SceneMatch[] = [];
	for (const [mediaId, hit] of ranked) {
		const similarity = similarityFromDistance(hit.distance);
		if (similarity < minSimilarity) continue;
		const media = index.getMedia(mediaId);
		if (!media) continue;
		const { fromMs, toMs } = expandScene(index, media, query, hit);
		matches.push({
			mediaId,
			source: media.source,
			title: media.title,
			season: media.season ?? null,
			episode: media.episode ?? null,
			fromMs,
			atMs: hit.tMs,
			toMs,
			durationMs: media.durationMs,
			distance: hit.distance,
			similarity,
		});
	}
	return matches;
}

/**
 * Étend la meilleure trame en scène : on s'éloigne de part et d'autre tant que
 * les trames voisines restent proches de la requête *et* contiguës — un trou
 * dans l'échantillonnage signale un plan différent, pas une scène plus longue.
 */
function expandScene(
	index: FrameIndex,
	media: MediaRow,
	query: ArrayLike<number>,
	hit: Best,
): { fromMs: number; toMs: number } {
	const intervalMs = media.fps > 0 ? Math.round(1000 / media.fps) : 1000;
	const maxGap = intervalMs * 1.5;
	const threshold = hit.distance + SCENE_TOLERANCE;
	const window = index.framesBetween(
		media.id,
		hit.tMs - SCENE_MAX_SPAN_MS,
		hit.tMs + SCENE_MAX_SPAN_MS,
	);
	const pivot = window.findIndex((f) => f.tMs === hit.tMs);
	if (pivot < 0) return { fromMs: hit.tMs, toMs: hit.tMs };

	let fromMs = hit.tMs;
	for (let i = pivot - 1; i >= 0; i--) {
		const frame = window[i];
		if (fromMs - frame.tMs > maxGap) break;
		if (colorLayoutDistance(query, frame.vector) > threshold) break;
		fromMs = frame.tMs;
	}
	let toMs = hit.tMs;
	for (let i = pivot + 1; i < window.length; i++) {
		const frame = window[i];
		if (frame.tMs - toMs > maxGap) break;
		if (colorLayoutDistance(query, frame.vector) > threshold) break;
		toMs = frame.tMs;
	}
	return { fromMs, toMs };
}

/** `123456` → `2:03.456`, pour l'affichage d'un horodatage de scène. */
export function formatTimecode(ms: number): string {
	const total = Math.max(0, Math.round(ms));
	const h = Math.floor(total / 3_600_000);
	const m = Math.floor((total % 3_600_000) / 60_000);
	const s = Math.floor((total % 60_000) / 1000);
	const milli = total % 1000;
	const head = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m);
	return `${head}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}
