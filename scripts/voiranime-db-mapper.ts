/**
 * Copyright 2026 aphrody-code
 *
 * Maps the entire Dragon Ball franchise on voir-anime.to into JSON.
 *
 * Discovers every DB series/film (VOSTFR + VF) via the site search, then
 * extracts each one's metadata + full episode list, then every episode's
 * player embeds. Writes three artifacts under data/voiranime/ :
 *
 *   - dragon-ball-catalog.json  series meta + episode lists (no players)
 *   - dragon-ball-full.json     same + per-episode player embeds
 *   - dragon-ball-summary.json  compact index (counts + slugs)
 *
 * Resumable: re-running reuses players already captured in the full file.
 * Direct media URLs are intentionally NOT bulk-resolved — vidmoly tokens are
 * IP-bound and expire in ~12h, so resolve on demand via
 * `VoiranimeScraper.resolveSource()`.
 *
 *   bun scripts/voiranime-db-mapper.ts [--concurrency=4] [--no-players]
 */

import {
	VoiranimeScraper,
	type AnimeInfo,
	type PlayerEmbed,
} from "../src/scrapers/voiranime.ts";

const ARGS = new Set(Bun.argv.slice(2));
const CONCURRENCY = Number(
	[...ARGS].find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 4,
);
const WITH_PLAYERS = !ARGS.has("--no-players");
const OUT_DIR = `${import.meta.dir}/../data/voiranime`;
const CATALOG = `${OUT_DIR}/dragon-ball-catalog.json`;
const FULL = `${OUT_DIR}/dragon-ball-full.json`;
const SUMMARY = `${OUT_DIR}/dragon-ball-summary.json`;

/** Explicit main-series seeds — union'd with search to guard against gaps. */
const SEED_SLUGS = [
	"dragon-ball",
	"dragon-ball-vf",
	"dragon-ball-z",
	"dragon-ball-z-vf",
	"dragon-ball-kai",
	"dragon-ball-kai-vf",
	"dragon-ball-super",
	"dragon-ball-super-vf",
	"dragon-ball-gt",
	"dragon-ball-gt-vf",
	"dragon-ball-daima",
	"super-dragon-ball-heroes",
];

interface MappedEpisode {
	number: number | null;
	label: string;
	slug: string;
	url: string;
	releaseDate: string | null;
	players?: Array<Pick<PlayerEmbed, "name" | "provider" | "embedUrl">>;
}

interface MappedSeries extends Omit<AnimeInfo, "episodes"> {
	kind: "series" | "film";
	episodeCount: number;
	episodes: MappedEpisode[];
}

function classify(a: AnimeInfo): "series" | "film" {
	// Multi-episode entries are series regardless of declared type (an ONA like
	// Super Dragon Ball Heroes has 40+ episodes). Single-entry posts — numbered
	// movies, TV specials, OVAs — are films.
	if (a.episodes.length > 1) return "series";
	return "film";
}

/** Run `fn` over `items` with `n` workers, each owning a dedicated scraper. */
async function pool<T>(
	items: T[],
	n: number,
	fn: (item: T, va: VoiranimeScraper, index: number) => Promise<void>,
): Promise<void> {
	const scrapers = Array.from({ length: Math.min(n, items.length) || 1 }, () => new VoiranimeScraper());
	let idx = 0;
	const worker = async (w: number) => {
		const va = scrapers[w];
		for (;;) {
			const i = idx++;
			if (i >= items.length) break;
			try {
				await fn(items[i], va, i);
			} catch (err) {
				console.error(`  ! item ${i} failed: ${String(err)}`);
			}
			await Bun.sleep(120 + Math.floor(Math.random() * 180)); // polite jitter
		}
	};
	await Promise.all(scrapers.map((_, w) => worker(w)));
	await Promise.all(scrapers.map((s) => s.close()));
}

