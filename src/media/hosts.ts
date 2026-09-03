// SPDX-License-Identifier: Apache-2.0
/**
 * Registre des hébergeurs de lecteurs.
 *
 * Un même hébergeur se présente sous plusieurs domaines, en change au gré des
 * saisies, et se retrouve derrière plusieurs sites de streaming. Le nom
 * canonique, la normalisation d'URL et les particularités de lecture sont donc
 * ici, une fois — pas dans chaque scraper.
 */

/** Ce qu'on sait d'un hébergeur avant même de charger sa page. */
export interface HostTraits {
	/** Nom canonique, stable dans le temps (`vidmoly`, `sibnet`…). */
	name: string;
	/**
	 * Lecteur propriétaire dont le flux ne s'extrait pas d'une page :
	 * inutile de télécharger quoi que ce soit, on le dit tout de suite.
	 */
	proprietary?: boolean;
	/** Le flux exige le `Referer` de l'embed pour répondre. */
	needsReferer?: boolean;
	/** Réputé fortement obfusqué : la résolution statique est au mieux partielle. */
	obfuscated?: boolean;
}

const HOSTS: Array<[RegExp, HostTraits]> = [
	[/ansembed/i, { name: "ansembed", needsReferer: true }],
	[/embed4me|lpayer/i, { name: "embed4me", needsReferer: true }],
	[/sibnet/i, { name: "sibnet", needsReferer: true }],
	[/vidmoly/i, { name: "vidmoly", needsReferer: true }],
	[/oneupload/i, { name: "oneupload", needsReferer: true }],
	[/sendvid/i, { name: "sendvid" }],
	[/movearnpre/i, { name: "movearnpre", needsReferer: true }],
	[/streamhide|guccihide|haghalaz/i, { name: "streamhide", needsReferer: true }],
	[/vk\.com|vkvideo/i, { name: "vk", needsReferer: true }],
	[/myvi\./i, { name: "myvi" }],
	[/anime-sama\.(fr|to)/i, { name: "anime-sama", needsReferer: true }],
	[/weneverbeenfree|filemoon|kerapoxy|\bmoon\b/i, { name: "filemoon", needsReferer: true }],
	[/streamtape|strtape|tapecontent|streamadblock/i, { name: "streamtape", needsReferer: true }],
	[/dood|d000d|dooood|ds2play/i, { name: "doodstream", needsReferer: true }],
	[/mp4upload/i, { name: "mp4upload", needsReferer: true }],
	[/yourupload/i, { name: "yourupload", needsReferer: true }],
	[/voe\.sx|\bvoe\b/i, { name: "voe", obfuscated: true }],
	[/mail\.ru/i, { name: "mailru", obfuscated: true }],
	[/youtube\.com|youtu\.be|youtube-nocookie/i, { name: "youtube", proprietary: true }],
	[/dailymotion/i, { name: "dailymotion", proprietary: true }],
	[/vimeo\.com/i, { name: "vimeo", proprietary: true }],
];

/** Hébergeur inconnu : on garde le nom d'hôte, c'est déjà une information. */
function fallbackTraits(url: string): HostTraits {
	try {
		return { name: new URL(url).hostname.replace(/^www\./, ""), needsReferer: true };
	} catch {
		return { name: "unknown" };
	}
}

/** Particularités connues de l'hébergeur d'une URL d'embed. */
export function hostTraits(embedUrl: string): HostTraits {
	for (const [pattern, traits] of HOSTS) {
		if (pattern.test(embedUrl)) return traits;
	}
	return fallbackTraits(embedUrl);
}

/** Nom canonique de l'hébergeur d'une URL d'embed. */
export function hostFromUrl(embedUrl: string): string {
	return hostTraits(embedUrl).name;
}

/**
 * Corrige les domaines morts avant d'aller frapper à la porte.
 *
 * `vidmoly.to` et `vidmoly.net` ne répondent plus ; seul `vidmoly.biz` sert
 * encore les lecteurs, y compris pour les liens publiés sous les anciens noms.
 */
export function normalizeEmbedUrl(url: string): string {
	return url.trim().replace(/vidmoly\.(to|net)/gi, "vidmoly.biz");
}

/**
 * En-têtes à rejouer pour que le flux réponde.
 *
 * La plupart des hébergeurs refusent une requête sans `Referer` pointant vers
 * leur propre page d'embed — c'est leur garde-fou anti-hotlink, et c'est la
 * première cause de « l'URL marche dans le navigateur mais pas en ligne de
 * commande ».
 */
export function playbackHeaders(
	embedUrl: string,
	userAgent?: string,
): Record<string, string> {
	const traits = hostTraits(embedUrl);
	const headers: Record<string, string> = {};
	if (userAgent) headers["User-Agent"] = userAgent;
	if (traits.needsReferer !== false) {
		try {
			const origin = new URL(embedUrl).origin;
			headers.Referer = `${origin}/`;
			headers.Origin = origin;
		} catch {
			/* URL inexploitable : pas d'en-tête plutôt qu'un en-tête faux */
		}
	}
	return headers;
}

/**
 * Expiration d'une URL signée, en ms epoch.
 *
 * Les hébergeurs signent leurs liens avec une échéance (`e`, `t`, `expires`,
 * `exp`, `validfrom`…), en secondes epoch le plus souvent, parfois en
 * millisecondes. Un lien résolu hier ne vaut plus rien aujourd'hui : autant le
 * savoir avant de le mettre en cache.
 */
export function expiryFromUrl(url: string): number | null {
	let params: URLSearchParams;
	try {
		params = new URL(url).searchParams;
	} catch {
		return null;
	}
	for (const key of ["expires", "expire", "exp", "e", "t", "validto"]) {
		const raw = params.get(key);
		if (!raw || !/^\d{9,14}$/.test(raw)) continue;
		const value = Number(raw);
		const ms = raw.length >= 13 ? value : value * 1000;
		// Une échéance plausible : entre 2020 et 2100.
		if (ms > 1_577_836_800_000 && ms < 4_102_444_800_000) return ms;
	}
	return null;
}
