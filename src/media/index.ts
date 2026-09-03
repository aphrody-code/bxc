// SPDX-License-Identifier: Apache-2.0
/**
 * Cœur média de bxc : reconnaître, déballer et résoudre un lecteur embarqué.
 *
 * Les scrapers du dépôt (`packages/voiranime`, `packages/animesama`, …)
 * partageaient jusqu'ici trois copies presque identiques du même code —
 * déballage des scripts compressés, recherche de l'URL, classification du
 * flux. Elles vivent maintenant ici, une fois : **un correctif sur un
 * hébergeur profite à tous les sites qui le servent**, ce qui est la règle du
 * dépôt (cf. `purge-engine.ts` pour les purges X).
 *
 * @example
 * ```ts
 * import { resolveEmbed } from "@aphrody/bxc/media";
 *
 * const media = await resolveEmbed("https://vidmoly.to/embed-xxxx.html", {
 *   transport: monTransport,
 *   enumerateVariants: true,
 * });
 * media.url;                       // https://…/master.m3u8?t=…
 * media.variants.map((v) => v.label);  // ["1080p", "720p", "480p"]
 * media.headers;                   // { Referer: …, Origin: … } à rejouer
 * media.candidates[0].rule;        // "jwplayer.sources" — d'où vient l'URL
 * ```
 */

export type {
	MediaCandidate,
	MediaKind,
	MediaRequest,
	MediaResponse,
	MediaTransport,
	MediaVariant,
	PlaybackHeaders,
	ResolvedMedia,
} from "./types.ts";

export {
	expiryFromUrl,
	hostFromUrl,
	hostTraits,
	normalizeEmbedUrl,
	playbackHeaders,
	type HostTraits,
} from "./hosts.ts";

export {
	decodeBase64Payloads,
	isPacked,
	peelLayers,
	unescapeUrls,
	unpackPacker,
	type SourceLayer,
} from "./unpack.ts";

export { classifyMedia, extractMediaCandidates, extractPoster } from "./extract.ts";

export {
	isMasterPlaylist,
	isPlaylist,
	labelFromHeight,
	parseMasterPlaylist,
	playlistDuration,
} from "./hls.ts";

export { resolveEmbed, resolveVariants, type ResolveOptions } from "./resolver.ts";
