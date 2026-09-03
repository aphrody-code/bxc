// SPDX-License-Identifier: Apache-2.0
/**
 * Déballage des charges utiles obfusquées d'un lecteur.
 *
 * Deux formes couvrent l'essentiel du parc :
 *
 *  - le compresseur de Dean Edwards (`eval(function(p,a,c,k,e,d){…})`), où le
 *    script est réécrit avec un dictionnaire de mots-clés en base *a* ;
 *  - des chaînes base64 (`atob("…")`) qui contiennent l'URL en clair.
 *
 * Rien n'est *évalué* : on rejoue la substitution nous-mêmes. Faire tourner le
 * script d'un hébergeur pour lire une URL reviendrait à exécuter du code
 * arbitraire venu d'une page tierce.
 */

/** Une couche de source : la page brute, puis chaque niveau déballé. */
export interface SourceLayer {
	text: string;
	/** 0 pour la page telle qu'elle arrive, 1 après un déballage, etc. */
	depth: number;
	/** Ce qui a produit cette couche (`raw`, `packer`, `base64`). */
	via: "raw" | "packer" | "base64";
}

/** Nombre maximal de déballages successifs : au-delà, c'est une boucle. */
const MAX_DEPTH = 4;

/**
 * L'appel final du compresseur : `}('charge',base,compte,'mots'.split('|')`.
 *
 * Les deux guillemets sont acceptés — certains hébergeurs republient la charge
 * avec des guillemets doubles, et une expression qui n'accepte que l'apostrophe
 * rate ces pages sans rien dire.
 */
const PACKER_CALL =
	/}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.split\((['"])\|\7\)/;

/** Chiffre `n` dans la base du compresseur, façon `toString(36)` étendu. */
function baseEncode(n: number, radix: number): string {
	const low = n % radix;
	const rest = Math.floor(n / radix);
	const token = low > 35 ? String.fromCharCode(low + 29) : low.toString(36);
	return (n < radix ? "" : baseEncode(rest, radix)) + token;
}

/**
 * Rend la charge utile d'un script compressé, ou la source inchangée si elle
 * ne l'est pas.
 */
export function unpackPacker(source: string): string {
	const match = PACKER_CALL.exec(source);
	if (!match) return source;

	let payload = match[2]
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\")
		.replace(/\\n/g, "\n");
	const radix = Number.parseInt(match[3], 10);
	const dictionary = match[6].split("|");
	let count = Number.parseInt(match[4], 10);
	if (!Number.isFinite(radix) || radix < 2 || !Number.isFinite(count)) return source;

	while (count--) {
		const word = dictionary[count];
		if (!word) continue;
		payload = payload.replace(new RegExp(`\\b${baseEncode(count, radix)}\\b`, "g"), word);
	}
	return payload;
}

/** Vrai si la source contient un script compressé à la Dean Edwards. */
export function isPacked(source: string): boolean {
	return PACKER_CALL.test(source);
}

/** Vrai si la chaîne ne contient que du texte imprimable (plus tabulation et retours). */
function isPrintable(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const allowed = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
		if (!allowed) return false;
	}
	return true;
}

/** Décode les chaînes base64 assez longues pour contenir une URL. */
export function decodeBase64Payloads(source: string): string[] {
	const out: string[] = [];
	const pattern = /atob\(\s*["']([A-Za-z0-9+/=]{24,})["']\s*\)/g;
	for (const match of source.matchAll(pattern)) {
		try {
			const decoded = Buffer.from(match[1], "base64").toString("utf8");
			// Une charge utile exploitable est du texte : si le décodage donne
			// du binaire, c'est qu'on s'est trompé de piste.
			if (isPrintable(decoded)) out.push(decoded);
		} catch {
			/* chaîne mal formée : on l'ignore */
		}
	}
	return out;
}

/** Neutralise les échappements qui masquent une URL (`https:\/\/…`, `/`). */
export function unescapeUrls(source: string): string {
	return source
		.replace(/\\\//g, "/")
		.replace(/\\u002[fF]/g, "/")
		.replace(/\\u003[aA]/g, ":");
}

/**
 * Déplie une page en couches successives : la source telle quelle, puis chaque
 * déballage. Les règles d'extraction sont ensuite appliquées à chacune, ce qui
 * permet de dire *à quelle profondeur* une URL a été trouvée.
 */
export function peelLayers(source: string, maxDepth = MAX_DEPTH): SourceLayer[] {
	const layers: SourceLayer[] = [{ text: source, depth: 0, via: "raw" }];
	const seen = new Set([source]);

	let current = source;
	for (let depth = 1; depth <= maxDepth; depth++) {
		const unpacked = unpackPacker(current);
		if (unpacked === current || seen.has(unpacked)) break;
		seen.add(unpacked);
		layers.push({ text: unpacked, depth, via: "packer" });
		current = unpacked;
	}

	// Instantané : les couches base64 ajoutées ci-dessous ne doivent pas être
	// refouillées par la même boucle.
	for (const layer of layers.slice()) {
		for (const decoded of decodeBase64Payloads(layer.text)) {
			if (seen.has(decoded)) continue;
			seen.add(decoded);
			layers.push({ text: decoded, depth: layer.depth + 1, via: "base64" });
		}
	}
	return layers;
}
