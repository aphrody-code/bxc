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

import { describe, expect, it } from "bun:test";

import type { ChannelInfo, VideoRef } from "@aphrody/ietv";
import type { CacheStats } from "@aphrody/ietv/cache";

import { JournalAnnonces, analyserJournal, diffNouveaux } from "./annonces.ts";
import { Catalogue, CLE_DERNIER_RAFRAICHISSEMENT, type CacheLike } from "./catalogue.ts";
import { cheminCacheParDefaut, lireConfig, lireEntier, lireFlocons, resumerConfig } from "./config.ts";
import { estStaff } from "./bot.ts";
import {
	DEFINITION_IETV,
	estLisibleEnLigne,
	executerIetv,
	optionsDepuisObjet,
	reponsePrivee,
	type ContexteCommande,
} from "./commands/ietv.ts";
import {
	CLE_FILS,
	SynchronisationForum,
	analyserTableFils,
	etiquettesDeSaison,
	nomFilSaison,
	type PasserelleForum,
} from "./forum.ts";
import {
	CLE_LACUNES,
	Reparateur,
	decrireLacune,
	detecterLacunes,
	lacunesDeSaison,
} from "./lacunes.ts";
import { Planificateur } from "./planificateur.ts";
import { MARQUE_PAR_DEFAUT } from "./ui/theme.ts";
import { Fiche, tailleEmbed } from "./ui/embed.ts";
import {
	bornerTexte,
	codeEpisode,
	formaterDuree,
	horodatageRelatif,
	libelleLangue,
	grouperParEpisode,
	lienCourt,
	listerEpisodes,
	listerSaison,
	repartitionLangues,
	trierEpisodes,
	type EpisodeCatalogue,
} from "./ui/format.ts";

// ---------------------------------------------------------------------------
// Doublures
// ---------------------------------------------------------------------------

function episode(partiel: Partial<EpisodeCatalogue> & { videoId: string }): EpisodeCatalogue {
	return {
		title: `Épisode ${partiel.videoId}`,
		url: `https://y/${partiel.videoId}`,
		description: null,
		thumbnail: null,
		publishDate: null,
		season: 1,
		episode: 1,
		language: "vf",
		duration: 1440,
		viewCount: null,
		...partiel,
	};
}

function chaine(nom: string, episodes: EpisodeCatalogue[]): ChannelInfo {
	const saisons = new Map<number, EpisodeCatalogue[]>();
	for (const ep of episodes) {
		const cle = ep.season ?? 0;
		saisons.set(cle, [...(saisons.get(cle) ?? []), ep]);
	}
	return {
		channel: nom,
		title: nom.toUpperCase(),
		description: null,
		avatar: null,
		totalEpisodes: episodes.length,
		seasons: [...saisons.entries()].map(([season, eps]) => ({
			season,
			episodes: eps as VideoRef[],
			totalEpisodes: eps.length,
		})),
	};
}

/** Cache en mémoire : même surface que `IETVCache`, sans SQLite. */
class CacheMemoire implements CacheLike {
	episodes: EpisodeCatalogue[] = [];
	chaines: ChannelInfo[] = [];
	meta = new Map<string, string>();
	fermetures = 0;

	search(query: {
		q?: string;
		season?: number;
		episode?: number;
		language?: "vf" | "vostfr";
		limit?: number;
	}) {
		let resultat = this.episodes;
		if (query.q) {
			const q = query.q.toLowerCase();
			resultat = resultat.filter((ep) => ep.title.toLowerCase().includes(q));
		}
		if (query.season !== undefined) resultat = resultat.filter((ep) => ep.season === query.season);
		if (query.episode !== undefined) resultat = resultat.filter((ep) => ep.episode === query.episode);
		if (query.language) resultat = resultat.filter((ep) => ep.language === query.language);
		return resultat.slice(0, query.limit ?? resultat.length) as never;
	}

	getAllChannels() {
		return this.chaines;
	}

	getStats(): CacheStats {
		const byLanguage: Record<string, number> = {};
		for (const ep of this.episodes) byLanguage[ep.language] = (byLanguage[ep.language] ?? 0) + 1;
		return {
			channels: this.chaines.length,
			seasons: new Set(this.episodes.map((ep) => ep.season)).size,
			episodes: this.episodes.length,
			byLanguage,
			lastUpdate: 0,
		};
	}

	getMetadata(cle: string) {
		return this.meta.get(cle) ?? null;
	}
	setMetadata(cle: string, valeur: string) {
		this.meta.set(cle, valeur);
	}
	saveChannel(info: ChannelInfo) {
		this.chaines.push(info);
		for (const saison of info.seasons) {
			this.episodes.push(...(saison.episodes as EpisodeCatalogue[]));
		}
	}
	clear() {
		this.episodes = [];
		this.chaines = [];
	}
	clearExpired() {}
	close() {
		this.fermetures++;
	}
}

function catalogueAvec(episodes: EpisodeCatalogue[]): { catalogue: Catalogue; cache: CacheMemoire } {
	const cache = new CacheMemoire();
	cache.saveChannel(chaine("inazumatvfr", episodes));
	return {
		catalogue: new Catalogue({
			ouvrirCache: () => cache,
			creerScraper: () => ({
				getAllChannelEpisodes: async () => [],
				close: async () => {},
			}),
		}),
		cache,
	};
}

function contexte(catalogue: Catalogue, estStaffAppelant = false): ContexteCommande {
	return { catalogue, marque: MARQUE_PAR_DEFAUT, estStaff: estStaffAppelant };
}

const texteDe = (reponse: { embeds: { description?: string; title?: string }[] }) =>
	`${reponse.embeds[0]?.title ?? ""}\n${reponse.embeds[0]?.description ?? ""}`;

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

