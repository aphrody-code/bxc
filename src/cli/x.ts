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
 * `bxc x <action> [args]` — native X / Twitter client (cookie auth).
 *
 * Wraps the `@aphrody/x` headless client. Authentication uses an
 * `auth_token` + `ct0` cookie pair, resolved from (in order):
 *   1. `--cookie "auth_token=...; ct0=..."`
 *   2. the session file (`~/.config/x-cli/session.json`)
 *   3. the `X_AUTH_TOKEN` / `X_CT0` environment variables
 */

import { XClient, XSession, getNews, isAuthFailure, purgeFollowing, purgeTweets, rankPosts, rankTweets, toPostCandidate, type PostCandidate, type PostKind, type PurgeOptions, type PurgeTweetsOptions, type TweetPage } from "@aphrody/x";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

type Action = "profile" | "tweets" | "news" | "search" | "whoami" | "rank" | "foryou" | "unfollow" | "purge-tweets";

interface CliOptions extends CommonOptions {
	action: Action;
	positional: string[];
	count: number;
	cookie?: string;
	fromSource?: "search" | "news";
	/** Flags de cadence et de reprise communs aux deux purges. */
	purge: SharedPurgeFlags;
	/** Flags propres a `unfollow`. */
	unfollow: Pick<PurgeOptions, "nonMutualOnly">;
	/** Flags propres a `purge-tweets`. */
	tweetPurge: Pick<
		PurgeTweetsOptions,
		"maxLikes" | "kinds" | "includeRetweets" | "protectIds"
	>;
	confirmed: boolean;
}

/**
 * Ce que les deux moteurs de purge acceptent a l'identique. Les typer ainsi
 * evite de deverser dans l'un des options qui n'ont de sens que pour l'autre
 * (`nonMutualOnly`, `onProgress`...).
 */
type SharedPurgeFlags = Pick<
	PurgeOptions,
	| "limit"
	| "refresh"
	| "once"
	| "statePath"
	| "perWindow"
	| "perDay"
	| "minDelayMs"
	| "maxDelayMs"
>;

function printUsage(): void {
	Bun.stdout.write(
		`bxc x — native X / Twitter client (cookie auth, no API key)

Usage:
  bxc x profile <handle>            Fetch a user profile (followers, bio, id...)
  bxc x tweets <handle> [--count N] Fetch a user's recent tweets (default 20)
  bxc x search <query> [--count N]  Search the Latest timeline
  bxc x news [--count N]            Fetch trending news from the Explore tabs
  bxc x whoami                      Resolve the authenticated account
  bxc x rank [--from <search|news>] [--count N]
                                    Re-rank recent results using local X For You style algo
  bxc x foryou [--count N]          Demo "For You" mix (whoami + search/news) ranked locally (x-algorithm)
  bxc x unfollow [--yes]            Purge autonome des abonnements, non-mutuels d'abord
  bxc x purge-tweets [--yes]        Purge autonome des posts sous un seuil de likes

Options:
  --count, -n <N>   Number of items to fetch (default 20)
  --cookie <str>    "auth_token=...; ct0=..." pair (overrides session/env)
  --json            Emit raw JSON (default)
  --help, -h        this help

Options de 'unfollow' (destructif, irreversible) :
  --yes, -y             Execute reellement (sans ce flag: dry-run, aucune mutation)
  --non-mutual-only     S'arrete apres les comptes qui ne suivent pas en retour
  --limit N             Plafond de retraits pour cette execution
  --refresh             Relit le graphe et reconstruit la file (ignore le journal)
  --once                Rend la main des qu'un budget est epuise au lieu d'attendre
  --state <path>        Journal de reprise (defaut ~/.aphrody/x-unfollow-<handle>.json)
  --per-window N        Plafond par fenetre de 15 min (defaut 45)
  --per-day N           Plafond par 24 h (defaut 400)
  --delay-min <ms>      Delai minimum entre deux mutations (defaut 4000)
  --delay-max <ms>      Delai maximum entre deux mutations (defaut 11000)

Options de 'purge-tweets' (destructif, irreversible) :
  --yes, -y             Execute reellement (sans ce flag: dry-run)
  --max-likes N         Conserve les posts a partir de N likes (defaut 1000)
  --kinds <a,b>         Types a supprimer parmi tweet,reply,media (defaut les trois)
  --include-retweets    Retire aussi les retweets (hors seuil : les likes ne sont pas les tiens)
  --keep <id,id>        Ids de posts a ne jamais toucher (post epingle, souvenirs)
  --limit / --refresh / --once / --state / --per-window / --per-day / --delay-*
                        Identiques a 'unfollow' ci-dessus

Auth resolution order: --cookie > session file > X_AUTH_TOKEN / X_CT0 env.

`,
	);
}

