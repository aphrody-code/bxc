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
 * Tests du scraper anime-sama — **aucun accès réseau**.
 *
 * Toutes les entrées sont des extraits réels capturés sur anime-sama.to le
 * 2026-09-03 (`test/fixtures/`), et le transport HTTP est injecté : les tests
 * du scraper servent des fixtures et vérifient les URLs demandées.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	AnimesamaScraper,
	LANGUES_ANIMESAMA,
	chercherMedia,
	classerMedia,
	composerEpisodes,
	estLangue,
	hebergeurDepuisUrl,
	normaliserUrlLecteur,
	numeroDepuisNom,
	parserCartesCatalogue,
	parserDrapeauxLangues,
	parserFicheAnime,
	parserLecteurs,
	parserNomsEpisodes,
	parserResultatsRecherche,
	parserSaison,
	parserSaisonsDeclarees,
	retirerCommentairesJs,
	texteBrut,
	type RequeteHttp,
	type ReponseHttp,
} from "./index.ts";

const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");

function fixture(nom: string): string {
	return require("node:fs").readFileSync(join(FIXTURES, nom), "utf8") as string;
}

const FICHE_INAZUMA = fixture("catalogue-inazuma-eleven.html");
const PAGE_SAISON1 = fixture("inazuma-saison1-vf-page.html");
const JS_SAISON1 = fixture("inazuma-saison1-vf-episodes.js");
const JS_ONE_PIECE = fixture("one-piece-saison1-vostfr-episodes.js");
const LISTE_FILMS = fixture("dragon-ball-super-film-vostfr-liste.html");
const RECHERCHE = fixture("recherche-fetch.html");
const CARTES = fixture("catalogue-recherche-cartes.html");
const EMBED_ANSEMBED = fixture("ansembed-embed.html");
const EMBED_SIBNET = fixture("sibnet-shell.html");

const URL_FICHE = "https://anime-sama.to/catalogue/inazuma-eleven/";
const URL_SAISON1 = "https://anime-sama.to/catalogue/inazuma-eleven/saison1/vf/";

// ---------------------------------------------------------------------------

describe("aides textuelles", () => {
	test("texteBrut retire les balises et décode les entités", () => {
		expect(texteBrut("<b>Inazuma&nbsp;&amp;   Co</b>")).toBe("Inazuma & Co");
	});

	test("retirerCommentairesJs supprime les blocs et les lignes commentées", () => {
		const src = "a(); /* resetListe(); */ b();\n\t// finirListe(9);\nc();";
		const net = retirerCommentairesJs(src);
		expect(net).not.toContain("resetListe");
		expect(net).not.toContain("finirListe");
		expect(net).toContain("c();");
	});

	test("retirerCommentairesJs ne coupe pas les URLs sur leur //", () => {
		// Le piège : `https://` et `//cdn…` ne sont pas des commentaires.
		const src = "var eps1 = ['https://www.youtube.com/embed/HoDiiJ-sWCk'];";
		expect(retirerCommentairesJs(src)).toBe(src);
	});

	test("estLangue reconnaît les dossiers du site", () => {
		expect(estLangue("vostfr")).toBe(true);
		expect(estLangue("vf2")).toBe(true);
		expect(estLangue("saison1")).toBe(false);
		expect(LANGUES_ANIMESAMA).toContain("vf");
	});

	test("normaliserUrlLecteur applique la réécriture vidmoly de videos.js", () => {
		expect(normaliserUrlLecteur("https://vidmoly.to/embed-x.html")).toBe(
			"https://vidmoly.biz/embed-x.html",
		);
		expect(normaliserUrlLecteur("https://vidmoly.net/embed-x.html")).toBe(
			"https://vidmoly.biz/embed-x.html",
		);
	});

	test("hebergeurDepuisUrl couvre les hébergeurs réellement rencontrés", () => {
		expect(hebergeurDepuisUrl("https://ansembed.net/embed-a.html")).toBe(
			"ansembed",
		);
		expect(
			hebergeurDepuisUrl("https://lpayer.embed4me.com/e/abc"),
		).toBe("embed4me");
		expect(
			hebergeurDepuisUrl("https://video.sibnet.ru/shell.php?videoid=1"),
		).toBe("sibnet");
		expect(hebergeurDepuisUrl("https://oneupload.to/embed-x.html")).toBe(
			"oneupload",
		);
		expect(hebergeurDepuisUrl("https://sendvid.com/embed/x")).toBe("sendvid");
		expect(hebergeurDepuisUrl("https://movearnpre.com/embed/x")).toBe(
			"movearnpre",
		);
		expect(hebergeurDepuisUrl("https://www.youtube.com/embed/HoDiiJ")).toBe(
			"youtube",
		);
		expect(
			hebergeurDepuisUrl("https://www.dailymotion.com/embed/video/x7xhdq6"),
		).toBe("dailymotion");
		expect(hebergeurDepuisUrl("https://s22.anime-sama.fr/f/x.mp4")).toBe(
			"anime-sama",
		);
		expect(hebergeurDepuisUrl("pas une url")).toBe("inconnu");
	});
});