describe("format", () => {
	it("code un épisode, même partiellement identifié", () => {
		expect(codeEpisode(1, 5)).toBe("S01E05");
		expect(codeEpisode(12, null)).toBe("S12");
		expect(codeEpisode(null, 7)).toBe("E07");
		expect(codeEpisode(null, null)).toBe("hors série");
	});

	it("formate les durées", () => {
		expect(formaterDuree(1440)).toBe("24 min");
		expect(formaterDuree(3600)).toBe("1 h");
		expect(formaterDuree(5400)).toBe("1 h 30");
		expect(formaterDuree(null)).toBe("—");
		expect(formaterDuree(0)).toBe("—");
	});

	it("nomme les versions linguistiques", () => {
		expect(libelleLangue("vf")).toContain("VF");
		expect(libelleLangue("vostfr")).toContain("VOSTFR");
		expect(libelleLangue("unknown")).toContain("inconnue");
	});

	it("borne un texte sans couper au milieu d'une ligne quand c'est possible", () => {
		const texte = "première ligne\nseconde ligne bien plus longue que la première";
		const borne = bornerTexte(texte, 30);
		expect(borne.length).toBeLessThanOrEqual(30);
		expect(borne.endsWith("…")).toBe(true);
		expect(borne).toContain("première ligne");
	});

	it("rend le texte tel quel quand il tient", () => {
		expect(bornerTexte("court", 100)).toBe("court");
	});

	it("liste les épisodes et annonce le reste", () => {
		const episodes = Array.from({ length: 12 }, (_, i) => episode({ videoId: `v${i}`, episode: i + 1 }));
		const liste = listerEpisodes(episodes, { limite: 5 });
		expect(liste.affiches).toBe(5);
		expect(liste.restants).toBe(7);
		expect(liste.texte).toContain("et 7 autre(s)");
	});

	it("tient le budget de description", () => {
		const episodes = Array.from({ length: 200 }, (_, i) =>
			episode({ videoId: `v${i}`, title: "T".repeat(200) })
		);
		const liste = listerEpisodes(episodes, { limite: 200 });
		expect(liste.texte.length).toBeLessThanOrEqual(4096);
		expect(liste.affiches).toBeLessThan(200);
	});

	it("trie par saison puis épisode, inconnus en dernier", () => {
		const trie = trierEpisodes([
			episode({ videoId: "c", season: 2, episode: 1 }),
			episode({ videoId: "a", season: 1, episode: 2 }),
			episode({ videoId: "d", season: null, episode: null }),
			episode({ videoId: "b", season: 1, episode: 1 }),
		]);
		expect(trie.map((e) => e.videoId)).toEqual(["b", "a", "c", "d"]);
	});

	it("résume la répartition des langues dans un ordre stable", () => {
		expect(repartitionLangues({ vostfr: 3, vf: 10 })).toMatch(/VF 10 · .*VOSTFR 3/);
		expect(repartitionLangues({})).toBe("aucun épisode");
	});

	it("rend un horodatage relatif natif, ou « jamais »", () => {
		expect(horodatageRelatif(1_700_000_000_000)).toBe("<t:1700000000:R>");
		expect(horodatageRelatif(0)).toBe("jamais");
	});
});

// ---------------------------------------------------------------------------
// Embeds
// ---------------------------------------------------------------------------

