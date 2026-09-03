/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @module bxc/scrapers/animesama
 *
 * Scraper typé et dédié à **anime-sama.to** — catalogue et référencement
 * d'animes francophones. Rétro-ingénierie faite sur les pages réelles
 * (2026-09-03). Toute la couche d'extraction est **purement textuelle** (pas de
 * DOM, pas d'exécution de JS) : elle analyse le HTML rendu côté serveur et les
 * fichiers `episodes.js`, donc elle fonctionne aussi bien sur un miroir
 * persisté que sur une réponse live.
 *
 * ## Anatomie réelle du site
 *
 * - **Fiche d'une œuvre** `/catalogue/<slug>/` :
 *     - `<h1 class="…">` → titre, `#titreAlter` → titres alternatifs,
 *       `#synopsisText` → synopsis, `.genre-pill` → genres.
 *     - `.info-card` (`.info-lbl` / `.info-val`) → État, Année, Épisodes,
 *       Studio.
 *     - `<meta property="og:image">` / `#coverOeuvre` → jaquette.
 *     - Les saisons ne sont **pas** du HTML : elles sont écrites par des appels
 *       `panneauAnime("Saison 1", "saison1/vf")` (et `panneauScan(…)` pour les
 *       scans) dans un `<script>`, exécutés via `document.write`. C'est la
 *       seule source de vérité pour la liste des saisons et des langues.
 * - **Page d'une saison** `/catalogue/<slug>/<saison>/<langue>/` :
 *     - charge `episodes.js` (même dossier) et `/js/contenu/videos.js`.
 *     - `#titreOeuvre` → titre de l'œuvre, `<title>` → « Œuvre - Saison N ».
 *     - un `<script>$(document).ready(…)</script>` en fin de page compose la
 *       liste affichée avec `resetListe()`, `creerListe(debut, fin)`,
 *       `newSP(numero)`, `newSPF("nom libre")` et `finirListe(debut)`.
 *       Le **dernier** `resetListe()` gagne : le bloc par défaut
 *       (`resetListe(); finirListe(1);`) est souvent suivi d'un second bloc
 *       spécifique aux films. Un gabarit commenté (`/* … *\/`) contient les
 *       mêmes appels : il faut retirer les commentaires avant d'analyser.
 * - **`/catalogue/<slug>/<saison>/<langue>/episodes.js`** :
 *     - une variable `var epsN = [ 'url', 'url', … ];` par **lecteur**
 *       (hébergeur), `N` de 1 à 8. Une case = un épisode, dans l'ordre.
 *     - la numérotation n'est ni dense ni ordonnée : on croise `var eps2`
 *       déclaré avant `var eps1`, `eps1` absent, des retours à la ligne
 *       arbitraires et des virgules traînantes.
 *     - `videos.js` **échange** `eps1` et `eps2` à l'affichage ; ce module
 *       conserve la numérotation brute du fichier (voir {@link Lecteur.index}).
 * - **Recherche** : `POST /template-php/defaut/fetch.php` avec `query=<texte>`
 *   → fragment HTML de `<a class="asn-search-result">`. Alternative en GET :
 *   `/catalogue/?search=<texte>&page=N` → cartes `.catalog-card`.
 *
 * ## Hébergeurs rencontrés
 *
 * `ansembed.net`, `lpayer.embed4me.com`, `video.sibnet.ru`, `sendvid.com`,
 * `movearnpre.com`, `oneupload.to`, `s22.anime-sama.fr` (direct mp4),
 * `www.youtube.com/embed`, `www.dailymotion.com/embed`, `vidmoly`, `myvi.top`.
 *
 * @example
 * ```ts
 * import { AnimesamaScraper } from "@aphrody/animesama";
 *
 * const as = new AnimesamaScraper();
 * const fiche = await as.getAnime("inazuma-eleven");
 * console.log(fiche.titre, fiche.saisons.length);        // Inazuma Eleven 7
 *
 * const saison = await as.getSaison("inazuma-eleven", "saison1", "vf");
 * console.log(saison.episodes[0].lecteurs[0].url);
 *
 * const source = await as.resoudreLecteur(saison.episodes[0].lecteurs[0]);
 * console.log(source.type, source.url);
 * await as.close();
 * ```
 */

import { Browser } from "@aphrody/bxc";
import {
	classifyMedia,
	extractMediaCandidates,
	extractPoster,
	hostFromUrl,
	normalizeEmbedUrl,
	resolveEmbed,
	resolveVariants,
	unpackPacker,
	type MediaTransport,
	type MediaVariant,
} from "@aphrody/bxc/media";

type AnyPage = Awaited<ReturnType<typeof Browser.newPage>>;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Codes de langue utilisés par les dossiers du site (`…/saison1/vostfr/`). */
export const LANGUES_ANIMESAMA = [
	"vostfr",
	"vf",
	"va",
	"var",
	"vkr",
	"vcn",
	"vqc",
	"vf1",
	"vf2",
] as const;

/** Langue d'une saison, telle qu'elle apparaît dans l'URL. */
export type LangueAnimesama = (typeof LANGUES_ANIMESAMA)[number];

/** Profils de transport bxc acceptés (identiques aux autres scrapers du dépôt). */
export type ProfilAnimesama = "static" | "http" | "fast" | "stealth" | "max";