// ---------------------------------------------------------------------------

describe("fiche d'une œuvre", () => {
	const fiche = parserFicheAnime(FICHE_INAZUMA, URL_FICHE);

	test("titre, slug et titres alternatifs", () => {
		expect(fiche.slug).toBe("inazuma-eleven");
		expect(fiche.titre).toBe("Inazuma Eleven");
		expect(fiche.titresAlternatifs).toContain("Lightning Eleven");
		expect(fiche.titresAlternatifs).toContain("Inazuma Eleven GO");
	});

	test("carte d'informations", () => {
		expect(fiche.etat).toBe("Terminé");
		expect(fiche.annee).toBe(2008);
		expect(fiche.nombreEpisodesAnnonce).toBe(268);
		expect(fiche.studios).toEqual(["LEVEL5", "TV Tokyo", "OLM"]);
	});

	test("synopsis, jaquette et genres", () => {
		expect(fiche.synopsis).toContain("Endou Mamoru");
		expect(fiche.image).toContain("inazuma-eleven.jpg");
		expect(fiche.genres).toContain("Football");
		expect(fiche.genres).toContain("Shônen");
	});

	test("les saisons viennent des appels panneauAnime, pas du HTML", () => {
		expect(fiche.saisons).toHaveLength(7);
		expect(fiche.saisons[0]).toEqual({
			nom: "Saison 1",
			chemin: "saison1/vf",
			saison: "saison1",
			langue: "vf",
			url: "https://anime-sama.to/catalogue/inazuma-eleven/saison1/vf/",
			categorie: "anime",
		});
		expect(fiche.saisons.map((s) => s.nom)).toContain("GO: Chrono Stones");
		expect(fiche.saisons.at(-1)?.saison).toBe("saison7");
		expect(fiche.scans).toHaveLength(0);
	});

	test("la définition JS de panneauAnime n'est pas prise pour une saison", () => {
		// La page déclare `function panneauAnime(nom, url){…}` juste avant les
		// appels : ses arguments ne sont pas des chaînes littérales.
		expect(fiche.saisons.every((s) => s.chemin !== "url")).toBe(true);
	});

	test("panneauScan alimente `scans` et pas `saisons`", () => {
		const html = `<script>
			panneauAnime("Saison 1", "saison1/vostfr");
			panneauScan("Scan", "scan/vf");
		</script>`;
		const { saisons, scans } = parserSaisonsDeclarees(
			html,
			"https://anime-sama.to/catalogue/x",
		);
		expect(saisons.map((s) => s.chemin)).toEqual(["saison1/vostfr"]);
		expect(scans.map((s) => s.chemin)).toEqual(["scan/vf"]);
		expect(scans[0].categorie).toBe("scan");
	});

	test("un chemin sans langue laisse `langue` à null", () => {
		const { saisons } = parserSaisonsDeclarees(
			'<script>panneauAnime("Film", "film");</script>',
			"https://anime-sama.to/catalogue/x/",
		);
		expect(saisons[0]).toMatchObject({
			saison: "film",
			langue: null,
			url: "https://anime-sama.to/catalogue/x/film/",
		});
	});
});

// ---------------------------------------------------------------------------

