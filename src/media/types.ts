// SPDX-License-Identifier: Apache-2.0
/**
 * Types partagés du cœur média : ce qu'un lecteur embarqué finit par livrer.
 *
 * Les scrapers (`packages/voiranime`, `packages/animesama`, …) ne définissent
 * plus leur propre vocabulaire — ils traduisent celui-ci dans leur langue de
 * façade. Une correction ici vaut donc pour tous, comme les deux purges X
 * partagent `purge-engine.ts`.
 */

/** Nature du flux, déduite de l'URL. */
export type MediaKind = "hls" | "dash" | "mp4" | "unknown";

/**
 * Une piste candidate trouvée dans la page d'un lecteur.
 *
 * On garde *où* et *comment* elle a été trouvée : deux hébergeurs peuvent
 * livrer la même URL par des chemins très différents, et c'est la règle qui a
 * mordu qui dit si on peut lui faire confiance.
 */
export interface MediaCandidate {
	/** URL absolue du flux. */
	url: string;
	kind: MediaKind;
	/** Règle d'extraction qui a produit ce candidat (`jwplayer.sources`, `sibnet.relative`…). */
	rule: string;
	/** Confiance 0..1 : une source déclarée par le lecteur vaut mieux qu'une URL glanée. */
	confidence: number;
	/** Position du motif dans la couche où il a été trouvé, en caractères. */
	offset: number;
	/**
	 * Profondeur de déballage : 0 = tel quel dans la page, 1 = après avoir
	 * déballé un `eval(function(p,a,c,k,e,d))`, 2 = après un second niveau, etc.
	 */
	layer: number;
	/** Libellé de qualité annoncé par le lecteur (`"720p"`, `"HD"`…), s'il y en a un. */
	label?: string;
}

/** Une variante d'une playlist HLS maîtresse. */
export interface MediaVariant {
	url: string;
	/** Débit annoncé en bits/s (`BANDWIDTH`). */
	bandwidth: number | null;
	/** Débit moyen annoncé (`AVERAGE-BANDWIDTH`). */
	averageBandwidth?: number | null;
	width: number | null;
	height: number | null;
	codecs: string | null;
	frameRate: number | null;
	/** `NAME` de la variante, quand la playlist en donne un. */
	name: string | null;
	/** `720p`, `1080p`… dérivé de la hauteur quand elle est connue. */
	label: string | null;
}

/** Ce qu'il faut rejouer pour que le flux réponde (Referer, Origin, UA). */
export type PlaybackHeaders = Record<string, string>;

/** Résultat d'une résolution d'embed. */
export interface ResolvedMedia {
	/** Hébergeur canonique (`sibnet`, `vidmoly`, `ansembed`…). */
	host: string;
	/** URL d'embed effectivement interrogée (après normalisation). */
	embedUrl: string;
	kind: MediaKind;
	/** Meilleur candidat, ou `null` si rien n'a été trouvé. */
	url: string | null;
	/** Tous les candidats, du plus sûr au moins sûr. */
	candidates: MediaCandidate[];
	/** Variantes de la playlist maîtresse, si elle a été lue. */
	variants: MediaVariant[];
	/** En-têtes à rejouer pour lire le flux. */
	headers: PlaybackHeaders;
	poster: string | null;
	/** Expiration lue dans l'URL signée, en ms epoch, ou `null`. */
	expiresAt: number | null;
	/** Message explicite quand la résolution échoue (hébergeur propriétaire, page vide…). */
	error?: string;
}

/** Requête HTTP minimale, telle que le cœur média la formule. */
export interface MediaRequest {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	referer?: string;
	body?: string;
	timeoutMs?: number;
}

/** Réponse HTTP minimale attendue en retour. */
export interface MediaResponse {
	status: number;
	body: string;
	/** URL finale après redirections, si le transport la connaît. */
	url?: string;
}

/**
 * Transport injectable : c'est le seul point de contact avec le réseau.
 *
 * Chaque scraper branche le sien (page bxc, `fetch` nu, curl-impersonate) ;
 * les tests en branchent un qui rejoue des captures.
 */
export type MediaTransport = (request: MediaRequest) => Promise<MediaResponse>;
