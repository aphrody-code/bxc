// SPDX-License-Identifier: Apache-2.0
/**
 * Descripteur d'image : MPEG-7 ColorLayout, 33 coefficients.
 *
 * C'est le même descripteur que celui utilisé par trace.moe, et volontairement :
 * un vecteur extrait ici s'interroge indifféremment sur l'index **local**
 * (`store.ts` + `search.ts`) ou sur l'API distante (`trace-moe.ts`, paramètre
 * `?vector=`). L'extraction et l'encodage viennent de `trace.moe-id` (MIT,
 * sans dépendance) pour que les vecteurs restent bit-à-bit compatibles ; ce
 * module n'ajoute que ce qui manque côté index :
 *
 *  - {@link packVector} / {@link unpackVector} — 33 octets, la forme stockée en
 *    base (un coefficient tient sur 6 bits au plus, donc sur un octet).
 *  - {@link colorLayoutDistance} — la métrique MPEG-7 sur `Uint8Array`, sans
 *    allocation, pour balayer des centaines de milliers de trames.
 *  - {@link similarityFromDistance} — la conversion en score 0..1 comparable à
 *    celui que renvoie trace.moe (échelle calibrée, cf. {@link DISTANCE_SCALE}).
 */

import { ColorLayout, type PixelData } from "trace.moe-id";

/** Nombre de coefficients d'un vecteur ColorLayout. */
export const CL_DIMS = 33;

/** Coefficients de luminance (1 DC + 20 AC), en tête du vecteur. */
export const CL_Y_COUNT = 21;

/** Coefficients par plan de chrominance (1 DC + 5 AC), Cb puis Cr. */
export const CL_C_COUNT = 6;

/**
 * Poids MPEG-7 de la distance : les trois premiers coefficients de chaque plan
 * pèsent plus que les suivants (ils portent la structure globale de l'image).
 */
const W_Y = [2, 2, 2] as const;
const W_CB = [2, 1, 1] as const;
const W_CR = [4, 2, 2] as const;

/**
 * Distance au-delà de laquelle deux images n'ont plus rien à voir.
 *
 * Mesurée, pas devinée (cf. `README.md`, section « Similarité ») : sur des
 * trames d'anime décodées par ce module, la même image ré-encodée reste sous
 * 10, deux trames de la même scène tiennent sous 30, et deux images sans
 * rapport se placent entre 34 et 79. L'échelle 100 fait donc tomber le seuil
 * « probablement faux » au même endroit que celui de trace.moe (0,90).
 *
 * Ne sert qu'à afficher un score lisible : le classement des résultats, lui,
 * ne dépend que de la distance.
 */
export const DISTANCE_SCALE = 100;

/** Un vecteur ColorLayout, tel que produit par {@link extractColorLayout}. */
export type ColorLayoutVector = number[];

/** Image décodée en pixels bruts, telle qu'attendue par l'extracteur. */
export type { PixelData };

/** Extrait le vecteur 33 coefficients d'une image décodée. */
export function extractColorLayout(image: PixelData): ColorLayoutVector {
	return ColorLayout.extract(image);
}

/** Encode un vecteur en chaîne base64 URL-safe (28 caractères), forme acceptée par api.trace.moe. */
export function encodeVector(vector: ColorLayoutVector): string {
	return ColorLayout.encode(vector);
}

/** Décode une chaîne base64 URL-safe en vecteur. */
export function decodeVector(hash: string): ColorLayoutVector {
	return ColorLayout.decode(hash);
}

/**
 * Forme stockée : 33 octets. Chaque coefficient est déjà quantifié sur 5 ou
 * 6 bits par l'extracteur, un octet suffit donc et la distance se calcule
 * directement sur le buffer lu en base, sans reconstruire de tableau.
 */
export function packVector(vector: ColorLayoutVector): Uint8Array {
	if (vector.length !== CL_DIMS) {
		throw new Error(`vecteur ColorLayout attendu de ${CL_DIMS} coefficients, reçu ${vector.length}`);
	}
	const out = new Uint8Array(CL_DIMS);
	for (let i = 0; i < CL_DIMS; i++) {
		const v = vector[i] ?? 0;
		out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
	}
	return out;
}

/** Inverse de {@link packVector}. */
export function unpackVector(bytes: Uint8Array): ColorLayoutVector {
	if (bytes.length !== CL_DIMS) {
		throw new Error(`buffer de ${CL_DIMS} octets attendu, reçu ${bytes.length}`);
	}
	return Array.from(bytes);
}

/**
 * Distance MPEG-7 entre deux vecteurs : somme des racines des écarts pondérés
 * de chaque plan (Y, Cb, Cr). Accepte indifféremment les deux représentations
 * pour qu'un vecteur fraîchement extrait se compare à une ligne de la base
 * sans conversion intermédiaire.
 */
export function colorLayoutDistance(
	a: ArrayLike<number>,
	b: ArrayLike<number>,
): number {
	let sumY = 0;
	for (let i = 0; i < CL_Y_COUNT; i++) {
		const d = a[i] - b[i];
		sumY += (W_Y[i] ?? 1) * d * d;
	}
	let sumCb = 0;
	let sumCr = 0;
	for (let i = 0; i < CL_C_COUNT; i++) {
		const cb = a[CL_Y_COUNT + i] - b[CL_Y_COUNT + i];
		sumCb += (W_CB[i] ?? 1) * cb * cb;
		const j = CL_Y_COUNT + CL_C_COUNT + i;
		const cr = a[j] - b[j];
		sumCr += (W_CR[i] ?? 1) * cr * cr;
	}
	return Math.sqrt(sumY) + Math.sqrt(sumCb) + Math.sqrt(sumCr);
}

/**
 * Score 0..1 dérivé de la distance, sur la même échelle que la similarité
 * renvoyée par trace.moe : au-dessous de 0,90 le résultat est probablement
 * faux, quelle que soit sa place au classement.
 */
export function similarityFromDistance(distance: number): number {
	const s = 1 - distance / DISTANCE_SCALE;
	return s < 0 ? 0 : s > 1 ? 1 : s;
}
