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
 * Ce fichier ne fait plus QUE de la ligne de commande : analyse d'`argv`, ecriture, codes de
 * sortie. Toute la logique vit dans `src/crawler/wiki-service.ts`, que le serveur MCP appelle
 * telle quelle — les deux surfaces executent le meme code, pas deux copies.
 *
 * Le contenu recupere appartient a ses auteurs (les wikis Fandom sont sous CC BY-SA) :
 * l'outil extrait, l'appelant reste responsable de l'usage et de l'attribution. Le `revid`
 * joint a chaque dossier est ce qui rend cette attribution verifiable.
 */

import type { OptionsMediaWiki } from "../crawler/mediawiki.ts";
import { parserInfobox, resoudreImages } from "../crawler/mediawiki.ts";
import {
	ErreurWiki,
	chercherLocalement,
	cibleOuErreur,
	construireDossierEtPage,
	miroirWiki,
	pageOuErreur,
	rechercherSurLeWiki,
	tableauxDePage,
	verifierMediaWiki,
} from "../crawler/wiki-service.ts";
import { EXIT, type CommonOptions, logger, parseCommonArgs } from "./shared.ts";

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
  --limite <n>    nombre de resultats de 'search' et 'find' (defaut 20)
  --concurrence <n>  telechargements simultanes de 'mirror' (defaut 8)
  --compress      'mirror' archive page.html/page.wikitext en zstd (x10 mesure)
  --no-index      'mirror' n'ecrit pas dans la base locale
  --help, -h      cette aide

Options globales honorees : --proxy <url>, --insecure, --timeout <ms>, --quiet.

Exemples:
  bxc wiki page https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi
  bxc wiki images https://inazuma-eleven.fandom.com/fr/wiki/Byron_Love --out img.json
  bxc wiki search https://inazuma-eleven.fandom.com/wiki/Main_Page "Aphrodi"
  bxc wiki mirror https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi --out ./afuro
  bxc wiki find "Aphrodi"
