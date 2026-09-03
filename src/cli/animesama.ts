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
 * `bxc animesama <action> <arg>` — scraper anime-sama.to
 */

import {
	AnimesamaScraper,
	LANGUES_ANIMESAMA,
	estLangue,
	type LangueAnimesama,
} from "@aphrody/animesama";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "search" | "info" | "seasons" | "episodes" | "resolve";
	param: string;
	profile: "static" | "fast" | "http" | "stealth" | "max";
	saison: string;
	langue: LangueAnimesama;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc animesama — anime-sama.to catalogue & player scraper

Usage:
  bxc animesama search <query>        Recherche instantanée (POST fetch.php)
  bxc animesama info <slug-or-url>    Fiche d'une œuvre + saisons déclarées
  bxc animesama seasons <slug>        Saisons + langues réellement publiées
  bxc animesama episodes <slug>       Épisodes d'une saison (--season/--lang)
  bxc animesama resolve <embed-url>   Résout un embed vers son flux direct

Options:
  --season <dir>       dossier de saison (défaut saison1 ; ex. film, oav)
  --lang <code>        ${LANGUES_ANIMESAMA.join(" | ")} (défaut vostfr)
  --profile <name>     static (défaut) | fast | http | stealth | max
  --help, -h           cette aide

Exemples:
  bxc animesama search inazuma
  bxc animesama info inazuma-eleven
  bxc animesama episodes inazuma-eleven --season saison1 --lang vf

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		action: "search",
		param: "",
		profile: "static",
		saison: "saison1",
		langue: "vostfr",
	};

	const actionStr = argv[0];
	if (!actionStr || actionStr === "--help" || actionStr === "-h") return null;
	if (
		actionStr === "search" ||
		actionStr === "info" ||
		actionStr === "seasons" ||
		actionStr === "episodes" ||
		actionStr === "resolve"
	) {
		opts.action = actionStr;
	} else {
		logger.error(`Unknown action: ${actionStr}`);
		return null;
	}

	const positional: string[] = [];
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i];
				if (
					v !== "static" &&
					v !== "fast" &&
					v !== "http" &&
					v !== "stealth" &&
					v !== "max"
				) {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--season": {
				const v = argv[++i];
				if (!v) {
					logger.error("--season requires a value");
					return null;
				}
				opts.saison = v.replace(/^\/+|\/+$/g, "");
				break;
			}
			case "--lang": {
				const v = (argv[++i] ?? "").toLowerCase();
				if (!estLangue(v)) {
					logger.error(
						`Invalid lang: ${v} (attendu : ${LANGUES_ANIMESAMA.join(", ")})`,
					);
					return null;
				}
				opts.langue = v;
				break;
			}
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (positional.length < 1) {
		logger.error("requires query/slug/URL argument");
		return null;
	}
	opts.param = positional.join(" ");
	return opts;
}

/** Dernier segment de slug, pour accepter aussi une URL de fiche. */
function slugDepuis(param: string): string {
	if (!/^https?:\/\//i.test(param)) return param.replace(/^\/+|\/+$/g, "");
	const m = /\/catalogue\/([^/?#]+)/.exec(param);
	return m ? m[1] : param;
}

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const scraper = new AnimesamaScraper({
		profile: opts.profile,
		timeoutMs: opts.timeoutMs,
	});

	try {
		if (opts.action === "search") {
			const resultats = await scraper.rechercher(opts.param);
			Bun.stdout.write(JSON.stringify(resultats, null, 2) + "\n");
		} else if (opts.action === "info") {
			const fiche = await scraper.getAnime(opts.param);
			Bun.stdout.write(JSON.stringify(fiche, null, 2) + "\n");
		} else if (opts.action === "seasons") {
			const slug = slugDepuis(opts.param);
			const fiche = await scraper.getAnime(slug);
			// Les drapeaux imprimés ne disent rien : on sonde chaque dossier.
			const dossiers = [...new Set(fiche.saisons.map((s) => s.saison))];
			const saisons = [];
			for (const dossier of dossiers) {
				saisons.push({
					saison: dossier,
					noms: fiche.saisons
						.filter((s) => s.saison === dossier)
						.map((s) => s.nom),
					langues: await scraper.listerLangues(slug, dossier),
				});
			}
			Bun.stdout.write(
				JSON.stringify({ slug, titre: fiche.titre, saisons }, null, 2) + "\n",
			);
		} else if (opts.action === "episodes") {
			const saison = await scraper.getSaison(
				slugDepuis(opts.param),
				opts.saison,
				opts.langue,
			);
			Bun.stdout.write(JSON.stringify(saison, null, 2) + "\n");
		} else {
			const source = await scraper.resoudreLecteur(opts.param, {
				enumererQualites: true,
			});
			Bun.stdout.write(JSON.stringify(source, null, 2) + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		await scraper.close().catch(() => {});
	}
}
