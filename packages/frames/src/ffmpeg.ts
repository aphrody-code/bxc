// SPDX-License-Identifier: Apache-2.0
/**
 * Décodage : la seule dépendance externe du paquet est `ffmpeg`.
 *
 * Une vidéo n'est jamais chargée en mémoire ni recopiée sur disque : ffmpeg
 * décode en flux, redimensionne chaque trame à une vignette carrée et l'écrit
 * en `rawvideo` sur sa sortie standard, que {@link iterateFrames} découpe au
 * fur et à mesure. Indexer un épisode coûte donc la taille d'**une** vignette
 * en mémoire, quelle que soit la durée.
 *
 * La vignette est carrée à dessein : le descripteur ColorLayout découpe l'image
 * en 8×8 blocs et n'en garde que la moyenne, donc écraser le rapport d'aspect
 * vers un multiple de 8 revient exactement à moyenner les blocs de l'image
 * d'origine — et coûte cent fois moins cher que de décoder en pleine
 * résolution.
 *
 * Tout ce qui touche au processus passe par {@link FfmpegDeps.spawn} : les
 * tests construisent et vérifient les arguments, et rejouent un flux factice,
 * sans que ffmpeg soit installé.
 */

import type { PixelData } from "./descriptor.ts";

/** Le strict minimum d'un processus, pour que les tests puissent en simuler un. */
export interface SpawnedProcess {
	stdout: ReadableStream<Uint8Array> | null;
	stderr?: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	kill?(): void;
}

/** Lance une commande et rend ses flux. */
export type Spawner = (cmd: readonly string[]) => SpawnedProcess;

/** Points d'injection : binaires et lanceur de processus. */
export interface FfmpegDeps {
	/** Chemin du binaire ffmpeg (défaut : `ffmpeg` dans le `PATH`). */
	ffmpeg?: string;
	/** Chemin du binaire ffprobe (défaut : `ffprobe` dans le `PATH`). */
	ffprobe?: string;
	/** Lanceur de processus (défaut : `Bun.spawn`). */
	spawn?: Spawner;
}

/** Options d'échantillonnage d'une vidéo. */
export interface FrameStreamOptions {
	/** Trames extraites par seconde de vidéo (défaut : 1). */
	fps?: number;
	/** Côté de la vignette carrée décodée, en pixels (défaut : 128). */
	size?: number;
	/** Début de la plage à décoder, en millisecondes. */
	startMs?: number;
	/** Fin de la plage à décoder, en millisecondes. */
	endMs?: number;
}

/** Une trame décodée et son horodatage dans la vidéo. */
export interface DecodedFrame {
	/** Rang de la trame dans le flux échantillonné, à partir de 0. */
	index: number;
	/** Position dans la vidéo, en millisecondes. */
	tMs: number;
	/** Pixels RGB de la vignette. */
	pixels: PixelData;
}

/** Ce que `ffprobe` sait dire d'un média avant de le décoder. */
export interface MediaInfo {
	durationMs: number;
	width: number;
	height: number;
	/** Cadence d'origine, en images par seconde (0 si inconnue). */
	fps: number;
	codec: string;
}

const DEFAULT_SIZE = 128;
const DEFAULT_FPS = 1;

function defaultSpawn(cmd: readonly string[]): SpawnedProcess {
	return Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
}

/** Millisecondes → `HH:MM:SS.mmm`, la forme que ffmpeg accepte sans ambiguïté. */
export function timecode(ms: number): string {
	const clamped = Math.max(0, Math.round(ms));
	const h = Math.floor(clamped / 3_600_000);
	const m = Math.floor((clamped % 3_600_000) / 60_000);
	const s = Math.floor((clamped % 60_000) / 1000);
	const milli = clamped % 1000;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

/** Arguments de la commande d'échantillonnage — isolés pour être testables. */
export function buildFrameArgs(
	source: string,
	opts: FrameStreamOptions = {},
	deps: FfmpegDeps = {},
): string[] {
	const fps = opts.fps ?? DEFAULT_FPS;
	const size = opts.size ?? DEFAULT_SIZE;
	const args = [deps.ffmpeg ?? "ffmpeg", "-v", "error", "-nostdin"];
	// `-ss` avant `-i` : ffmpeg saute directement à la position demandée au
	// lieu de décoder tout ce qui précède.
	if (opts.startMs) args.push("-ss", timecode(opts.startMs));
	args.push("-i", source);
	if (opts.endMs !== undefined) {
		args.push("-t", timecode(opts.endMs - (opts.startMs ?? 0)));
	}
	args.push(
		"-an",
		"-sn",
		"-vf",
		`fps=${fps},scale=${size}:${size}:flags=area`,
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"-",
	);
	return args;
}

/** Arguments de la commande d'inspection — isolés pour être testables. */
export function buildProbeArgs(source: string, deps: FfmpegDeps = {}): string[] {
	return [
		deps.ffprobe ?? "ffprobe",
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height,r_frame_rate,codec_name:format=duration",
		"-of",
		"json",
		source,
	];
}

/** Lit la sortie JSON de ffprobe. Tolère les champs absents : un flux peut tout ignorer sauf sa taille. */
export function parseProbe(json: string): MediaInfo {
	const parsed = JSON.parse(json) as {
		streams?: Array<{
			width?: number;
			height?: number;
			r_frame_rate?: string;
			codec_name?: string;
		}>;
		format?: { duration?: string };
	};
	const stream = parsed.streams?.[0] ?? {};
	const [num, den] = (stream.r_frame_rate ?? "0/1").split("/");
	const denominator = Number(den) || 1;
	const duration = Number(parsed.format?.duration ?? 0);
	return {
		durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
		width: stream.width ?? 0,
		height: stream.height ?? 0,
		fps: Number(num) / denominator || 0,
		codec: stream.codec_name ?? "",
	};
}

async function drain(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!stream) return "";
	return await new Response(stream).text();
}

