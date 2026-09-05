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
 * `bxc wiki` — lire un wiki MediaWiki par son API plutot que par son HTML.
 *
 * Raison d'etre : sur Fandom, la page rend 403 quel que soit le User-Agent, tandis que
 * `/api.php` rend 200. Mais l'interet depasse le contournement — l'API publie ce que le HTML
 * a deja perdu : les noms de champs de l'infobox, le wikitext, les URL d'images en pleine
 * resolution, la liste des sections, les categories. Un scrape rend une page ; l'API rend une
 * base de donnees.
 *
 * Le contenu recupere appartient a ses auteurs (les wikis Fandom sont sous CC BY-SA) :
 * l'outil extrait, l'appelant reste responsable de l'usage et de l'attribution.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BxcDB } from "../db/BxcDB.ts";
import { getEmbedding } from "../utils/vector.ts";
import { EXIT, type CommonOptions, logger, parseCommonArgs } from "./shared.ts";
import {
	estMediaWiki,
	parserInfobox,
	parserTableaux,
	recupererViaMediaWiki,
	rechercher,
	resoudreImages,
	titreDepuisUrl,
} from "../crawler/mediawiki.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc wiki — lire un wiki MediaWiki par son API (Fandom, Wikipedia, Miraheze, wiki.gg…)

Usage:
  bxc wiki page   <url>            tout : sections, infobox, tableaux, images, wikitext
  bxc wiki md     <url>            le contenu en Markdown, sans menu ni banniere
  bxc wiki tables <url>            les tableaux de donnees, rowspan/colspan developpes
  bxc wiki images <url>            les images en PLEINE resolution (pas les vignettes)
  bxc wiki infobox <url>           les champs de l'infobox, avec leurs vrais noms
  bxc wiki search <url> <requete>  recherche plein texte SUR le wiki (API)
  bxc wiki mirror <url> --out <dir>  page + toutes ses images, indexee localement
  bxc wiki find   <requete>        recherche plein texte DANS ce qui a ete lu (FTS5 local)
  bxc wiki check  <url>            ce domaine sert-il MediaWiki ?

Options:
  --json          sortie JSON (defaut pour page/tables/images/infobox/search)
  --out <chemin>  fichier de sortie, ou dossier pour 'mirror'
  --concurrence <n>  telechargements simultanes de 'mirror' (defaut 8)
  --no-index      'mirror' n'ecrit pas dans la base locale
  --help, -h      cette aide

Exemples:
  bxc wiki page https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi
  bxc wiki images https://inazuma-eleven.fandom.com/fr/wiki/Byron_Love --out img.json
  bxc wiki search https://inazuma-eleven.fandom.com/wiki/Main_Page "Aphrodi"
  bxc wiki mirror https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi --out ./afuro
  bxc wiki find "Aphrodi"