describe("episodes.js", () => {
	test("saison 1 VF d'Inazuma Eleven : deux lecteurs de 26 épisodes", () => {
		const lecteurs = parserLecteurs(JS_SAISON1);
		expect(lecteurs).toHaveLength(2);
		expect(lecteurs.map((l) => l.index)).toEqual([1, 2]);
		expect(lecteurs.map((l) => l.nom)).toEqual(["Lecteur 1", "Lecteur 2"]);
		expect(lecteurs[0].hebergeur).toBe("youtube");
		expect(lecteurs[1].hebergeur).toBe("ansembed");
		expect(lecteurs[0].urls).toHaveLength(26);
		expect(lecteurs[1].urls).toHaveLength(26);
		expect(lecteurs[0].urls[0]).toBe(
			"https://www.youtube.com/embed/HoDiiJ-sWCk",
		);
	});

	test("eps2 déclaré avant eps1, eps1 indenté et sur une seule ligne", () => {
		const lecteurs = parserLecteurs(JS_ONE_PIECE);
		// Le fichier réel déclare `var eps2` en premier ; on retrie par index.
		expect(lecteurs.map((l) => l.index)).toEqual([1, 2]);
		expect(lecteurs[0].hebergeur).toBe("sibnet");
		expect(lecteurs[1].hebergeur).toBe("ansembed");
		expect(lecteurs[0].urls[0]).toBe(
			"https://video.sibnet.ru/shell.php?videoid=4826196",
		);
	});

	test("la virgule traînante ne crée pas d'épisode vide", () => {
		const lecteurs = parserLecteurs("var eps1 = [\n'https://a/1',\n\t\n];");
		expect(lecteurs[0].urls).toEqual(["https://a/1"]);
	});

	test("un lecteur vide est ignoré, les commentaires aussi", () => {
		const js = "var eps1 = [];\n// var eps2 = ['https://a/2'];\nvar eps3 = ['https://a/3'];";
		const lecteurs = parserLecteurs(js);
		expect(lecteurs.map((l) => l.index)).toEqual([3]);
		expect(lecteurs[0].nom).toBe("Lecteur 1");
	});

	test("les URLs vidmoly sont normalisées à l'analyse", () => {
		const lecteurs = parserLecteurs("var eps1 = ['https://vidmoly.to/e/a'];");
		expect(lecteurs[0].urls[0]).toBe("https://vidmoly.biz/e/a");
		expect(lecteurs[0].hebergeur).toBe("vidmoly");
	});
});

// ---------------------------------------------------------------------------

describe("liste d'épisodes affichée", () => {
	test("page standard : resetListe() + finirListe(1)", () => {
		expect(parserNomsEpisodes(PAGE_SAISON1, 26)).toEqual(
			Array.from({ length: 26 }, (_, i) => `Episode ${i + 1}`),
		);
	});

	test("page de films : le second bloc réinitialise et nomme librement", () => {
		// Réel : `resetListe(); newSPF("Broly"); newSPF("Super Hero"); finirListe(2);`
		expect(parserNomsEpisodes(LISTE_FILMS, 2)).toEqual(["Broly", "Super Hero"]);
	});

	test("le gabarit commenté de la page n'est pas rejoué", () => {
		// Le commentaire contient `creerListe(debut, fin); newSP(special);` :
		// sans nettoyage il ferait apparaître des libellés fantômes.
		const noms = parserNomsEpisodes(LISTE_FILMS, 2);
		expect(noms.some((n) => /special|debut|fin/i.test(n))).toBe(false);
	});

	test("creerListe + newSP + finirListe se composent", () => {
		const html = `<script>$(document).ready(function(){
			resetListe();
			creerListe(1, 3);
			newSP(4);
			newSPF("OAV");
			finirListe(4);
		});</script>`;
		// taille = 8, 2 spéciaux → finirListe(4) va de 4 à 6.
		expect(parserNomsEpisodes(html, 8)).toEqual([
			"Episode 1",
			"Episode 2",
			"Episode 3",
			"Episode 4",
			"OAV",
			"Episode 4",
			"Episode 5",
			"Episode 6",
		]);
	});

	test("sans directive exploitable, on retombe sur la numérotation simple", () => {
		expect(parserNomsEpisodes("<html></html>", 3)).toEqual([
			"Episode 1",
			"Episode 2",
			"Episode 3",
		]);
	});

	test("numeroDepuisNom ne numérote que les libellés « Episode N »", () => {
		expect(numeroDepuisNom("Episode 12")).toBe(12);
		expect(numeroDepuisNom("Épisode 7")).toBe(7);
		expect(numeroDepuisNom("Broly")).toBeNull();
	});

	test("composerEpisodes croise lecteurs et libellés", () => {
		const episodes = composerEpisodes(
			[
				{
					index: 1,
					nom: "Lecteur 1",
					hebergeur: "sibnet",
					urls: ["https://video.sibnet.ru/shell.php?videoid=1"],
				},
				{
					index: 2,
					nom: "Lecteur 2",
					hebergeur: "ansembed",
					urls: [
						"https://ansembed.net/embed-a.html",
						"https://ansembed.net/embed-b.html",
					],
				},
			],
			["Episode 1", "Episode 2"],
		);
		expect(episodes).toHaveLength(2);
		// Le lecteur 1 ne couvre pas l'épisode 2 : il en est absent.
		expect(episodes[0].lecteurs.map((l) => l.index)).toEqual([1, 2]);
		expect(episodes[1].lecteurs.map((l) => l.index)).toEqual([2]);
		expect(episodes[1].numero).toBe(2);
	});
});