describe("Fiche", () => {
	it("pose un pied avec la marque", () => {
		const embed = new Fiche({ titre: "Titre" }).finir("note");
		expect(embed.footer?.text).toBe("note · Wonderbot · catalogue d'épisodes");
	});

	it("ne nomme aucune marque déposée dans le pied de page", () => {
		// Le pied est public : il s'affiche sous chaque réponse du bot.
		const pied = new Fiche({ titre: "T" }).finir();
		expect(pied.footer?.text.toLowerCase()).not.toContain("inazuma");
		expect(pied.footer?.text.toLowerCase()).not.toContain("ietv");
	});

	it("refuse un champ qui ferait dépasser le budget, et le signale", () => {
		const f = new Fiche({ titre: "T" });
		for (let i = 0; i < 10; i++) f.champ(`champ ${i}`, "V".repeat(1000));
		const embed = f.finir();

		expect(f.tronquee).toBe(true);
		expect(tailleEmbed(embed)).toBeLessThanOrEqual(6000);
		expect(embed.footer?.text).toContain("tronqué");
	});

	it("plafonne le nombre de champs à 25", () => {
		const f = new Fiche({ titre: "T" });
		for (let i = 0; i < 40; i++) f.champ(`c${i}`, "v");
		expect(f.finir().fields).toHaveLength(25);
	});
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("lireConfig", () => {
	const base = {
		WONDERBOT_DISCORD_TOKEN: "jeton",
		WONDERBOT_APPLICATION_ID: "1544463751279812740",
		HOME: "/home/test",
	};

	it("lit une configuration minimale", () => {
		const config = lireConfig(base);
		expect(config.jeton).toBe("jeton");
		expect(config.applicationId).toBe("1544463751279812740");
		expect(config.cheminCache).toBe("/home/test/.cache/ietv/episodes.db");
		// Sans guilde, la portée « guildes » n'enregistrerait nulle part.
		expect(config.portee).toBe("globale");
	});

	it("accepte les noms de variables historiques", () => {
		const config = lireConfig({
			DISCORD_TOKEN: "jeton-historique",
			DISCORD_CLIENT_ID: "1544463751279812740",
			DISCORD_GUILD_ID: "1544475258591907961",
			HOME: "/home/test",
		});
		expect(config.jeton).toBe("jeton-historique");
		expect(config.guildes).toEqual(["1544475258591907961"]);
		expect(config.portee).toBe("guildes");
	});

	it("refuse un secret scellé au lieu du jeton", () => {
		expect(() => lireConfig({ ...base, WONDERBOT_DISCORD_TOKEN: "eyJ2IjoxfQ" })).toThrow(/SCELLÉ/);
	});

	it("refuse une référence shell non substituée", () => {
		expect(() => lireConfig({ ...base, WONDERBOT_DISCORD_TOKEN: "$AUTRE" })).toThrow(/non substituée/);
	});

	it("nomme la variable à poser quand le jeton manque", () => {
		expect(() => lireConfig({ HOME: "/home/test" })).toThrow(/WONDERBOT_DISCORD_TOKEN/);
	});

	it("refuse un identifiant d'application qui n'est pas un flocon", () => {
		expect(() => lireConfig({ ...base, WONDERBOT_APPLICATION_ID: "Wonderbot" })).toThrow(
			/Application ID/
		);
	});

	it("refuse une portée inconnue", () => {
		expect(() => lireConfig({ ...base, WONDERBOT_COMMAND_SCOPE: "serveur" })).toThrow(/guildes, globale/);
	});

	it("plancher l'intervalle de rafraîchissement à une minute", () => {
		expect(lireConfig({ ...base, WONDERBOT_REFRESH_INTERVAL_MS: "5" }).intervalleRafraichissementMs).toBe(
			60_000
		);
	});

	it("ignore un salon d'annonces qui n'est pas un flocon", () => {
		expect(lireConfig({ ...base, WONDERBOT_ANNOUNCE_CHANNEL_ID: "général" }).salonAnnonces).toBeNull();
	});

	it("ne fait jamais figurer le jeton dans le résumé", () => {
		const resume = resumerConfig(lireConfig({ ...base, WONDERBOT_DISCORD_TOKEN: "SECRET-A-NE-PAS-VOIR" }));
		expect(resume).not.toContain("SECRET");
		expect(resume).toContain("1544463751279812740");
	});

	it("lit des listes de flocons tolérantes aux séparateurs", () => {
		expect(lireFlocons("1544475258591907961, 1349526851672080414 x")).toEqual([
			"1544475258591907961",
			"1349526851672080414",
		]);
		expect(lireFlocons(undefined)).toEqual([]);
	});

	it("retombe sur le défaut pour un entier absurde", () => {
		expect(lireEntier("zéro", { defaut: 42 })).toBe(42);
		expect(lireEntier("-3", { defaut: 42 })).toBe(42);
		expect(lireEntier("100", { defaut: 42, minimum: 50 })).toBe(100);
	});

	it("laisse IETV_CACHE_PATH l'emporter sur le défaut", () => {
		expect(cheminCacheParDefaut({ IETV_CACHE_PATH: "/var/lib/w/e.db", HOME: "/home/test" })).toBe(
			"/var/lib/w/e.db"
		);
	});
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe("Catalogue", () => {
	it("cherche, filtre et trie", () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", title: "Le Onze Suprême", season: 1, episode: 2 }),
			episode({ videoId: "b", title: "Le Onze Suprême", season: 1, episode: 1, language: "vostfr" }),
			episode({ videoId: "c", title: "Autre chose", season: 2, episode: 1 }),
		]);

		expect(catalogue.rechercher({ texte: "onze" }).map((e) => e.videoId)).toEqual(["b", "a"]);
		expect(catalogue.rechercher({ texte: "onze", langue: "vf" }).map((e) => e.videoId)).toEqual(["a"]);
	});

	it("rend toutes les versions d'un épisode", () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "vf", season: 1, episode: 3 }),
			episode({ videoId: "vo", season: 1, episode: 3, language: "vostfr" }),
			episode({ videoId: "autre", season: 1, episode: 4 }),
		]);
		expect(catalogue.episode(1, 3).map((e) => e.videoId).sort()).toEqual(["vf", "vo"]);
	});

	it("liste les saisons disponibles, croissantes", () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", season: 3 }),
			episode({ videoId: "b", season: 1 }),
		]);
		expect(catalogue.saisonsDisponibles()).toEqual([1, 3]);
	});

	it("résume le catalogue et sa fraîcheur", () => {
		const { catalogue, cache } = catalogueAvec([episode({ videoId: "a" })]);
		cache.setMetadata(CLE_DERNIER_RAFRAICHISSEMENT, "1700000000000");

		const resume = catalogue.resume();
		expect(resume.stats.episodes).toBe(1);
		expect(resume.sources[0]?.nom).toBe("inazumatvfr");
		expect(resume.dernierRafraichissement).toBe(1_700_000_000_000);
	});

	it("scrape AVANT de vider : un scraping en échec conserve le catalogue", async () => {
		const cache = new CacheMemoire();
		cache.saveChannel(chaine("source", [episode({ videoId: "ancien" })]));

		const catalogue = new Catalogue({
			ouvrirCache: () => cache,
			creerScraper: () => ({
				getAllChannelEpisodes: async () => {
					throw new Error("réseau coupé");
				},
				close: async () => {},
			}),
		});

		await expect(catalogue.rafraichir()).rejects.toThrow("réseau coupé");
		expect(cache.getStats().episodes).toBe(1);
	});

	it("refuse de remplacer le catalogue par un scraping vide", async () => {
		const cache = new CacheMemoire();
		cache.saveChannel(chaine("source", [episode({ videoId: "ancien" })]));

		const catalogue = new Catalogue({
			ouvrirCache: () => cache,
			creerScraper: () => ({ getAllChannelEpisodes: async () => [], close: async () => {} }),
		});

		await expect(catalogue.rafraichir()).rejects.toThrow(/aucune source/);
		expect(cache.getStats().episodes).toBe(1);
	});

	it("détecte les nouveautés et horodate le passage", async () => {
		const cache = new CacheMemoire();
		cache.saveChannel(chaine("source", [episode({ videoId: "connu" })]));

		let instant = 1000;
		const catalogue = new Catalogue({
			ouvrirCache: () => cache,
			now: () => (instant += 500),
			creerScraper: () => ({
				getAllChannelEpisodes: async () => [
					chaine("source", [episode({ videoId: "connu" }), episode({ videoId: "neuf", episode: 2 })]),
				],
				close: async () => {},
			}),
		});

		const resultat = await catalogue.rafraichir();
		expect(resultat.nouveaux.map((e) => e.videoId)).toEqual(["neuf"]);
		expect(resultat.sources).toBe(1);
		expect(cache.getMetadata(CLE_DERNIER_RAFRAICHISSEMENT)).not.toBeNull();
	});

	it("ferme le scraper même quand le scraping échoue", async () => {
		let ferme = false;
		const catalogue = new Catalogue({
			ouvrirCache: () => new CacheMemoire(),
			creerScraper: () => ({
				getAllChannelEpisodes: async () => {
					throw new Error("boum");
				},
				close: async () => {
					ferme = true;
				},
			}),
		});
		await expect(catalogue.rafraichir()).rejects.toThrow("boum");
		expect(ferme).toBe(true);
	});

	it("fusionne deux rafraîchissements concurrents", async () => {
		let appels = 0;
		const catalogue = new Catalogue({
			ouvrirCache: () => new CacheMemoire(),
			creerScraper: () => ({
				getAllChannelEpisodes: async () => {
					appels++;
					await Bun.sleep(5);
					return [chaine("source", [episode({ videoId: "a" })])];
				},
				close: async () => {},
			}),
		});

		await Promise.all([catalogue.rafraichir(), catalogue.rafraichir()]);
		expect(appels).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

describe("annonces", () => {
	const stockage = () => {
		const meta = new Map<string, string>();
		return {
			meta,
			lireMeta: (cle: string) => meta.get(cle) ?? null,
			ecrireMeta: (cle: string, valeur: string) => void meta.set(cle, valeur),
		};
	};

	it("diffe sur les identifiants, pas sur une date", () => {
		const nouveaux = diffNouveaux(new Set(["a"]), [episode({ videoId: "a" }), episode({ videoId: "b" })]);
		expect(nouveaux.map((e) => e.videoId)).toEqual(["b"]);
	});

	it("n'annonce rien au premier passage, mais amorce le journal", () => {
		const support = stockage();
		const journal = new JournalAnnonces(support);
		const catalogue = [episode({ videoId: "a" }), episode({ videoId: "b" })];

		const decision = journal.traiter(catalogue, 5);
		expect(decision.amorcage).toBe(true);
		expect(decision.aAnnoncer).toEqual([]);
		expect(journal.vus()).toEqual(new Set(["a", "b"]));
	});

	it("annonce uniquement ce qui est apparu depuis", () => {
		const support = stockage();
		const journal = new JournalAnnonces(support);
		journal.traiter([episode({ videoId: "a" })], 5);

		const decision = journal.traiter([episode({ videoId: "a" }), episode({ videoId: "b" })], 5);
		expect(decision.amorcage).toBe(false);
		expect(decision.aAnnoncer.map((e) => e.videoId)).toEqual(["b"]);
	});

	it("plafonne sans créer de file d'attente", () => {
		const support = stockage();
		const journal = new JournalAnnonces(support);
		journal.traiter([episode({ videoId: "a" })], 2);

		const catalogue = [
			episode({ videoId: "a" }),
			episode({ videoId: "b" }),
			episode({ videoId: "c" }),
			episode({ videoId: "d" }),
		];
		const premier = journal.traiter(catalogue, 2);
		expect(premier.aAnnoncer).toHaveLength(2);
		expect(premier.omis).toBe(1);

		// Le passage suivant ne rejoue pas les omis : ils sont marqués comme vus.
		expect(journal.traiter(catalogue, 2).aAnnoncer).toEqual([]);
	});

	it("élague le journal sur le catalogue courant", () => {
		const support = stockage();
		const journal = new JournalAnnonces(support);
		journal.traiter([episode({ videoId: "a" }), episode({ videoId: "b" })], 5);
		journal.traiter([episode({ videoId: "b" })], 5);
		expect(journal.vus()).toEqual(new Set(["b"]));
	});

	it("traite un journal illisible comme absent", () => {
		expect(analyserJournal("{pas du json")).toBeNull();
		expect(analyserJournal('{"a":1}')).toBeNull();
		expect(analyserJournal("")).toBeNull();
		expect(analyserJournal('["a"]')).toEqual(new Set(["a"]));
	});
});

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

describe("/episodes", () => {
	it("déclare cinq sous-commandes sous un nom sans marque déposée", () => {
		expect(DEFINITION_IETV.name).toBe("episodes");
		expect(DEFINITION_IETV.options.map((o) => o.name)).toEqual([
			"recherche",
			"episode",
			"saison",
			"catalogue",
			"rafraichir",
		]);
	});

	it("ne rend privée que la sous-commande d'exploitation", () => {
		expect(reponsePrivee("rafraichir")).toBe(true);
		expect(reponsePrivee("recherche")).toBe(false);
	});

	it("recherche et liste", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", title: "Le Onze Suprême", episode: 1 }),
			episode({ videoId: "b", title: "Le Onze Suprême", episode: 2 }),
		]);
		const reponse = await executerIetv(
			"recherche",
			optionsDepuisObjet({ texte: "onze" }),
			contexte(catalogue)
		);
		expect(texteDe(reponse)).toContain("Onze");
		expect(reponse.embeds[0]?.footer?.text).toContain("2 sur 2");
	});

	it("refuse une recherche vide", async () => {
		const { catalogue } = catalogueAvec([]);
		const reponse = await executerIetv("recherche", optionsDepuisObjet({ texte: "  " }), contexte(catalogue));
		expect(texteDe(reponse)).toContain("Recherche vide");
	});

	it("propose une piste quand la recherche ne rend rien", async () => {
		const { catalogue } = catalogueAvec([episode({ videoId: "a", title: "Autre" })]);
		const reponse = await executerIetv(
			"recherche",
			optionsDepuisObjet({ texte: "introuvable" }),
			contexte(catalogue)
		);
		expect(texteDe(reponse)).toContain("Aucun épisode");
		expect(texteDe(reponse)).toContain("/episodes saison");
	});

	it("rend un champ par version d'un épisode", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "vf", season: 1, episode: 3 }),
			episode({ videoId: "vo", season: 1, episode: 3, language: "vostfr" }),
		]);
		const reponse = await executerIetv(
			"episode",
			optionsDepuisObjet({ saison: 1, numero: 3 }),
			contexte(catalogue)
		);
		expect(reponse.embeds[0]?.fields).toHaveLength(2);
		expect(reponse.embeds[0]?.footer?.text).toContain("2 version(s)");
	});

	it("dit quelles saisons existent quand l'épisode est absent", async () => {
		const { catalogue } = catalogueAvec([episode({ videoId: "a", season: 2, episode: 1 })]);
		const reponse = await executerIetv(
			"episode",
			optionsDepuisObjet({ saison: 9, numero: 1 }),
			contexte(catalogue)
		);
		expect(texteDe(reponse)).toContain("Saisons au catalogue : 2");
	});

	it("liste une saison", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", season: 2, episode: 1 }),
			episode({ videoId: "b", season: 2, episode: 2 }),
			episode({ videoId: "c", season: 3, episode: 1 }),
		]);
		const reponse = await executerIetv("saison", optionsDepuisObjet({ numero: 2 }), contexte(catalogue));
		expect(reponse.embeds[0]?.footer?.text).toContain("2 sur 2");
	});

	it("résume le catalogue", async () => {
		const { catalogue, cache } = catalogueAvec([
			episode({ videoId: "a" }),
			episode({ videoId: "b", language: "vostfr" }),
		]);
		cache.setMetadata(CLE_DERNIER_RAFRAICHISSEMENT, "1700000000000");

		const reponse = await executerIetv("catalogue", optionsDepuisObjet({}), contexte(catalogue));
		const champs = reponse.embeds[0]?.fields ?? [];
		expect(champs.find((c) => c.name === "Épisodes")?.value).toBe("2");
		expect(champs.some((c) => c.value.includes("<t:1700000000:R>"))).toBe(true);
	});

	it("dit quoi faire quand le catalogue est vide", async () => {
		const { catalogue } = catalogueAvec([]);
		const reponse = await executerIetv("catalogue", optionsDepuisObjet({}), contexte(catalogue));
		expect(texteDe(reponse)).toContain("/episodes rafraichir");
	});

	it("réserve le rafraîchissement au staff", async () => {
		const { catalogue } = catalogueAvec([]);
		const reponse = await executerIetv("rafraichir", optionsDepuisObjet({}), contexte(catalogue, false));
		expect(texteDe(reponse)).toContain("Réservé au staff");
	});

	it("rafraîchit pour le staff et compte les nouveautés", async () => {
		const cache = new CacheMemoire();
		const catalogue = new Catalogue({
			ouvrirCache: () => cache,
			creerScraper: () => ({
				getAllChannelEpisodes: async () => [chaine("source", [episode({ videoId: "neuf" })])],
				close: async () => {},
			}),
		});

		const reponse = await executerIetv("rafraichir", optionsDepuisObjet({}), contexte(catalogue, true));
		expect(texteDe(reponse)).toContain("Catalogue rafraîchi");
		expect(texteDe(reponse)).toContain("1 nouveauté");
	});

	it("rend un échec lisible quand le rafraîchissement casse", async () => {
		const catalogue = new Catalogue({
			ouvrirCache: () => new CacheMemoire(),
			creerScraper: () => ({
				getAllChannelEpisodes: async () => {
					throw new Error("YouTube injoignable");
				},
				close: async () => {},
			}),
		});

		const reponse = await executerIetv("rafraichir", optionsDepuisObjet({}), contexte(catalogue, true));
		expect(texteDe(reponse)).toContain("YouTube injoignable");
		expect(texteDe(reponse)).toContain("catalogue précédent est conservé");
	});

	it("ne lève pas sur une sous-commande inconnue", async () => {
		const { catalogue } = catalogueAvec([]);
		const reponse = await executerIetv("inconnue", optionsDepuisObjet({}), contexte(catalogue));
		expect(texteDe(reponse)).toContain("Sous-commande inconnue");
	});
});

