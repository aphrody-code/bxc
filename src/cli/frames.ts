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
 * `bxc frames <action>` — frame-by-frame index & scene lookup for anime.
 */

import {
	CONFIDENCE_THRESHOLD,
	FrameSearch,
	TraceMoeError,
	defaultIndexPath,
	encodeVector,
	formatTimecode,
	type UnifiedMatch,
} from "@aphrody/frames";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "index" | "search" | "vector" | "list" | "stats" | "quota";
	targets: string[];
	db?: string;
	fps: number;
	size: number;
	limit: number;
	mode: "auto" | "local" | "remote";
	atMs?: number;
	title?: string;
	season?: number;
	episode?: number;
	anilistId?: number;
	force: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc frames — frame-by-frame anime index (local first, trace.moe as fallback)

Usage:
  bxc frames index <video...>     Index videos frame by frame (ffmpeg required)
  bxc frames search <image>       Find which episode/timestamp an image comes from
  bxc frames vector <image>       Print the 33-coefficient ColorLayout hash
  bxc frames list                 List indexed media
  bxc frames stats                Index size and coverage
  bxc frames quota                trace.moe quota for this machine

Options:
  --db <path>          Index location (default: ${defaultIndexPath()}, env BXC_FRAMES_DB)
  --fps <n>            Frames indexed per second of video (default: 1)
  --size <px>          Decoded thumbnail size (default: 128)
  --title <text>       Media title stored with the index
  --season <n>         Season number
  --episode <n>        Episode number
  --force              Re-index a media already present
  --local              Search the local index only (nothing leaves the machine)
  --remote             Query trace.moe only (sends the 33-int vector, never the image)
  --at <ms|mm:ss>      Take the query frame at this position of a video
  --limit <n>          Maximum matches (default: 5)
  --anilist-id <n>     Restrict a remote search to one AniList entry
  --json               JSON output
  --help, -h           this help

Examples:
  bxc frames index ~/videos/inazuma-s1e01.mp4 --season 1 --episode 1 --fps 2
  bxc frames search capture.jpg
  bxc frames search episode.mkv --at 12:34 --local
  bxc frames vector capture.jpg          # partageable sans l'image