/**
 * Lit un entier de drapeau, ou echoue.
 *
 * `parseInt("abc")` vaut NaN, et NaN traverse `?? defaut` sans etre remplace.
 * Sur `--max-likes` c'est destructeur : la regle de conservation est
 * `likes >= maxLikes`, comparaison fausse pour tout entier face a NaN — plus
 * aucun post n'est protege et la purge vide l'archive entiere. Les `|| undefined`
 * qui suivaient avaient le defaut symetrique : un `0` explicite ou une faute de
 * frappe retombaient silencieusement sur « pas de plafond ».
 */
function intFlag(flag: string, raw: string | undefined, min: number): number | null {
	if (raw === undefined || !/^\d+$/.test(raw.trim())) {
		logger.error(`${flag}: entier attendu (recu: ${raw ?? "rien"})`);
		return null;
	}
	const n = Number.parseInt(raw, 10);
	if (n < min) {
		logger.error(`${flag}: doit valoir au moins ${min} (recu: ${n})`);
		return null;
	}
	return n;
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const actionStr = argv[0];
	const valid: Action[] = ["profile", "tweets", "news", "search", "whoami", "rank", "foryou", "unfollow", "purge-tweets"];
	if (!valid.includes(actionStr as Action)) {
		if (actionStr && actionStr !== "--help" && actionStr !== "-h") {
			logger.error(`Unknown action: ${actionStr}`);
		}
		return null;
	}

	const opts: CliOptions = {
		...baseOpts,
		action: actionStr as Action,
		positional: [],
		count: 20,
		purge: {},
		unfollow: {},
		tweetPurge: {},
		confirmed: false,
	};

	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--count":
			case "-n": {
				const n = intFlag("--count", argv[++i], 1);
				if (n === null) return null;
				opts.count = n;
				break;
			}
			case "--cookie":
				opts.cookie = argv[++i];
				break;
			case "--from":
				const src = (argv[++i] || "").toLowerCase();
				if (src === "search" || src === "news") opts.fromSource = src;
				break;
			case "--yes":
			case "-y":
				opts.confirmed = true;
				break;
			case "--dry-run":
				opts.confirmed = false;
				break;
			case "--non-mutual-only":
				opts.unfollow.nonMutualOnly = true;
				break;
			case "--max-likes": {
				const n = intFlag("--max-likes", argv[++i], 0);
				if (n === null) return null;
				opts.tweetPurge.maxLikes = n;
				break;
			}
			case "--kinds": {
				const raw = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
				const known: PostKind[] = ["tweet", "reply", "media", "retweet"];
				const picked = raw.filter((k): k is PostKind => known.includes(k as PostKind));
				if (picked.length !== raw.length) {
					logger.error(`--kinds: valeurs valides = ${known.join(", ")}`);
					return null;
				}
				opts.tweetPurge.kinds = picked;
				break;
			}
			case "--include-retweets":
				opts.tweetPurge.includeRetweets = true;
				break;
			case "--keep":
				opts.tweetPurge.protectIds = (argv[++i] || "")
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case "--limit": {
				const n = intFlag("--limit", argv[++i], 1);
				if (n === null) return null;
				opts.purge.limit = n;
				break;
			}
			case "--refresh":
				opts.purge.refresh = true;
				break;
			case "--once":
				opts.purge.once = true;
				break;
			case "--state":
				opts.purge.statePath = argv[++i];
				break;
			case "--per-window": {
				const n = intFlag("--per-window", argv[++i], 1);
				if (n === null) return null;
				opts.purge.perWindow = n;
				break;
			}
			case "--per-day": {
				const n = intFlag("--per-day", argv[++i], 1);
				if (n === null) return null;
				opts.purge.perDay = n;
				break;
			}
			case "--delay-min": {
				const n = intFlag("--delay-min", argv[++i], 0);
				if (n === null) return null;
				opts.purge.minDelayMs = n;
				break;
			}
			case "--delay-max": {
				const n = intFlag("--delay-max", argv[++i], 0);
				if (n === null) return null;
				opts.purge.maxDelayMs = n;
				break;
			}
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) opts.positional.push(a);
		}
	}
	return opts;
}

