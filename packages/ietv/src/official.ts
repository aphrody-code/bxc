/**
 * Lecture du site officiel `inazuma-eleven.fr/tv` — module PUR.
 *
 * ── POURQUOI JSON-LD ET PAS LE HTML ────────────────────────────────────────
 * La liste des épisodes est rendue par JavaScript : le HTML servi ne contient
 * qu'un `<div id="episode-list"></div>` vide, et l'ancien parseur, qui cherchait
 * des conteneurs `class="…episode…"`, ne trouvait donc jamais rien.
 *
 * En revanche le site publie ses données en **JSON-LD** pour les moteurs de
 * recherche : l'index porte un `ItemList` des dix catégories, et chaque page de
 * catégorie un `ItemList` de ses épisodes, nom et URL compris. C'est du balisage
 * structuré, versionné avec le site et destiné à être lu — bien plus stable
 * qu'une classe CSS.
 */

/** Une catégorie du site : « Saison 1 », « GO », « Films »… */
export interface CategorieOfficielle {
	/** Rang dans la liste du site — sert de numéro de saison. */
	position: number;
	nom: string;
	url: string;
	/** Dernier segment de l'URL : `saison1`, `chronoStones`, `films`. */
	slug: string;
}

/** Un épisode listé sur une page de catégorie. */
export interface EpisodeOfficiel {
	/** Numéro tel que porté par l'URL (`ep-12`), à défaut le rang dans la liste. */
	numero: number;
	/** Nom complet, `« Épisode 12 - Titre »`. */
	nom: string;
	/** Titre seul, sans le préfixe « Épisode N - ». */
	titre: string;
	url: string;
}

/**
 * Tous les objets JSON-LD de la page, `@graph` aplati.
 *
 * Un bloc illisible est ignoré plutôt que fatal : une page peut en porter
 * plusieurs, et un seul mal formé ne doit pas faire perdre les autres.
 */
export function extraireJsonLd(html: string): Record<string, unknown>[] {
	const objets: Record<string, unknown>[] = [];
	const blocs = html.matchAll(
		/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
	);

	for (const bloc of blocs) {
		try {
			const valeur: unknown = JSON.parse(bloc[1]!);
			const racines = Array.isArray(valeur) ? valeur : [valeur];
			for (const racine of racines) {
				if (typeof racine !== "object" || racine === null) continue;
				const objet = racine as Record<string, unknown>;
				const graphe = objet["@graph"];
				if (Array.isArray(graphe)) {
					for (const noeud of graphe) {
						if (typeof noeud === "object" && noeud !== null) {
							objets.push(noeud as Record<string, unknown>);
						}
					}
				} else {
					objets.push(objet);
				}
			}
		} catch {
			// Bloc JSON-LD illisible : on passe au suivant.
		}
	}
	return objets;
}

interface ElementListe {
	position?: unknown;
	name?: unknown;
	url?: unknown;
}

/** Éléments du premier `ItemList` dont le nom satisfait le prédicat. */
function elementsDeListe(
	html: string,
	accepte: (nom: string) => boolean
): { position: number; nom: string; url: string }[] {
	for (const objet of extraireJsonLd(html)) {
		if (objet["@type"] !== "ItemList") continue;
		const nomListe = typeof objet.name === "string" ? objet.name : "";
		if (!accepte(nomListe)) continue;

		const elements = objet.itemListElement;
		if (!Array.isArray(elements)) continue;

		return elements
			.map((brut, index) => {
				const element = brut as ElementListe;
				const nom = typeof element.name === "string" ? element.name.trim() : "";
				const url = typeof element.url === "string" ? element.url.trim() : "";
				const position = typeof element.position === "number" ? element.position : index + 1;
				return { position, nom, url };
			})
			.filter((element) => element.nom !== "" && element.url !== "");
	}
	return [];
}

/** Dernier segment de chemin d'une URL, paramètres retirés. */
export function slugDeUrl(url: string): string {
	const chemin = url.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
	return chemin.slice(chemin.lastIndexOf("/") + 1);
}

/**
 * Catégories listées par la page d'index.
 *
 * Le rang du site fait office de numéro de saison : les trois premières
 * s'appellent bien « Saison 1/2/3 », et les suivantes (GO, Chrono Stones,
 * Galaxy…) n'ont pas de numéro propre. Reprendre l'ordre du site donne une
 * numérotation stable, et qui correspond à l'ordre de diffusion.
 */
