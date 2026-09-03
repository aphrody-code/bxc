// SPDX-License-Identifier: Apache-2.0
/**
 * Résolution d'un lecteur embarqué vers son flux réel.
 *
 * L'enchaînement est toujours le même, quel que soit le site qui héberge le
 * lecteur : normaliser l'URL, écarter tout de suite les lecteurs propriétaires,
 * charger la page, la déballer, en extraire les pistes candidates, suivre au
 * besoin l'iframe interne, puis — si la piste est du HLS — lire la playlist
 * maîtresse pour savoir *ce qu'on va vraiment lire*.
 *
 * Le réseau passe entièrement par {@link ResolveOptions.transport} : le cœur
 * ne connaît ni `fetch`, ni bxc, ni le profil de navigation choisi par
 * l'appelant. C'est ce qui rend la chaîne testable sans réseau, et réutilisable
 * par n'importe quel scraper du dépôt.
 */

import { extractMediaCandidates, extractPoster } from "./extract.ts";
import { isMasterPlaylist, parseMasterPlaylist } from "./hls.ts";
import { expiryFromUrl, hostTraits, normalizeEmbedUrl, playbackHeaders } from "./hosts.ts";
import type {
	MediaCandidate,
	MediaTransport,
	MediaVariant,
	ResolvedMedia,
} from "./types.ts";

/** Réglages d'une résolution. */
export interface ResolveOptions {
	/** Seul point de contact avec le réseau. */
	transport: MediaTransport;
	/** Referer à présenter à l'embed — en général la page du site qui l'affiche. */
	referer?: string;
	userAgent?: string;
	/** Lire la playlist maîtresse pour énumérer les qualités (une requête de plus). */
	enumerateVariants?: boolean;
	timeoutMs?: number;
	/** Nombre d'iframes internes suivies (défaut : 1). */
	maxHops?: number;
}

const IFRAME = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi;

function absolute(url: string, base: string): string | null {
	try {
		return new URL(url, base).toString();
	} catch {
		return null;
	}
}

/**
 * Suit l'iframe interne d'une page qui ne fait que réhéberger un autre lecteur.
 *
 * Les sites de streaming empilent volontiers deux niveaux : leur propre page
 * d'embed, qui contient l'iframe de l'hébergeur réel. Sans ce saut, on
 * n'extrait rien — la page extérieure ne contient aucune URL média.
 */
function nextHop(body: string, currentUrl: string): string | null {
	IFRAME.lastIndex = 0;
	for (const match of body.matchAll(IFRAME)) {
		const candidate = absolute(match[1], currentUrl);
		if (!candidate) continue;
		if (/^https?:/i.test(candidate) && candidate !== currentUrl) return candidate;
	}
	return null;
}

/**
 * Lit une playlist HLS et rend ses variantes. Une playlist de segments (donc
 * déjà une qualité précise) rend une liste vide : il n'y a rien à choisir.
 */
export async function resolveVariants(
	playlistUrl: string,
	opts: ResolveOptions,
): Promise<MediaVariant[]> {
	const response = await opts.transport({
		url: playlistUrl,
		headers: playbackHeaders(playlistUrl, opts.userAgent),
		referer: opts.referer,
		timeoutMs: opts.timeoutMs,
	});
	if (response.status >= 400 || !isMasterPlaylist(response.body)) return [];
	return parseMasterPlaylist(response.body, response.url ?? playlistUrl);
}

/**
 * Résout une URL d'embed vers son flux.
 *
 * Rend toujours un objet : un échec est décrit dans `error`, avec l'hébergeur
 * et les candidats trouvés, plutôt que levé. Un scraper qui parcourt trente
 * épisodes ne doit pas s'arrêter parce qu'un lecteur est cassé.
 */
export async function resolveEmbed(
	embedUrl: string,
	opts: ResolveOptions,
): Promise<ResolvedMedia> {
	const normalized = normalizeEmbedUrl(embedUrl);
	const traits = hostTraits(normalized);
	const base: ResolvedMedia = {
		host: traits.name,
		embedUrl: normalized,
		kind: "unknown",
		url: null,
		candidates: [],
		variants: [],
		headers: playbackHeaders(normalized, opts.userAgent),
		poster: null,
		expiresAt: null,
	};

	if (traits.proprietary) {
		return {
			...base,
			error: `${traits.name} est un lecteur propriétaire : son flux ne s'extrait pas de la page, il faut son propre extracteur`,
		};
	}

	let currentUrl = normalized;
	let candidates: MediaCandidate[] = [];
	let poster: string | null = null;
	const hops = opts.maxHops ?? 1;

	for (let hop = 0; hop <= hops; hop++) {
		let response: Awaited<ReturnType<MediaTransport>>;
		try {
			response = await opts.transport({
				url: currentUrl,
				referer: hop === 0 ? opts.referer : normalized,
				headers: opts.userAgent ? { "User-Agent": opts.userAgent } : undefined,
				timeoutMs: opts.timeoutMs,
			});
		} catch (err) {
			return {
				...base,
				embedUrl: currentUrl,
				error: `page du lecteur injoignable : ${err instanceof Error ? err.message : String(err)}`,
			};
		}
		if (response.status >= 400) {
			return { ...base, embedUrl: currentUrl, error: `le lecteur répond ${response.status}` };
		}

		const finalUrl = response.url ?? currentUrl;
		candidates = extractMediaCandidates(response.body, finalUrl);
		poster = poster ?? extractPoster(response.body, finalUrl);
		if (candidates.length) break;

		const hopUrl = hop < hops ? nextHop(response.body, finalUrl) : null;
		if (!hopUrl) break;
		currentUrl = hopUrl;
	}

	if (!candidates.length) {
		return {
			...base,
			embedUrl: currentUrl,
			poster,
			error: traits.obfuscated
				? `${traits.name} masque sa source : une résolution statique ne suffit pas, il faut exécuter la page`
				: "aucune piste trouvée dans la page du lecteur",
		};
	}

	const best = candidates[0];
	// Après un saut d'iframe, l'hébergeur réel est celui de la page finale,
	// pas celui du site qui l'affichait.
	const finalTraits = hostTraits(currentUrl);
	const resolved: ResolvedMedia = {
		...base,
		host: finalTraits.name,
		embedUrl: currentUrl,
		kind: best.kind,
		url: best.url,
		candidates,
		poster,
		expiresAt: expiryFromUrl(best.url),
		headers: playbackHeaders(currentUrl, opts.userAgent),
	};

	if (opts.enumerateVariants && best.kind === "hls") {
		try {
			resolved.variants = await resolveVariants(best.url, { ...opts, referer: currentUrl });
		} catch {
			// L'énumération est un bonus : son échec ne doit pas perdre l'URL
			// qu'on vient de résoudre.
		}
	}
	return resolved;
}