`,
	);
}

async function ecrire(contenu: string, out: string | null): Promise<void> {
	if (out) {
		await Bun.write(out, contenu);
		logger.log(`ecrit : ${out} (${contenu.length} o)`);
	} else Bun.stdout.write(contenu + "\n");
}

export async function main(argv: string[], _base: CommonOptions): Promise<void> {
	const sous = argv[0];
	const url = argv[1];
	if (!sous || argv.includes("--help") || argv.includes("-h")) {
		printUsage();
		return;
	}
	if (!url) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}
	const iOut = argv.indexOf("--out");
	const out = iOut >= 0 && argv[iOut + 1] ? argv[iOut + 1]! : null;

	// `find` interroge la base locale : son deuxieme argument est une requete, pas une URL.
	if (sous === "find") {
		const requete = argv.slice(1).filter((a) => !a.startsWith("--")).join(" ");
		if (!requete) {
			logger.error("requete manquante");
			process.exit(EXIT.MISUSE);
		}
		const db = new BxcDB();
		// `saveScrape` insere sans dedupliquer : une page relue N fois apparait N fois.
		// On ne garde que la lecture la plus recente de chaque URL.
		const vues = new Set<string>();
		const res = db
			.searchFullText(requete, 60)
			.filter((r: any) => String(r.profile ?? "").startsWith("mediawiki"))
			.filter((r: any) => !vues.has(r.url) && (vues.add(r.url), true))
			.slice(0, 20)
			.map((r: any) => ({
				url: r.url,
				titre: r.metadata ? (JSON.parse(r.metadata).title ?? null) : null,
				octets: (r.markdown ?? "").length,
				lu_le: r.timestamp,
			}));
		db.close();
		await ecrire(JSON.stringify(res, null, 2), out);
		if (!res.length) process.exit(EXIT.DATA_ERR);
		return;
	}

	const cible = titreDepuisUrl(url);
	if (!cible && sous !== "check") {
		logger.error(
			`${url} n'a pas la forme d'une page de wiki (/wiki/<Titre> ou ?title=<Titre>). ` +
				`Pour un wiki localise, inclure le prefixe de langue : /fr/wiki/<Titre>.`,
		);
		process.exit(EXIT.MISUSE);
	}

	if (sous === "check") {
		const ok = await estMediaWiki(url);
		Bun.stdout.write(JSON.stringify({ url, mediawiki: ok }, null, 2) + "\n");
		if (!ok) process.exit(EXIT.DATA_ERR);
		return;
	}

	if (sous === "search") {
		const requete = argv.slice(2).filter((a) => !a.startsWith("--") && a !== out).join(" ");
		if (!requete) {
			logger.error("requete de recherche manquante");
			process.exit(EXIT.MISUSE);
		}
		const res = await rechercher(cible!.base, requete, cible!.hote);
		await ecrire(JSON.stringify(res, null, 2), out);
		// Zero resultat n'est pas une erreur de l'outil, mais l'appelant doit pouvoir le
		// distinguer sans reparser la sortie.
		if (!res.length) process.exit(EXIT.DATA_ERR);
		return;
	}

	const page = await recupererViaMediaWiki(url);
	if (!page) {
		logger.error(
			`aucun contenu rendu par l'API pour ${url}. Causes possibles : page inexistante, ` +
				`api.php desactive, ou prefixe de langue manquant dans l'URL.`,
		);
		process.exit(EXIT.DATA_ERR);
	}

	if (sous === "mirror") {
		if (!out) {
			logger.error("`mirror` exige --out <dossier>");
			process.exit(EXIT.MISUSE);
		}
		const iC = argv.indexOf("--concurrence");
		const concurrence = Math.max(1, Number.parseInt(iC >= 0 ? (argv[iC + 1] ?? "8") : "8", 10) || 8);
		await mkdir(join(out, "images"), { recursive: true });

		const images = await resoudreImages(cible!.base, page.images, cible!.hote);
		// Bun.write(chemin, Response) ecrit le flux directement sur le disque : pas de
		// Buffer intermediaire, donc une image de 10 Mo ne coute pas 10 Mo de RAM.
		// La concurrence est bornee : le CDN d'un wiki repond mal a 114 requetes d'un coup.
		let ok = 0;
		let echecs = 0;
		const octets: number[] = [];
		for (let i = 0; i < images.length; i += concurrence) {
			await Promise.all(
				images.slice(i, i + concurrence).map(async (img) => {
					const nom = (img.fichier.replace(/^(File|Fichier):/, "") || "sans-nom")
						.replace(/[^\w.\-]+/g, "_")
						.slice(0, 120);
					try {
						const r = await fetch(img.url, { headers: { "user-agent": "bxc/0.9 (wiki mirror)" } });
						if (!r.ok) {
							echecs++;
							return;
						}
						const n = await Bun.write(join(out, "images", nom), r);
						octets.push(n);
						ok++;
					} catch {
						echecs++;
					}
				}),
			);
		}

		const cheerioM = await import("cheerio");
		const tables = parserTableaux(page.html, cheerioM.load(page.html));
		const dossier = {
			url,
			titre: page.title,
			api: page.api,
			sections: page.sections,
			infobox: page.wikitext ? parserInfobox(page.wikitext) : [],
			tableaux: tables,
			images,
			categories: page.categories,
			liens_externes: page.liens_externes,
			mesures: { images_telechargees: ok, images_en_echec: echecs, octets_images: octets.reduce((a, b) => a + b, 0) },
		};
		await Bun.write(join(out, "page.json"), JSON.stringify(dossier, null, 2));
		await Bun.write(join(out, "page.md"), page.markdown);
		if (page.wikitext) await Bun.write(join(out, "page.wikitext"), page.wikitext);

		if (!argv.includes("--no-index")) {
			// Indexer dans la base de bxc : la page devient cherchable hors ligne par FTS5
			// (`bxc wiki find`), et son vecteur rejoint le corpus RAG existant.
			try {
				const db = new BxcDB();
				const vecteur = await getEmbedding(page.markdown).catch(() => undefined);
				db.saveScrape(url, `mediawiki:${page.api}`, 200, page.html, { title: page.title }, page.markdown, dossier, null, vecteur);
				db.close();
			} catch (err) {
				logger.warn(`indexation locale impossible : ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		logger.log(
			`${out} — ${ok} images (${(dossier.mesures.octets_images / 1024).toFixed(0)} Kio)` +
				`${echecs ? `, ${echecs} en echec` : ""}, ${tables.length} tableaux, ${page.sections.length} sections`,
		);
		return;
	}

	if (sous === "md") {
		await ecrire(page.markdown, out);
		return;
	}

	const cheerio = await import("cheerio");
	const $ = cheerio.load(page.html);

	switch (sous) {
		case "tables": {
			const t = parserTableaux(page.html, $);
			await ecrire(JSON.stringify(t, null, 2), out);
			return;
		}
		case "images": {
			const img = await resoudreImages(cible!.base, page.images, cible!.hote);
			await ecrire(JSON.stringify(img, null, 2), out);
			return;
		}
		case "infobox": {
			const box = page.wikitext ? parserInfobox(page.wikitext) : [];
			await ecrire(JSON.stringify(box, null, 2), out);
			if (!box.length) {
				logger.warn("aucune infobox trouvee dans le wikitext de cette page");
				process.exit(EXIT.DATA_ERR);
			}
			return;
		}
		case "page": {
			const [images, tables] = await Promise.all([
				resoudreImages(cible!.base, page.images, cible!.hote),
				Promise.resolve(parserTableaux(page.html, $)),
			]);
			const dossier = {
				url,
				titre: page.title,
				api: page.api,
				sections: page.sections,
				infobox: page.wikitext ? parserInfobox(page.wikitext) : [],
				tableaux: tables,
				images,
				categories: page.categories,
				liens_externes: page.liens_externes,
				markdown: page.markdown,
				wikitext: page.wikitext,
				mesures: {
					sections: page.sections.length,
					tableaux: tables.length,
					lignes_de_tableau: tables.reduce((n, t) => n + t.lignes.length, 0),
					images: images.length,
					categories: page.categories.length,
					octets_html: page.html.length,
					octets_markdown: page.markdown.length,
					octets_wikitext: page.wikitext?.length ?? 0,
				},
			};
			await ecrire(JSON.stringify(dossier, null, 2), out);
			return;
		}
		default:
			logger.error(`sous-commande inconnue : ${sous}`);
			printUsage();
			process.exit(EXIT.MISUSE);
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
