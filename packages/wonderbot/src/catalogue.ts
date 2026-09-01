/**
 * Catalogue — la seule porte d'entrée du bot sur les données.
 *
 * Les commandes ne lisent JAMAIS le scraper : elles lisent le cache SQLite,
 * qu'un rafraîchissement périodique alimente. Une commande répond donc en
 * millisecondes et ne dépend ni de YouTube ni du réseau ; c'est aussi ce qui
 * évite qu'un serveur de deux mille membres déclenche deux mille scrapings.
 *
 * Les dépendances lourdes (base, scraper) sont INJECTABLES : c'est ce qui rend
 * l'ensemble testable sans SQLite, sans réseau et sans navigateur.
 */

import type { ChannelInfo } from "@aphrody/ietv";
import { IETVCache, type CacheStats, type CachedVideoRef } from "@aphrody/ietv/cache";

import { trierEpisodes, type EpisodeCatalogue } from "./ui/format.ts";

/** Ce que le catalogue attend d'un cache — le sous-ensemble qu'il utilise. */
export interface CacheLike {
	search(query: {
		q?: string;
		season?: number;
		episode?: number;
		language?: "vf" | "vostfr";
		channel?: string;
		limit?: number;
	}): CachedVideoRef[];
	getAllChannels(): ChannelInfo[];
	getStats(): CacheStats;
	getMetadata(key: string): string | null;
	setMetadata(key: string, value: string, ttlMs?: number): void;
	saveChannel(info: ChannelInfo): void;
	clear(): void;
	clearExpired(): void;
	close(): void;
}

/** Ce que le catalogue attend d'un scraper. */
export interface ScraperLike {
	getAllChannelEpisodes(): Promise<ChannelInfo[]>;
	close(): Promise<void>;
}

export interface OptionsCatalogue {
	/** Ouvre la base. Appelé paresseusement, jamais à l'import. */
	ouvrirCache: () => CacheLike;
	/** Crée un scraper pour un rafraîchissement, puis le referme. */
	creerScraper: () => ScraperLike | Promise<ScraperLike>;
	now?: () => number;
}

export interface FiltresRecherche {
	texte?: string;
	saison?: number;
	episode?: number;
	langue?: "vf" | "vostfr";
	limite?: number;
}

export interface ResumeCatalogue {
	stats: CacheStats;
	/** Sources agrégées, de la plus fournie à la moins fournie. */
	sources: { nom: string; titre: string | null; episodes: number }[];
	/** Dernier rafraîchissement réussi, en millisecondes epoch (0 = jamais). */
	dernierRafraichissement: number;
}

export interface ResultatRafraichissement {
	stats: CacheStats;
	/** Épisodes absents du catalogue avant ce passage. */
	nouveaux: EpisodeCatalogue[];
	sources: number;
	dureeMs: number;
}

/** Clé de métadonnée portant l'horodatage du dernier rafraîchissement réussi. */
export const CLE_DERNIER_RAFRAICHISSEMENT = "wonderbot:dernier-rafraichissement";

/**
 * Plafond de lecture pour les balayages complets. Le catalogue tient dans
 * ~1 200 épisodes ; la borne est là pour qu'une base anormalement grosse ne
 * fasse pas exploser la mémoire du bot, pas pour tronquer un cas nominal.
 */
const PLAFOND_BALAYAGE = 20_000;

export class Catalogue {
	private readonly options: Required<OptionsCatalogue>;
	private cache: CacheLike | null = null;
	/** Un seul rafraîchissement à la fois : ils écrivent la même base. */
	private rafraichissementEnCours: Promise<ResultatRafraichissement> | null = null;

	constructor(options: OptionsCatalogue) {
		this.options = { now: Date.now, ...options };
	}

	/** Ouvre la base au premier besoin et la garde ouverte. */
	private ouvrir(): CacheLike {
		this.cache ??= this.options.ouvrirCache();
		return this.cache;
	}

	/** Recherche libre, filtrée, triée pour l'affichage. */
	rechercher(filtres: FiltresRecherche): EpisodeCatalogue[] {
		const resultats = this.ouvrir().search({
			...(filtres.texte ? { q: filtres.texte } : {}),
			...(filtres.saison !== undefined ? { season: filtres.saison } : {}),
			...(filtres.episode !== undefined ? { episode: filtres.episode } : {}),
			...(filtres.langue ? { language: filtres.langue } : {}),
			limit: filtres.limite ?? 25,
		});
		return trierEpisodes(resultats);
	}

	/**
	 * Toutes les versions d'un épisode donné. Il y en a plusieurs : le même
	 * épisode existe en VF et en VOSTFR, et souvent sur plusieurs chaînes.
	 */
	episode(saison: number, numero: number, langue?: "vf" | "vostfr"): EpisodeCatalogue[] {
		return this.rechercher({ saison, episode: numero, ...(langue ? { langue } : {}), limite: 25 });
	}

