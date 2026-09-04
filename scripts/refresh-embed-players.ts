/**
 * refresh-embed-players.ts — Re-scrape en LIVE (pas depuis le dataset JSON
 * figé) la liste des lecteurs (players) d'un épisode ou d'un film voir-anime,
 * pour le watcher shenron `refresh-dead-embed-players.ts`.
 *
 * Contrairement à `voiranime-db-mapper.ts` (dump complet, figé une fois
 * scrapé), ce script fait toujours un `getAnime()` + `getEpisode()` frais au
 * moment de l'appel : voir-anime.to peut avoir mis à jour un embed hébergeur
 * mort depuis le dernier dump — un mapper qui tourne une fois par semaine ne
 * le verrait pas avant longtemps.
 *
 * N'effectue AUCUN test de vivacité (juste le scrape) — c'est le script
 * appelant (shenron, plain fetch, pas de navigateur) qui teste les candidats.
 *
 * Sortie : JSON sur stdout (dernière ligne) → Player[] ou { error }.
 * Usage :
 *   bun scripts/refresh-embed-players.ts episode <SERIES> <NUMBER>
 *   bun scripts/refresh-embed-players.ts movie <MOVIE_ID>
 *   SERIES ∈ DB | DBZ | DBGT | DBS | DB_DAIMA
 */
import { VoiranimeScraper } from "@aphrody/bxc/scrapers/voiranime";

type Player = { name: string; provider: string; embedUrl: string; lang?: "vf" | "vostfr" };

/**
 * Une série a DEUX pages sur voir-anime — la VOSTFR et la VF — sous deux slugs
 * distincts, et elles ne portent pas les mêmes hébergeurs. Ne scraper que la
 * première, ce que faisait ce script, rendait un lecteur VF mort
 * irremplaçable : le repêchage ne pouvait proposer que des candidats VOSTFR,
 * que la déduplication écartait ensuite. Mesuré le 2026-09-02 : `dragon-ball-z-vf`
 * porte 7 lecteurs par épisode, dont aucun n'était jamais consulté.
 *
 * `decalage` : notre base coupe Kai en deux séries (97 puis 70 épisodes) là où
 * la source les numérote d'une traite jusqu'à 167.
 */
const SERIES_SLUG: Record<string, { vostfr: string | null; vf: string | null; decalage?: number }> = {
	DB: { vostfr: "dragon-ball", vf: "dragon-ball-vf" },
	DBZ: { vostfr: "dragon-ball-z", vf: "dragon-ball-z-vf" },
	DBGT: { vostfr: "dragon-ball-gt", vf: "dragon-ball-gt-vf" },
	DBS: { vostfr: "dragon-ball-super", vf: "dragon-ball-super-vf" },
	// Daima n'a pas de page VF sur la source (vérifié dans le catalogue).
	DB_DAIMA: { vostfr: "dragon-ball-daima", vf: null },
	DBZ_KAI: { vostfr: "dragon-ball-kai", vf: "dragon-ball-kai-vf" },
	DBZ_KAI_FINAL: { vostfr: "dragon-ball-kai", vf: "dragon-ball-kai-vf", decalage: 97 },
};