function resolveSession(opts: CliOptions): XSession {
	if (opts.cookie) return XSession.fromCookieString(opts.cookie);
	return XSession.loadOrEnv();
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

	let session: XSession;
	try {
		session = resolveSession(opts);
	} catch (err) {
		logger.error(
			`no X session: ${err instanceof Error ? err.message : String(err)}. ` +
				`Pass --cookie "auth_token=...; ct0=..." or set X_AUTH_TOKEN / X_CT0.`,
		);
		process.exit(EXIT.MISUSE);
	}

	const client = new XClient(session);
	const emit = (data: unknown) =>
		Bun.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

	try {
		switch (opts.action) {
			case "profile": {
				const handle = opts.positional[0]?.replace(/^@/, "");
				if (!handle) {
					logger.error("requires <handle>");
					process.exit(EXIT.MISUSE);
				}
				emit(await client.userByScreenName(handle));
				break;
			}
			case "tweets": {
				const handle = opts.positional[0]?.replace(/^@/, "");
				if (!handle) {
					logger.error("requires <handle>");
					process.exit(EXIT.MISUSE);
				}
				const uid = await client.userIdFor(handle);
				emit(await client.userTweets(uid, opts.count, undefined, 1));
				break;
			}
			case "search": {
				const query = opts.positional.join(" ").trim();
				if (!query) {
					logger.error("requires <query>");
					process.exit(EXIT.MISUSE);
				}
				emit(await client.search(query, opts.count));
				break;
			}
			case "news": {
				emit(await getNews(client, opts.count));
				break;
			}
			case "whoami": {
				emit(await client.whoami());
				break;
			}
			case "rank":
			case "foryou": {
				const isForyou = opts.action === "foryou";
				// Try to use typed path for search results (preferred, uses Tweet types + rankTweets)
				let ranked: ReturnType<typeof rankPosts> = [];
				let source = isForyou ? "foryou-mix" : (opts.fromSource || "search");

				if (isForyou || opts.fromSource === "search" || (!opts.fromSource && opts.positional.length)) {
					const q = isForyou ? (opts.positional.join(" ") || "ai") : (opts.positional.join(" ").trim() || "tech");
					const page: TweetPage = await client.search(q, Math.max(30, opts.count));
					// Try to enrich context (best effort)
					let viewer: any = null;
					try { viewer = await client.whoami(); } catch {}
					const ctx = {
						viewer_id: viewer?.id ? String(viewer.id) : undefined,
					};
					ranked = rankTweets(page.tweets || [], ctx, opts.count);
				} else {
					// Fallback for news or raw
					const newsRes: any = await getNews(client, Math.max(30, opts.count));
					const raws: any[] = Array.isArray(newsRes) ? newsRes : (newsRes?.items || newsRes || []);
					const cands: PostCandidate[] = raws.map(toPostCandidate).filter(Boolean) as PostCandidate[];
					let viewer: any = null;
					try { viewer = await client.whoami(); } catch {}
					const ctx = { viewer_id: viewer?.id ? String(viewer.id) : undefined };
					ranked = rankPosts(cands, ctx, opts.count);
					source = "news";
				}

				emit({ ranked_count: ranked.length, source, results: ranked });
				break;
			}
			case "unfollow":
			case "purge-tweets": {
				// Les deux purges partagent le meme contrat d'exploitation : arret
				// propre sur signal, rapport JSON resume, et surtout les codes de
				// sortie que systemd interprete (77 = ne pas relancer).
				const controller = new AbortController();
				const onSignal = () => {
					logger.error("interruption — arret propre, le journal est a jour");
					controller.abort();
				};
				process.on("SIGINT", onSignal);
				process.on("SIGTERM", onSignal);

				try {
					const shared = {
						dryRun: !opts.confirmed,
						signal: controller.signal,
						onLog: (line: string) => {
							if (!opts.quiet) Bun.stderr.write(`${line}\n`);
						},
					};
					const report =
						opts.action === "unfollow"
							? await purgeFollowing(client, {
									...opts.purge,
									...opts.unfollow,
									...shared,
								})
							: await purgeTweets(client, {
									...opts.purge,
									...opts.tweetPurge,
									...shared,
								});

					const { planned, ...summary } = report;
					emit({
						...summary,
						eta_iso: report.eta_epoch
							? new Date(report.eta_epoch).toISOString()
							: undefined,
						planned_count: planned.length,
						planned_preview: planned.slice(0, 25),
						hint: report.dry_run
							? `file complete dans ${report.state_path ?? "(journal desactive)"} — relancer avec --yes pour executer`
							: undefined,
					});

					// 77 = ne pas relancer : un cookie mort ne se repare pas en
					// reessayant, et marteler X avec des credentials invalides est
					// exactement ce qui fait flaguer un compte.
					if (report.stopped_by === "auth-error") process.exit(EXIT.NOPERM);
					if (report.stopped_by === "aborted") process.exit(EXIT.SIGINT);
				} finally {
					process.off("SIGINT", onSignal);
					process.off("SIGTERM", onSignal);
				}
				break;
			}
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		// Une session rejetee doit sortir en 77 meme quand elle echoue avant la
		// boucle (whoami, lecture du graphe) : c'est ce code que systemd utilise
		// pour ne PAS relancer, au lieu de marteler X avec un cookie mort.
		process.exit(isAuthFailure(err) ? EXIT.NOPERM : EXIT.DATA_ERR);
	}
}
