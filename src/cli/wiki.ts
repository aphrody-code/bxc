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
  bxc wiki search <url> <requete>  recherche plein texte sur le wiki
  bxc wiki check  <url>            ce domaine sert-il MediaWiki ?

Options:
  --json          sortie JSON (defaut pour page/tables/images/infobox/search)
  --out <fichier> ecrire dans un fichier plutot que sur stdout
  --help, -h      cette aide

Exemples:
  bxc wiki page https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi
  bxc wiki images https://inazuma-eleven.fandom.com/fr/wiki/Byron_Love --out img.json
  bxc wiki search https://inazuma-eleven.fandom.com/wiki/Main_Page "Aphrodi"
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