// Identique à apps/bot/scripts/import-voiranime-movies-players.ts (shenron) —
// dupliqué ici volontairement : ce script tourne dans le repo bxc, l'autre
// dans shenron, pas de package partagé entre les deux.
const MOVIE_MAP: Record<number, { vostfr: string | null; vf: string | null }> = {
	12: { vostfr: "dragon-ball-super-broly", vf: "dragon-ball-super-broly-vf" },
	13: { vostfr: "dragon-ball-z-movie-kami-to-kami", vf: "dragon-ball-z-movie-14-kami-to-kami-vf" },
	14: {
		vostfr: "dragon-ball-z-movie-fukkatsu-no-f",
		vf: "dragon-ball-z-movie-15-fukkatsu-no-f-vf",
	},
	15: {
		vostfr: "dragon-ball-movie-1-shen-long-no-densetsu",
		vf: "dragon-ball-movie-1-shen-long-no-densetsu-vf",
	},
	16: {
		vostfr: "dragon-ball-film-02-majinjou-no-nemuri-hime",
		vf: "dragon-ball-film-02-majinjou-no-nemuri-hime-vf",
	},
	17: {
		vostfr: "dragon-ball-movie-3-makafushigi-daibouken",
		vf: "dragon-ball-movie-3-makafushigi-daibouken-vf",
	},
	18: {
		vostfr: "dragon-ball-movie-4-saikyou-e-no-michi",
		vf: "dragon-ball-movie-4-saikyou-e-no-michi-vf",
	},
	19: {
		vostfr: "dragon-ball-z-movie-ora-no-gohan-wo-kaese",
		vf: "dragon-ball-z-movie-01-ora-no-gohan-wo-kaese-vf",
	},
	20: {
		vostfr: "dragon-ball-z-movie-konoyo-de-ichiban-tsuyoi-yatsu",
		vf: "dragon-ball-z-movie-02-konoyo-de-ichiban-tsuyoi-yatsu-vf",
	},
	21: {
		vostfr: "dragon-ball-z-movie-chikyuu-marugoto-chou-kessen",
		vf: "dragon-ball-z-movie-03-chikyuu-marugoto-chou-kessen-vf",
	},
	22: {
		vostfr: "dragon-ball-z-movie-super-saiyajin-da-son-goku",
		vf: "dragon-ball-z-movie-04-super-saiyajin-da-son-goku-vf",
	},
	23: {
		vostfr: "dragon-ball-z-movie-tobikkiri-no-saikyou-tai-saikyou",
		vf: "dragon-ball-z-movie-05-tobikkiri-no-saikyou-tai-saikyou-vf",
	},
	24: {
		vostfr: "dragon-ball-z-movie-gekitotsu-100-oku-power-no-senshi-tachi",
		vf: "dragon-ball-z-movie-06-gekitotsu-100-oku-power-no-senshi-tachi-vf",
	},
	25: {
		vostfr: "dragon-ball-z-movie-kyokugen-battle-sandai-super-saiyajin",
		vf: "dragon-ball-z-movie-07-kyokugen-battle-sandai-super-saiyajin-vf",
	},
	26: {
		vostfr: "dragon-ball-z-movie-moetsukiro-nessen-ressen-chou-gekisen",
		vf: "dragon-ball-z-movie-08-moetsukiro-nessen-ressen-chou-gekisen-vf",
	},
	27: {
		vostfr: "dragon-ball-z-movie-ginga-girigiri-bucchigiri-no-sugoi-yatsu",
		vf: "dragon-ball-z-movie-09-ginga-girigiri-bucchigiri-no-sugoi-yatsu-vf",
	},
	28: {
		vostfr: "dragon-ball-z-kiken-na-futari-super-senshi-wa-nemurenai",
		vf: "dragon-ball-z-movie-10-kiken-na-futari-super-senshi-wa-nemurenai-vf",
	},
	29: {
		vostfr: "dragon-ball-z-movie-super-senshi-gekiha-katsu-no-wa-ore-da",
		vf: "dragon-ball-z-movie-11-super-senshi-gekiha-katsu-no-wa-ore-da-vf",
	},
	30: {
		vostfr: "dragon-ball-z-movie-fukkatsu-no-fusion-goku-to-vegeta",
		vf: "dragon-ball-z-movie-12-fukkatsu-no-fusion-goku-to-vegeta-vf",
	},
	31: {
		vostfr: "dragon-ball-z-movie-ryuuken-bakuhatsu-goku-ga-yaraneba-dare-ga-yaru",
		vf: "dragon-ball-z-movie-13-ryuuken-bakuhatsu-goku-ga-yaraneba-dare-ga-yaru-vf",
	},
	35: { vostfr: "dragon-ball-episode-of-bardock", vf: null },
	36: { vostfr: "dragon-ball-super-super-hero", vf: null },
};

function fail(msg: string): never {
	console.log(JSON.stringify({ error: msg }));
	process.exit(0);
}

const [mode, a1, a2] = Bun.argv.slice(2);

const va = new VoiranimeScraper();
try {
	let players: Player[] = [];

	if (mode === "episode") {
		const serie = SERIES_SLUG[a1 ?? ""];
		const number = Number(a2);
		if (!serie || !Number.isFinite(number)) fail("usage: episode <SERIES> <NUMBER>");
		const numeroSource = number + (serie.decalage ?? 0);
		for (const [lang, slug] of [
			["vostfr", serie.vostfr],
			["vf", serie.vf],
		] as const) {
			if (!slug) continue;
			try {
				console.error(`[REFRESH] getAnime(${slug}) [${lang}] — épisode #${numeroSource}...`);
				const anime = await va.getAnime(slug);
				const ep = anime.episodes.find((e) => e.number === numeroSource);
				if (!ep) {
					console.error(`[REFRESH] épisode ${numeroSource} absent de ${slug}`);
					continue;
				}
				const info = await va.getEpisode(ep.url);
				for (const p of info.players)
					players.push({
						name: `${lang === "vf" ? "VF" : "VOSTFR"} · ${p.name}`,
						provider: p.provider,
						embedUrl: p.embedUrl,
						lang,
					});
			} catch (err) {
				console.error(`[REFRESH] échec ${lang} (${slug}) : ${String(err)}`);
			}
		}
		if (players.length === 0) fail(`aucun lecteur trouvé : ${a1} ${number}`);
	} else if (mode === "movie") {
		const id = Number(a1);
		const slugs = MOVIE_MAP[id];
		if (!Number.isFinite(id) || !slugs) fail(`usage: movie <MOVIE_ID> (id inconnu : ${a1})`);
		for (const [lang, slug] of [
			["vostfr", slugs.vostfr],
			["vf", slugs.vf],
		] as const) {
			if (!slug) continue;
			try {
				console.error(`[REFRESH] getAnime(${slug}) [${lang}]...`);
				const anime = await va.getAnime(slug);
				const filmEp = anime.episodes[0];
				if (!filmEp) continue;
				const info = await va.getEpisode(filmEp.url);
				for (const p of info.players) {
					players.push({
						name: `${lang === "vf" ? "VF" : "VOSTFR"} · ${p.name}`,
						provider: p.provider,
						embedUrl: p.embedUrl,
						lang,
					});
				}
			} catch (err) {
				console.error(`[REFRESH] échec ${lang} (${slug}) : ${String(err)}`);
			}
		}
	} else {
		fail("usage: episode <SERIES> <NUMBER> | movie <MOVIE_ID>");
	}

	console.error(`[REFRESH] ${players.length} lecteur(s) fraîchement scrapé(s).`);
	console.log(JSON.stringify(players));
} catch (err) {
	console.log(JSON.stringify({ error: String(err).slice(0, 300) }));
} finally {
	await va.close();
}