`,
	);
}

/** `12:34`, `1:02:03.500` or a plain millisecond count. */
function parsePosition(raw: string): number | null {
	if (/^\d+$/.test(raw)) return Number(raw);
	const parts = raw.split(":");
	if (parts.length < 2 || parts.length > 3) return null;
	const seconds = Number(parts.pop());
	const minutes = Number(parts.pop());
	const hours = parts.length ? Number(parts.pop()) : 0;
	if (![seconds, minutes, hours].every(Number.isFinite)) return null;
	return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		action: "search",
		targets: [],
		fps: 1,
		size: 128,
		limit: 5,
		mode: "auto",
		force: false,
	};

	const action = argv[0];
	if (
		action === "index" ||
		action === "search" ||
		action === "vector" ||
		action === "list" ||
		action === "stats" ||
		action === "quota"
	) {
		opts.action = action;
	} else if (action === "--help" || action === "-h" || action === undefined) {
		return null;
	} else {
		logger.error(`Unknown action: ${action}`);
		return null;
	}

	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--db":
				opts.db = argv[++i];
				break;
			case "--fps":
				opts.fps = Number(argv[++i]);
				break;
			case "--size":
				opts.size = Number(argv[++i]);
				break;
			case "--title":
				opts.title = argv[++i];
				break;
			case "--season":
				opts.season = Number(argv[++i]);
				break;
			case "--episode":
				opts.episode = Number(argv[++i]);
				break;
			case "--limit":
				opts.limit = Number(argv[++i]);
				break;
			case "--anilist-id":
				opts.anilistId = Number(argv[++i]);
				break;
			case "--at": {
				const at = parsePosition(argv[++i] ?? "");
				if (at === null) {
					logger.error("--at expects milliseconds or mm:ss / hh:mm:ss");
					return null;
				}
				opts.atMs = at;
				break;
			}
			case "--local":
				opts.mode = "local";
				break;
			case "--remote":
				opts.mode = "remote";
				break;
			case "--force":
				opts.force = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) opts.targets.push(a);
		}
	}

	if ((opts.action === "index" || opts.action === "search" || opts.action === "vector") && !opts.targets.length) {
		logger.error(`${opts.action} requires a file argument`);
		return null;
	}
	if (!Number.isFinite(opts.fps) || opts.fps <= 0) {
		logger.error("--fps expects a positive number");
		return null;
	}
	return opts;
}

function describe(match: UnifiedMatch): string {
	const episode = Array.isArray(match.episode) ? match.episode.join("-") : match.episode;
	const label = [
		match.season !== null ? `S${match.season}` : null,
		episode !== null && episode !== undefined ? `E${episode}` : null,
	]
		.filter(Boolean)
		.join("");
	const flag = match.similarity >= CONFIDENCE_THRESHOLD ? "" : "  (peu fiable)";
	return `${(match.similarity * 100).toFixed(1).padStart(5)}%  ${match.title}${label ? ` ${label}` : ""}  ${formatTimecode(match.fromMs)} → ${formatTimecode(match.toMs)}${flag}`;
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(argv[0] === undefined || argv[0] === "--help" || argv[0] === "-h" ? EXIT.OK : EXIT.MISUSE);
	}

	const engine = new FrameSearch({ indexPath: opts.db, size: opts.size });
	try {
		switch (opts.action) {
			case "index": {
				for (const target of opts.targets) {
					const started = Date.now();
					const result = await engine.indexVideo(target, {
						fps: opts.fps,
						size: opts.size,
						title: opts.title,
						season: opts.season ?? null,
						episode: opts.episode ?? null,
						force: opts.force,
						onProgress: (indexed, tMs) =>
							logger.log(`  … ${indexed} trames (${formatTimecode(tMs)})`, opts),
					});
					if (opts.json) {
						Bun.stdout.write(`${JSON.stringify({ target, ...result })}\n`);
					} else if (result.skipped) {
						logger.log(`${target} — déjà indexé (${result.frames} trames)`, opts);
					} else {
						logger.log(
							`${target} — ${result.frames} trames en ${((Date.now() - started) / 1000).toFixed(1)} s`,
							opts,
						);
					}
				}
				break;
			}

			case "search": {
				const found = await engine.search(opts.targets[0], {
					mode: opts.mode,
					limit: opts.limit,
					atMs: opts.atMs,
					anilistID: opts.anilistId,
				});
				if (opts.json) {
					Bun.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
					break;
				}
				const origin = found.origin === "local" ? "index local" : "trace.moe";
				const quota = found.quota ? ` — quota ${found.quota.used}/${found.quota.total}` : "";
				logger.log(`${found.matches.length} résultat(s) — ${origin}${quota}`, opts);
				for (const match of found.matches) logger.log(describe(match), opts);
				if (!found.matches.length) process.exit(EXIT.DATA_ERR);
				break;
			}

			case "vector": {
				const vector = await engine.vectorOf(opts.targets[0], {
					atMs: opts.atMs,
					size: opts.size,
				});
				Bun.stdout.write(
					opts.json
						? `${JSON.stringify({ hash: encodeVector(vector), vector })}\n`
						: `${encodeVector(vector)}\n`,
				);
				break;
			}

			case "list": {
				const media = engine.index.listMedia();
				if (opts.json) {
					Bun.stdout.write(`${JSON.stringify(media, null, 2)}\n`);
					break;
				}
				for (const row of media) {
					logger.log(
						`#${row.id}  ${row.title}  S${row.season ?? "?"}E${row.episode ?? "?"}  ${row.frameCount} trames @ ${row.fps} fps  ${formatTimecode(row.durationMs)}`,
						opts,
					);
				}
				break;
			}

			case "stats": {
				const stats = engine.index.stats();
				Bun.stdout.write(
					opts.json
						? `${JSON.stringify({ path: engine.index.path, ...stats }, null, 2)}\n`
						: `${engine.index.path}\n${stats.media} média(s), ${stats.frames} trames, ${formatTimecode(stats.durationMs)} de vidéo indexée\n`,
				);
				break;
			}

			case "quota": {
				const quota = await engine.traceMoe.me();
				Bun.stdout.write(
					opts.json
						? `${JSON.stringify(quota, null, 2)}\n`
						: `trace.moe — ${quota.quotaUsed}/${quota.quota} recherches sur 24 h, concurrence ${quota.concurrency}, priorité ${quota.priority}\n`,
				);
				break;
			}
		}
	} catch (err) {
		if (err instanceof TraceMoeError) {
			logger.error(`trace.moe (${err.kind}) : ${err.message}`);
			process.exit(err.kind === "quota" ? EXIT.NOPERM : EXIT.DATA_ERR);
		}
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	} finally {
		engine.close();
	}
}