/** Une entrée de résultat de recherche ou de carte du catalogue. */
export interface ResultatRecherche {
	/** Slug de l'œuvre (`"inazuma-eleven"`). */
	slug: string;
	/** Titre affiché. */
	titre: string;
	/** Titres alternatifs, tels qu'imprimés (souvent tronqués sur les cartes). */
	titresAlternatifs: string[];
	/** URL absolue de la fiche. */
	url: string;
	/** Vignette, quand la page en fournit une. */
	image: string | null;
}

/** Une saison (ou un bloc de films / de scans) déclarée sur la fiche. */
export interface SaisonRef {
	/** Libellé affiché (`"Saison 1"`, `"GO: Chrono Stones"`, `"Film"`). */
	nom: string;
	/** Chemin relatif déclaré (`"saison1/vf"`). */
	chemin: string;
	/** Dossier de saison (`"saison1"`, `"film"`, `"oav"`…). */
	saison: string;
	/** Langue extraite du chemin, `null` si le chemin n'en porte pas. */
	langue: LangueAnimesama | null;
	/** URL absolue de la page de saison. */
	url: string;
	/** `anime` (`panneauAnime`) ou `scan` (`panneauScan`). */
	categorie: "anime" | "scan";
}

/** Fiche complète d'une œuvre du catalogue. */
export interface FicheAnime {
	slug: string;
	url: string;
	titre: string;
	titresAlternatifs: string[];
	synopsis: string | null;
	/** Jaquette pleine résolution. */
	image: string | null;
	genres: string[];
	/** État de diffusion tel qu'imprimé (`"Terminé"`, `"En cours"`…). */
	etat: string | null;
	/** Année de première diffusion, quand la fiche l'affiche. */
	annee: number | null;
	/** Nombre d'épisodes annoncé par la fiche (peut différer du réel). */
	nombreEpisodesAnnonce: number | null;
	/** Studios d'animation. */
	studios: string[];
	/** Saisons animées déclarées par `panneauAnime`. */
	saisons: SaisonRef[];
	/** Blocs de scans déclarés par `panneauScan`. */
	scans: SaisonRef[];
}

/** Un lecteur = une variable `epsN` du fichier `episodes.js`. */
export interface Lecteur {
	/** Numéro brut de la variable (`eps1` → 1). Non contigu, non trié. */
	index: number;
	/** Nom d'affichage du site (`"Lecteur 1"`), dérivé de l'ordre croissant. */
	nom: string;
	/** Hébergeur dominant du lecteur (`"sibnet"`, `"ansembed"`…). */
	hebergeur: string;
	/** URLs d'embed, une par épisode, dans l'ordre du fichier. */
	urls: string[];
}

/** L'URL d'un épisode chez un lecteur donné. */
export interface LecteurEpisode {
	/** Numéro brut de la variable `epsN`. */
	index: number;
	/** Nom d'affichage du lecteur. */
	nom: string;
	/** Hébergeur normalisé. */
	hebergeur: string;
	/** URL d'embed, normalisée (vidmoly → `.biz`). */
	url: string;
}

/** Un épisode d'une saison, tous lecteurs confondus. */
export interface EpisodeAnimesama {
	/** Position dans les tableaux `epsN` (0-based). */
	position: number;
	/** Nom affiché par le site (`"Episode 3"`, `"Broly"`…). */
	nom: string;
	/** Numéro d'épisode quand le nom en porte un, sinon `null`. */
	numero: number | null;
	/** Une entrée par lecteur qui couvre cet épisode. */
	lecteurs: LecteurEpisode[];
}

/** Une saison résolue : lecteurs bruts + épisodes nommés. */
export interface SaisonAnimesama {
	slug: string;
	saison: string;
	langue: LangueAnimesama;
	url: string;
	/** Titre de l'œuvre tel qu'affiché sur la page de saison. */
	titre: string | null;
	/** Libellé de la saison (`"Saison 1"`), tel qu'injecté par la page. */
	libelle: string | null;
	lecteurs: Lecteur[];
	episodes: EpisodeAnimesama[];
}

/** Variante d'un master HLS. */
export interface QualiteMedia {
	label: string;
	url: string;
	resolution?: string;
	bandePassante?: number;
}

/** Résultat de la résolution d'un embed vers un flux direct. */
export interface SourceResolue {
	hebergeur: string;
	embedUrl: string;
	/** `hls` pour `.m3u8`, `dash` pour `.mpd`, `mp4` pour du progressif, `unknown` sinon. */
	type: "hls" | "dash" | "mp4" | "unknown";
	/** URL média directe, ou `null` si la résolution a échoué. */
	url: string | null;
	/** Image d'aperçu déclarée par le lecteur, quand elle existe. */
	poster: string | null;
	/** Variantes du master HLS, quand elles ont été énumérées. */
	qualites?: QualiteMedia[];
	/** En-têtes nécessaires à la lecture (notamment `Referer`). */
	enTetes: Record<string, string>;
	/** Raison lisible de l'échec quand `url` vaut `null`. */
	erreur: string | null;
}

/** Une requête HTTP émise par le scraper. */
export interface RequeteHttp {
	url: string;
	methode?: "GET" | "POST";
	/** Corps déjà encodé (`application/x-www-form-urlencoded` pour la recherche). */
	corps?: string;
	enTetes?: Record<string, string>;
	referer?: string;
	timeoutMs?: number;
}

/** La réponse minimale dont les analyseurs ont besoin. */
export interface ReponseHttp {
	status: number;
	corps: string;
	/** URL finale après redirections, quand le transport la connaît. */
	url?: string;
}

