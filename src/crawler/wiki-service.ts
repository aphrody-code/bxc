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
 * Capacités composées du lecteur de wiki : dossier complet d'une page, miroir sur disque,
 * recherche locale dans ce qui a déjà été lu.
 *
 * Ces fonctions vivaient dans `src/cli/wiki.ts`, mêlées à l'analyse d'`argv` et aux codes de
 * sortie. Elles sont ici pour que la CLI et le serveur MCP les appellent toutes les deux :
 * l'outil MCP `bxc_wiki_page` et la commande `bxc wiki page` exécutent désormais la MÊME
 * fonction, et non deux copies qui divergent au premier correctif.
 *
 * `mediawiki.ts` reste la couche « parler à l'API » ; ce module est la couche « en faire
 * quelque chose ». Aucun des deux ne connaît `process.argv` ni `process.exit`.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BxcDB } from "../db/BxcDB.ts";
import { getEmbedding } from "../utils/vector.ts";
import {
	type ImageWiki,
	type OptionsMediaWiki,
	type PageMediaWiki,
	type TableauWiki,
	estMediaWiki,
	parserInfobox,
	parserTableaux,
	recupererViaMediaWiki,
	rechercher,
	resoudreImages,
	telechargerFichier,
	titreDepuisUrl,
} from "./mediawiki.ts";

export type DossierWiki = {
	url: string;
	titre: string;
	api: "api.php" | "rest.php";
	revid: number | null;
	sections: PageMediaWiki["sections"];
	infobox: Record<string, { brut: string; propre: string }>[];
	tableaux: TableauWiki[];
	images: ImageWiki[];
	categories: string[];
	liens_externes: string[];
	markdown?: string;
	wikitext?: string | null;
	mesures: Record<string, number>;
};

/** Une page introuvable n'est pas une exception : l'appelant décide de son code de sortie. */
export class ErreurWiki extends Error {
	constructor(
		message: string,
		readonly genre: "url" | "introuvable",
	) {
		super(message);
		this.name = "ErreurWiki";
	}
}

/** Résout l'URL en cible d'API, ou lève une `ErreurWiki` porteuse du message d'aide. */
export function cibleOuErreur(url: string): { base: string; titre: string; hote: string } {
	const cible = titreDepuisUrl(url);
	if (!cible) {
		throw new ErreurWiki(
			`${url} n'a pas la forme d'une page de wiki (/wiki/<Titre> ou ?title=<Titre>). ` +
				`Pour un wiki localise, inclure le prefixe de langue : /fr/wiki/<Titre>.`,
			"url",
		);
	}
	return cible;
}

/** Récupère la page ou lève : le message dit les trois causes réelles, pas « erreur ». */
export async function pageOuErreur(url: string, opts?: OptionsMediaWiki): Promise<PageMediaWiki> {
	const page = await recupererViaMediaWiki(url, opts);
	if (!page) {
		throw new ErreurWiki(
			`aucun contenu rendu par l'API pour ${url}. Causes possibles : page inexistante, ` +
				`api.php desactive, ou prefixe de langue manquant dans l'URL.`,
			"introuvable",
		);
	}
	return page;
}

/**
 * Les tableaux d'une page. `cheerio` n'est chargé qu'ici, et seulement quand on en a besoin :
 * `bxc wiki md` n'a aucune raison de payer son import.
 */
export async function tableauxDePage(page: PageMediaWiki): Promise<TableauWiki[]> {
	if (!page.html) return [];
	const cheerio = await import("cheerio");
	return parserTableaux(page.html, cheerio.load(page.html));
}

export type OptionsDossier = OptionsMediaWiki & {
	/** Résoudre les URL d'images en pleine résolution (un appel d'API par lot de 50). */
	avecImages?: boolean;
	/** Joindre `markdown` et `wikitext` au dossier. */
	avecContenu?: boolean;
};

/**
 * Dossier complet d'une page : structure, infobox, tableaux, images, mesures.
 *
 * C'est la forme unique servie par `bxc wiki page`, écrite par `mirror` dans `page.json` et
 * rendue par l'outil MCP. Les `mesures` ne sont pas décoratives : elles permettent à
 * l'appelant de constater qu'une page a rendu 0 tableau sans avoir à reparcourir le JSON.
 */
export async function construireDossier(url: string, opts: OptionsDossier = {}): Promise<DossierWiki> {
	return (await construireDossierEtPage(url, opts)).dossier;
}

/**
 * Dossier + page brute. Le miroir a besoin des deux (le Markdown et le HTML sont ecrits sur
 * disque) et ne doit pas payer deux fois le reseau pour les obtenir.
 */