/** Inspecte un média (durée, dimensions, cadence) sans le décoder. */
export async function probeMedia(source: string, deps: FfmpegDeps = {}): Promise<MediaInfo> {
	const spawn = deps.spawn ?? defaultSpawn;
	const proc = spawn(buildProbeArgs(source, deps));
	const [out, err, code] = await Promise.all([
		drain(proc.stdout),
		drain(proc.stderr),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(`ffprobe a échoué (${code}) sur ${source}: ${err.trim() || "sans message"}`);
	}
	return parseProbe(out);
}

/**
 * Échantillonne une vidéo et rend ses trames une par une.
 *
 * Le flux `rawvideo` n'a ni en-tête ni séparateur : chaque trame occupe
 * exactement `size × size × 3` octets, et son horodatage se déduit de son rang
 * puisque le filtre `fps` produit une cadence constante.
 */
export async function* iterateFrames(
	source: string,
	opts: FrameStreamOptions = {},
	deps: FfmpegDeps = {},
): AsyncGenerator<DecodedFrame> {
	const fps = opts.fps ?? DEFAULT_FPS;
	const size = opts.size ?? DEFAULT_SIZE;
	const startMs = opts.startMs ?? 0;
	const frameBytes = size * size * 3;
	const spawn = deps.spawn ?? defaultSpawn;
	const proc = spawn(buildFrameArgs(source, opts, deps));
	if (!proc.stdout) throw new Error("ffmpeg n'a pas ouvert de sortie standard");

	const errPromise = drain(proc.stderr);
	const reader = proc.stdout.getReader();
	let pending = new Uint8Array(0);
	let index = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (value && value.length) {
				const merged = new Uint8Array(pending.length + value.length);
				merged.set(pending);
				merged.set(value, pending.length);
				pending = merged;
				let offset = 0;
				while (pending.length - offset >= frameBytes) {
					const data = pending.subarray(offset, offset + frameBytes);
					offset += frameBytes;
					yield {
						index,
						tMs: startMs + Math.round((index * 1000) / fps),
						pixels: { data, width: size, height: size, channels: 3 },
					};
					index++;
				}
				pending = offset ? pending.slice(offset) : pending;
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}

	const code = await proc.exited;
	if (code !== 0) {
		const err = await errPromise;
		throw new Error(`ffmpeg a échoué (${code}) sur ${source}: ${err.trim() || "sans message"}`);
	}
}

/** Arguments du décodage d'une image unique — isolés pour être testables. */
export function buildStillArgs(
	source: string,
	opts: { atMs?: number; size?: number } = {},
	deps: FfmpegDeps = {},
): string[] {
	const size = opts.size ?? DEFAULT_SIZE;
	const args = [deps.ffmpeg ?? "ffmpeg", "-v", "error", "-nostdin"];
	if (opts.atMs) args.push("-ss", timecode(opts.atMs));
	args.push(
		"-i",
		source,
		"-an",
		"-sn",
		"-vf",
		`scale=${size}:${size}:flags=area`,
		"-frames:v",
		"1",
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"-",
	);
	return args;
}

/**
 * Décode une seule image : un fichier JPEG/PNG, ou la trame d'une vidéo à la
 * position `atMs`. C'est le chemin d'une requête de recherche.
 *
 * Une image fixe n'a pas de durée : le filtre `fps` d'{@link iterateFrames} ne
 * produirait rien sur un JPEG. D'où une commande distincte, bornée par
 * `-frames:v 1`.
 */
export async function decodeStill(
	source: string,
	opts: { atMs?: number; size?: number } = {},
	deps: FfmpegDeps = {},
): Promise<PixelData> {
	const size = opts.size ?? DEFAULT_SIZE;
	const frameBytes = size * size * 3;
	const spawn = deps.spawn ?? defaultSpawn;
	const proc = spawn(buildStillArgs(source, opts, deps));
	if (!proc.stdout) throw new Error("ffmpeg n'a pas ouvert de sortie standard");
	const errPromise = drain(proc.stderr);
	const raw = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
	const code = await proc.exited;
	if (code !== 0) {
		const err = await errPromise;
		throw new Error(`ffmpeg a échoué (${code}) sur ${source}: ${err.trim() || "sans message"}`);
	}
	if (raw.length < frameBytes) {
		throw new Error(`aucune image décodable dans ${source}`);
	}
	return { data: raw.subarray(0, frameBytes), width: size, height: size, channels: 3 };
}