/**
 * Transport HTTP injectable. Le remplacer permet de tester le scraper sans
 * réseau, ou de le brancher sur un cache / un miroir.
 */
export type TransportHttp = (requete: RequeteHttp) => Promise<ReponseHttp>;

/** Options de {@link AnimesamaScraper}. */
export interface AnimesamaOptions {
	/** Profil de transport bxc. `static` (défaut) est le plus rapide, zéro spawn. */
	profile?: ProfilAnimesama;
	/** Origine du site (défaut `https://anime-sama.to`). */
	baseUrl?: string;
	/** Délai de navigation par requête, en ms (défaut 30000). */
	timeoutMs?: number;
	/** Nombre de reprises sur échec transitoire (défaut 2). */
	retries?: number;
	/**
     * Transport injecté. Quand il est fourni, aucune page bxc n'est ouverte —
     * c'est ce que font les tests.
     */
	transport?: TransportHttp;
}

// ---------------------------------------------------------------------------
// Aides HTML pures
// ---------------------------------------------------------------------------

const ENTITES_NOMMEES: Record<string, string> = {
	quot: '"',
	amp: "&",
	apos: "'",
	lt: "<",
	gt: ">",
	nbsp: " ",
	hellip: "…",
	laquo: "«",
	raquo: "»",
	eacute: "é",
	egrave: "è",
	agrave: "à",
	ccedil: "ç",
	rsquo: "’",
};

/** Décode les entités HTML numériques et les quelques entités nommées utiles. */
export function decoderEntites(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(
			/&([a-z]+);/gi,
			(m, nom) => ENTITES_NOMMEES[nom.toLowerCase()] ?? m,
		);
}