export function parserCategories(html: string): CategorieOfficielle[] {
	return elementsDeListe(html, (nom) => /categor/i.test(nom))
		.map((element) => ({
			position: element.position,
			nom: element.nom,
			url: element.url,
			slug: slugDeUrl(element.url),
		}))
		.filter((categorie) => categorie.slug !== "")
		.sort((a, b) => a.position - b.position);
}

/** Numéro porté par une URL d'épisode (`…/ep-12?lang=fr` → 12), sinon `null`. */
export function numeroDeUrl(url: string): number | null {
	const trouve = /\/ep-(\d+)/i.exec(url);
	return trouve ? Number.parseInt(trouve[1]!, 10) : null;
}

/** Retire le préfixe « Épisode 12 - » d'un nom complet. */
export function titreSansPrefixe(nom: string): string {
	return nom.replace(/^\s*(?:épisode|episode)\s*\d+\s*[-–—:]\s*/i, "").trim() || nom.trim();
}

/** Épisodes listés par une page de catégorie. */
export function parserEpisodes(html: string): EpisodeOfficiel[] {
	return elementsDeListe(html, (nom) => /episode/i.test(nom))
		.map((element) => ({
			// L'URL fait foi : le rang saute dès qu'un épisode manque au site,
			// alors que `/ep-12` porte le vrai numéro de diffusion.
			numero: numeroDeUrl(element.url) ?? element.position,
			nom: element.nom,
			titre: titreSansPrefixe(element.nom),
			url: element.url,
		}))
		.sort((a, b) => a.numero - b.numero);
}

/**
 * Identifiant stable d'un épisode officiel, pour la clé `videoId` du cache.
 *
 * Le site ne donne pas d'identifiant : on en dérive un du couple
 * catégorie/numéro, qui est unique et reproductible d'un scraping à l'autre —
 * indispensable, puisque c'est lui qui distingue un épisode déjà annoncé d'une
 * nouveauté.
 */
export function identifiantOfficiel(slug: string, numero: number): string {
	return `off-${slug}-${numero}`;
}

/** Métadonnées lues sur la page d'un épisode. */
export interface MetaEpisode {
	idYoutube: string | null;
	titre: string | null;
	description: string | null;
	vignette: string | null;
	/** Code de langue déclaré par le site (`"fr"`). */
	langue: string | null;
	/** Nom de l'arc tel que le site le nomme (« Saison 1 », « Films »). */
	nomSaison: string | null;
	numero: number | null;
}

/**
 * Métadonnées d'une page d'épisode, lues dans son JSON-LD.
 *
 * La page publie un `VideoObject` ET un `Episode` : le premier porte la
 * vignette, le second le numéro et le nom de l'arc. On lit les deux, parce
 * qu'aucun ne suffit — et parce que cette page est de toute façon déjà
 * récupérée pour son identifiant YouTube. Une requête, toutes les données.
 */
export function parserMetaEpisode(html: string): MetaEpisode {
	const objets = extraireJsonLd(html);
	const video = objets.find((o) => o["@type"] === "VideoObject");
	const episode = objets.find((o) => o["@type"] === "Episode");

	const chaine = (valeur: unknown): string | null =>
		typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;

	const vignette = (() => {
		const brut = video?.thumbnailUrl;
		if (Array.isArray(brut)) return chaine(brut[0]);
		return chaine(brut);
	})();

	const saison = episode?.partOfSeason as { name?: unknown } | undefined;

	return {
		idYoutube: extraireIdYoutube(html),
		titre: chaine(episode?.name) ?? chaine(video?.name),
		description: chaine(episode?.description) ?? chaine(video?.description),
		vignette,
		langue: chaine(episode?.inLanguage) ?? chaine(video?.inLanguage),
		nomSaison: chaine(saison?.name),
		numero: typeof episode?.episodeNumber === "number" ? episode.episodeNumber : null,
	};
}

/**
 * Identifiant YouTube porté par une page d'épisode.
 *
 * Les épisodes du site officiel SONT des vidéos YouTube : la page les intègre
 * en iframe et annonce sa vignette via `og:image`. Récupérer cet identifiant
 * change tout côté Discord — une URL YouTube nue y produit un vrai lecteur,
 * là où un lien vers la page du site ne donne qu'une carte.
 */
export function extraireIdYoutube(html: string): string | null {
	const trouve =
		/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(html) ??
		/img\.youtube\.com\/vi\/([A-Za-z0-9_-]{11})/.exec(html) ??
		/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/.exec(html);
	return trouve ? trouve[1]! : null;
}

/** URL de visionnage YouTube — la forme que Discord sait lire en lecteur. */
export function urlYoutube(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}
