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
 * Tests du lecteur MediaWiki (`src/crawler/mediawiki.ts`).
 *
 * AUCUN reseau : chaque cas porte sa fixture en dur. Les fixtures ne sont pas inventees —
 * elles reproduisent les formes exactes qui ont casse le module le 2026-09-05 (tableau
 * imbrique, `<br>` dans une cellule, wikitexte non referme, prefixe de langue regional).
 * Un test qui exigerait le reseau ne tournerait pas sous `SKIP_NETWORK_TESTS=1`, donc ne
 * protegerait rien.
 */

import { describe, expect, it } from "bun:test";
import * as cheerio from "cheerio";
import {
	INTERVALLE_MIN_MS,
	nettoyerWikitexte,
	parserInfobox,
	parserTableaux,
	reinitialiserDebit,
	reserverCreneau,
	titreDepuisUrl,
} from "../../src/crawler/mediawiki.ts";
import { nomDeFichierImage } from "../../src/crawler/wiki-service.ts";

const tableaux = (html: string) => parserTableaux(html, cheerio.load(html));

// ---------------------------------------------------------------------------
// titreDepuisUrl
// ---------------------------------------------------------------------------

describe("mediawiki: titreDepuisUrl", () => {
	it("lit une page /wiki/<Titre> ordinaire", () => {
		expect(titreDepuisUrl("https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi")).toEqual({
			base: "https://inazuma-eleven.fandom.com",
			titre: "Afuro Terumi",
			hote: "inazuma-eleven.fandom.com",
		});
	});

	it("garde le prefixe de langue DANS la base de l'API", () => {
		// C'est la base qui porte le prefixe : /fr/api.php, pas /api.php. La perdre revient a
		// interroger le wiki anglais et a rendre les mauvaises images.
		expect(titreDepuisUrl("https://inazuma-eleven.fandom.com/fr/wiki/Byron_Love")).toEqual({
			base: "https://inazuma-eleven.fandom.com/fr",
			titre: "Byron Love",
			hote: "inazuma-eleven.fandom.com",
		});
	});

	it("accepte un prefixe de langue REGIONAL (pt-br, zh-tw, es-419)", () => {
		// `[a-z]{2,3}` seul ne les reconnaissait pas : `pt-br` etait pris pour un titre et la
		// requete partait sur le wiki anglais.
		expect(titreDepuisUrl("https://x.fandom.com/pt-br/wiki/Titulo")?.base).toBe("https://x.fandom.com/pt-br");
		expect(titreDepuisUrl("https://x.fandom.com/zh-tw/wiki/Titre")?.base).toBe("https://x.fandom.com/zh-tw");
		expect(titreDepuisUrl("https://x.fandom.com/es-419/wiki/Titulo")?.base).toBe("https://x.fandom.com/es-419");
	});

	it("lit ?title= et deduit la base du REPERTOIRE du script", () => {
		// L'installation MediaWiki la plus courante hors Fandom sert /w/index.php : son API
		// est /w/api.php. Prendre l'origine seule visait /api.php, qui n'existe pas.
		expect(titreDepuisUrl("https://www.exemple.org/w/index.php?title=Page_de_test")).toEqual({
			base: "https://www.exemple.org/w",
			titre: "Page de test",
			hote: "www.exemple.org",
		});
	});

	it("rend null sur une URL qui n'est pas une page de wiki", () => {
		expect(titreDepuisUrl("https://exemple.org/blog/article")).toBeNull();
		expect(titreDepuisUrl("https://exemple.org/")).toBeNull();
		expect(titreDepuisUrl("pas une url")).toBeNull();
		expect(titreDepuisUrl("")).toBeNull();
		// Un schema non HTTP n'a rien a faire ici, meme s'il contient /wiki/.
		expect(titreDepuisUrl("file:///tmp/wiki/Titre")).toBeNull();
	});

	it("ne LEVE pas sur un % litteral dans le titre", () => {
		// `decodeURIComponent("100%_Orange")` jette une URIError : elle traversait la fonction
		// au lieu du null (ou du titre) que les appelants attendent.
		expect(() => titreDepuisUrl("https://x.fandom.com/wiki/100%_Orange")).not.toThrow();
		expect(titreDepuisUrl("https://x.fandom.com/wiki/100%_Orange")?.titre).toBe("100% Orange");
	});

	it("decode le pourcentage-encodage valide", () => {
		expect(titreDepuisUrl("https://fr.wikipedia.org/wiki/%C3%89lectricit%C3%A9")?.titre).toBe("Électricité");
	});

	it("conserve le port dans l'hote (cle du limiteur de debit)", () => {
		expect(titreDepuisUrl("https://wiki.interne:8443/wiki/Accueil")?.hote).toBe("wiki.interne:8443");
	});
});

// ---------------------------------------------------------------------------
// nettoyerWikitexte
// ---------------------------------------------------------------------------