export async function construireDossierEtPage(url: string, opts: OptionsDossier = {}): Promise<{ dossier: DossierWiki; page: PageMediaWiki }> {
	const cible = cibleOuErreur(url);
	const page = await pageOuErreur(url, opts);
	const tableaux = await tableauxDePage(page);
	const images = opts.avecImages === false ? [] : await resoudreImages(cible.base, page.images, cible.hote, opts);

	const dossier: DossierWiki = {
		url,
		titre: page.title,
		api: page.api,
		revid: page.revid,
		sections: page.sections,
		infobox: page.wikitext ? parserInfobox(page.wikitext) : [],
		tableaux,
		images,
		categories: page.categories,
		liens_externes: page.liens_externes,
		mesures: {
			sections: page.sections.length,
			tableaux: tableaux.length,
			lignes_de_tableau: tableaux.reduce((n, t) => n + t.lignes.length, 0),
			images: images.length,
			categories: page.categories.length,
			octets_html: page.html.length,
			octets_markdown: page.markdown.length,
			octets_wikitext: page.wikitext?.length ?? 0,
		},
	};
	if (opts.avecContenu) {
		dossier.markdown = page.markdown;
		dossier.wikitext = page.wikitext;
	}
	return { dossier, page };
}

/**
 * Nom de fichier sûr et UNIQUE pour une image du wiki.
 *
 * Deux fichiers dont les noms ne diffèrent que par un caractère écarté par l'assainissement
 * (`A B.png` et `A_B.png`) se ramenaient au même nom : le second écrasait le premier en
 * silence, et le compteur d'images annonçait quand même deux succès.
 */
export function nomDeFichierImage(titre: string, deja: Set<string>): string {
	// Retirer l'espace de noms, et LUI SEUL : `[^:]+:` ôterait aussi un vrai début de nom de
	// fichier contenant un deux-points.
	let nom = (titre.replace(/^(File|Fichier|Image|Datei|Archivo|Ficheiro|Immagine|Bestand|Fil|Plik):/i, "") || "sans-nom").replace(/[^\w.-]+/g, "_").slice(0, 120);
	// `.` et `-` survivent à l'assainissement : un fichier nommé `..` viserait le dossier parent.
	if (/^\.+$/.test(nom)) nom = "sans-nom";
	if (!deja.has(nom)) {
		deja.add(nom);
		return nom;
	}
	const point = nom.lastIndexOf(".");
	const tronc = point > 0 ? nom.slice(0, point) : nom;
	const ext = point > 0 ? nom.slice(point) : "";
	for (let i = 2; ; i++) {
		const essai = `${tronc}-${i}${ext}`;
		if (!deja.has(essai)) {
			deja.add(essai);
			return essai;
		}
	}
}

export type OptionsMiroir = OptionsDossier & {
	/** Téléchargements simultanés. Le CDN d'un wiki répond mal à 114 requêtes d'un coup. */
	concurrence?: number;
	/** Écrire la page dans la base locale (FTS5 + vecteur). */
	indexer?: boolean;
	/**
	 * Compresser `page.html` et `page.wikitext` en zstd.
	 *
	 * Mesuré le 2026-09-05 sur une page réelle de 521 843 o : zstd rend 51 656 o en 1,5 ms
	 * (x10,1), gzip 54 306 o en 3,4 ms (x9,6). Zstd est donc à la fois plus compact et
	 * 2,3 fois plus rapide — sur un corpus de plusieurs milliers de pages, c'est la
	 * différence entre archiver le HTML et renoncer à le garder.
	 */
	compresser?: boolean;
};

export type MesuresMiroir = {
	dossier: string;
	images_telechargees: number;
	images_en_echec: number;
	images_corrompues: number;
	octets_images: number;
	tableaux: number;
	sections: number;
	indexee: boolean;
};