// ---------------------------------------------------------------------------
// Garde staff
// ---------------------------------------------------------------------------

describe("estStaff", () => {
	it("refuse un membre ordinaire quand aucun rôle n'est déclaré", () => {
		expect(estStaff(["1"], [])).toBe(false);
	});

	it("accepte dès qu'un rôle correspond", () => {
		expect(estStaff(["1", "2"], ["2", "3"])).toBe(true);
		expect(estStaff(["1"], ["2"])).toBe(false);
	});

	it("accepte toujours un administrateur, même sans rôle déclaré", () => {
		// Sans cette règle, un serveur neuf n'a personne pour lancer le premier
		// scraping — pas même son propriétaire.
		expect(estStaff([], [], true)).toBe(true);
		expect(estStaff(["1"], ["2"], true)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Planificateur
// ---------------------------------------------------------------------------

describe("Planificateur", () => {
	/** Minuteurs factices : on déclenche à la main, sans jamais attendre. */
	function horloge() {
		const enAttente: (() => void)[] = [];
		return {
			enAttente,
			planifier: (rappel: () => void) => {
				enAttente.push(rappel);
				return enAttente.length as unknown as ReturnType<typeof setTimeout>;
			},
			annuler: () => {},
			async declencher() {
				const rappel = enAttente.shift();
				rappel?.();
				// Laisse la micro-tâche du passage se dérouler.
				await Bun.sleep(1);
			},
		};
	}

	const resultatFactice = () => ({
		stats: { channels: 1, seasons: 1, episodes: 1, byLanguage: {}, lastUpdate: 0 },
		nouveaux: [],
		sources: 1,
		dureeMs: 10,
	});

	it("arme un minuteur au démarrage sans exécuter tout de suite", () => {
		const h = horloge();
		let appels = 0;
		const planificateur = new Planificateur({
			intervalleMs: 1000,
			rafraichir: async () => {
				appels++;
				return resultatFactice();
			},
			planifier: h.planifier,
			annuler: h.annuler,
		});

		planificateur.demarrer();
		expect(appels).toBe(0);
		expect(h.enAttente).toHaveLength(1);
	});

	it("exécute immédiatement quand on le demande", async () => {
		const h = horloge();
		let appels = 0;
		new Planificateur({
			intervalleMs: 1000,
			immediat: true,
			rafraichir: async () => {
				appels++;
				return resultatFactice();
			},
			planifier: h.planifier,
			annuler: h.annuler,
		}).demarrer();

		await Bun.sleep(1);
		expect(appels).toBe(1);
	});

	it("réarme après un passage réussi et notifie", async () => {
		const h = horloge();
		let succes = 0;
		const planificateur = new Planificateur({
			intervalleMs: 1000,
			rafraichir: async () => resultatFactice(),
			surSucces: () => {
				succes++;
			},
			planifier: h.planifier,
			annuler: h.annuler,
		});

		planificateur.demarrer();
		await h.declencher();

		expect(succes).toBe(1);
		expect(planificateur.instantane().passages).toBe(1);
		expect(h.enAttente).toHaveLength(1);
	});

	it("réarme AUSSI après un échec — une panne réseau n'arrête pas la boucle", async () => {
		const h = horloge();
		const erreurs: unknown[] = [];
		const planificateur = new Planificateur({
			intervalleMs: 1000,
			rafraichir: async () => {
				throw new Error("réseau");
			},
			surErreur: (err) => erreurs.push(err),
			planifier: h.planifier,
			annuler: h.annuler,
		});

		planificateur.demarrer();
		await h.declencher();

		expect(erreurs).toHaveLength(1);
		expect(planificateur.instantane().echecs).toBe(1);
		expect(planificateur.instantane().derniereErreur).toBe("réseau");
		expect(h.enAttente).toHaveLength(1);
	});

	it("n'arme rien de plus quand on démarre deux fois", () => {
		const h = horloge();
		const planificateur = new Planificateur({
			intervalleMs: 1000,
			rafraichir: async () => resultatFactice(),
			planifier: h.planifier,
			annuler: h.annuler,
		});

		planificateur.demarrer();
		planificateur.demarrer();
		expect(h.enAttente).toHaveLength(1);
	});

	it("cesse de réarmer une fois arrêté", async () => {
		const h = horloge();
		const planificateur = new Planificateur({
			intervalleMs: 1000,
			rafraichir: async () => resultatFactice(),
			planifier: h.planifier,
			annuler: h.annuler,
		});

		planificateur.demarrer();
		const rappel = h.enAttente.shift()!;
		planificateur.arreter();
		rappel();
		await Bun.sleep(1);

		expect(h.enAttente).toHaveLength(0);
		expect(planificateur.instantane().actif).toBe(false);
	});
});


// ---------------------------------------------------------------------------
// Forum : le catalogue en fils de discussion
// ---------------------------------------------------------------------------

describe("format des saisons", () => {
	it("regroupe les versions d'un même épisode", () => {
		const groupes = grouperParEpisode([
			episode({ videoId: "a", episode: 1 }),
			episode({ videoId: "b", episode: 1, language: "vostfr" }),
			episode({ videoId: "c", episode: 2 }),
		]);
		expect(groupes.map((g) => g.numero)).toEqual([1, 2]);
		expect(groupes[0]!.versions).toHaveLength(2);
	});

	it("met un lien par langue sur la ligne de l'épisode", () => {
		const liste = listerSaison([
			episode({ videoId: "a", episode: 1, url: "https://cdn.test/a" }),
			episode({ videoId: "b", episode: 1, language: "vostfr", url: "https://cdn.test/b" }),
		]);
		expect(liste.episodes).toBe(1);
		expect(liste.pages[0]).toContain("**E01**");
		expect(liste.pages[0]).toContain("(https://cdn.test/a)");
		expect(liste.pages[0]).toContain("(https://cdn.test/b)");
	});

	it("raccourcit les liens YouTube, et seulement eux", () => {
		expect(lienCourt(episode({ videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })))
			.toBe("https://youtu.be/dQw4w9WgXcQ");
		expect(lienCourt(episode({ videoId: "abc", url: "https://inazuma.test/ep1" })))
			.toBe("https://inazuma.test/ep1");
	});

	it("fait tenir une saison complète, quitte à déborder sur un second embed", () => {
		// 51 épisodes en deux langues avec de vraies URL YouTube : le cas réel
		// d'une saison complète, qui ne rentre PAS dans une seule description.
		const episodes = Array.from({ length: 51 }, (_, i) => [
			episode({
				videoId: `vf${String(i).padStart(9, "0")}`,
				episode: i + 1,
				url: `https://www.youtube.com/watch?v=vf${String(i).padStart(9, "0")}`,
			}),
			episode({
				videoId: `vo${String(i).padStart(9, "0")}`,
				episode: i + 1,
				language: "vostfr",
				url: `https://www.youtube.com/watch?v=vo${String(i).padStart(9, "0")}`,
			}),
		]).flat();

		const liste = listerSaison(episodes);
		expect(liste.episodes).toBe(51);
		expect(liste.omis).toBe(0);
		for (const page of liste.pages) expect(page.length).toBeLessThanOrEqual(4096);
		// Le total du message reste sous la limite de Discord.
		expect(liste.pages.reduce((n, p) => n + p.length, 0)).toBeLessThanOrEqual(6000);
	});

	it("annonce ce qu'il a dû écarter et renvoie vers la commande", () => {
		const episodes = Array.from({ length: 400 }, (_, i) =>
			episode({ videoId: `v${i}`, episode: i + 1, url: `https://cdn.test/${"x".repeat(60)}${i}` })
		);
		const liste = listerSaison(episodes);
		expect(liste.omis).toBeGreaterThan(0);
		expect(liste.pages.at(-1)).toContain("/episodes saison");
	});
});

describe("SynchronisationForum", () => {
	function passerelleFactice() {
		const fils = new Map<string, { nom: string; embed: any; tags: string[] }>();
		let suivant = 0;
		const journal: string[] = [];
		const passerelle: PasserelleForum = {
			filsExistants: async () => [...fils.keys()],
			creerFil: async (nom, embed, tags) => {
				const id = `fil${++suivant}`;
				fils.set(id, { nom, embed, tags });
				journal.push(`creer:${nom}`);
				return id;
			},
			majFil: async (id, nom, embed, tags) => {
				fils.set(id, { nom, embed, tags });
				journal.push(`maj:${id}`);
			},
		};
		return { passerelle, fils, journal };
	}

	const stockage = () => {
		const meta = new Map<string, string>();
		return {
			meta,
			lireMeta: (c: string) => meta.get(c) ?? null,
			ecrireMeta: (c: string, v: string) => void meta.set(c, v),
		};
	};

	const ETIQUETTES = { vf: "tag-vf", vostfr: "tag-vo" };

	it("crée un fil par saison au premier passage", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", season: 1, episode: 1 }),
			episode({ videoId: "b", season: 2, episode: 1 }),
		]);
		const { passerelle, fils } = passerelleFactice();
		const support = stockage();

		const r = await new SynchronisationForum({
			catalogue,
			passerelle,
			stockage: support,
			marque: MARQUE_PAR_DEFAUT,
			etiquettes: ETIQUETTES,
		}).synchroniser();

		expect(r.crees).toEqual([1, 2]);
		expect(fils.size).toBe(2);
		expect([...fils.values()][0]!.nom).toBe("Saison 1 — 1 épisode(s)");
	});

	it("modifie le fil existant au lieu d'en créer un second", async () => {
		const { catalogue } = catalogueAvec([episode({ videoId: "a", season: 1, episode: 1 })]);
		const { passerelle, fils, journal } = passerelleFactice();
		const support = stockage();
		const sync = () =>
			new SynchronisationForum({
				catalogue,
				passerelle,
				stockage: support,
				marque: MARQUE_PAR_DEFAUT,
				etiquettes: ETIQUETTES,
			}).synchroniser();

		await sync();
		const r = await sync();

		expect(r.majs).toEqual([1]);
		expect(r.crees).toEqual([]);
		expect(fils.size).toBe(1);
		expect(journal).toEqual(["creer:Saison 1 — 1 épisode(s)", "maj:fil1"]);
	});

	it("recrée un fil supprimé à la main", async () => {
		const { catalogue } = catalogueAvec([episode({ videoId: "a", season: 1, episode: 1 })]);
		const { passerelle, fils } = passerelleFactice();
		const support = stockage();
		const options = {
			catalogue,
			passerelle,
			stockage: support,
			marque: MARQUE_PAR_DEFAUT,
			etiquettes: ETIQUETTES,
		};

		await new SynchronisationForum(options).synchroniser();
		fils.clear(); // quelqu'un a supprimé le fil dans Discord

		const r = await new SynchronisationForum(options).synchroniser();
		expect(r.recrees).toEqual([1]);
		expect(fils.size).toBe(1);
	});

	it("étiquette selon les langues réellement présentes", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "a", season: 1, episode: 1 }),
			episode({ videoId: "b", season: 1, episode: 2, language: "vostfr" }),
			episode({ videoId: "c", season: 2, episode: 1, language: "vostfr" }),
		]);
		const { passerelle, fils } = passerelleFactice();
		await new SynchronisationForum({
			catalogue,
			passerelle,
			stockage: stockage(),
			marque: MARQUE_PAR_DEFAUT,
			etiquettes: ETIQUETTES,
		}).synchroniser();

		const [s1, s2] = [...fils.values()];
		expect(s1!.tags.sort()).toEqual(["tag-vf", "tag-vo"]);
		expect(s2!.tags).toEqual(["tag-vo"]);
	});

	it("ignore une étiquette absente du forum plutôt que d'échouer", () => {
		expect(etiquettesDeSaison({ vf: 3, vostfr: 1 }, { vf: "t1" })).toEqual(["t1"]);
		expect(etiquettesDeSaison({ vf: 3 }, {})).toEqual([]);
	});

	it("ne touche à rien quand le catalogue est vide", async () => {
		const { catalogue } = catalogueAvec([]);
		const { passerelle, journal } = passerelleFactice();
		const r = await new SynchronisationForum({
			catalogue,
			passerelle,
			stockage: stockage(),
			marque: MARQUE_PAR_DEFAUT,
		}).synchroniser();

		expect(r).toEqual({ crees: [], majs: [], recrees: [] });
		expect(journal).toEqual([]);
	});

	it("mémorise la correspondance saison → fil", async () => {
		const { catalogue } = catalogueAvec([episode({ videoId: "a", season: 3, episode: 1 })]);
		const { passerelle } = passerelleFactice();
		const support = stockage();
		await new SynchronisationForum({
			catalogue,
			passerelle,
			stockage: support,
			marque: MARQUE_PAR_DEFAUT,
		}).synchroniser();

		expect(analyserTableFils(support.lireMeta(CLE_FILS))).toEqual(new Map([[3, "fil1"]]));
	});

	it("repart d'une table vide quand la métadonnée est abîmée", () => {
		expect(analyserTableFils("pas du json")).toEqual(new Map());
		expect(analyserTableFils('["a"]')).toEqual(new Map());
		expect(analyserTableFils(null)).toEqual(new Map());
		expect(analyserTableFils('{"2":"fil9"}')).toEqual(new Map([[2, "fil9"]]));
	});

	it("nomme le fil avec le compte d'épisodes", () => {
		expect(nomFilSaison(4, 51)).toBe("Saison 4 — 51 épisode(s)");
	});
});


