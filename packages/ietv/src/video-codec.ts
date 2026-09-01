/**
 * Transcodage et compression IETV — adossé à [mediabunny](https://mediabunny.dev).
 *
 * mediabunny encode via l'API WebCodecs. Bun ne l'implémente pas (`VideoEncoder`
 * est `undefined`), donc côté serveur les encodeurs viennent du paquet natif
 * optionnel `@mediabunny/server` (liaisons FFmpeg via `node-av`), chargé
 * paresseusement par {@link ensureNativeCodecs}. Sans lui, la lecture des
 * métadonnées ({@link VideoTranscoder.probe}) marche toujours ; le transcodage
 * échoue avec un message actionnable plutôt qu'une erreur WebCodecs opaque.
 *
 * ```ts
 * const transcoder = new VideoTranscoder();
 * await transcoder.transcode("ep1.mkv", "ep1.mp4", {
 *   profile: COMPRESSION_PROFILES.web_720,
 *   onProgress: (p) => console.log(`${(p * 100).toFixed(0)} %`),
 * });
 * ```
 */

import { stat } from "node:fs/promises";
import {
	ALL_FORMATS,
	Conversion,
	FilePathSource,
	FilePathTarget,
	Input,
	Mp4OutputFormat,
	Output,
	Quality,
	WebMOutputFormat,
	canEncodeVideo,
	type ConversionOptions,
	type DiscardedTrack,
	type OutputFormat,
	type VideoCodec as MediabunnyVideoCodec,
} from "mediabunny";

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Codecs vidéo exposés par IETV, sous leurs noms usuels. */
export type VideoCodecName = "h264" | "h265" | "vp9" | "av1";
export type AudioCodecName = "aac" | "opus" | "mp3";
export type Resolution = "360p" | "480p" | "720p" | "1080p";
/** Conteneur de sortie. */
export type Container = "mp4" | "webm";

/** Noms IETV → noms mediabunny (qui suit la nomenclature WebCodecs). */
const VIDEO_CODEC_MAP: Record<VideoCodecName, MediabunnyVideoCodec> = {
	h264: "avc",
	h265: "hevc",
	vp9: "vp9",
	av1: "av1",
};

const RESOLUTION_HEIGHT: Record<Resolution, number> = {
	"360p": 360,
	"480p": 480,
	"720p": 720,
	"1080p": 1080,
};

export interface CompressionProfile {
	name: string;
	videoCodec: VideoCodecName;
	audioCodec: AudioCodecName;
	resolution: Resolution;
	/** Débit vidéo cible, en bits par seconde. */
	bitrate: number;
	/**
	 * Quantizer (l'équivalent du CRF de FFmpeg) : qualité constante plutôt que
	 * débit constant, plus faible = meilleure qualité. Utilisé quand l'encodeur
	 * le supporte, avec `bitrate` en repli.
	 */
	quantizer?: number;
	fps: number;
}

export interface TranscodeOptions {
	profile: CompressionProfile;
	/** Conteneur de sortie ; déduit de l'extension du fichier si omis. */
	container?: Container;
	/** Progression entre 0 et 1, plus le temps d'entrée déjà traité. */
	onProgress?: (progress: number, processedSeconds: number) => void;
	/** Annule le transcodage ; le fichier de sortie partiel est abandonné. */
	signal?: AbortSignal;
	/** Ne transcoder qu'un extrait de l'entrée. */
	trim?: { start?: number; end?: number };
}

export interface TranscodeResult {
	output: string;
	container: Container;
	videoCodec: VideoCodecName;
	audioCodec: AudioCodecName;
	sizeBytes: number;
	elapsedMs: number;
	/** Pistes de l'entrée laissées de côté, avec le motif donné par mediabunny. */
	discarded: { type: string; reason: string }[];
}

export interface MediaInfo {
	durationSeconds: number;
	video: {
		codec: MediabunnyVideoCodec | null;
		width: number;
		height: number;
		rotation: number;
	} | null;
	audio: { codec: string | null; sampleRate: number; channels: number } | null;
}

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

