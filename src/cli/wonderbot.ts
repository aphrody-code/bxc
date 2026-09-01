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
 * `bxc wonderbot <action>` — Wonderbot, le bot Discord d'Inazuma Eleven TV.
 *
 * `doctor` et `refresh` ne se connectent pas à Discord : ils servent à vérifier
 * une installation et à amorcer le catalogue avant même que le bot ne démarre.
 */

import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "start" | "doctor" | "refresh" | "register";
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc wonderbot — Wonderbot, bot Discord d'Inazuma Eleven TV

Usage:
  bxc wonderbot start        Démarre le bot (passerelle + rafraîchissement périodique)
  bxc wonderbot doctor       Vérifie la configuration et le catalogue, sans se connecter
  bxc wonderbot refresh      Rafraîchit le catalogue IETV puis sort (sans Discord)
  bxc wonderbot register     Publie les slash commands puis sort

Options:
  --json               sortie JSON (doctor, refresh)
  --quiet, -q          silencieux
  --help, -h           cette aide

Environnement (le premier nom trouvé gagne) :
  WONDERBOT_DISCORD_TOKEN | DISCORD_BOT_TOKEN | DISCORD_TOKEN   jeton du bot
  WONDERBOT_APPLICATION_ID | DISCORD_APPLICATION_ID | DISCORD_CLIENT_ID
  WONDERBOT_GUILD_ID | DISCORD_GUILD_ID          guilde(s), vide = commandes globales
  WONDERBOT_COMMAND_SCOPE                        guildes | globale
  WONDERBOT_ANNOUNCE_CHANNEL_ID                  salon des nouveautés (sinon : pas d'annonce)
  WONDERBOT_ANNOUNCE_ROLE_ID                     rôle mentionné dans l'annonce
  WONDERBOT_STAFF_ROLE_IDS                       rôles autorisés à /ietv rafraichir
  WONDERBOT_REFRESH_INTERVAL_MS                  période (défaut 6 h, plancher 60 s)
  IETV_CACHE_PATH                                base SQLite du catalogue
`
	);
}

function parseArgs(argv: string[], base: CommonOptions): CliOptions {
	const opts: CliOptions = { ...base, action: "start" };
	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(EXIT.MISUSE);
		}
		if (arg.startsWith("-")) continue;
		if (
			arg === "start" ||
			arg === "doctor" ||
			arg === "refresh" ||
			arg === "register"
		) {
			opts.action = arg;
		}
	}
	return opts;
}

export async function main(argv: string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);

	const { lireConfig, resumerConfig, catalogueReel, Wonderbot } = await import("@aphrody/wonderbot");

	let config;
	try {
		config = lireConfig(Bun.env as Record<string, string | undefined>);
	} catch (err) {
		// Configuration incomplète : c'est une erreur d'installation, pas un bug.
		// `NOPERM` dit à systemd que réessayer ne servira à rien.
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.NOPERM);
	}

	switch (opts.action) {
		case "doctor": {
			const catalogue = catalogueReel(config.cheminCache);
			try {
				const resume = catalogue.resume();
				if (opts.json) {
					Bun.stdout.write(
						`${JSON.stringify(
							{
								applicationId: config.applicationId,
								portee: config.portee,
								guildes: config.guildes,
								cheminCache: config.cheminCache,
								salonAnnonces: config.salonAnnonces,
								intervalleRafraichissementMs: config.intervalleRafraichissementMs,
								catalogue: {
									episodes: resume.stats.episodes,
									saisons: resume.stats.seasons,
									sources: resume.stats.channels,
									parLangue: resume.stats.byLanguage,
									dernierRafraichissement: resume.dernierRafraichissement,
								},
							},
							null,
							2
						)}\n`
					);
				} else {
					logger.log(resumerConfig(config), opts);
					logger.log(
						`catalogue : ${resume.stats.episodes} épisode(s), ${resume.stats.seasons} saison(s), ` +
							`${resume.stats.channels} source(s)`,
						opts
					);
					if (resume.stats.episodes === 0) {
						logger.warn("catalogue vide — lancer `bxc wonderbot refresh`", opts);
					}
				}
			} finally {
				catalogue.fermer();
			}
			return;
		}

		case "refresh": {
			const catalogue = catalogueReel(config.cheminCache);
			try {
				const resultat = await catalogue.rafraichir();
				if (opts.json) {
					Bun.stdout.write(
						`${JSON.stringify(
							{
								episodes: resultat.stats.episodes,
								sources: resultat.sources,
								nouveaux: resultat.nouveaux.length,
								dureeMs: resultat.dureeMs,
							},
							null,
							2
						)}\n`
					);
				} else {
					logger.log(
						`catalogue rafraîchi : ${resultat.stats.episodes} épisode(s) sur ${resultat.sources} source(s) ` +
							`en ${(resultat.dureeMs / 1000).toFixed(1)} s — ${resultat.nouveaux.length} nouveauté(s)`,
						opts
					);
				}
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(EXIT.SOFTWARE);
			} finally {
				catalogue.fermer();
			}
			return;
		}

		case "register": {
			const bot = new Wonderbot({ config, journaliser: (m) => logger.log(m, opts) });
			// `publierCommandes` a besoin d'une application résolue : on se connecte,
			// on attend la publication, on repart. Aucune boucle de rafraîchissement.
			try {
				await bot.demarrer({ planifier: false });
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				await bot.arreter();
				process.exit(EXIT.SOFTWARE);
			}
			await bot.arreter();
			return;
		}

		default: {
			const bot = new Wonderbot({ config, journaliser: (m) => logger.log(m, opts) });

			const arret = async (signal: string) => {
				logger.log(`\n${signal} reçu — arrêt propre`, opts);
				await bot.arreter();
				process.exit(EXIT.SIGINT);
			};
			process.on("SIGINT", () => void arret("SIGINT"));
			process.on("SIGTERM", () => void arret("SIGTERM"));

			await bot.demarrer();
			return;
		}
	}
}