// ---------------------------------------------------------------------------
// Épisodes manquants et réparation
// ---------------------------------------------------------------------------

describe("lacunesDeSaison", () => {
	const saison = (numeros: (number | null)[]) =>
		numeros.map((n, i) => episode({ videoId: `v${i}`, episode: n }));

	it("trouve un trou au milieu d'une saison", () => {
		const l = lacunesDeSaison(1, saison([1, 2, 4, 5]));
		expect(l).toEqual({ saison: 1, manquants: [3], borne: { debut: 1, fin: 5 } });
	});

	it("trouve plusieurs trous", () => {
		expect(lacunesDeSaison(2, saison([1, 4, 7]))?.manquants).toEqual([2, 3, 5, 6]);
	});

	it("ne signale rien sur une saison complète", () => {
		expect(lacunesDeSaison(1, saison([1, 2, 3]))).toBeNull();
	});

	it("ne cherche RIEN au-delà du dernier épisode connu", () => {
		// Une saison qui s'arrête à E12 est en cours de diffusion, pas trouée.
		expect(lacunesDeSaison(1, saison([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
	});

	it("ignore une saison trop petite pour avoir un intervalle", () => {
		expect(lacunesDeSaison(1, saison([]))).toBeNull();
		expect(lacunesDeSaison(1, saison([5]))).toBeNull();
	});

	it("ignore les épisodes sans numéro", () => {
		expect(lacunesDeSaison(1, saison([1, null, 3]))?.manquants).toEqual([2]);
	});

	it("ne compte pas deux fois un épisode présent en deux langues", () => {
		const doubles = [
			episode({ videoId: "a", episode: 1 }),
			episode({ videoId: "b", episode: 1, language: "vostfr" }),
			episode({ videoId: "c", episode: 3 }),
		];
		expect(lacunesDeSaison(1, doubles)?.manquants).toEqual([2]);
	});

	it("balaie tout le catalogue", () => {
		const trous = detecterLacunes(
			new Map([
				[2, saison([1, 3])],
				[1, saison([1, 2])],
			])
		);
		expect(trous.map((t) => t.saison)).toEqual([2]);
	});

	it("décrit un trou de façon lisible, en bornant l'aperçu", () => {
		expect(decrireLacune({ saison: 3, manquants: [7, 12], borne: { debut: 1, fin: 20 } })).toBe(
			"S03 · E07, E12"
		);
		const beaucoup = { saison: 1, manquants: Array.from({ length: 20 }, (_, i) => i + 2), borne: { debut: 1, fin: 30 } };
		expect(decrireLacune(beaucoup)).toContain("(+8)");
	});
});

describe("Reparateur", () => {
	const stockage = () => {
		const meta = new Map<string, string>();
		return {
			meta,
			lireMeta: (c: string) => meta.get(c) ?? null,
			ecrireMeta: (c: string, v: string) => void meta.set(c, v),
		};
	};
	const trou = (saison: number, manquants: number[]) => ({
		saison,
		manquants,
		borne: { debut: 1, fin: 50 },
	});

	it("retente un trou jamais vu", () => {
		const d = new Reparateur({ stockage: stockage() }).evaluer([trou(1, [7])]);
		expect(d.retenter).toBe(true);
		expect(d.nouveaux).toEqual(["1:7"]);
		expect(d.confirmes).toEqual([]);
	});

	it("cesse de retenter après le nombre de tentatives prévu", () => {
		const support = stockage();
		const r = new Reparateur({ stockage: support, tentativesMax: 2 });

		expect(r.evaluer([trou(1, [7])]).retenter).toBe(true);
		expect(r.evaluer([trou(1, [7])]).retenter).toBe(true);
		const troisieme = r.evaluer([trou(1, [7])]);

		expect(troisieme.retenter).toBe(false);
		expect(troisieme.confirmes).toEqual(["1:7"]);
		expect(r.confirmes()).toEqual(new Set(["1:7"]));
	});

	it("rend ses tentatives à un trou qui a disparu puis revient", () => {
		const support = stockage();
		const r = new Reparateur({ stockage: support, tentativesMax: 1 });

		r.evaluer([trou(1, [7])]);
		expect(r.evaluer([trou(1, [7])]).confirmes).toEqual(["1:7"]);
		// L'épisode réapparaît : plus aucun trou.
		r.evaluer([]);
		// Puis il redisparaît — une source qui republie mérite qu'on retente.
		expect(r.evaluer([trou(1, [7])]).retenter).toBe(true);
	});

	it("traite chaque épisode manquant séparément", () => {
		const support = stockage();
		const r = new Reparateur({ stockage: support, tentativesMax: 1 });
		r.evaluer([trou(1, [7])]);
		const d = r.evaluer([trou(1, [7, 9])]);
		expect(d.confirmes).toEqual(["1:7"]);
		expect(d.nouveaux).toEqual(["1:9"]);
		expect(d.retenter).toBe(true);
	});

	it("ne retente jamais quand la réparation est désactivée", () => {
		const d = new Reparateur({ stockage: stockage(), tentativesMax: 0 }).evaluer([trou(1, [7])]);
		expect(d.retenter).toBe(false);
		expect(d.confirmes).toEqual(["1:7"]);
	});

	it("repart de zéro sur un registre abîmé", () => {
		const support = stockage();
		support.ecrireMeta(CLE_LACUNES, "pas du json");
		expect(new Reparateur({ stockage: support }).evaluer([trou(1, [7])]).retenter).toBe(true);
	});

	it("oublie tout à la réinitialisation", () => {
		const support = stockage();
		const r = new Reparateur({ stockage: support, tentativesMax: 1 });
		r.evaluer([trou(1, [7])]);
		r.reinitialiser();
		expect(r.confirmes().size).toBe(0);
	});
});

describe("configuration de la réparation", () => {
	const base = {
		WONDERBOT_DISCORD_TOKEN: "jeton",
		WONDERBOT_APPLICATION_ID: "1544463751279812740",
		HOME: "/home/test",
	};

	it("active la réparation et le rafraîchissement de démarrage par défaut", () => {
		const c = lireConfig(base);
		expect(c.rafraichirAuDemarrage).toBe(true);
		expect(c.tentativesReparation).toBe(2);
		expect(c.delaiReparationMs).toBe(900_000);
	});

	it("laisse désactiver chacun des deux", () => {
		const c = lireConfig({ ...base, WONDERBOT_REFRESH_ON_START: "0", WONDERBOT_AUTOFIX_ATTEMPTS: "0" });
		expect(c.rafraichirAuDemarrage).toBe(false);
		expect(c.tentativesReparation).toBe(0);
	});

	it("plancher le délai de réparation à une minute", () => {
		expect(lireConfig({ ...base, WONDERBOT_AUTOFIX_DELAY_MS: "1000" }).delaiReparationMs).toBe(60_000);
	});
});

describe("estLisibleEnLigne", () => {
	it("reconnaît les plateformes dont Discord rend un lecteur", () => {
		expect(estLisibleEnLigne("https://www.youtube.com/watch?v=xbpo3u3P9dc")).toBe(true);
		expect(estLisibleEnLigne("https://youtu.be/xbpo3u3P9dc")).toBe(true);
	});

	it("refuse une page de site, même si elle contient une vidéo", () => {
		expect(estLisibleEnLigne("https://inazuma-eleven.fr/tv/watch/saison1/ep-1?lang=fr")).toBe(false);
	});

	it("teste l'hôte, pas la chaîne — un chemin trompeur ne passe pas", () => {
		expect(estLisibleEnLigne("https://exemple.test/youtube.com/watch?v=x")).toBe(false);
		expect(estLisibleEnLigne("pas une url")).toBe(false);
	});
});

describe("/episodes episode — lecteur", () => {
	it("pose l'URL YouTube en contenu, seul moyen d'obtenir un lecteur", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "yt1", season: 1, episode: 3, url: "https://www.youtube.com/watch?v=yt1" }),
		]);
		const reponse = await executerIetv(
			"episode",
			optionsDepuisObjet({ saison: 1, numero: 3 }),
			contexte(catalogue)
		);
		expect(reponse.contenu).toBe("https://www.youtube.com/watch?v=yt1");
	});

	it("ne pose aucun contenu quand aucune version n'est lisible en ligne", async () => {
		const { catalogue } = catalogueAvec([
			episode({ videoId: "off-1", season: 1, episode: 3, url: "https://inazuma-eleven.fr/tv/x" }),
		]);
		const reponse = await executerIetv(
			"episode",
			optionsDepuisObjet({ saison: 1, numero: 3 }),
			contexte(catalogue)
		);
		expect(reponse.contenu).toBeUndefined();
	});
});