/**
 * Profils prêts à l'emploi. Les débits suivent les recommandations usuelles
 * pour du contenu animé ; les quantizers ciblent une qualité visuellement
 * transparente sur ce type de source (aplats, peu de grain).
 */
export const COMPRESSION_PROFILES = {
	mobile_360: {
		name: "Mobile (360p)",
		videoCodec: "h264",
		audioCodec: "aac",
		resolution: "360p",
		bitrate: 500_000,
		quantizer: 28,
		fps: 24,
	},
	mobile_480: {
		name: "Mobile (480p)",
		videoCodec: "h264",
		audioCodec: "aac",
		resolution: "480p",
		bitrate: 1_000_000,
		quantizer: 26,
		fps: 30,
	},
	web_720: {
		name: "Web (720p)",
		videoCodec: "h265",
		audioCodec: "aac",
		resolution: "720p",
		bitrate: 2_000_000,
		quantizer: 26,
		fps: 30,
	},
	desktop_1080: {
		name: "Desktop (1080p)",
		videoCodec: "h265",
		audioCodec: "aac",
		resolution: "1080p",
		bitrate: 4_000_000,
		quantizer: 24,
		fps: 30,
	},
	av1_1080: {
		name: "AV1 (1080p)",
		videoCodec: "av1",
		audioCodec: "opus",
		resolution: "1080p",
		// AV1 tient la même qualité pour ~40 % de débit en moins que H.264.
		bitrate: 1_500_000,
		quantizer: 32,
		fps: 30,
	},
} as const satisfies Record<string, CompressionProfile>;

export type CompressionProfileName = keyof typeof COMPRESSION_PROFILES;

/** Hauteur en pixels visée par un profil. */
export function profileHeight(profile: CompressionProfile): number {
	return RESOLUTION_HEIGHT[profile.resolution];
}

/** Nom mediabunny du codec vidéo d'un profil. */
export function mediabunnyVideoCodec(codec: VideoCodecName): MediabunnyVideoCodec {
	return VIDEO_CODEC_MAP[codec];
}

/**
 * Conteneur déduit de l'extension du fichier de sortie. VP9 et AV1 sont
 * régulièrement servis en WebM ; tout le reste tombe en MP4.
 */
export function containerFor(outputPath: string): Container {
	return outputPath.toLowerCase().endsWith(".webm") ? "webm" : "mp4";
}

function outputFormatFor(container: Container): OutputFormat {
	// `fastStart: "in-memory"` place les métadonnées en tête du MP4 : la
	// lecture démarre sans télécharger tout le fichier.
	return container === "webm"
		? new WebMOutputFormat()
		: new Mp4OutputFormat({ fastStart: "in-memory" });
}

// ---------------------------------------------------------------------------
// Encodeurs natifs (@mediabunny/server)
// ---------------------------------------------------------------------------

interface MediabunnyServerModule {
	registerMediabunnyServer: (options?: unknown) => void;
}

let nativeCodecs: Promise<boolean> | null = null;

/**
 * Enregistre les encodeurs/décodeurs natifs si `@mediabunny/server` est
 * installé. Idempotent, et sans effet quand le paquet est absent : l'appelant
 * lit le booléen pour savoir sur quoi il tourne.
 */
export function ensureNativeCodecs(): Promise<boolean> {
	nativeCodecs ??= (async () => {
		try {
			// Spécifieur indirect : `@mediabunny/server` est une dépendance
			// optionnelle, il ne doit être ni résolu à la compilation ni tiré
			// dans un bundle navigateur.
			const specifier = "@mediabunny/server";
			const mod = (await import(specifier)) as MediabunnyServerModule;
			mod.registerMediabunnyServer();
			return true;
		} catch {
			return false;
		}
	})();
	return nativeCodecs;
}

/** Remet à zéro le cache de {@link ensureNativeCodecs} (tests). */
export function resetNativeCodecs(): void {
	nativeCodecs = null;
}

// ---------------------------------------------------------------------------
// Transcodeur
// ---------------------------------------------------------------------------

