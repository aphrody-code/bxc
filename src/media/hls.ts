// SPDX-License-Identifier: Apache-2.0
/**
 * Lecture des playlists HLS.
 *
 * Une URL `.m3u8` ne dit pas si elle mène à une playlist maîtresse (la liste
 * des qualités) ou directement à une piste. Résoudre « avec précision » un
 * lecteur, c'est aller jusqu'à la liste des variantes : sans elle, on ne sait
 * ni ce qu'on va lire, ni en quelle définition.
 *
 * Le parseur est délibérément tolérant : les playlists servies par les
 * hébergeurs sont souvent produites à la main, avec des attributs manquants ou
 * dans le désordre.
 */

import type { MediaVariant } from "./types.ts";

/** Vrai si le texte est une playlist HLS. */
export function isPlaylist(text: string): boolean {
	return /^\s*#EXTM3U/.test(text);
}

/** Vrai si la playlist liste des variantes (playlist maîtresse). */
export function isMasterPlaylist(text: string): boolean {
	return /#EXT-X-STREAM-INF/i.test(text);
}

/** Découpe une ligne d'attributs `CLÉ=VALEUR` en respectant les guillemets. */
function parseAttributes(line: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	// Une valeur entre guillemets peut contenir des virgules (`CODECS="a,b"`),
	// d'où la lecture par expression plutôt qu'un simple `split(",")`.
	for (const match of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
		attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "").trim();
	}
	return attributes;
}

function toNumber(raw: string | undefined): number | null {
	if (!raw) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

function absolute(url: string, base: string): string {
	try {
		return new URL(url, base).toString();
	} catch {
		return url;
	}
}

/** `1080p` à partir d'une hauteur, `null` si elle est inconnue. */
export function labelFromHeight(height: number | null): string | null {
	return height && height > 0 ? `${height}p` : null;
}

/**
 * Rend les variantes d'une playlist maîtresse, de la plus définie à la moins
 * définie. Les URL relatives sont résolues contre `baseUrl`.
 */
export function parseMasterPlaylist(text: string, baseUrl: string): MediaVariant[] {
	const lines = text.split(/\r?\n/);
	const variants: MediaVariant[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
		// L'URI de la variante est la première ligne non vide, non commentaire.
		let uri = "";
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j].trim();
			if (!next || next.startsWith("#")) continue;
			uri = next;
			i = j;
			break;
		}
		if (!uri) continue;

		const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
		const [width, height] = (attributes.RESOLUTION ?? "").split("x").map((n) => toNumber(n));
		variants.push({
			url: absolute(uri, baseUrl),
			bandwidth: toNumber(attributes.BANDWIDTH),
			averageBandwidth: toNumber(attributes["AVERAGE-BANDWIDTH"]),
			width: width ?? null,
			height: height ?? null,
			codecs: attributes.CODECS ?? null,
			frameRate: toNumber(attributes["FRAME-RATE"]),
			name: attributes.NAME ?? null,
			label: labelFromHeight(height ?? null),
		});
	}

	variants.sort(
		(a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
	);
	return disambiguate(variants);
}

/**
 * Distingue les variantes de même définition par leur débit.
 *
 * Un hébergeur sert couramment deux encodages d'une même hauteur (une version
 * légère et une version normale) : deux entrées « 416p » ne laissent aucun
 * moyen de choisir, alors que « 416p (1282 kbps) » se lit.
 */
function disambiguate(variants: MediaVariant[]): MediaVariant[] {
	const counts = new Map<string, number>();
	for (const variant of variants) {
		if (variant.label) counts.set(variant.label, (counts.get(variant.label) ?? 0) + 1);
	}
	return variants.map((variant) =>
		variant.label && (counts.get(variant.label) ?? 0) > 1 && variant.bandwidth
			? { ...variant, label: `${variant.label} (${Math.round(variant.bandwidth / 1000)} kbps)` }
			: variant,
	);
}

/** Durée totale annoncée par une playlist de segments, en secondes. */
export function playlistDuration(text: string): number | null {
	let total = 0;
	let seen = false;
	for (const match of text.matchAll(/^#EXTINF:\s*([\d.]+)/gim)) {
		const value = Number(match[1]);
		if (Number.isFinite(value)) {
			total += value;
			seen = true;
		}
	}
	return seen ? Math.round(total * 1000) / 1000 : null;
}