/** Écrit une page et toutes ses images dans un dossier, et l'indexe dans la base locale. */
export async function miroirWiki(url: string, sortie: string, opts: OptionsMiroir = {}): Promise<{ dossier: DossierWiki; mesures: MesuresMiroir }> {
	const { dossier, page } = await construireDossierEtPage(url, opts);
	const racine = resolve(sortie);
	await mkdir(join(racine, "images"), { recursive: true });

	const concurrence = Math.max(1, opts.concurrence ?? 8);
	const noms = new Set<string>();
	let ok = 0;
	let echecs = 0;
	let corrompues = 0;
	let octets = 0;

	for (let i = 0; i < dossier.images.length; i += concurrence) {
		await Promise.all(
			dossier.images.slice(i, i + concurrence).map(async (img) => {
				const nom = nomDeFichierImage(img.fichier, noms);
				const chemin = join(racine, "images", nom);
				const r = await telechargerFichier(img.url, opts);
				if (!r) {
					echecs++;
					return;
				}
				// `Bun.write(chemin, Response)` écrit le flux directement sur le disque : pas
				// de Buffer intermédiaire, donc une image de 10 Mo ne coûte pas 10 Mo de RAM.
				const n = await Bun.write(chemin, r);
				octets += n;
				// Un CDN qui rend 200 avec une page d'erreur HTML produit un `.png` illisible
				// que rien ne signale. Le wiki publie le SHA-1 du fichier : le vérifier
				// transforme une corruption silencieuse en une mesure. La relecture depuis le
				// cache disque coûte quelques millisecondes contre une requête réseau.
				if (img.sha1) {
					const octetsFichier = await Bun.file(chemin).bytes();
					const somme = new Bun.CryptoHasher("sha1").update(octetsFichier).digest("hex");
					if (somme !== img.sha1) {
						corrompues++;
						return;
					}
				}
				ok++;
			}),
		);
	}

	await Bun.write(join(racine, "page.json"), JSON.stringify({ ...dossier, mesures: { ...dossier.mesures, images_telechargees: ok, images_en_echec: echecs, images_corrompues: corrompues, octets_images: octets } }, null, 2));
	await Bun.write(join(racine, "page.md"), page.markdown);
	if (opts.compresser) {
		if (page.html) await Bun.write(join(racine, "page.html.zst"), Bun.zstdCompressSync(new TextEncoder().encode(page.html)));
		if (page.wikitext) await Bun.write(join(racine, "page.wikitext.zst"), Bun.zstdCompressSync(new TextEncoder().encode(page.wikitext)));
	} else if (page.wikitext) {
		await Bun.write(join(racine, "page.wikitext"), page.wikitext);
	}

	let indexee = false;
	if (opts.indexer !== false) {
		// Indexer dans la base de bxc : la page devient cherchable hors ligne par FTS5
		// (`bxc wiki find`), et son vecteur rejoint le corpus RAG existant.
		let db: BxcDB | null = null;
		try {
			db = new BxcDB();
			const vecteur = await getEmbedding(page.markdown).catch(() => undefined);
			db.saveScrape(url, `mediawiki:${page.api}`, 200, page.html, { title: page.title, revid: page.revid }, page.markdown, dossier, null, vecteur);
			indexee = true;
		} catch (err) {
			throw new Error(`indexation locale impossible : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
		} finally {
			// `close()` dans un `finally` : sans lui, une erreur d'embedding laissait le
			// handle SQLite ouvert pour toute la durée du processus.
			db?.close();
		}
	}

	return {
		dossier,
		mesures: {
			dossier: racine,
			images_telechargees: ok,
			images_en_echec: echecs,
			images_corrompues: corrompues,
			octets_images: octets,
			tableaux: dossier.tableaux.length,
			sections: dossier.sections.length,
			indexee,
		},
	};
}

export type ResultatLocal = { url: string; titre: string | null; octets: number; lu_le: string };

/**
 * Recherche plein texte dans les pages de wiki déjà lues (FTS5 local, aucun réseau).
 *
 * `saveScrape` insère sans dédupliquer : une page relue N fois apparaît N fois. On ne garde
 * que la lecture la plus récente de chaque URL.
 */
export function chercherLocalement(requete: string, limite = 20): ResultatLocal[] {
	const db = new BxcDB();
	try {
		const vues = new Set<string>();
		const out: ResultatLocal[] = [];
		for (const r of db.searchFullText(requete, 60) as Record<string, any>[]) {
			if (!String(r.profile ?? "").startsWith("mediawiki")) continue;
			const url = String(r.url);
			if (vues.has(url)) continue;
			vues.add(url);
			let titre: string | null = null;
			try {
				titre = r.metadata ? (JSON.parse(String(r.metadata)).title ?? null) : null;
			} catch {
				/* metadata illisible : le titre n'est pas la raison d'être du résultat */
			}
			out.push({ url, titre, octets: String(r.markdown ?? "").length, lu_le: String(r.timestamp) });
			if (out.length >= limite) break;
		}
		return out;
	} finally {
		db.close();
	}
}

/** Recherche plein texte SUR le wiki (API), à partir d'une URL quelconque de ce wiki. */
export async function rechercherSurLeWiki(url: string, requete: string, limite = 20, opts?: OptionsMediaWiki): Promise<{ titre: string; url: string; taille: number | null }[]> {
	const cible = cibleOuErreur(url);
	return await rechercher(cible.base, requete, cible.hote, limite, opts);
}

/** Ce domaine sert-il MediaWiki ? */
export async function verifierMediaWiki(url: string, opts?: OptionsMediaWiki): Promise<{ url: string; mediawiki: boolean }> {
	return { url, mediawiki: await estMediaWiki(url, opts) };
}