// ---------------------------------------------------------------------------

describe("page de saison complète", () => {
	const saison = parserSaison(PAGE_SAISON1, JS_SAISON1, {
		slug: "inazuma-eleven",
		saison: "saison1",
		langue: "vf",
		url: URL_SAISON1,
	});

	test("métadonnées de la page", () => {
		expect(saison.titre).toBe("Inazuma Eleven");
		expect(saison.libelle).toBe("Saison 1");
		expect(saison.slug).toBe("inazuma-eleven");
		expect(saison.langue).toBe("vf");
	});

	test("26 épisodes, deux lecteurs chacun", () => {
		expect(saison.episodes).toHaveLength(26);
		expect(saison.episodes[0].nom).toBe("Episode 1");
		expect(saison.episodes[0].numero).toBe(1);
		expect(saison.episodes[0].lecteurs.map((l) => l.hebergeur)).toEqual([
			"youtube",
			"ansembed",
		]);
		expect(saison.episodes.at(-1)?.numero).toBe(26);
	});

	test("les drapeaux imprimés ne valent pas disponibilité", () => {
		// Le gabarit imprime les dix drapeaux, tous `hidden` : seule une sonde
		// HTTP (listerLangues) dit ce qui existe vraiment.
		const drapeaux = parserDrapeauxLangues(PAGE_SAISON1);
		expect(drapeaux).toContain("vostfr");
		expect(drapeaux).toContain("vf");
		expect(drapeaux.length).toBeGreaterThan(5);
	});
});

// ---------------------------------------------------------------------------