	/** Une saison entière, dans l'ordre des épisodes. */
	saison(numero: number, langue?: "vf" | "vostfr", limite = 50): EpisodeCatalogue[] {
		return this.rechercher({ saison: numero, ...(langue ? { langue } : {}), limite });
	}

	/** Saisons présentes dans le catalogue, croissantes. */
	saisonsDisponibles(): number[] {
		const saisons = new Set<number>();
		for (const chaine of this.ouvrir().getAllChannels()) {
			for (const saison of chaine.seasons) saisons.add(saison.season);
		}
		return [...saisons].sort((a, b) => a - b);
	}

	/** Compteurs, sources et fraîcheur — ce que sert `/episodes catalogue`. */
	resume(): ResumeCatalogue {
		const cache = this.ouvrir();
		const sources = cache
			.getAllChannels()
			.map((chaine) => ({
				nom: chaine.channel,
				titre: chaine.title,
				episodes: chaine.totalEpisodes,
			}))
			.sort((a, b) => b.episodes - a.episodes);

		const marque = Number.parseInt(cache.getMetadata(CLE_DERNIER_RAFRAICHISSEMENT) ?? "", 10);

		return {
			stats: cache.getStats(),
			sources,
			dernierRafraichissement: Number.isFinite(marque) ? marque : 0,
		};
	}

	/** Identifiants de tous les épisodes connus, pour la détection du neuf. */
	identifiants(): Set<string> {
		return new Set(this.ouvrir().search({ limit: PLAFOND_BALAYAGE }).map((ep) => ep.videoId));
	}

	/**
	 * Rescrape toutes les sources et remplace le catalogue.
	 *
	 * L'ordre est délibéré : on scrape D'ABORD, on remplace ENSUITE. Vider la
	 * base avant de scraper — ce que faisait la première version — laisse un
	 * catalogue vide si le scraping échoue, et le bot répond « aucun épisode »
	 * jusqu'au prochain passage.
	 *
	 * Deux appels concurrents partagent la même exécution : le planificateur et
	 * `/episodes rafraichir` écrivent la même base.
	 */
	rafraichir(): Promise<ResultatRafraichissement> {
		this.rafraichissementEnCours ??= this.executerRafraichissement().finally(() => {
			this.rafraichissementEnCours = null;
		});
		return this.rafraichissementEnCours;
	}

	private async executerRafraichissement(): Promise<ResultatRafraichissement> {
		const debut = this.options.now();
		const cache = this.ouvrir();
		const avant = this.identifiants();

		const scraper = await this.options.creerScraper();
		let chaines: ChannelInfo[];
		try {
			chaines = await scraper.getAllChannelEpisodes();
		} finally {
			await scraper.close();
		}

		if (chaines.length === 0) {
			throw new Error(
				"[wonderbot] Le scraping n'a rendu aucune source : catalogue conservé en l'état. " +
					"Vérifier l'accès réseau et `bxc ietv all` en ligne de commande."
			);
		}

		cache.clear();
		for (const chaine of chaines) cache.saveChannel(chaine);
		cache.clearExpired();

		const apres = cache.search({ limit: PLAFOND_BALAYAGE });
		const nouveaux = trierEpisodes(apres.filter((episode) => !avant.has(episode.videoId)));

		const fin = this.options.now();
		cache.setMetadata(CLE_DERNIER_RAFRAICHISSEMENT, String(fin));

		return { stats: cache.getStats(), nouveaux, sources: chaines.length, dureeMs: fin - debut };
	}

	/** Métadonnée arbitraire — utilisée par le journal d'annonces. */
	lireMeta(cle: string): string | null {
		return this.ouvrir().getMetadata(cle);
	}

	ecrireMeta(cle: string, valeur: string): void {
		this.ouvrir().setMetadata(cle, valeur);
	}

	fermer(): void {
		this.cache?.close();
		this.cache = null;
	}
}

/**
 * Catalogue branché sur les vraies implémentations.
 *
 * `IETVCache` est importé statiquement — il ne tire que `bun:sqlite` et `fs`.
 * Le SCRAPER, lui, est chargé à la demande : il tire tout `@aphrody/bxc` et son
 * navigateur, dont un processus qui se contente de lire le catalogue n'a que
 * faire. Un bot qui répond à des commandes ne l'importe jamais.
 */
export function catalogueReel(cheminCache: string, now?: () => number): Catalogue {
	return new Catalogue({
		ouvrirCache: () => new IETVCache(cheminCache) as unknown as CacheLike,
		creerScraper: async () => {
			const { default: IETVScraper } = await import("@aphrody/ietv");
			return new IETVScraper() as unknown as ScraperLike;
		},
		...(now ? { now } : {}),
	});
}