/** Retire les balises, décode les entités et normalise les espaces. */
export function texteBrut(s: string): string {
	return decoderEntites(s.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Dernier segment non vide d'une URL ou d'un chemin. */
function dernierSegment(url: string): string {
	return (
		url
			.replace(/[?#].*$/, "")
			.replace(/\/+$/, "")
			.split("/")
			.pop() ?? ""
	);
}

/** Lit le `content` d'une `<meta>` par `name` ou `property`. */
function metaContenu(html: string, cle: string): string | null {
	const echappe = cle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const direct = new RegExp(
		`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${echappe}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
		"i",
	).exec(html);
	if (direct) return decoderEntites(direct[1]);
	const inverse = new RegExp(
		`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${echappe}["']`,
		"i",
	).exec(html);
	return inverse ? decoderEntites(inverse[1]) : null;
}

/**
 * Retire les commentaires JS d'un fragment de script ou d'une page.
 *
 * Indispensable : les pages de saison embarquent un gabarit **commenté** qui
 * contient les mêmes appels (`resetListe(); creerListe(debut, fin); …`) que le
 * code réel. Sans ce nettoyage, l'analyseur reconstruirait une liste fantôme.
 *
 * Volontairement conservateur sur les commentaires de ligne : `//` apparaît
 * dans toutes les URLs (`https://…`, `//cdn.jsdelivr.net/…`), donc seules les
 * lignes qui **commencent** par `//` sont retirées. C'est la forme qu'emploie
 * le site (`//check si episode existe`, `//` final de `episodes.js`).
 */
export function retirerCommentairesJs(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/^[ \t]*\/\/[^\n]*/gm, " ");
}

/** Vérifie qu'une chaîne est bien un code de langue connu du site. */
export function estLangue(valeur: string): valeur is LangueAnimesama {
	return (LANGUES_ANIMESAMA as readonly string[]).includes(valeur);
}

// ---------------------------------------------------------------------------
// Hébergeurs
// ---------------------------------------------------------------------------

/**
 * Nom canonique de l'hébergeur d'un lecteur.
 *
 * Le registre lui-même est dans le cœur média de bxc (`@aphrody/bxc/media`) :
 * les mêmes hébergeurs se retrouvent derrière voiranime, et un domaine qui
 * change doit être corrigé à un seul endroit. Seul le mot « inconnu » reste
 * local — c'est le vocabulaire français de ce paquet.
 */
export function hebergeurDepuisUrl(url: string): string {
	const nom = hostFromUrl(url);
	return nom === "unknown" ? "inconnu" : nom;
}

/**
 * Applique la réécriture que `videos.js` fait à l'exécution : les domaines
 * `vidmoly.to` et `vidmoly.net` sont morts, seul `vidmoly.biz` répond.
 */
export function normaliserUrlLecteur(url: string): string {
	return normalizeEmbedUrl(url);
}

// ---------------------------------------------------------------------------
// Analyseurs purs — fiche d'une œuvre
// ---------------------------------------------------------------------------

/**
 * Extrait les saisons déclarées par les appels `panneauAnime` / `panneauScan`
 * du `<script>` de la fiche.
 *
 * La définition JavaScript de ces deux fonctions est elle-même présente dans la
 * page ; elle est ignorée car ses arguments sont des identifiants (`nom`,
 * `url`) et non des chaînes littérales.
 */
export function parserSaisonsDeclarees(
	html: string,
	urlFiche: string,
): { saisons: SaisonRef[]; scans: SaisonRef[] } {
	const base = urlFiche.replace(/\/+$/, "");
	const saisons: SaisonRef[] = [];
	const scans: SaisonRef[] = [];
	const source = retirerCommentairesJs(html);
	const re =
		/panneau(Anime|Scan)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
	for (const m of source.matchAll(re)) {
		const categorie = m[1] === "Scan" ? "scan" : "anime";
		const nom = decoderEntites(m[2].replace(/\\(.)/g, "$1")).trim();
		const chemin = m[3].replace(/\\(.)/g, "$1").replace(/^\/+|\/+$/g, "");
		if (!chemin) continue;
		const segments = chemin.split("/");
		const dernier = segments[segments.length - 1] ?? "";
		const langue = estLangue(dernier) ? dernier : null;
		const ref: SaisonRef = {
			nom,
			chemin,
			saison: langue ? segments.slice(0, -1).join("/") : chemin,
			langue,
			url: `${base}/${chemin}/`,
			categorie,
		};
		(categorie === "scan" ? scans : saisons).push(ref);
	}
	return { saisons, scans };
}

/** Lit une ligne `.info-lbl` → `.info-val` de la carte d'informations. */
function ligneInfo(html: string, label: string): string | null {
	const echappe = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		`<span class="info-lbl">[\\s\\S]*?${echappe}\\s*</span>\\s*<(span|div) class="info-val[^"]*"[^>]*>([\\s\\S]*?)</\\1>`,
		"i",
	);
	const m = re.exec(html);
	return m ? texteBrut(m[2]) : null;
}

/** Analyse une fiche `/catalogue/<slug>/` complète. */
export function parserFicheAnime(html: string, url: string): FicheAnime {
	const slug = dernierSegment(url);

	const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
	const titre =
		(h1 ? texteBrut(h1[1]) : "") ||
		(metaContenu(html, "og:title") ?? "").split("|")[0].trim() ||
		slug;

	const alterM = /id="titreAlter"[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
	const titresAlternatifs = alterM
		? texteBrut(alterM[1])
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

	const synM = /id="synopsisText"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
	const synopsis = synM
		? texteBrut(synM[1])
		: metaContenu(html, "description");

	const coverM = /id="coverOeuvre"[^>]+src="([^"]+)"/i.exec(html);
	const image = coverM ? coverM[1] : metaContenu(html, "og:image");

	const genres: string[] = [];
	for (const m of html.matchAll(
		/<span class="genre-pill">([\s\S]*?)<\/span>/g,
	)) {
		const g = texteBrut(m[1]);
		if (g && !genres.includes(g)) genres.push(g);
	}

	const anneeRaw = ligneInfo(html, "Année");
	const annee = anneeRaw ? parseInt(anneeRaw.replace(/\D/g, ""), 10) || null : null;

	const episodesRaw = ligneInfo(html, "Épisodes");
	const nombreEpisodesAnnonce = episodesRaw
		? parseInt(episodesRaw.replace(/\D/g, ""), 10) || null
		: null;

	const studioRaw = ligneInfo(html, "Studio");
	const studios = studioRaw
		? studioRaw
				.replace(/\s*Voir (?:plus|moins)\s*$/i, "")
				.split(/,|·/)
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

	const { saisons, scans } = parserSaisonsDeclarees(html, url);

	return {
		slug,
		url,
		titre,
		titresAlternatifs,
		synopsis,
		image,
		genres,
		etat: ligneInfo(html, "État"),
		annee,
		nombreEpisodesAnnonce,
		studios,
		saisons,
		scans,
	};
}

// ---------------------------------------------------------------------------
// Analyseurs purs — recherche
// ---------------------------------------------------------------------------

/**
 * Analyse le fragment renvoyé par `POST /template-php/defaut/fetch.php`
 * (une suite de `<a class="asn-search-result">`).
 */
export function parserResultatsRecherche(html: string): ResultatRecherche[] {
	const out: ResultatRecherche[] = [];
	const blocs = html.split(/<a\s+href="/i).slice(1);
	for (const bloc of blocs) {
		const hrefM = /^([^"]+)"/.exec(bloc);
		if (!hrefM) continue;
		const url = hrefM[1];
		const slugM = /\/catalogue\/([^/"?#]+)/.exec(url);
		if (!slugM) continue;
		const titreM = /class="asn-search-result-title"[^>]*>([\s\S]*?)<\/h3>/i.exec(
			bloc,
		);
		if (!titreM) continue;
		const sousTitreM =
			/class="asn-search-result-subtitle"[^>]*>([\s\S]*?)<\/p>/i.exec(bloc);
		const imgM = /class="asn-search-result-img"[^>]*src="([^"]+)"/i.exec(bloc);
		out.push({
			slug: slugM[1],
			titre: texteBrut(titreM[1]),
			titresAlternatifs: sousTitreM
				? texteBrut(sousTitreM[1])
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: [],
			url,
			image: imgM ? imgM[1] : null,
		});
	}
	return out;
}

/** Analyse les cartes `.catalog-card` d'une page `/catalogue/?search=…`. */
export function parserCartesCatalogue(html: string): ResultatRecherche[] {
	const out: ResultatRecherche[] = [];
	const seen = new Set<string>();
	for (const bloc of html.split(/class="[^"]*catalog-card[^"]*"/i).slice(1)) {
		const hrefM = /<a\s+href="([^"]*\/catalogue\/([^/"?#]+))"/i.exec(bloc);
		if (!hrefM) continue;
		if (seen.has(hrefM[2])) continue;
		const titreM = /class="card-title"[^>]*>([\s\S]*?)<\/h2>/i.exec(bloc);
		if (!titreM) continue;
		const altM = /class="alternate-titles"[^>]*>([\s\S]*?)<\/p>/i.exec(bloc);
		const imgM = /class="card-image"[^>]*src="([^"]+)"/i.exec(bloc);
		seen.add(hrefM[2]);
		out.push({
			slug: hrefM[2],
			titre: texteBrut(titreM[1]),
			titresAlternatifs: altM
				? texteBrut(altM[1])
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: [],
			url: hrefM[1],
			image: imgM ? imgM[1] : null,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Analyseurs purs — episodes.js et liste d'épisodes
// ---------------------------------------------------------------------------

/**
 * Analyse un fichier `episodes.js` et renvoie un lecteur par variable `epsN`.
 *
 * Tolère les formes réelles rencontrées : déclarations sur une seule ligne,
 * indentation quelconque, `eps2` déclaré avant `eps1`, `eps1` absent, virgule
 * traînante avant `]`.
 */
export function parserLecteurs(js: string): Lecteur[] {
	const source = retirerCommentairesJs(js);
	const lecteurs: Lecteur[] = [];
	const re = /\bvar\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]/g;
	for (const m of source.matchAll(re)) {
		const index = parseInt(m[1], 10);
		if (lecteurs.some((l) => l.index === index)) continue;
		const urls: string[] = [];
		for (const u of m[2].matchAll(/['"]([^'"]+)['"]/g)) {
			const url = normaliserUrlLecteur(u[1].trim());
			if (url) urls.push(url);
		}
		if (urls.length === 0) continue;
		lecteurs.push({
			index,
			nom: "",
			hebergeur: hebergeurDominant(urls),
			urls,
		});
	}
	lecteurs.sort((a, b) => a.index - b.index);
	// Le site nomme les lecteurs « Lecteur 1..n » dans l'ordre croissant des
	// variables présentes, pas d'après le numéro de la variable elle-même.
	lecteurs.forEach((l, i) => {
		l.nom = `Lecteur ${i + 1}`;
	});
	return lecteurs;
}

/** Hébergeur majoritaire d'une liste d'URLs. */
function hebergeurDominant(urls: string[]): string {
	const compte = new Map<string, number>();
	for (const u of urls) {
		const h = hebergeurDepuisUrl(u);
		compte.set(h, (compte.get(h) ?? 0) + 1);
	}
	let meilleur = "inconnu";
	let max = 0;
	for (const [h, n] of compte) {
		if (n > max) {
			max = n;
			meilleur = h;
		}
	}
	return meilleur;
}

/**
 * Rejoue les appels `resetListe` / `creerListe` / `newSP` / `newSPF` /
 * `finirListe` de la page de saison pour reconstituer les libellés affichés.
 *
 * @param html   Le HTML de la page de saison.
 * @param taille Nombre d'épisodes réels (longueur d'un tableau `epsN`).
 *
 * Sémantique reprise de `/js/contenu/videos.js` :
 * - `resetListe()` vide la liste (et remet le compteur d'épisodes spéciaux) ;
 * - `creerListe(a, b)` ajoute « Episode a » … « Episode b » ;
 * - `newSP(n)` ajoute « Episode n » et incrémente le compteur de spéciaux ;
 * - `newSPF(nom)` ajoute le libellé libre `nom` et incrémente le compteur ;
 * - `finirListe(a)` complète de `a` jusqu'à `taille - nombreDeSpeciaux`.
 *
 * Quand la page ne contient aucune directive exploitable, on retombe sur la
 * numérotation par défaut « Episode 1 … Episode taille ».
 */
export function parserNomsEpisodes(html: string, taille: number): string[] {
	const source = retirerCommentairesJs(html);
	let noms: string[] = [];
	let speciaux = 0;
	let vuDirective = false;

	const re =
		/\b(resetListe|creerListe|newSPF|newSP|finirListe)\s*\(([^)]*)\)/g;
	for (const m of source.matchAll(re)) {
		const args = m[2].trim();
		switch (m[1]) {
			case "resetListe":
				noms = [];
				speciaux = 0;
				vuDirective = true;
				break;
			case "creerListe": {
				const bornes = args.match(/-?\d+/g);
				if (!bornes || bornes.length < 2) break;
				const debut = parseInt(bornes[0], 10);
				const fin = parseInt(bornes[1], 10);
				for (let i = debut; i <= fin; i++) noms.push(`Episode ${i}`);
				vuDirective = true;
				break;
			}
			case "newSP": {
				const n = args.match(/-?\d+/);
				if (!n) break;
				noms.push(`Episode ${n[0]}`);
				speciaux++;
				vuDirective = true;
				break;
			}
			case "newSPF": {
				const litteral = /^\s*(["'])([\s\S]*)\1\s*$/.exec(args);
				if (!litteral) break;
				noms.push(decoderEntites(litteral[2].replace(/\\(.)/g, "$1")));
				speciaux++;
				vuDirective = true;
				break;
			}
			case "finirListe": {
				const n = args.match(/-?\d+/);
				if (!n) break;
				const debut = parseInt(n[0], 10);
				for (let i = debut; i <= taille - speciaux; i++)
					noms.push(`Episode ${i}`);
				vuDirective = true;
				break;
			}
		}
	}

	if (!vuDirective || noms.length === 0) {
		return Array.from({ length: taille }, (_, i) => `Episode ${i + 1}`);
	}
	// Le site tronque implicitement à la taille du tableau de lecteurs.
	return noms.slice(0, taille);
}

/** Extrait le numéro d'un libellé (`"Episode 12"` → 12, `"Broly"` → null). */
export function numeroDepuisNom(nom: string): number | null {
	const m = /^\s*(?:episode|épisode)\s+(\d+)/i.exec(nom);
	return m ? parseInt(m[1], 10) : null;
}

/**
 * Codes de langue pour lesquels la page imprime un drapeau.
 *
 * ⚠️ Ce n'est **pas** une liste de disponibilité : le gabarit imprime les dix
 * drapeaux quelle que soit l'œuvre, tous en `hidden`, et c'est `videos.js` qui
 * sonde `../<langue>` en HTTP pour révéler ceux qui existent. Seul
 * {@link AnimesamaScraper.listerLangues} dit la vérité.
 */
export function parserDrapeauxLangues(html: string): LangueAnimesama[] {
	const out: LangueAnimesama[] = [];
	for (const m of html.matchAll(/id="switch([A-Z0-9]+)"/g)) {
		const code = m[1].toLowerCase();
		if (estLangue(code) && !out.includes(code)) out.push(code);
	}
	return out;
}

/** Croise lecteurs et libellés pour produire la liste d'épisodes. */
export function composerEpisodes(
	lecteurs: Lecteur[],
	noms: string[],
): EpisodeAnimesama[] {
	const total = Math.max(0, ...lecteurs.map((l) => l.urls.length));
	const episodes: EpisodeAnimesama[] = [];
	for (let i = 0; i < total; i++) {
		const nom = noms[i] ?? `Episode ${i + 1}`;
		episodes.push({
			position: i,
			nom,
			numero: numeroDepuisNom(nom),
			lecteurs: lecteurs
				.filter((l) => l.urls[i])
				.map((l) => ({
					index: l.index,
					nom: l.nom,
					hebergeur: hebergeurDepuisUrl(l.urls[i]),
					url: l.urls[i],
				})),
		});
	}
	return episodes;
}

/** Analyse la page de saison + son `episodes.js` en une {@link SaisonAnimesama}. */
export function parserSaison(
	htmlPage: string,
	jsEpisodes: string,
	contexte: { slug: string; saison: string; langue: LangueAnimesama; url: string },
): SaisonAnimesama {
	const lecteurs = parserLecteurs(jsEpisodes);
	const taille = Math.max(0, ...lecteurs.map((l) => l.urls.length));
	const noms = parserNomsEpisodes(htmlPage, taille);

	const titreM = /id="titreOeuvre"[^>]*>([\s\S]*?)<\/h3>/i.exec(htmlPage);
	const libelleM = /\$\("#avOeuvre"\)\.html\("([^"]*)"\)/.exec(htmlPage);

	return {
		...contexte,
		titre: titreM ? texteBrut(titreM[1]) : null,
		libelle: libelleM ? decoderEntites(libelleM[1]) : null,
		lecteurs,
		episodes: composerEpisodes(lecteurs, noms),
	};
}

// ---------------------------------------------------------------------------
// Résolution des lecteurs vers un flux direct
// ---------------------------------------------------------------------------

/** Déballe une charge `eval(function(p,a,c,k,e,d){…})` (Dean Edwards). */
export function deballerPacker(source: string): string {
	return unpackPacker(source);
}

/** Classe une URL média d'après son extension. */
export function classerMedia(u: string): "hls" | "dash" | "mp4" | "unknown" {
	return classifyMedia(u);
}

/**
 * Cherche l'URL média dans le corps d'une page de lecteur.
 *
 * Couvre les lecteurs JW Player (`sources: [{ file: … }]`, y compris packés)
 * utilisés par ansembed / embed4me / oneupload, et le cas **sibnet** dont la
 * page `shell.php` ne contient qu'un chemin **relatif** `/v/<hash>/<id>.mp4`.
 *
 * @param base URL de l'embed, qui sert à résoudre les chemins relatifs.
 */
export function chercherMedia(
	corps: string,
	base: string,
): { url: string | null; poster: string | null } {
	const [meilleur] = extractMediaCandidates(corps, base);
	return {
		url: meilleur?.url ?? null,
		poster: extractPoster(corps, base),
	};
}

/** Traduit une variante du cœur média dans le vocabulaire du paquet. */
function enQualite(variante: MediaVariant): QualiteMedia {
	const label =
		variante.label ??
		variante.name ??
		(variante.bandwidth ? `${Math.round(variante.bandwidth / 1000)}kbps` : "variante");
	return {
		label,
		url: variante.url,
		...(variante.width && variante.height
			? { resolution: `${variante.width}x${variante.height}` }
			: {}),
		...(variante.bandwidth ? { bandePassante: variante.bandwidth } : {}),
	};
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const UA_DEFAUT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Transport par défaut, adossé à bxc.
 *
 * Les GET passent par une page bxc (`profile` au choix, `static` = zéro spawn).
 * Les POST — uniquement la recherche `fetch.php` — passent par `fetch` global,
 * car `page.goto()` ne sait pas envoyer de corps.
 */
export function creerTransportBxc(opts: {
	profile: ProfilAnimesama;
	timeoutMs: number;
}): TransportHttp & { fermer: () => Promise<void> } {
	let page: AnyPage | null = null;

	const transport = async (requete: RequeteHttp): Promise<ReponseHttp> => {
		if ((requete.methode ?? "GET") === "POST") {
			const reponse = await fetch(requete.url, {
				method: "POST",
				headers: {
					"User-Agent": UA_DEFAUT,
					"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
					"X-Requested-With": "XMLHttpRequest",
					...(requete.referer ? { Referer: requete.referer } : {}),
					...requete.enTetes,
				},
				body: requete.corps ?? "",
				signal: AbortSignal.timeout(requete.timeoutMs ?? opts.timeoutMs),
			});
			return {
				status: reponse.status,
				corps: await reponse.text(),
				url: reponse.url,
			};
		}
		if (!page) page = await Browser.newPage({ profile: opts.profile });
		const reponse = await page.goto(requete.url, {
			timeoutMs: requete.timeoutMs ?? opts.timeoutMs,
			referer: requete.referer,
		});
		return {
			status: reponse.status,
			corps: await page.content(),
			url: reponse.url,
		};
	};

	transport.fermer = async (): Promise<void> => {
		if (!page) return;
		try {
			await page.close();
		} catch {
			/* rien à faire */
		}
		page = null;
	};
	return transport;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

/** Client haut niveau pour anime-sama.to. */
export class AnimesamaScraper {
	readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private readonly transport: TransportHttp;
	private readonly fermerTransport: (() => Promise<void>) | null;

	constructor(opts: AnimesamaOptions = {}) {
		this.baseUrl = (opts.baseUrl ?? "https://anime-sama.to").replace(
			/\/+$/,
			"",
		);
		this.timeoutMs = opts.timeoutMs ?? 30_000;
		this.retries = opts.retries ?? 2;
		if (opts.transport) {
			this.transport = opts.transport;
			this.fermerTransport = null;
		} else {
			const bxc = creerTransportBxc({
				profile: opts.profile ?? "static",
				timeoutMs: this.timeoutMs,
			});
			this.transport = bxc;
			this.fermerTransport = bxc.fermer;
		}
	}

	/** Résout un slug ou une URL absolue vers l'URL de la fiche. */
	urlFiche(slugOuUrl: string): string {
		if (/^https?:\/\//i.test(slugOuUrl))
			return slugOuUrl.replace(/\/+$/, "") + "/";
		return `${this.baseUrl}/catalogue/${slugOuUrl.replace(/^\/+|\/+$/g, "")}/`;
	}

	/** URL du dossier d'une saison. */
	urlSaison(slug: string, saison: string, langue: LangueAnimesama): string {
		return `${this.baseUrl}/catalogue/${slug}/${saison}/${langue}/`;
	}

	/** Exécute une requête avec reprises sur échec transitoire. */
	private async requete(requete: RequeteHttp): Promise<ReponseHttp> {
		let derniere: unknown;
		for (let essai = 0; essai <= this.retries; essai++) {
			try {
				return await this.transport({
					timeoutMs: this.timeoutMs,
					referer: `${this.baseUrl}/`,
					...requete,
				});
			} catch (err) {
				derniere = err;
				if (essai < this.retries) await Bun.sleep(400 * (essai + 1));
			}
		}
		throw new Error(`requête ${requete.url} échouée : ${String(derniere)}`);
	}

	/**
	 * Recherche instantanée, via `POST /template-php/defaut/fetch.php`.
	 * C'est l'endpoint qu'utilise la barre de recherche du site.
	 */
	async rechercher(requete: string): Promise<ResultatRecherche[]> {
		const reponse = await this.requete({
			url: `${this.baseUrl}/template-php/defaut/fetch.php`,
			methode: "POST",
			corps: `query=${encodeURIComponent(requete)}`,
		});
		if (reponse.status !== 200)
			throw new Error(`rechercher(${requete}) : HTTP ${reponse.status}`);
		return parserResultatsRecherche(reponse.corps);
	}

	/**
	 * Parcourt le catalogue paginé (`/catalogue/?search=…&page=N`).
	 * Plus lent que {@link rechercher} mais renvoie les genres et permet la
	 * pagination sur de gros ensembles.
	 */
	async parcourirCatalogue(
		opts: { recherche?: string; pages?: number } = {},
	): Promise<ResultatRecherche[]> {
		const pages = opts.pages ?? 1;
		const vus = new Map<string, ResultatRecherche>();
		for (let p = 1; p <= pages; p++) {
			const params = new URLSearchParams();
			if (opts.recherche) params.set("search", opts.recherche);
			if (p > 1) params.set("page", String(p));
			const qs = params.toString();
			const reponse = await this.requete({
				url: `${this.baseUrl}/catalogue/${qs ? `?${qs}` : ""}`,
			});
			if (reponse.status !== 200) break;
			const lot = parserCartesCatalogue(reponse.corps);
			let ajoutes = 0;
			for (const r of lot)
				if (!vus.has(r.slug)) {
					vus.set(r.slug, r);
					ajoutes++;
				}
			if (ajoutes === 0) break;
		}
		return [...vus.values()];
	}

	/** Récupère et analyse la fiche d'une œuvre. */
	async getAnime(slugOuUrl: string): Promise<FicheAnime> {
		const url = this.urlFiche(slugOuUrl);
		const reponse = await this.requete({ url });
		if (reponse.status !== 200)
			throw new Error(`getAnime(${url}) : HTTP ${reponse.status}`);
		return parserFicheAnime(reponse.corps, url);
	}

	/** Récupère le `episodes.js` brut d'une saison (ou `null` si 404). */
	async getEpisodesJs(
		slug: string,
		saison: string,
		langue: LangueAnimesama,
	): Promise<string | null> {
		const url = `${this.urlSaison(slug, saison, langue)}episodes.js`;
		const reponse = await this.requete({
			url,
			referer: this.urlSaison(slug, saison, langue),
		});
		if (reponse.status !== 200) return null;
		return reponse.corps;
	}

	/** Récupère et analyse une saison complète (page + `episodes.js`). */
	async getSaison(
		slug: string,
		saison: string,
		langue: LangueAnimesama,
	): Promise<SaisonAnimesama> {
		const url = this.urlSaison(slug, saison, langue);
		const page = await this.requete({ url });
		if (page.status !== 200)
			throw new Error(`getSaison(${url}) : HTTP ${page.status}`);
		const js = await this.getEpisodesJs(slug, saison, langue);
		if (js === null)
			throw new Error(`getSaison(${url}) : episodes.js introuvable`);
		return parserSaison(page.corps, js, { slug, saison, langue, url });
	}

	/**
	 * Sonde les langues réellement publiées pour une saison.
	 *
	 * Le sélecteur de la page imprime tous les drapeaux ; seule la présence
	 * d'un `episodes.js` non vide fait foi, d'où le sondage.
	 */
	async listerLangues(
		slug: string,
		saison: string,
		langues: readonly LangueAnimesama[] = LANGUES_ANIMESAMA,
	): Promise<LangueAnimesama[]> {
		const out: LangueAnimesama[] = [];
		for (const langue of langues) {
			const js = await this.getEpisodesJs(slug, saison, langue);
			if (js && parserLecteurs(js).length > 0) out.push(langue);
		}
		return out;
	}

	/**
	 * Récupère la fiche puis toutes ses saisons animées.
	 * Les saisons illisibles (404, `episodes.js` vide) sont ignorées.
	 */
	async getAnimeComplet(
		slugOuUrl: string,
	): Promise<FicheAnime & { saisonsResolues: SaisonAnimesama[] }> {
		const fiche = await this.getAnime(slugOuUrl);
		const saisonsResolues: SaisonAnimesama[] = [];
		for (const ref of fiche.saisons) {
			if (!ref.langue) continue;
			try {
				saisonsResolues.push(
					await this.getSaison(fiche.slug, ref.saison, ref.langue),
				);
			} catch {
				/* saison indisponible : on continue */
			}
		}
		return { ...fiche, saisonsResolues };
	}

	/**
	 * Résout une URL d'embed vers un flux direct.
	 *
	 * Fiable pour les lecteurs JW Player (ansembed, embed4me, oneupload) et pour
	 * sibnet. YouTube et Dailymotion sont signalés comme non résolubles : ce
	 * sont des lecteurs propriétaires, pas des embeds de fichier.
	 */
	async resoudreLecteur(
		lecteur: LecteurEpisode | string,
		opts: { enumererQualites?: boolean } = {},
	): Promise<SourceResolue> {
		const embedUrl = normaliserUrlLecteur(
			typeof lecteur === "string" ? lecteur : lecteur.url,
		);
		const hebergeur =
			typeof lecteur === "string" ? hebergeurDepuisUrl(embedUrl) : lecteur.hebergeur;

		// Certains épisodes pointent directement sur un fichier hébergé par le
		// site : rien à résoudre, l'URL *est* le flux.
		const direct = classerMedia(embedUrl);
		if (direct !== "unknown") {
			return {
				hebergeur,
				embedUrl,
				type: direct,
				url: embedUrl,
				poster: null,
				enTetes: { Referer: `${this.baseUrl}/` },
				erreur: null,
			};
		}

		const media = await resolveEmbed(embedUrl, {
			transport: this.transportMedia(),
			referer: `${this.baseUrl}/`,
			enumerateVariants: opts.enumererQualites,
			timeoutMs: this.timeoutMs,
		});

		return {
			hebergeur: media.host === "unknown" ? hebergeur : media.host,
			embedUrl: media.embedUrl,
			type: media.kind,
			url: media.url,
			poster: media.poster,
			enTetes: media.headers,
			erreur: media.error ?? null,
			...(media.variants.length ? { qualites: media.variants.map(enQualite) } : {}),
		};
	}

	/**
	 * Adapte le transport du scraper à celui qu'attend le cœur média.
	 *
	 * Les deux disent la même chose dans deux langues : cette fonction est la
	 * frontière entre le vocabulaire français du paquet et celui du cœur.
	 */
	private transportMedia(): MediaTransport {
		return async (requete) => {
			const reponse = await this.requete({
				url: requete.url,
				methode: requete.method,
				enTetes: requete.headers,
				referer: requete.referer,
				corps: requete.body,
				timeoutMs: requete.timeoutMs,
			});
			return { status: reponse.status, body: reponse.corps, url: reponse.url };
		};
	}

	/** Récupère et analyse un master HLS pour en lister les variantes. */
	async enumererQualitesHls(
		urlMaster: string,
		referer: string,
	): Promise<QualiteMedia[]> {
		const variantes = await resolveVariants(urlMaster, {
			transport: this.transportMedia(),
			referer,
			timeoutMs: this.timeoutMs,
		});
		return variantes.map(enQualite);
	}

	/** Libère la page bxc sous-jacente (sans effet si le transport est injecté). */
	async close(): Promise<void> {
		if (this.fermerTransport) await this.fermerTransport();
	}
}

export default AnimesamaScraper;
