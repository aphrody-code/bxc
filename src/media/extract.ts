// SPDX-License-Identifier: Apache-2.0
/**
 * Extraction : où est le flux dans la page d'un lecteur.
 *
 * Chaque hébergeur déclare sa source à sa façon, et la même page contient
 * souvent plusieurs URL plausibles — la vraie piste, une publicité, une
 * miniature, un ancien lien mort laissé dans le code. Plutôt que de rendre la
 * première trouvée, on applique des règles nommées, on garde **toutes** les
 * candidates avec leur provenance (règle, position, profondeur de déballage)
 * et on les classe par confiance.
 *
 * C'est ce qui permet, quand un hébergeur change sa page, de voir *quelle*
 * règle a mordu et pourquoi le résultat est faux — au lieu de constater une
 * URL vide.
 */

import { peelLayers, unescapeUrls } from "./unpack.ts";
import type { MediaCandidate, MediaKind } from "./types.ts";

/** Classe une URL d'après son extension, avant toute requête. */
export function classifyMedia(url: string): MediaKind {
	if (/\.m3u8(\?|#|$)/i.test(url)) return "hls";
	if (/\.mpd(\?|#|$)/i.test(url)) return "dash";
	if (/\.(mp4|m4v|mov)(\?|#|$)/i.test(url)) return "mp4";
	return "unknown";
}

/** Une règle d'extraction : un motif, un nom, une confiance. */
interface Rule {
	name: string;
	confidence: number;
	pattern: RegExp;
	/** Rang du groupe capturant l'URL (1 par défaut). */
	group?: number;
	/** Rang du groupe capturant le libellé de qualité. */
	labelGroup?: number;
}

const MEDIA_EXT = String.raw`\.(?:m3u8|mpd|mp4|m4v|mov)`;

const RULES: Rule[] = [
	{
		name: "player.file",
		confidence: 0.85,
		pattern: new RegExp(
			String.raw`["']?file["']?\s*[:=]\s*["']([^"']+${MEDIA_EXT}[^"']*)["']`,
			"gi",
		),
	},
	{
		name: "player.src",
		confidence: 0.8,
		pattern: new RegExp(String.raw`["']?src["']?\s*[:=]\s*["']([^"']+${MEDIA_EXT}[^"']*)["']`, "gi"),
	},
	{
		name: "player.hls",
		confidence: 0.75,
		pattern: new RegExp(
			String.raw`["']?(?:hls|source|url|stream)["']?\s*[:=]\s*["']([^"']+${MEDIA_EXT}[^"']*)["']`,
			"gi",
		),
	},
	// Balise HTML : `<source src="…">`, `<video data-src="…">`.
	{
		name: "html.source",
		confidence: 0.7,
		pattern: new RegExp(
			String.raw`<(?:source|video)[^>]+(?:data-)?src\s*=\s*["']([^"']+${MEDIA_EXT}[^"']*)["']`,
			"gi",
		),
	},
	// sibnet : la page ne contient qu'un chemin relatif, sans hôte ni clé.
	{
		name: "sibnet.relative",
		confidence: 0.7,
		pattern: /["'(]?(\/v\/[A-Za-z0-9_%-]+\/\d+\.mp4)/g,
	},
	// Dernier recours : une URL média nue dans le corps de la page.
	{
		name: "bare.url",
		confidence: 0.45,
		pattern: new RegExp(String.raw`https?://[^\s"'<>\\|]+${MEDIA_EXT}[^\s"'<>\\|]*`, "gi"),
		group: 0,
	},
];

const POSTER_RULES: RegExp[] = [
	/\bimage\s*:\s*["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i,
	/\bposter\s*[:=]\s*["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i,
	/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
];

/** Nettoie une URL trouvée dans du JavaScript et la rend absolue. */
function cleanUrl(raw: string, baseUrl: string): string | null {
	const url = raw
		.replace(/\\\//g, "/")
		.replace(/\\u002[fF]/gi, "/")
		.replace(/&amp;/g, "&")
		.trim();
	if (!url || url.length > 2048) return null;
	if (/^https?:\/\//i.test(url)) return url;
	try {
		return new URL(url, baseUrl).toString();
	} catch {
		return null;
	}
}

/**
 * Lit **tout** le tableau `sources: [ … ]` d'un lecteur JW Player, pas
 * seulement sa première entrée : c'est là que se trouvent les qualités
 * proposées, avec leur libellé. Le tableau est délimité par comptage de
 * crochets — une expression régulière s'arrêterait au premier `]` venu, y
 * compris celui d'un tableau imbriqué.
 */
function extractDeclaredSources(text: string, baseUrl: string, layer: number): MediaCandidate[] {
	const out: MediaCandidate[] = [];
	for (const start of text.matchAll(/\bsources?\s*:\s*\[/gi)) {
		const open = (start.index ?? 0) + start[0].length - 1;
		let depth = 0;
		let end = -1;
		for (let i = open; i < text.length; i++) {
			const char = text[i];
			if (char === "[") depth++;
			else if (char === "]") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end < 0) continue;
		const block = text.slice(open, end + 1);
		for (const entry of block.matchAll(/\{[^{}]*\}/g)) {
			const file = /\b(?:file|src|url)\s*:\s*["']([^"']+)["']/i.exec(entry[0]);
			if (!file) continue;
			const url = cleanUrl(file[1], baseUrl);
			if (!url) continue;
			const label = /\blabel\s*:\s*["']([^"']+)["']/i.exec(entry[0]);
			out.push({
				url,
				kind: classifyMedia(url),
				rule: "jwplayer.sources",
				confidence: Math.max(0.1, Math.round((0.95 - layer * 0.05) * 100) / 100),
				offset: open + (entry.index ?? 0),
				layer,
				...(label ? { label: label[1] } : {}),
			});
		}
	}
	return out;
}

/**
 * Rend toutes les pistes candidates d'une page de lecteur, la plus sûre en
 * tête. Une même URL trouvée par plusieurs règles n'apparaît qu'une fois, avec
 * sa meilleure provenance.
 */
export function extractMediaCandidates(source: string, baseUrl: string): MediaCandidate[] {
	const best = new Map<string, MediaCandidate>();

	const keep = (candidate: MediaCandidate): void => {
		const previous = best.get(candidate.url);
		if (!previous || candidate.confidence > previous.confidence) best.set(candidate.url, candidate);
	};

	for (const rawLayer of peelLayers(source)) {
		// Une URL écrite `https:\/\/…` dans une chaîne JavaScript n'est
		// reconnue par aucune expression tant qu'on ne l'a pas remise à plat :
		// les positions rendues sont donc celles de la couche normalisée.
		const layer = { ...rawLayer, text: unescapeUrls(rawLayer.text) };
		// Le tableau de sources déclaré par le lecteur passe en premier : il
		// donne les qualités, ce qu'aucune expression ligne à ligne ne sait faire.
		for (const declared of extractDeclaredSources(layer.text, baseUrl, layer.depth)) {
			keep(declared);
		}
		for (const rule of RULES) {
			// Les expressions globales gardent un curseur : on repart de zéro
			// pour chaque couche, sinon la deuxième est lue à moitié.
			rule.pattern.lastIndex = 0;
			for (const match of layer.text.matchAll(rule.pattern)) {
				const url = cleanUrl(match[rule.group ?? 1] ?? "", baseUrl);
				if (!url) continue;
				const candidate: MediaCandidate = {
					url,
					kind: classifyMedia(url),
					rule: rule.name,
					// Une piste trouvée après déballage reste une piste déclarée
					// par le lecteur : on ne la pénalise que légèrement.
					confidence: Math.max(0.1, Math.round((rule.confidence - layer.depth * 0.05) * 100) / 100),
					offset: match.index ?? 0,
					layer: layer.depth,
					...(rule.labelGroup && match[rule.labelGroup]
						? { label: match[rule.labelGroup] }
						: {}),
				};
				keep(candidate);
			}
		}
	}

	return [...best.values()].sort(
		(a, b) => b.confidence - a.confidence || a.layer - b.layer || a.offset - b.offset,
	);
}

/** Miniature déclarée par le lecteur, si elle existe. */
export function extractPoster(source: string, baseUrl: string): string | null {
	for (const layer of peelLayers(source)) {
		const text = unescapeUrls(layer.text);
		for (const rule of POSTER_RULES) {
			const match = rule.exec(text);
			if (match) {
				const url = cleanUrl(match[1], baseUrl);
				if (url) return url;
			}
		}
	}
	return null;
}