`,
	);
}

/** Drapeaux qui consomment l'argument suivant. Le reste des `--xxx` est booleen. */
const DRAPEAUX_VALEUR = new Set(["--out", "--concurrence", "--limite"]);

/**
 * Separe `argv` en positionnels, valeurs et booleens.
 *
 * L'ancienne forme reconstruisait la requete par `argv.filter(a => !a.startsWith("--"))` :
 * la VALEUR d'un drapeau y survivait. `bxc wiki find "Aphrodi" --out r.json` cherchait donc
 * « Aphrodi r.json » et ne rendait rien, sans que rien ne l'explique.
 */
function separerArguments(argv: string[]): { positionnels: string[]; valeurs: Map<string, string>; bools: Set<string> } {
	const positionnels: string[] = [];
	const valeurs = new Map<string, string>();
	const bools = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (DRAPEAUX_VALEUR.has(a)) {
			const v = argv[++i];
			if (v !== undefined) valeurs.set(a, v);
		} else if (a.startsWith("-") && !/^-\d/.test(a)) {
			bools.add(a);
		} else {
			positionnels.push(a);
		}
	}
	return { positionnels, valeurs, bools };
}

function entier(v: string | undefined, defaut: number): number {
	const n = Number.parseInt(v ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : defaut;
}

/**
 * Ecrit sur le fichier demande, ou sur stdout.
 *
 * `Bun.stdout.write` rend une PROMESSE : sans `await`, une sortie volumineuse suivie d'un
 * `process.exit` est tronquee ou perdue (verifie — l'ordre des lignes s'inverse deja sur une
 * sortie minuscule). Et le compte d'octets vient de `Bun.write`, pas de `contenu.length` :
 * sur un titre accentue, la longueur en caracteres n'est pas la taille du fichier.
 */
async function ecrire(contenu: string, out: string | null): Promise<void> {
	if (out) {
		const n = await Bun.write(out, contenu);
		logger.log(`ecrit : ${out} (${n} o)`);
	} else {
		await Bun.stdout.write(`${contenu}\n`);
	}
}

const enJson = (v: unknown) => JSON.stringify(v, null, 2);

export async function main(argv: string[], base?: CommonOptions): Promise<void> {
	const { positionnels, valeurs, bools } = separerArguments(argv);
	const sous = positionnels[0];
	if (!sous || bools.has("--help") || bools.has("-h")) {
		printUsage();
		return;
	}
	const out = valeurs.get("--out") ?? null;

	// Les options globales de bxc etaient recues puis jetees : `--proxy` et `--insecure`
	// n'atteignaient pas le repli MediaWiki, qui est pourtant le seul chemin reseau de cette
	// commande. `proxy` et `tls` sont des options natives du `fetch` de Bun.
	const opts: OptionsMediaWiki = {
		...(base?.proxy ? { proxy: base.proxy } : {}),
		...(base?.insecure ? { insecure: true } : {}),
		...(base?.timeoutMs ? { timeoutMs: base.timeoutMs } : {}),
	};

	try {
		// `find` interroge la base locale : son argument est une requete, pas une URL.
		if (sous === "find") {
			const requete = positionnels.slice(1).join(" ");
			if (!requete) {
				logger.error("requete manquante");
				process.exit(EXIT.MISUSE);
			}
			const res = chercherLocalement(requete, entier(valeurs.get("--limite"), 20));
			await ecrire(enJson(res), out);
			if (!res.length) process.exit(EXIT.DATA_ERR);
			return;
		}

		if (sous === "check") {
			const url = positionnels[1];
			if (!url) {
				printUsage();
				process.exit(EXIT.MISUSE);
			}
			const r = await verifierMediaWiki(url, opts);
			await ecrire(enJson(r), out);
			if (!r.mediawiki) process.exit(EXIT.DATA_ERR);
			return;
		}

		const url = positionnels[1];
		if (!url) {
			printUsage();
			process.exit(EXIT.MISUSE);
		}

		if (sous === "search") {
			const requete = positionnels.slice(2).join(" ");
			if (!requete) {
				logger.error("requete de recherche manquante");
				process.exit(EXIT.MISUSE);
			}
			const res = await rechercherSurLeWiki(url, requete, entier(valeurs.get("--limite"), 20), opts);
			await ecrire(enJson(res), out);
			// Zero resultat n'est pas une erreur de l'outil, mais l'appelant doit pouvoir le
			// distinguer sans reparser la sortie.
			if (!res.length) process.exit(EXIT.DATA_ERR);
			return;
		}

		if (sous === "mirror") {
			if (!out) {
				logger.error("`mirror` exige --out <dossier>");
				process.exit(EXIT.MISUSE);
			}
			const { mesures } = await miroirWiki(url, out, {
				...opts,
				concurrence: entier(valeurs.get("--concurrence"), 8),
				indexer: !bools.has("--no-index"),
				compresser: bools.has("--compress"),
				avecContenu: true,
			});
			logger.log(
				`${mesures.dossier} — ${mesures.images_telechargees} images (${(mesures.octets_images / 1024).toFixed(0)} Kio)` +
					`${mesures.images_en_echec ? `, ${mesures.images_en_echec} en echec` : ""}` +
					`${mesures.images_corrompues ? `, ${mesures.images_corrompues} corrompues (sha1)` : ""}` +
					`, ${mesures.tableaux} tableaux, ${mesures.sections} sections`,
			);
			return;
		}

		// Les sous-commandes restantes n'ont besoin que d'une lecture de page.
		switch (sous) {
			case "md": {
				const page = await pageOuErreur(url, opts);
				await ecrire(page.markdown, out);
				return;
			}
			case "tables": {
				const page = await pageOuErreur(url, opts);
				await ecrire(enJson(await tableauxDePage(page)), out);
				return;
			}
			case "images": {
				const cible = cibleOuErreur(url);
				const page = await pageOuErreur(url, opts);
				await ecrire(enJson(await resoudreImages(cible.base, page.images, cible.hote, opts)), out);
				return;
			}
			case "infobox": {
				const page = await pageOuErreur(url, opts);
				const box = page.wikitext ? parserInfobox(page.wikitext) : [];
				await ecrire(enJson(box), out);
				if (!box.length) {
					logger.warn("aucune infobox trouvee dans le wikitext de cette page");
					process.exit(EXIT.DATA_ERR);
				}
				return;
			}
			case "page": {
				const { dossier } = await construireDossierEtPage(url, { ...opts, avecContenu: true });
				await ecrire(enJson(dossier), out);
				return;
			}
			default:
				logger.error(`sous-commande inconnue : ${sous}`);
				printUsage();
				process.exit(EXIT.MISUSE);
		}
	} catch (err) {
		if (err instanceof ErreurWiki) {
			logger.error(err.message);
			process.exit(err.genre === "url" ? EXIT.MISUSE : EXIT.DATA_ERR);
		}
		throw err;
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