describe("recherche", () => {
	test("fragment de /template-php/defaut/fetch.php", () => {
		const resultats = parserResultatsRecherche(RECHERCHE);
		expect(resultats.length).toBeGreaterThanOrEqual(3);
		expect(resultats[0]).toMatchObject({
			slug: "inazuma-eleven",
			titre: "Inazuma Eleven",
			url: "https://anime-sama.to/catalogue/inazuma-eleven",
		});
		expect(resultats[0].titresAlternatifs).toContain("Lightning Eleven");
		expect(resultats[0].image).toContain("inazuma-eleven.webp");
		expect(resultats.map((r) => r.slug)).toContain("amaama-to-inazuma");
	});

	test("cartes .catalog-card du catalogue paginé", () => {
		const cartes = parserCartesCatalogue(CARTES);
		expect(cartes.map((c) => c.slug)).toEqual([
			"amaama-to-inazuma",
			"inazuma-eleven",
		]);
		expect(cartes[1].titre).toBe("Inazuma Eleven");
		expect(cartes[1].image).toContain("inazuma-eleven.webp");
	});

	test("un fragment vide ne produit aucun résultat", () => {
		expect(parserResultatsRecherche("")).toEqual([]);
		expect(parserCartesCatalogue("")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------

describe("résolution des lecteurs", () => {
	test("classerMedia", () => {
		expect(classerMedia("https://a/master.m3u8?t=1")).toBe("hls");
		expect(classerMedia("https://a/x.mp4")).toBe("mp4");
		expect(classerMedia("https://a/embed-x.html")).toBe("unknown");
	});

	test("ansembed : source JW Player + poster", () => {
		const { url, poster } = chercherMedia(
			EMBED_ANSEMBED,
			"https://ansembed.net/embed-ze0dv8b88jpo.html",
		);
		expect(url).toContain("master.m3u8");
		expect(classerMedia(url ?? "")).toBe("hls");
		expect(poster).toContain("ze0dv8b88jpo.jpg");
	});

	test("sibnet : chemin relatif /v/<hash>/<id>.mp4 résolu sur l'origine", () => {
		const { url } = chercherMedia(
			EMBED_SIBNET,
			"https://video.sibnet.ru/shell.php?videoid=4826196",
		);
		expect(url).toBe(
			"https://video.sibnet.ru/v/11ac91cb55f3080ef490ddeb5e01cc9c/4826196.mp4",
		);
	});

	test("un embed sans média renvoie null", () => {
		expect(chercherMedia("<html>rien</html>", "https://x/").url).toBeNull();
	});
});

// ---------------------------------------------------------------------------

/** Transport factice : sert des fixtures et journalise les requêtes. */
function transportFactice(
	routes: Record<string, ReponseHttp | string>,
): { transport: (r: RequeteHttp) => Promise<ReponseHttp>; vues: RequeteHttp[] } {
	const vues: RequeteHttp[] = [];
	return {
		vues,
		transport: async (requete) => {
			vues.push(requete);
			const brut = routes[requete.url];
			if (brut === undefined) return { status: 404, corps: "not found" };
			return typeof brut === "string" ? { status: 200, corps: brut } : brut;
		},
	};
}

describe("AnimesamaScraper (transport injecté, sans réseau)", () => {
	test("getAnime lit la fiche à l'URL attendue", async () => {
		const { transport, vues } = transportFactice({
			[URL_FICHE]: FICHE_INAZUMA,
		});
		const scraper = new AnimesamaScraper({ transport });
		const fiche = await scraper.getAnime("inazuma-eleven");
		expect(vues[0].url).toBe(URL_FICHE);
		expect(vues[0].methode).toBeUndefined();
		expect(fiche.titre).toBe("Inazuma Eleven");
		expect(fiche.saisons).toHaveLength(7);
		await scraper.close();
	});

	test("rechercher poste query= sur fetch.php", async () => {
		const { transport, vues } = transportFactice({
			"https://anime-sama.to/template-php/defaut/fetch.php": RECHERCHE,
		});
		const scraper = new AnimesamaScraper({ transport });
		const resultats = await scraper.rechercher("inazuma eleven");
		expect(vues[0].methode).toBe("POST");
		expect(vues[0].corps).toBe("query=inazuma%20eleven");
		expect(resultats[0].slug).toBe("inazuma-eleven");
		await scraper.close();
	});

	test("getSaison combine la page et son episodes.js", async () => {
		const { transport, vues } = transportFactice({
			[URL_SAISON1]: PAGE_SAISON1,
			[`${URL_SAISON1}episodes.js`]: JS_SAISON1,
		});
		const scraper = new AnimesamaScraper({ transport });
		const saison = await scraper.getSaison("inazuma-eleven", "saison1", "vf");
		expect(vues.map((v) => v.url)).toEqual([
			URL_SAISON1,
			`${URL_SAISON1}episodes.js`,
		]);
		expect(saison.episodes).toHaveLength(26);
		expect(saison.lecteurs).toHaveLength(2);
		await scraper.close();
	});

	test("getSaison échoue proprement quand episodes.js est absent", async () => {
		const { transport } = transportFactice({ [URL_SAISON1]: PAGE_SAISON1 });
		const scraper = new AnimesamaScraper({ transport, retries: 0 });
		expect(
			scraper.getSaison("inazuma-eleven", "saison1", "vf"),
		).rejects.toThrow(/episodes\.js introuvable/);
		await scraper.close();
	});

	test("listerLangues ne retient que les langues au episodes.js peuplé", async () => {
		const base = "https://anime-sama.to/catalogue/inazuma-eleven/saison1";
		const { transport } = transportFactice({
			[`${base}/vf/episodes.js`]: JS_SAISON1,
			// vostfr répond 200 mais vide (cas réel des dossiers amorcés)
			[`${base}/vostfr/episodes.js`]: { status: 200, corps: "    \n//\n" },
		});
		const scraper = new AnimesamaScraper({ transport });
		const langues = await scraper.listerLangues("inazuma-eleven", "saison1", [
			"vostfr",
			"vf",
			"va",
		]);
		expect(langues).toEqual(["vf"]);
		await scraper.close();
	});

	test("getAnimeComplet ignore les saisons illisibles", async () => {
		const { transport } = transportFactice({
			[URL_FICHE]: FICHE_INAZUMA,
			[URL_SAISON1]: PAGE_SAISON1,
			[`${URL_SAISON1}episodes.js`]: JS_SAISON1,
		});
		const scraper = new AnimesamaScraper({ transport, retries: 0 });
		const complet = await scraper.getAnimeComplet("inazuma-eleven");
		expect(complet.saisons).toHaveLength(7);
		expect(complet.saisonsResolues).toHaveLength(1);
		expect(complet.saisonsResolues[0].saison).toBe("saison1");
		await scraper.close();
	});

	test("resoudreLecteur suit l'embed jusqu'au flux direct", async () => {
		const embed = "https://ansembed.net/embed-ze0dv8b88jpo.html";
		const { transport } = transportFactice({ [embed]: EMBED_ANSEMBED });
		const scraper = new AnimesamaScraper({ transport });
		const source = await scraper.resoudreLecteur(embed);
		expect(source.hebergeur).toBe("ansembed");
		expect(source.type).toBe("hls");
		expect(source.url).toContain("master.m3u8");
		expect(source.enTetes.Referer).toBe("https://ansembed.net/");
		expect(source.erreur).toBeNull();
		await scraper.close();
	});

	test("resoudreLecteur refuse YouTube sans requête réseau", async () => {
		const { transport, vues } = transportFactice({});
		const scraper = new AnimesamaScraper({ transport });
		const source = await scraper.resoudreLecteur(
			"https://www.youtube.com/embed/HoDiiJ-sWCk",
		);
		expect(vues).toHaveLength(0);
		expect(source.url).toBeNull();
		expect(source.erreur).toContain("propriétaire");
		await scraper.close();
	});

	test("un lien direct .mp4 est renvoyé tel quel", async () => {
		const { transport, vues } = transportFactice({});
		const scraper = new AnimesamaScraper({ transport });
		const source = await scraper.resoudreLecteur(
			"https://s22.anime-sama.fr/f/ep1.mp4",
		);
		expect(vues).toHaveLength(0);
		expect(source.type).toBe("mp4");
		expect(source.url).toBe("https://s22.anime-sama.fr/f/ep1.mp4");
		await scraper.close();
	});

	test("enumererQualitesHls lit le master playlist", async () => {
		const master = "https://box.example/hls/master.m3u8";
		const { transport } = transportFactice({
			[master]: [
				"#EXTM3U",
				"#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
				"360/index.m3u8",
				"#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
				"720/index.m3u8",
			].join("\n"),
		});
		const scraper = new AnimesamaScraper({ transport });
		const qualites = await scraper.enumererQualitesHls(master, "https://x/");
		// Le cœur média classe la meilleure définition en tête, nomme les
		// variantes par leur hauteur et rend des URL absolues.
		expect(qualites.map((q) => q.label)).toEqual(["720p", "360p"]);
		expect(qualites[0].resolution).toBe("1280x720");
		expect(qualites[0].bandePassante).toBe(2_400_000);
		expect(qualites[0].url).toBe("https://box.example/hls/720/index.m3u8");
		await scraper.close();
	});

	test("les reprises sont bornées par `retries`", async () => {
		let appels = 0;
		const scraper = new AnimesamaScraper({
			retries: 2,
			transport: async () => {
				appels++;
				throw new Error("socket morte");
			},
		});
		expect(scraper.getAnime("x")).rejects.toThrow(/socket morte/);
		await Bun.sleep(1500);
		expect(appels).toBe(3);
		await scraper.close();
	});

	test("baseUrl est configurable (miroir / domaine de repli)", async () => {
		const { transport, vues } = transportFactice({});
		const scraper = new AnimesamaScraper({
			transport,
			baseUrl: "https://anime-sama.fr/",
			retries: 0,
		});
		await scraper.getAnime("x").catch(() => {});
		expect(vues[0].url).toBe("https://anime-sama.fr/catalogue/x/");
		await scraper.close();
	});
});