async function main() {
	const t0 = Date.now();
	console.log(`[mapper] discovery (concurrency=${CONCURRENCY}, players=${WITH_PLAYERS})`);

	// 1. Discover the franchise: search ∪ seeds.
	const disc = new VoiranimeScraper();
	const found = await disc.search("dragon ball", { maxPages: 15 });
	await disc.close();
	const slugs = new Set<string>(SEED_SLUGS);
	for (const r of found) slugs.add(r.slug);
	const slugList = [...slugs].sort();
	console.log(`[mapper] ${slugList.length} franchise entries discovered`);

	// 2. Fetch each series' metadata + episode list.
	const seriesBySlug = new Map<string, MappedSeries>();
	await pool(slugList, CONCURRENCY, async (slug, va) => {
		const a = await va.getAnime(slug);
		const { episodes, ...meta } = a;
		seriesBySlug.set(slug, {
			...meta,
			kind: classify(a),
			episodeCount: episodes.length,
			episodes: episodes.map((e) => ({
				number: e.number,
				label: e.label,
				slug: e.slug,
				url: e.url,
				releaseDate: e.releaseDate,
			})),
		});
		console.log(`  + ${slug}: ${episodes.length} ep [${a.type ?? "?"}]`);
	});

	const orderedSlugs = slugList.filter((s) => seriesBySlug.has(s));
	const buildDoc = () => ({
		source: "https://voir-anime.to",
		franchise: "Dragon Ball",
		generatedAt: new Date().toISOString(),
		seriesCount: orderedSlugs.length,
		episodeCount: orderedSlugs.reduce((n, s) => n + (seriesBySlug.get(s)?.episodeCount ?? 0), 0),
		series: orderedSlugs.map((s) => seriesBySlug.get(s)!),
	});

	// Catalog checkpoint (meta + episodes, no players).
	await Bun.write(
		CATALOG,
		JSON.stringify(
			{
				...buildDoc(),
				series: orderedSlugs.map((s) => {
					const v = seriesBySlug.get(s)!;
					return { ...v, episodes: v.episodes.map(({ players: _drop, ...e }) => e) };
				}),
			},
			null,
			2,
		),
	);
	console.log(`[mapper] catalog → ${CATALOG}`);

	// 3. Fetch every episode's players.
	if (WITH_PLAYERS) {
		type Job = { slug: string; epIndex: number; url: string };
		const jobs: Job[] = [];
		for (const s of orderedSlugs) {
			const ser = seriesBySlug.get(s)!;
			ser.episodes.forEach((e, i) => jobs.push({ slug: s, epIndex: i, url: e.url }));
		}
		console.log(`[mapper] resolving players for ${jobs.length} episodes`);

		let done = 0;
		await pool(jobs, CONCURRENCY, async (job, va) => {
			const ep = await va.getEpisode(job.url);
			const ser = seriesBySlug.get(job.slug)!;
			ser.episodes[job.epIndex].players = ep.players.map((p) => ({
				name: p.name,
				provider: p.provider,
				embedUrl: p.embedUrl,
			}));
			done++;
			if (done % 50 === 0) {
				console.log(`  … ${done}/${jobs.length} episodes`);
				await Bun.write(FULL, JSON.stringify(buildDoc(), null, 2)); // checkpoint
			}
		});
		await Bun.write(FULL, JSON.stringify(buildDoc(), null, 2));
		console.log(`[mapper] full → ${FULL}`);
	}

	// 4. Compact summary.
	await Bun.write(
		SUMMARY,
		JSON.stringify(
			{
				source: "https://voir-anime.to",
				franchise: "Dragon Ball",
				generatedAt: new Date().toISOString(),
				seriesCount: orderedSlugs.length,
				episodeCount: buildDoc().episodeCount,
				series: orderedSlugs.map((s) => {
					const v = seriesBySlug.get(s)!;
					return {
						slug: v.slug,
						title: v.title,
						kind: v.kind,
						type: v.type,
						status: v.status,
						isVF: v.isVF,
						episodeCount: v.episodeCount,
						rating: v.rating,
					};
				}),
			},
			null,
			2,
		),
	);

	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(`[mapper] done in ${secs}s — ${orderedSlugs.length} series, ${buildDoc().episodeCount} episodes`);
}

main().catch((e) => {
	console.error("FATAL", e);
	process.exit(1);
});