/** Sous-ensemble de `Conversion` dont le transcodeur a besoin. */
export interface ConversionLike {
	isValid: boolean;
	discardedTracks: DiscardedTrack[];
	onProgress?: (progress: number, processedTime: number) => unknown;
	execute(): Promise<void>;
	cancel(): Promise<void>;
}

/** Points d'injection — horloge, système de fichiers et moteur de conversion. */
export interface TranscoderDeps {
	initConversion?: (options: ConversionOptions) => Promise<ConversionLike>;
	registerNativeCodecs?: () => Promise<boolean>;
	canEncode?: (codec: MediabunnyVideoCodec, options: { height: number }) => Promise<boolean>;
	fileSize?: (path: string) => Promise<number>;
	now?: () => number;
}

export class VideoTranscoder {
	private readonly deps: Required<TranscoderDeps>;

	constructor(deps: TranscoderDeps = {}) {
		this.deps = {
			initConversion: deps.initConversion ?? ((options) => Conversion.init(options)),
			registerNativeCodecs: deps.registerNativeCodecs ?? ensureNativeCodecs,
			canEncode: deps.canEncode ?? canEncodeVideo,
			fileSize: deps.fileSize ?? (async (path) => (await stat(path)).size),
			now: deps.now ?? Date.now,
		};
	}

	/** Métadonnées de l'entrée, sans décoder une seule frame. */
	async probe(inputPath: string): Promise<MediaInfo> {
		const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(inputPath) });
		try {
			const [videoTrack, audioTrack] = await Promise.all([
				input.getPrimaryVideoTrack(),
				input.getPrimaryAudioTrack(),
			]);

			const [duration, video, audio] = await Promise.all([
				input.computeDuration(),
				videoTrack
					? Promise.all([
							videoTrack.getCodec(),
							videoTrack.getDisplayWidth(),
							videoTrack.getDisplayHeight(),
							videoTrack.getRotation(),
						]).then(([codec, width, height, rotation]) => ({
							codec,
							width,
							height,
							rotation,
						}))
					: null,
				audioTrack
					? Promise.all([
							audioTrack.getCodec(),
							audioTrack.getSampleRate(),
							audioTrack.getNumberOfChannels(),
						]).then(([codec, sampleRate, channels]) => ({
							codec,
							sampleRate,
							channels,
						}))
					: null,
			]);

			return { durationSeconds: duration, video, audio };
		} finally {
			input.dispose();
		}
	}

	/**
	 * Transcode `inputPath` vers `outputPath` selon le profil demandé.
	 *
	 * La vidéo est redimensionnée à la hauteur du profil (largeur déduite du
	 * rapport d'image) et ré-encodée ; les pistes que le conteneur de sortie ne
	 * sait pas accueillir sont rapportées dans `discarded` plutôt que
	 * silencieusement perdues.
	 */
	async transcode(
		inputPath: string,
		outputPath: string,
		options: TranscodeOptions
	): Promise<TranscodeResult> {
		const { profile } = options;
		const container = options.container ?? containerFor(outputPath);
		const startedAt = this.deps.now();

		await this.deps.registerNativeCodecs();

		const codec = mediabunnyVideoCodec(profile.videoCodec);
		const height = profileHeight(profile);
		if (!(await this.deps.canEncode(codec, { height }))) {
			throw new Error(
				`Aucun encodeur ${profile.videoCodec} disponible. Sous Bun/Node, installer ` +
					"`@mediabunny/server` (liaisons FFmpeg) ; sinon choisir un profil dont le " +
					"codec est supporté par la plateforme."
			);
		}

		const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(inputPath) });
		const output = new Output({
			format: outputFormatFor(container),
			target: new FilePathTarget(outputPath),
		});

		const conversion = await this.deps.initConversion({
			input,
			output,
			trim: options.trim,
			video: {
				height,
				codec,
				frameRate: profile.fps,
				quality: new Quality({
					bitrate: profile.bitrate,
					...(profile.quantizer !== undefined ? { quantizer: profile.quantizer } : {}),
				}),
			},
			audio: { codec: profile.audioCodec },
		});

		if (options.onProgress) {
			const report = options.onProgress;
			conversion.onProgress = (progress, processedTime) => report(progress, processedTime);
		}

		if (!conversion.isValid) {
			const reasons = describeDiscarded(conversion.discardedTracks);
			throw new Error(
				`Transcodage impossible pour ${inputPath} → ${outputPath}` +
					(reasons.length > 0 ? ` : ${reasons.join(", ")}` : "")
			);
		}

		const onAbort = () => void conversion.cancel();
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			await conversion.execute();
		} finally {
			options.signal?.removeEventListener("abort", onAbort);
			input.dispose();
		}

		return {
			output: outputPath,
			container,
			videoCodec: profile.videoCodec,
			audioCodec: profile.audioCodec,
			sizeBytes: await this.deps.fileSize(outputPath),
			elapsedMs: this.deps.now() - startedAt,
			discarded: conversion.discardedTracks.map((track) => ({
				type: track.track.type,
				reason: track.reason,
			})),
		};
	}
}