describe("mediawiki: nettoyerWikitexte", () => {
	it("rend le libelle d'un lien pipe, pas sa cible", () => {
		expect(nettoyerWikitexte("[[Afuro Terumi|Aphrodi]] et [[Zeus]]")).toBe("Aphrodi et Zeus");
	});

	it("rend la LEGENDE d'un lien de fichier, pas ses options de mise en page", () => {
		// L'ancienne forme ne coupait qu'au premier `|` et rendait « thumb|200px|Le dieu ».
		expect(nettoyerWikitexte("[[File:aphrodi.png|thumb|200px|Le dieu]]")).toBe("Le dieu");
	});

	it("supprime les modeles imbriques jusqu'au bout", () => {
		// Une passe unique laissait « {{a|}} » derriere elle, c'est-a-dire du balisage dans
		// une valeur annoncee comme propre.
		expect(nettoyerWikitexte("Avant {{a|{{b|c}}}} apres")).toBe("Avant apres");
	});

	it("supprime le CONTENU d'une note, pas seulement ses balises", () => {
		expect(nettoyerWikitexte("Valeur<ref name=x>Source a ne pas garder</ref>")).toBe("Valeur");
		expect(nettoyerWikitexte("Valeur<ref name=x />")).toBe("Valeur");
	});

	it("separe les fragments d'un <br> au lieu de les coller", () => {
		expect(nettoyerWikitexte("Zeus<br>Japon")).toBe("Zeus · Japon");
		expect(nettoyerWikitexte("Zeus<br />Japon")).toBe("Zeus · Japon");
	});

	it("garde le libelle d'un lien externe, ou son URL a defaut", () => {
		expect(nettoyerWikitexte("[https://exemple.org Le site]")).toBe("Le site");
		expect(nettoyerWikitexte("[https://exemple.org]")).toBe("https://exemple.org");
	});

	it("decode les entites HTML courantes", () => {
		expect(nettoyerWikitexte("Zeus&nbsp;II &amp; Aphrodi &#8211; fin")).toBe("Zeus II & Aphrodi – fin");
	});

	it("retire commentaires, gras et italiques", () => {
		expect(nettoyerWikitexte("<!-- interne -->'''Gras''' et ''italique''")).toBe("Gras et italique");
	});

	it("rend une chaine vide sur une valeur entierement decorative", () => {
		expect(nettoyerWikitexte("   {{vide}}   ")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// parserInfobox
// ---------------------------------------------------------------------------

describe("mediawiki: parserInfobox", () => {
	const infobox = `Du texte avant.
{{Infobox character
|name       = Afuro Terumi
|name_jp    = アフロディ
|team       = [[Zeus (equipe)|Zeus]]
|element    = {{Element|Wind}}
|position   = FW
|debut      = Episode {{n|22}} et [[Saison 1]]
}}
Du texte apres.`;

	it("lit les vrais noms de champs du wikitext", () => {
		const boites = parserInfobox(infobox);
		expect(boites).toHaveLength(1);
		expect(Object.keys(boites[0]!).sort()).toEqual(["debut", "element", "name", "name_jp", "position", "team"]);
	});

	it("rend a la fois la valeur brute et la valeur nettoyee", () => {
		const b = parserInfobox(infobox)[0]!;
		expect(b.team).toEqual({ brut: "[[Zeus (equipe)|Zeus]]", propre: "Zeus" });
		expect(b.name_jp!.propre).toBe("アフロディ");
	});

	it("ne coupe PAS sur un | interne a un modele ou a un lien", () => {
		// `{{Element|Wind}}` contient un `|` : le prendre pour un separateur de champ aurait
		// invente un champ « Wind}} » et tronque `element`.
		const b = parserInfobox(infobox)[0]!;
		expect(b.element!.brut).toBe("{{Element|Wind}}");
		expect(b).not.toHaveProperty("Wind}}");
		expect(b.debut!.brut).toBe("Episode {{n|22}} et [[Saison 1]]");
	});

	it("traverse les modeles imbriques sur plusieurs niveaux", () => {
		const b = parserInfobox("{{Infobox\n|a = {{x|{{y|1|2}}|3}}\n|b = fin\n}}")[0]!;
		expect(b.a!.brut).toBe("{{x|{{y|1|2}}|3}}");
		expect(b.b!.brut).toBe("fin");
	});

	it("rend TOUTES les boites d'une page, pas seulement la premiere", () => {
		expect(parserInfobox("{{Infobox A\n|x = 1\n}}\ntexte\n{{Infobox B\n|y = 2\n}}")).toHaveLength(2);
	});

	it("ignore un parametre positionnel qui n'a pas la forme nom = valeur", () => {
		const b = parserInfobox("{{Infobox\n|[[a|b=c]]\n|vrai = oui\n}}")[0]!;
		expect(Object.keys(b)).toEqual(["vrai"]);
	});

	it("ne boucle PAS indefiniment sur un modele jamais referme", () => {
		// Mesure du 2026-09-05 : sur cette entree exacte, l'ancienne version ne rendait jamais
		// la main (processus tue a 10 s), parce que `re.lastIndex` etait repose sur la
		// position deja examinee. Une page tronquee suffisait a figer la CLI.
		const debut = Bun.nanoseconds();
		expect(parserInfobox("{{Infobox character\n|name = Aphrodi\n|team = [[Zeus]]\n")).toEqual([]);
		expect((Bun.nanoseconds() - debut) / 1e6).toBeLessThan(500);
	});

	it("rend un tableau vide quand il n'y a pas d'infobox", () => {
		expect(parserInfobox("Une page sans la moindre boite.")).toEqual([]);
		expect(parserInfobox("")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// parserTableaux
// ---------------------------------------------------------------------------

describe("mediawiki: parserTableaux", () => {
	it("developpe un colspan sur la largeur qu'il couvre", () => {
		const t = tableaux(`<table>
			<tr><th>A</th><th>B</th><th>C</th></tr>
			<tr><td colspan="2">fusion</td><td>c</td></tr>
		</table>`)[0]!;
		expect(t.entetes).toEqual(["A", "B", "C"]);
		expect(t.lignes).toEqual([["fusion", "fusion", "c"]]);
	});

	it("developpe un rowspan sur les lignes suivantes, a la BONNE colonne", () => {
		const t = tableaux(`<table>
			<tr><th>Equipe</th><th>Joueur</th></tr>
			<tr><td rowspan="2">Zeus</td><td>Aphrodi</td></tr>
			<tr><td>Kageyama</td></tr>
		</table>`)[0]!;
		expect(t.lignes).toEqual([
			["Zeus", "Aphrodi"],
			["Zeus", "Kageyama"],
		]);
	});

	it("developpe rowspan ET colspan combines", () => {
		const t = tableaux(`<table>
			<tr><th>A</th><th>B</th><th>C</th></tr>
			<tr><td rowspan="2" colspan="2">bloc</td><td>c1</td></tr>
			<tr><td>c2</td></tr>
		</table>`)[0]!;
		expect(t.lignes).toEqual([
			["bloc", "bloc", "c1"],
			["bloc", "bloc", "c2"],
		]);
	});

	it("garde la premiere ligne en DONNEES quand ce n'est pas un en-tete", () => {
		const t = tableaux(`<table>
			<tr><td>a1</td><td>a2</td></tr>
			<tr><td>b1</td><td>b2</td></tr>
		</table>`)[0]!;
		expect(t.entetes).toEqual([]);
		expect(t.lignes).toEqual([
			["a1", "a2"],
			["b1", "b2"],
		]);
	});

	it("ne prend pas pour en-tete une premiere ligne qui melange th et td", () => {
		// Un `<th>` de libelle en debut de ligne de donnees est frequent sur les wikis : le
		// traiter comme un en-tete supprimait une ligne de donnees.
		const t = tableaux(`<table>
			<tr><th>Nom</th><td>Aphrodi</td></tr>
			<tr><th>Equipe</th><td>Zeus</td></tr>
		</table>`)[0]!;
		expect(t.entetes).toEqual([]);
		expect(t.lignes).toHaveLength(2);
	});

	it("n'absorbe PAS les lignes d'un tableau imbrique", () => {
		// Mesure du 2026-09-05 : `find("tr")` descend dans les descendants, donc le tableau
		// exterieur recuperait les lignes de l'interieur. Sur ce cas exact, l'ancienne version
		// rendait 3 lignes dont deux doublons, avec des cellules collees (« internex »).
		const html = `<table>
			<tr><th>Nom</th><th>Equipe</th></tr>
			<tr><td>Aphrodi</td><td>Zeus</td></tr>
			<tr><td colspan="2"><table><tr><th>interne</th></tr><tr><td>x</td></tr></table></td></tr>
		</table>`;
		const t = tableaux(html);
		expect(t).toHaveLength(2);
		expect(t[0]!.entetes).toEqual(["Nom", "Equipe"]);
		expect(t[0]!.lignes).toEqual([
			["Aphrodi", "Zeus"],
			["interne x", "interne x"],
		]);
		expect(t[1]!.entetes).toEqual(["interne"]);
		expect(t[1]!.lignes).toEqual([["x"]]);
	});

	it("separe les fragments d'un <br> dans une cellule", () => {
		// `.text()` seul rendait « ZeusJapon » : deux valeurs fondues en un mot inexistant.
		const t = tableaux("<table><tr><td>Zeus<br>Japon</td></tr></table>")[0]!;
		expect(t.lignes).toEqual([["Zeus · Japon"]]);
	});

	it("retire les appels de note des cellules", () => {
		const t = tableaux('<table><tr><td>120<sup class="reference">[1]</sup></td></tr></table>')[0]!;
		expect(t.lignes).toEqual([["120"]]);
	});

	it("prend la <caption> comme titre en priorite", () => {
		const t = tableaux("<h2>Section</h2><table><caption>Statistiques</caption><tr><td>x</td></tr></table>")[0]!;
		expect(t.titre).toBe("Statistiques");
	});

	it("remonte les ancetres pour trouver l'intertitre precedent", () => {
		// `prevAll` ne regarde que les freres : un tableau enveloppe dans un <div> — la forme
		// que sert MediaWiki — n'avait aucun titre.
		const t = tableaux('<h3>Techniques</h3><div class="table-responsive"><table><tr><td>x</td></tr></table></div>')[0]!;
		expect(t.titre).toBe("Techniques");
	});

	it("ignore le lien [modifier] d'un titre de section MediaWiki", () => {
		const html = '<div class="mw-heading"><h2>Palmares</h2><span class="mw-editsection">[modifier]</span></div><table><tr><td>x</td></tr></table>';
		expect(tableaux(html)[0]!.titre).toBe("Palmares");
	});

	it("rend un tableau vide quand la page n'en contient aucun", () => {
		expect(tableaux("<p>Rien a voir.</p>")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Limiteur de debit
// ---------------------------------------------------------------------------

describe("mediawiki: reserverCreneau", () => {
	it("laisse passer la premiere requete sans attendre", () => {
		reinitialiserDebit("exemple.test");
		expect(reserverCreneau("exemple.test", 6000, 1_000_000)).toBe(0);
	});

	it("SERIALISE des reservations simultanees au lieu de les grouper", () => {
		// C'etait le defaut de fond : l'ancienne version lisait la date du dernier appel,
		// dormait, PUIS l'ecrivait. Trois appels concurrents lisaient donc la meme date,
		// dormaient le meme temps et repartaient ensemble — le limiteur ne limitait rien.
		reinitialiserDebit("groupe.test");
		const t = 5_000_000;
		expect([reserverCreneau("groupe.test", 6000, t), reserverCreneau("groupe.test", 6000, t), reserverCreneau("groupe.test", 6000, t)]).toEqual([0, 6000, 12000]);
	});

	it("ne fait pas attendre quand l'intervalle est deja ecoule", () => {
		reinitialiserDebit("ecoule.test");
		reserverCreneau("ecoule.test", 6000, 1_000_000);
		expect(reserverCreneau("ecoule.test", 6000, 1_000_000 + 60_000)).toBe(0);
	});

	it("tient un compteur INDEPENDANT par hote", () => {
		reinitialiserDebit();
		reserverCreneau("a.test", 6000, 2_000_000);
		expect(reserverCreneau("b.test", 6000, 2_000_000)).toBe(0);
	});

	it("expose un intervalle par defaut compatible avec l'etiquette de Fandom", () => {
		expect(INTERVALLE_MIN_MS).toBeGreaterThanOrEqual(6000);
	});
});

// ---------------------------------------------------------------------------
// Nommage des fichiers du miroir
// ---------------------------------------------------------------------------

describe("wiki-service: nomDeFichierImage", () => {
	it("retire l'espace de noms et assainit le nom", () => {
		const vus = new Set<string>();
		expect(nomDeFichierImage("File:Afuro Terumi (GO).png", vus)).toBe("Afuro_Terumi_GO_.png");
		expect(nomDeFichierImage("Fichier:Byron.png", new Set())).toBe("Byron.png");
	});

	it("ne laisse pas deux fichiers se recouvrir apres assainissement", () => {
		// « A B.png » et « A_B.png » se ramenaient au meme nom : le second ecrasait le premier
		// en silence, et le compteur annoncait quand meme deux succes.
		const vus = new Set<string>();
		expect(nomDeFichierImage("File:A B.png", vus)).toBe("A_B.png");
		expect(nomDeFichierImage("File:A_B.png", vus)).toBe("A_B-2.png");
		expect(nomDeFichierImage("File:A/B.png", vus)).toBe("A_B-3.png");
		// Le tiret, lui, survit a l'assainissement : ce n'est PAS une collision.
		expect(nomDeFichierImage("File:A-B.png", vus)).toBe("A-B.png");
	});

	it("refuse un nom qui viserait le dossier parent", () => {
		expect(nomDeFichierImage("File:..", new Set())).toBe("sans-nom");
		expect(nomDeFichierImage("File:../../etc/passwd", new Set())).not.toContain("/");
	});

	it("ne coupe pas un nom de fichier contenant un deux-points", () => {
		expect(nomDeFichierImage("Inazuma : le film.png", new Set())).toBe("Inazuma_le_film.png");
	});
});
