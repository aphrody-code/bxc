/**
 * resolve-episode.ts — Résout un épisode Dragon Ball (voir-anime) en source
 * lisible (HLS .m3u8 / mp4) + headers requis, pour le proxy HLS du bot Shenron.
 *
 * Lit l'URL d'épisode exacte depuis data/voiranime/dragon-ball-full.json
 * (apparié par série + numéro), récupère les lecteurs FRAIS (getEpisode), puis
 * tente resolveSource sur chaque lecteur jusqu'à obtenir un flux hls/mp4.
 *
 * Sortie : JSON sur stdout → { type, url, headers, provider } ou { error }.
 * Usage : bun scripts/resolve-episode.ts <SERIES> <NUMBER>
 *   SERIES ∈ DB | DBZ | DBGT | DBS | DB_DAIMA
 */
import { VoiranimeScraper } from "../src/scrapers/voiranime.ts";

const SERIES_SLUG: Record<string, string> = {
	DB: "dragon-ball",
	DBZ: "dragon-ball-z",
	DBGT: "dragon-ball-gt",
	DBS: "dragon-ball-super",
	DB_DAIMA: "dragon-ball-daima",
};

const FULL = `${import.meta.dir}/../data/voiranime/dragon-ball-full.json`;

const [series, numRaw] = Bun.argv.slice(2);
const number = Number(numRaw);
const slug = SERIES_SLUG[series ?? ""];
if (!slug || !Number.isFinite(number)) {
	console.log(JSON.stringify({ error: "usage: <SERIES> <NUMBER>" }));
	process.exit(0);
}

const doc = (await Bun.file(FULL).json()) as {
	series: {
		slug: string;
		episodes: { number: number | null; url: string }[];
	}[];
};
const ser = doc.series.find((s) => s.slug === slug);
const ep = ser?.episodes.find((e) => e.number === number);
if (!ep) {
	console.log(
		JSON.stringify({ error: `episode introuvable: ${series} ${number}` }),
	);
	process.exit(0);
}

const va = new VoiranimeScraper();
try {
	const info = await va.getEpisode(ep.url);
	const candidates: Array<{
		type: "hls" | "mp4";
		url: string;
		headers: Record<string, string>;
		provider: string;
	}> = [];

	for (const p of info.players) {
		console.error(
			`[RESOLVER] Scrape/Test du lecteur : ${p.name} (${p.provider})...`,
		);
		try {
			const s = await va.resolveSource(p);
			if ((s.type === "hls" || s.type === "mp4") && s.url) {
				// Test the stream URL by fetching the first few bytes
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 5000);
				let testOk = false;
				let testStatus = 0;
				try {
					const testHeaders: Record<string, string> = {
						Range: "bytes=0-1024",
						...(s.headers ?? {}),
					};
					const testRes = await fetch(s.url, {
						headers: testHeaders,
						signal: controller.signal,
					});
					testOk = testRes.ok;
					testStatus = testRes.status;
				} catch (err) {
					console.error(`[RESOLVER] Erreur fetch pour ${p.name} :`, err);
				} finally {
					clearTimeout(timeoutId);
				}

				if (testOk) {
					console.error(
						`[RESOLVER] Lecteur ${p.name} (${p.provider}) : VALIDE (${s.type}, HTTP ${testStatus})`,
					);
					candidates.push({
						type: s.type,
						url: s.url,
						headers: s.headers ?? {},
						provider: p.provider,
					});
				} else {
					console.error(
						`[RESOLVER] Lecteur ${p.name} (${p.provider}) : INVALIDE ou INJOIGNABLE (HTTP ${testStatus})`,
					);
				}
			} else {
				console.error(
					`[RESOLVER] Lecteur ${p.name} (${p.provider}) : ECHEC (Résolution: ${s.error ?? "format non supporté"})`,
				);
			}
		} catch (err) {
			console.error(
				`[RESOLVER] Lecteur ${p.name} (${p.provider}) : ERREUR :`,
				err,
			);
		}
	}

	if (candidates.length > 0) {
		// Prefer HLS over MP4 if any exists
		const chosen = candidates.find((c) => c.type === "hls") ?? candidates[0];
		console.error(
			`[RESOLVER] Succès : lecteur retenu = ${chosen.provider} (${chosen.type})`,
		);
		console.log(JSON.stringify(chosen));
		process.exit(0);
	}
	console.log(
		JSON.stringify({ error: "aucun lecteur fonctionnel résolu en HLS/MP4" }),
	);
} catch (e) {
	console.log(JSON.stringify({ error: String(e).slice(0, 200) }));
} finally {
	await va.close();
}