function describeDiscarded(tracks: DiscardedTrack[]): string[] {
	return tracks.map((track) => `piste ${track.track.type} écartée (${track.reason})`);
}

// ---------------------------------------------------------------------------
// Aides au choix de profil
// ---------------------------------------------------------------------------

export class VideoCodec {
	/** Profil adapté à l'appareil et à la bande passante mesurée (Mbps). */
	static recommendProfile(
		deviceType: "mobile" | "tablet" | "desktop",
		bandwidth: number
	): CompressionProfile {
		if (deviceType === "mobile") {
			return bandwidth < 2 ? COMPRESSION_PROFILES.mobile_360 : COMPRESSION_PROFILES.mobile_480;
		}
		if (deviceType === "tablet") {
			return bandwidth < 5 ? COMPRESSION_PROFILES.mobile_480 : COMPRESSION_PROFILES.web_720;
		}
		return bandwidth < 8 ? COMPRESSION_PROFILES.web_720 : COMPRESSION_PROFILES.desktop_1080;
	}

	/** Taille attendue en octets, débit vidéo seul. */
	static estimateFileSize(durationSeconds: number, profile: CompressionProfile): number {
		return (profile.bitrate / 8) * durationSeconds;
	}

	static formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
	}

	/** Le navigateur courant sait-il *lire* ce codec ? (`false` hors DOM) */
	static canPlayCodec(codec: VideoCodecName): boolean {
		if (typeof document === "undefined") return false;

		const video = document.createElement("video");
		const mimeTypes: Record<VideoCodecName, string> = {
			h264: 'video/mp4; codecs="avc1.42E01E"',
			h265: 'video/mp4; codecs="hev1.1.1.L93.B0"',
			vp9: 'video/webm; codecs="vp9"',
			av1: 'video/mp4; codecs="av01.0.08M.08"',
		};
		return video.canPlayType(mimeTypes[codec]) !== "";
	}

	/**
	 * Le runtime courant sait-il *encoder* ce codec ? Appeler
	 * {@link ensureNativeCodecs} d'abord côté serveur, sinon la réponse ne
	 * reflète que WebCodecs.
	 */
	static canEncodeCodec(codec: VideoCodecName, height?: number): Promise<boolean> {
		return canEncodeVideo(VIDEO_CODEC_MAP[codec], height !== undefined ? { height } : undefined);
	}

	/** Compromis qualité/poids relatif d'un profil, base 360p. */
	static getQualityMetrics(profile: CompressionProfile): { quality: number; filesize: number } {
		const metrics: Record<Resolution, { quality: number; filesize: number }> = {
			"360p": { quality: 2, filesize: 1 },
			"480p": { quality: 3, filesize: 1.5 },
			"720p": { quality: 5, filesize: 2.5 },
			"1080p": { quality: 8, filesize: 4 },
		};
		return metrics[profile.resolution];
	}
}

export default VideoTranscoder;
