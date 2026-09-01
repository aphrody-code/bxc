/**
 * Mise en forme des données IETV — module PUR.
 *
 * Tout le calcul d'affichage vit ici et se teste sans bot, sans base et sans
 * réseau. Les fichiers de commande ne font que lire puis appeler ces fonctions.
 */

import type { LanguageVersion, VideoRef } from "@aphrody/ietv";

import { ICONES, LIMITES } from "./theme.ts";

/** Épisode tel que le cache le rend : la chaîne d'origine en plus. */
export type EpisodeCatalogue = VideoRef & { channel?: string };

/** `🇫🇷 VF`, `💬 VOSTFR`, `❔ inconnue`. */
export function libelleLangue(langue: LanguageVersion): string {
	switch (langue) {
		case "vf":
			return `${ICONES.vf} VF`;
		case "vostfr":
			return `${ICONES.vostfr} VOSTFR`;
		default:
			return `${ICONES.inconnu} langue inconnue`;
	}
}

/**
 * `S01E05`, ou `S01` / `E05` quand une seule des deux valeurs est connue, ou
 * `hors série` quand aucune ne l'est. Un titre YouTube ne porte pas toujours
 * les deux.
 */
export function codeEpisode(saison: number | null, episode: number | null): string {
	const s = saison !== null ? `S${String(saison).padStart(2, "0")}` : "";
	const e = episode !== null ? `E${String(episode).padStart(2, "0")}` : "";
	if (s === "" && e === "") return "hors série";
	return `${s}${e}`;
}

/** `24 min`, `1 h 30`, `—` si la durée est inconnue. */
export function formaterDuree(secondes: number | null): string {
	if (secondes === null || !Number.isFinite(secondes) || secondes <= 0) return "—";
	const minutes = Math.round(secondes / 60);
	if (minutes < 60) return `${minutes} min`;
	const heures = Math.floor(minutes / 60);
	const reste = minutes % 60;
	return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * Coupe sans jamais couper au milieu d'un lien Markdown : Discord afficherait
 * un `[texte](http` orphelin, illisible. On rend la chaîne entière quand elle
 * tient, sinon on tronque au dernier saut de ligne utile.
 */
export function bornerTexte(texte: string, limite: number): string {
	if (texte.length <= limite) return texte;
	const coupe = texte.slice(0, limite - 1);
	const dernierSaut = coupe.lastIndexOf("\n");
	return `${(dernierSaut > limite * 0.5 ? coupe.slice(0, dernierSaut) : coupe).trimEnd()}…`;
}

/** Échappe les marqueurs Markdown d'un titre venu d'une source externe. */
export function echapperMarkdown(texte: string): string {
	return texte.replace(/([*_`~|\\[\]()>])/g, "\\$1");
}

/** Une ligne de résultat : `**S01E05** · titre · 🇫🇷 VF · [voir](url)`. */
export function ligneEpisode(episode: EpisodeCatalogue): string {
	const code = codeEpisode(episode.season, episode.episode);
	const titre = echapperMarkdown(episode.title);
	const lien = `[${ICONES.lien} voir](${episode.url})`;
	return `**${code}** · ${titre}\n${libelleLangue(episode.language)} · ${formaterDuree(episode.duration)} · ${lien}`;
}

/**
 * Assemble autant de lignes que le budget de description le permet et dit
 * combien ont été laissées de côté — un « et 12 autres » vaut mieux qu'une
 * liste tronquée en silence.
 */
export function listerEpisodes(
	episodes: readonly EpisodeCatalogue[],
	options: { limite?: number; budget?: number } = {}
): { texte: string; affiches: number; restants: number } {
	const limite = options.limite ?? 10;
	const budget = options.budget ?? LIMITES.description;

	const lignes: string[] = [];
	let taille = 0;

	for (const episode of episodes.slice(0, limite)) {
		const ligne = ligneEpisode(episode);
		// +2 pour le séparateur de paragraphe, +40 de marge pour la mention
		// « et N autres » qui sera peut-être ajoutée en dessous.
		if (taille + ligne.length + 2 > budget - 40) break;
		lignes.push(ligne);
		taille += ligne.length + 2;
	}

	const restants = episodes.length - lignes.length;
	const texte =
		lignes.length === 0
			? ""
			: lignes.join("\n\n") + (restants > 0 ? `\n\n*…et ${restants} autre(s).*` : "");

	return { texte, affiches: lignes.length, restants: Math.max(0, restants) };
}

/** Répartition `VF 412 · VOSTFR 388 · inconnue 12`, dans un ordre stable. */
export function repartitionLangues(parLangue: Readonly<Record<string, number>>): string {
	const ordre: LanguageVersion[] = ["vf", "vostfr", "unknown"];
	const parts = ordre
		.filter((langue) => (parLangue[langue] ?? 0) > 0)
		.map((langue) => `${libelleLangue(langue)} ${parLangue[langue]}`);
	return parts.length === 0 ? "aucun épisode" : parts.join(" · ");
}

/**
 * Horodatage relatif natif de Discord (`<t:…:R>` → « il y a 3 heures »), qui
 * s'affiche dans le fuseau de chaque lecteur. `jamais` quand le catalogue n'a
 * pas encore été rafraîchi.
 */
export function horodatageRelatif(millisecondes: number): string {
	if (!Number.isFinite(millisecondes) || millisecondes <= 0) return "jamais";
	return `<t:${Math.floor(millisecondes / 1000)}:R>`;
}

/** Tri de présentation : saison puis épisode croissants, inconnus en dernier. */
export function trierEpisodes<T extends EpisodeCatalogue>(episodes: readonly T[]): T[] {
	return [...episodes].sort((a, b) => {
		const sa = a.season ?? Number.MAX_SAFE_INTEGER;
		const sb = b.season ?? Number.MAX_SAFE_INTEGER;
		if (sa !== sb) return sa - sb;
		const ea = a.episode ?? Number.MAX_SAFE_INTEGER;
		const eb = b.episode ?? Number.MAX_SAFE_INTEGER;
		if (ea !== eb) return ea - eb;
		return a.title.localeCompare(b.title, "fr");
	});
}
