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

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	IETVPlayer,
	bufferHealthPercent,
	bufferedAheadOf,
	inferFormat,
	mimeTypeFor,
	qualityLabel,
	type HlsConstructor,
} from "./video-player.ts";
import { parseSeasonEpisode, situerAbsolu } from "./index.ts";
import { extraireChannelId, langueDeChaine, parserFluxYoutube } from "./youtube-feed.ts";
import {
	arcDeSection,
	indexerChronologie,
	normaliserDate,
	parserListeEpisodes,
} from "./wiki.ts";
import {
	extraireJsonLd,
	identifiantOfficiel,
	parserCategories,
	parserEpisodes,
	parserMetaEpisode,
	slugDeUrl,
	titreSansPrefixe,
} from "./official.ts";
import {
	COMPRESSION_PROFILES,
	VideoCodec,
	VideoTranscoder,
	containerFor,
	ensureNativeCodecs,
	mediabunnyVideoCodec,
	profileHeight,
	resetNativeCodecs,
	type ConversionLike,
} from "./video-codec.ts";

// ---------------------------------------------------------------------------
// Doublures : juste assez de DOM et de hls.js pour piloter le player
// ---------------------------------------------------------------------------

interface FakeVideo {
	src: string;
	autoplay: boolean;
	controls: boolean;
	muted: boolean;
	loop: boolean;
	preload: string;
	poster: string;
	crossOrigin: string | null;
	slot: string;
	currentTime: number;
	videoWidth: number;
	videoHeight: number;
	buffered: { length: number; start(i: number): number; end(i: number): number };
	playable: Set<string>;
	removed: string[];
	loadCalls: number;
	paused: boolean;
	canPlayType(type: string): string;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	removeAttribute(name: string): void;
	getVideoPlaybackQuality(): { totalVideoFrames: number; droppedVideoFrames: number };
}

function fakeVideo(options: { playable?: string[]; ranges?: [number, number][] } = {}): FakeVideo {
	const ranges = options.ranges ?? [];
	let totalFrames = 0;
	return {
		src: "",
		autoplay: false,
		controls: false,
		muted: false,
		loop: false,
		preload: "",
		poster: "",
		crossOrigin: null,
		slot: "",
		currentTime: 0,
		videoWidth: 1280,
		videoHeight: 720,
		buffered: {
			length: ranges.length,
			start: (i: number) => ranges[i]![0],
			end: (i: number) => ranges[i]![1],
		},
		playable: new Set(options.playable ?? []),
		removed: [],
		loadCalls: 0,
		paused: true,
		canPlayType(type) {
			return this.playable.has(type) ? "probably" : "";
		},
		async play() {
			this.paused = false;
		},
		pause() {
			this.paused = true;
		},
		load() {
			this.loadCalls++;
		},
		removeAttribute(name) {
			this.removed.push(name);
			if (name === "src") this.src = "";
		},
		getVideoPlaybackQuality() {
			totalFrames += 30;
			return { totalVideoFrames: totalFrames, droppedVideoFrames: 2 };
		},
	};
}

const asVideoElement = (video: FakeVideo) => video as unknown as HTMLVideoElement;

const FAKE_EVENTS = {
	LEVEL_SWITCHED: "hlsLevelSwitched",
	ERROR: "hlsError",
} as const;

const FAKE_ERROR_TYPES = {
	NETWORK_ERROR: "networkError",
	MEDIA_ERROR: "mediaError",
	OTHER_ERROR: "otherError",
} as const;

class FakeHls {
	static isSupportedResult = true;
	static last?: FakeHls;

	static isSupported() {
		return FakeHls.isSupportedResult;
	}
	static get Events() {
		return FAKE_EVENTS;
	}
	static get ErrorTypes() {
		return FAKE_ERROR_TYPES;
	}

	levels = [
		{ height: 360, width: 640, bitrate: 500_000, videoCodec: "avc1.42c01e", name: "360", frameRate: 24 },
		{ height: 720, width: 1280, bitrate: 2_000_000, videoCodec: "avc1.64001f", name: "720", frameRate: 30 },
	];
	currentLevel = 1;
	nextLevel = -1;
	autoLevelEnabled = true;
	bandwidthEstimate = 8_000_000;
	config = { maxBufferLength: 40 };

	readonly calls: string[] = [];
	private readonly listeners = new Map<string, ((event: string, data: unknown) => void)[]>();

	constructor(public readonly options: Record<string, unknown>) {
		FakeHls.last = this;
	}

	on(event: string, listener: (event: string, data: unknown) => void) {
		const bucket = this.listeners.get(event) ?? [];
		bucket.push(listener);
		this.listeners.set(event, bucket);
	}

	emit(event: string, data: unknown) {
		for (const listener of this.listeners.get(event) ?? []) listener(event, data);
	}

	attachMedia(video: unknown) {
		this.calls.push("attachMedia");
		void video;
	}
	loadSource(url: string) {
		this.calls.push(`loadSource:${url}`);
	}
	startLoad() {
		this.calls.push("startLoad");
	}
	recoverMediaError() {
		this.calls.push("recoverMediaError");
	}
	destroy() {
		this.calls.push("destroy");
	}
}

const fakeHlsLoader = () => Promise.resolve(FakeHls as unknown as HlsConstructor);

// ---------------------------------------------------------------------------
// Aides pures du player
// ---------------------------------------------------------------------------

describe("inferFormat", () => {
	it("reconnaît HLS malgré la query string", () => {
		expect(inferFormat("https://cdn.test/master.m3u8?token=abc&x=1")).toBe("hls");
		expect(inferFormat("https://cdn.test/live.M3U8#t=10")).toBe("hls");
	});

	it("reconnaît DASH et WebM", () => {
		expect(inferFormat("https://cdn.test/manifest.mpd")).toBe("dash");
		expect(inferFormat("https://cdn.test/ep1.webm")).toBe("webm");
	});

	it("retombe sur mp4 pour une extension inconnue", () => {
		expect(inferFormat("https://cdn.test/ep1.mkv")).toBe("mp4");
		expect(inferFormat("https://cdn.test/stream")).toBe("mp4");
	});
});

describe("mimeTypeFor", () => {
	it("mappe chaque conteneur", () => {
		expect(mimeTypeFor("mp4")).toBe("video/mp4");
		expect(mimeTypeFor("webm")).toBe("video/webm");
		expect(mimeTypeFor("hls")).toBe("application/vnd.apple.mpegurl");
		expect(mimeTypeFor("dash")).toBe("application/dash+xml");
	});
});

describe("qualityLabel", () => {
	it("préfère la hauteur", () => {
		expect(qualityLabel({ height: 1080, name: "hi" })).toBe("1080p");
	});

	it("retombe sur le nom de la playlist puis sur ?", () => {
		expect(qualityLabel({ height: 0, name: "audio-only" })).toBe("audio-only");
		expect(qualityLabel({ height: 0, name: "" })).toBe("?");
	});
});

describe("bufferHealthPercent", () => {
	it("rapporte l'avance à la cible et borne à 100", () => {
		expect(bufferHealthPercent(15, 30)).toBe(50);
		expect(bufferHealthPercent(60, 30)).toBe(100);
		expect(bufferHealthPercent(-5, 30)).toBe(0);
	});

	it("renvoie 0 sur une cible nulle plutôt qu'une division par zéro", () => {
		expect(bufferHealthPercent(10, 0)).toBe(0);
	});
});

describe("bufferedAheadOf", () => {
	const ranges = (list: [number, number][]) => ({
		length: list.length,
		start: (i: number) => list[i]![0],
		end: (i: number) => list[i]![1],
	});

	it("mesure l'avance dans la plage courante", () => {
		expect(bufferedAheadOf(ranges([[0, 25]]) as unknown as TimeRanges, 10)).toBe(15);
	});

	it("ignore les plages qui ne contiennent pas la tête de lecture", () => {
		const buffered = ranges([
			[0, 5],
			[30, 60],
		]) as unknown as TimeRanges;
		expect(bufferedAheadOf(buffered, 10)).toBe(0);
		expect(bufferedAheadOf(buffered, 40)).toBe(20);
	});

	it("tolère l'absence de tampon", () => {
		expect(bufferedAheadOf(undefined, 0)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

describe("IETVPlayer", () => {
	it("refuse de charger avant mount()/attach()", async () => {
		const player = new IETVPlayer();
		await expect(player.load("https://cdn.test/ep1.mp4")).rejects.toThrow(/mount\(\) ou attach\(\)/);
	});

	it("applique la configuration à la balise vidéo", () => {
		const video = fakeVideo();
		new IETVPlayer({ autoplay: true, muted: true, preload: "auto", poster: "p.jpg" }).attach(
			asVideoElement(video)
		);

		expect(video.autoplay).toBe(true);
		expect(video.muted).toBe(true);
		expect(video.preload).toBe("auto");
		expect(video.poster).toBe("p.jpg");
	});

	it("charge un MP4 en source directe", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));

		await player.load("https://cdn.test/ep1.mp4");

		expect(video.src).toBe("https://cdn.test/ep1.mp4");
		expect(player.getQualities()).toEqual([]);
	});

	it("préfère le HLS natif quand le navigateur le lit", async () => {
		const video = fakeVideo({ playable: ["application/vnd.apple.mpegurl"] });
		let loaderCalls = 0;
		const player = new IETVPlayer({
			loadHls: () => {
				loaderCalls++;
				return fakeHlsLoader();
			},
		});
		player.attach(asVideoElement(video));

		await player.load("https://cdn.test/master.m3u8");

		expect(video.src).toBe("https://cdn.test/master.m3u8");
		expect(loaderCalls).toBe(0);
	});

	it("bascule sur hls.js sans support natif", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader, startQuality: 1 });
		player.attach(asVideoElement(video));

		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		expect(hls.calls).toEqual(["attachMedia", "loadSource:https://cdn.test/master.m3u8"]);
		expect(hls.options.startLevel).toBe(1);
		expect(video.src).toBe("");
	});

	it("refuse le DASH sans lecture native", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer();
		player.attach(asVideoElement(video));

		await expect(player.load("https://cdn.test/manifest.mpd")).rejects.toThrow(/DASH/);
	});

	it("remonte une erreur claire quand hls.js n'est pas supporté", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));

		FakeHls.isSupportedResult = false;
		try {
			await expect(player.load("https://cdn.test/master.m3u8")).rejects.toThrow(/Media Source/);
		} finally {
			FakeHls.isSupportedResult = true;
		}
	});

	it("liste les variantes avec une entrée auto en tête", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const qualities = player.getQualities();
		expect(qualities.map((q) => q.label)).toEqual(["auto", "360p", "720p"]);
		expect(qualities[0]!.index).toBe(-1);
		expect(player.getCurrentQuality()).toMatchObject({ index: 1, label: "720p", bitrate: 2_000_000 });
	});

	it("force une variante et rend la main à l'ABR", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		player.setQuality(0);
		expect(FakeHls.last!.nextLevel).toBe(0);

		player.setQuality("auto");
		expect(FakeHls.last!.nextLevel).toBe(-1);
	});

	it("refuse le choix de qualité sur une source non HLS", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer();
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/ep1.mp4");

		expect(() => player.setQuality(0)).toThrow(/source HLS/);
	});

	it("notifie les changements de variante", async () => {
		const video = fakeVideo();
		const seen: string[] = [];
		const player = new IETVPlayer({
			loadHls: fakeHlsLoader,
			onQualityChange: (q) => seen.push(q.label),
		});
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		FakeHls.last!.currentLevel = 0;
		FakeHls.last!.emit(FAKE_EVENTS.LEVEL_SWITCHED, {});

		expect(seen).toEqual(["360p"]);
	});

	it("relance le chargement sur erreur réseau fatale", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		hls.emit(FAKE_EVENTS.ERROR, { fatal: true, type: FAKE_ERROR_TYPES.NETWORK_ERROR });
		expect(hls.calls).toContain("startLoad");
	});

	it("vide les tampons sur erreur média fatale", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		hls.emit(FAKE_EVENTS.ERROR, { fatal: true, type: FAKE_ERROR_TYPES.MEDIA_ERROR });
		expect(hls.calls).toContain("recoverMediaError");
	});

	it("ignore les erreurs non fatales", async () => {
		const video = fakeVideo();
		let errors = 0;
		const player = new IETVPlayer({ loadHls: fakeHlsLoader, onError: () => errors++ });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		hls.emit(FAKE_EVENTS.ERROR, { fatal: false, type: FAKE_ERROR_TYPES.NETWORK_ERROR });

		expect(errors).toBe(0);
		expect(hls.calls).not.toContain("startLoad");
	});

	it("abandonne et signale les erreurs fatales non récupérables", async () => {
		const video = fakeVideo();
		const errors: Error[] = [];
		const player = new IETVPlayer({ loadHls: fakeHlsLoader, onError: (e) => errors.push(e) });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		hls.emit(FAKE_EVENTS.ERROR, {
			fatal: true,
			type: FAKE_ERROR_TYPES.OTHER_ERROR,
			details: "muxError",
			error: new Error("boom"),
		});

		expect(hls.calls).toContain("destroy");
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toContain("muxError");
		expect(video.removed).toContain("src");
	});

	it("agrège des statistiques réelles depuis hls.js et la balise vidéo", async () => {
		const video = fakeVideo({ ranges: [[0, 20]] });
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const stats = player.getStats()!;
		expect(stats.resolution).toBe("1280x720");
		expect(stats.bitrate).toBe(2_000_000);
		expect(stats.codec).toBe("avc1.64001f");
		expect(stats.bufferedAhead).toBe(20);
		// maxBufferLength de la doublure = 40 s.
		expect(stats.bufferHealth).toBe(50);
		expect(stats.networkSpeed).toBe(8);
		expect(stats.droppedFrames).toBe(2);
		// Premier relevé : pas encore de delta, on retombe sur la playlist.
		expect(stats.fps).toBe(30);
	});

	it("mesure les fps sur le delta de frames décodées", async () => {
		const video = fakeVideo();
		let clock = 0;
		const player = new IETVPlayer({ loadHls: fakeHlsLoader, now: () => clock });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		// La doublure décode 30 frames par relevé ; 30 frames en 0,5 s = 60 fps.
		player.getStats();
		clock = 500;
		expect(player.getStats()!.fps).toBe(60);

		// Deux relevés trop rapprochés : on garde la dernière mesure valable.
		clock = 550;
		expect(player.getStats()!.fps).toBe(60);
	});

	it("ne renvoie pas de statistiques sans balise vidéo", () => {
		expect(new IETVPlayer().getStats()).toBeUndefined();
	});

	it("libère hls.js et la source à la destruction", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));
		await player.load("https://cdn.test/master.m3u8");

		const hls = FakeHls.last!;
		player.destroy();

		expect(hls.calls).toContain("destroy");
		expect(video.paused).toBe(true);
		expect(video.loadCalls).toBe(1);
		expect(player.getStats()).toBeUndefined();
	});

	it("détruit l'ancienne instance hls.js avant d'en charger une autre", async () => {
		const video = fakeVideo();
		const player = new IETVPlayer({ loadHls: fakeHlsLoader });
		player.attach(asVideoElement(video));

		await player.load("https://cdn.test/a.m3u8");
		const first = FakeHls.last!;
		await player.load("https://cdn.test/b.m3u8");

		expect(first.calls).toContain("destroy");
		expect(FakeHls.last).not.toBe(first);
	});
});

// ---------------------------------------------------------------------------
// Profils et aides codec
// ---------------------------------------------------------------------------

describe("profils de compression", () => {
	it("traduit les noms de codec vers mediabunny", () => {
		expect(mediabunnyVideoCodec("h264")).toBe("avc");
		expect(mediabunnyVideoCodec("h265")).toBe("hevc");
		expect(mediabunnyVideoCodec("vp9")).toBe("vp9");
		expect(mediabunnyVideoCodec("av1")).toBe("av1");
	});

	it("donne la hauteur cible de chaque profil", () => {
		expect(profileHeight(COMPRESSION_PROFILES.mobile_360)).toBe(360);
		expect(profileHeight(COMPRESSION_PROFILES.desktop_1080)).toBe(1080);
	});

	it("exprime les débits en bits par seconde", () => {
		for (const profile of Object.values(COMPRESSION_PROFILES)) {
			expect(profile.bitrate).toBeGreaterThan(100_000);
			expect(Number.isInteger(profile.bitrate)).toBe(true);
		}
	});

	it("garde AV1 moins gourmand que H.265 à résolution égale", () => {
		expect(COMPRESSION_PROFILES.av1_1080.bitrate).toBeLessThan(
			COMPRESSION_PROFILES.desktop_1080.bitrate
		);
	});
});

describe("containerFor", () => {
	it("choisit WebM sur l'extension, MP4 sinon", () => {
		expect(containerFor("/tmp/ep1.webm")).toBe("webm");
		expect(containerFor("/tmp/ep1.WEBM")).toBe("webm");
		expect(containerFor("/tmp/ep1.mp4")).toBe("mp4");
		expect(containerFor("/tmp/ep1")).toBe("mp4");
	});
});

describe("VideoCodec", () => {
	it("recommande un profil selon appareil et bande passante", () => {
		expect(VideoCodec.recommendProfile("mobile", 1).resolution).toBe("360p");
		expect(VideoCodec.recommendProfile("mobile", 5).resolution).toBe("480p");
		expect(VideoCodec.recommendProfile("tablet", 3).resolution).toBe("480p");
		expect(VideoCodec.recommendProfile("tablet", 10).resolution).toBe("720p");
		expect(VideoCodec.recommendProfile("desktop", 5).resolution).toBe("720p");
		expect(VideoCodec.recommendProfile("desktop", 50).resolution).toBe("1080p");
	});

	it("estime la taille depuis le débit", () => {
		// 2 Mbit/s pendant 60 s = 15 Mo.
		expect(VideoCodec.estimateFileSize(60, COMPRESSION_PROFILES.web_720)).toBe(15_000_000);
	});

	it("formate les tailles", () => {
		expect(VideoCodec.formatFileSize(512)).toBe("512B");
		expect(VideoCodec.formatFileSize(2048)).toBe("2.0KB");
		expect(VideoCodec.formatFileSize(5 * 1024 * 1024)).toBe("5.0MB");
		expect(VideoCodec.formatFileSize(3 * 1024 ** 3)).toBe("3.0GB");
	});

	it("renvoie false pour la lecture hors navigateur", () => {
		expect(VideoCodec.canPlayCodec("h264")).toBe(false);
	});

	it("classe les profils par qualité croissante", () => {
		expect(VideoCodec.getQualityMetrics(COMPRESSION_PROFILES.mobile_360).quality).toBeLessThan(
			VideoCodec.getQualityMetrics(COMPRESSION_PROFILES.desktop_1080).quality
		);
	});
});

describe("ensureNativeCodecs", () => {
	it("renvoie false quand @mediabunny/server n'est pas installé, et mémorise", async () => {
		resetNativeCodecs();
		const first = ensureNativeCodecs();
		const second = ensureNativeCodecs();
		expect(first).toBe(second);
		expect(await first).toBe(false);
		resetNativeCodecs();
	});
});

// ---------------------------------------------------------------------------
// Transcodeur (moteur de conversion injecté : aucun encodage réel)
// ---------------------------------------------------------------------------

function fakeConversion(overrides: Partial<ConversionLike> = {}): ConversionLike {
	return {
		isValid: true,
		discardedTracks: [],
		execute: async () => {},
		cancel: async () => {},
		...overrides,
	};
}

describe("VideoTranscoder", () => {
	const transcoderWith = (conversion: ConversionLike, captured?: { options?: unknown }) =>
		new VideoTranscoder({
			initConversion: async (options) => {
				if (captured) captured.options = options;
				return conversion;
			},
			registerNativeCodecs: async () => true,
			canEncode: async () => true,
			fileSize: async () => 1_234_567,
			now: (() => {
				let t = 1_000;
				return () => (t += 500);
			})(),
		});

	it("transcode et décrit le résultat", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			const captured: { options?: unknown } = {};
			const transcoder = transcoderWith(fakeConversion(), captured);

			const result = await transcoder.transcode(
				join(dir, "in.mkv"),
				join(dir, "out.mp4"),
				{ profile: COMPRESSION_PROFILES.web_720 }
			);

			expect(result.container).toBe("mp4");
			expect(result.videoCodec).toBe("h265");
			expect(result.audioCodec).toBe("aac");
			expect(result.sizeBytes).toBe(1_234_567);
			expect(result.elapsedMs).toBe(500);
			expect(result.discarded).toEqual([]);

			const options = captured.options as { video: { height: number; codec: string } };
			expect(options.video.height).toBe(720);
			expect(options.video.codec).toBe("hevc");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("déduit le conteneur WebM de l'extension de sortie", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			const result = await transcoderWith(fakeConversion()).transcode(
				join(dir, "in.mkv"),
				join(dir, "out.webm"),
				{ profile: COMPRESSION_PROFILES.av1_1080 }
			);
			expect(result.container).toBe("webm");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("relaie la progression", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			const conversion = fakeConversion();
			conversion.execute = async () => {
				conversion.onProgress?.(0.5, 12);
				conversion.onProgress?.(1, 24);
			};
			const seen: [number, number][] = [];

			await transcoderWith(conversion).transcode(join(dir, "in.mkv"), join(dir, "out.mp4"), {
				profile: COMPRESSION_PROFILES.mobile_480,
				onProgress: (p, seconds) => seen.push([p, seconds]),
			});

			expect(seen).toEqual([
				[0.5, 12],
				[1, 24],
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("refuse une conversion invalide en citant les pistes écartées", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			const conversion = fakeConversion({
				isValid: false,
				discardedTracks: [
					{ track: { type: "audio" }, reason: "undecodable_source_codec" },
				] as unknown as ConversionLike["discardedTracks"],
			});

			await expect(
				transcoderWith(conversion).transcode(join(dir, "in.mkv"), join(dir, "out.mp4"), {
					profile: COMPRESSION_PROFILES.web_720,
				})
			).rejects.toThrow(/undecodable_source_codec/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("annule la conversion quand le signal est déclenché", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			let canceled = false;
			const controller = new AbortController();
			const conversion = fakeConversion({
				cancel: async () => {
					canceled = true;
				},
			});
			conversion.execute = async () => {
				controller.abort();
			};

			await transcoderWith(conversion).transcode(join(dir, "in.mkv"), join(dir, "out.mp4"), {
				profile: COMPRESSION_PROFILES.mobile_360,
				signal: controller.signal,
			});

			expect(canceled).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("explique quoi installer quand aucun encodeur n'est disponible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ietv-transcode-"));
		try {
			const transcoder = new VideoTranscoder({
				initConversion: async () => fakeConversion(),
				registerNativeCodecs: async () => false,
				canEncode: async () => false,
			});

			await expect(
				transcoder.transcode(join(dir, "in.mkv"), join(dir, "out.mp4"), {
					profile: COMPRESSION_PROFILES.web_720,
				})
			).rejects.toThrow(/@mediabunny\/server/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("échoue proprement sur une entrée illisible", async () => {
		const transcoder = new VideoTranscoder();
		await expect(transcoder.probe(join(tmpdir(), "ietv-absent-xyz.mp4"))).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Lecture du site officiel (JSON-LD)
// ---------------------------------------------------------------------------

const LD_INDEX = `<html><head>
<script id="server-seo-jsonld" type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"WebSite","name":"Inazuma TV+"},
{"@type":"ItemList","name":"Inazuma Eleven categories","itemListElement":[
{"@type":"ListItem","position":1,"name":"Saison 1","url":"https://inazuma-eleven.fr/tv/watch/saison1?lang=fr"},
{"@type":"ListItem","position":4,"name":"GO","url":"https://inazuma-eleven.fr/tv/watch/go?lang=fr"}]}]}</script>
</head><body><div id="episode-list"></div></body></html>`;

const LD_SAISON = `<html><head>
<script type="application/ld+json">{"@graph":[
{"@type":"BreadcrumbList"},
{"@type":"ItemList","name":"Episode list (saison1)","itemListElement":[
{"@type":"ListItem","position":1,"name":"Épisode 1 - Jouons au Football","url":"https://inazuma-eleven.fr/tv/watch/saison1/ep-1?lang=fr"},
{"@type":"ListItem","position":2,"name":"Épisode 12 - La Tornade","url":"https://inazuma-eleven.fr/tv/watch/saison1/ep-12?lang=fr"}]}]}</script>
</head><body></body></html>`;

describe("site officiel", () => {
	it("aplatit le @graph des blocs JSON-LD", () => {
		const objets = extraireJsonLd(LD_INDEX);
		expect(objets.map((o) => o["@type"])).toEqual(["WebSite", "ItemList"]);
	});

	it("ignore un bloc JSON-LD illisible sans perdre les autres", () => {
		const html = `<script type="application/ld+json">{cassé</script>${LD_INDEX}`;
		expect(extraireJsonLd(html)).toHaveLength(2);
	});

	it("lit les catégories et leur slug", () => {
		const categories = parserCategories(LD_INDEX);
		expect(categories.map((c) => [c.position, c.slug])).toEqual([
			[1, "saison1"],
			[4, "go"],
		]);
	});

	it("lit les épisodes en prenant le numéro de l'URL, pas le rang", () => {
		// Le rang saute dès qu'un épisode manque au site ; `/ep-12` porte le vrai
		// numéro de diffusion.
		const episodes = parserEpisodes(LD_SAISON);
		expect(episodes.map((e) => e.numero)).toEqual([1, 12]);
		expect(episodes[1]!.titre).toBe("La Tornade");
	});

	it("retire le préfixe « Épisode N - » du titre", () => {
		expect(titreSansPrefixe("Épisode 3 - À la recherche")).toBe("À la recherche");
		expect(titreSansPrefixe("Episode 7: Le choc")).toBe("Le choc");
		expect(titreSansPrefixe("Un titre sans préfixe")).toBe("Un titre sans préfixe");
	});

	it("dérive un identifiant stable, reproductible d'un scraping à l'autre", () => {
		expect(identifiantOfficiel("saison1", 12)).toBe("off-saison1-12");
		expect(identifiantOfficiel("saison1", 12)).toBe(identifiantOfficiel("saison1", 12));
		expect(identifiantOfficiel("go", 12)).not.toBe(identifiantOfficiel("saison1", 12));
	});

	it("extrait le slug malgré les paramètres et la barre finale", () => {
		expect(slugDeUrl("https://x/tv/watch/chronoStones?lang=fr")).toBe("chronoStones");
		expect(slugDeUrl("https://x/tv/watch/films/")).toBe("films");
	});

	it("rend une liste vide plutôt que de lever sur une page sans JSON-LD", () => {
		expect(parserCategories("<html><body>rien</body></html>")).toEqual([]);
		expect(parserEpisodes("<html><body>rien</body></html>")).toEqual([]);
	});

	it("ne confond pas la liste des catégories et celle des épisodes", () => {
		expect(parserEpisodes(LD_INDEX)).toEqual([]);
		expect(parserCategories(LD_SAISON)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Numérotation continue et flux YouTube
// ---------------------------------------------------------------------------

describe("situerAbsolu", () => {
	const arcs = [
		{ season: 1, totalEpisodes: 26 },
		{ season: 2, totalEpisodes: 41 },
		{ season: 3, totalEpisodes: 60 },
	];

	it("place un numéro continu dans son arc", () => {
		// 26 + 41 = 67 ; l'épisode 113 tombe donc en saison 3, épisode 46.
		expect(situerAbsolu(113, arcs)).toEqual({ season: 3, episode: 46 });
		expect(situerAbsolu(1, arcs)).toEqual({ season: 1, episode: 1 });
		expect(situerAbsolu(26, arcs)).toEqual({ season: 1, episode: 26 });
		expect(situerAbsolu(27, arcs)).toEqual({ season: 2, episode: 1 });
	});

	it("ne classe rien au-delà du total connu", () => {
		expect(situerAbsolu(500, arcs)).toBeNull();
	});

	it("refuse les entrées absurdes", () => {
		expect(situerAbsolu(0, arcs)).toBeNull();
		expect(situerAbsolu(-3, arcs)).toBeNull();
		expect(situerAbsolu(5, [])).toBeNull();
	});

	it("saute un arc vide au lieu de s'y arrêter", () => {
		expect(situerAbsolu(2, [{ season: 1, totalEpisodes: 0 }, { season: 2, totalEpisodes: 5 }])).toEqual({
			season: 2,
			episode: 2,
		});
	});

	it("ordonne les arcs même donnés en désordre", () => {
		expect(situerAbsolu(27, [...arcs].reverse())).toEqual({ season: 2, episode: 1 });
	});
});

describe("parseSeasonEpisode", () => {
	it("n'invente plus de saison quand le titre n'en nomme aucune", () => {
		// C'est ce défaut qui rangeait toute une chaîne numérotée en continu
		// dans la saison 1, en y créant une centaine de faux trous.
		expect(parseSeasonEpisode('Inazuma Eleven France - Épisode 113 "La conspiration"')).toEqual({
			season: null,
			episode: 113,
		});
		expect(parseSeasonEpisode("Ep. 7")).toEqual({ season: null, episode: 7 });
	});

	it("lit la saison quand elle est nommée", () => {
		expect(parseSeasonEpisode("Saison 2 Épisode 10")).toEqual({ season: 2, episode: 10 });
		expect(parseSeasonEpisode("S03E12")).toEqual({ season: 3, episode: 12 });
	});
});

const FLUX = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<title>Inazuma Eleven France officiel</title>
<entry><yt:videoId>abc12345678</yt:videoId><title>Épisode 113 &quot;La conspiration&quot;</title><published>2026-08-30T10:00:00+00:00</published></entry>
<entry><yt:videoId>def12345678</yt:videoId><title>Saison 2 Épisode 4 VOSTFR</title><published>2026-08-29T10:00:00+00:00</published></entry>
<entry><title>entrée sans identifiant</title></entry>
</feed>`;

describe("flux YouTube", () => {
	it("lit les entrées et le nom de la chaîne", () => {
		const entrees = parserFluxYoutube(FLUX);
		expect(entrees).toHaveLength(2);
		expect(entrees[0]!.chaine).toBe("Inazuma Eleven France officiel");
		expect(entrees[0]!.url).toBe("https://www.youtube.com/watch?v=abc12345678");
		expect(entrees[0]!.publie).toBe("2026-08-30T10:00:00+00:00");
	});

	it("décode les entités XML des titres", () => {
		expect(parserFluxYoutube(FLUX)[0]!.titre).toBe('Épisode 113 "La conspiration"');
	});

	it("ignore une entrée sans identifiant plutôt que de tout perdre", () => {
		expect(parserFluxYoutube(FLUX).map((e) => e.videoId)).toEqual(["abc12345678", "def12345678"]);
	});

	it("ne confond pas le titre de la chaîne avec celui de la première vidéo", () => {
		expect(parserFluxYoutube(FLUX)[1]!.chaine).toBe("Inazuma Eleven France officiel");
	});

	it("trouve l'identifiant de chaîne sous ses différentes formes", () => {
		expect(extraireChannelId('href="…channel_id=UCGMvTdioudzJSa5uTAY6FDw"')).toBe("UCGMvTdioudzJSa5uTAY6FDw");
		expect(extraireChannelId('"externalId":"UC1cdmvDug3oRgl_d-w1fdTg"')).toBe("UC1cdmvDug3oRgl_d-w1fdTg");
		expect(extraireChannelId("<html>rien</html>")).toBeNull();
	});
});

describe("métadonnées d'un épisode officiel", () => {
	const PAGE = `<script type="application/ld+json">{"@graph":[
{"@type":"VideoObject","name":"Épisode 1 - Jouons au Football","description":"L'équipe de foot du Collège Raimon.","thumbnailUrl":["https://img.youtube.com/vi/xbpo3u3P9dc/hqdefault.jpg"],"inLanguage":"fr","embedUrl":"https://www.youtube.com/embed/xbpo3u3P9dc"},
{"@type":"Episode","name":"Épisode 1 - Jouons au Football","episodeNumber":1,"description":"L'équipe de foot du Collège Raimon.","inLanguage":"fr","partOfSeason":{"@type":"CreativeWorkSeason","name":"Saison 1"}}]}</script>`;

	it("croise VideoObject et Episode — aucun des deux ne suffit", () => {
		const meta = parserMetaEpisode(PAGE);
		// La vignette vient du VideoObject…
		expect(meta.vignette).toBe("https://img.youtube.com/vi/xbpo3u3P9dc/hqdefault.jpg");
		// …le numéro et le nom d'arc de l'Episode.
		expect(meta.numero).toBe(1);
		expect(meta.nomSaison).toBe("Saison 1");
		expect(meta.description).toContain("Collège Raimon");
		expect(meta.langue).toBe("fr");
		expect(meta.idYoutube).toBe("xbpo3u3P9dc");
	});

	it("prend le premier élément quand thumbnailUrl est un tableau", () => {
		expect(parserMetaEpisode(PAGE).vignette?.startsWith("https://img.youtube.com/")).toBe(true);
	});

	it("rend des champs nuls plutôt que de lever sur une page sans JSON-LD", () => {
		const vide = parserMetaEpisode("<html></html>");
		expect(vide).toEqual({
			idYoutube: null,
			titre: null,
			description: null,
			vignette: null,
			langue: null,
			nomSaison: null,
			numero: null,
		});
	});
});

describe("langueDeChaine", () => {
	it("déduit le doublage français du nom de la chaîne", () => {
		expect(langueDeChaine("inazumaelevenfrance1", "Inazuma Eleven France officiel")).toBe("vf");
		expect(langueDeChaine("inazumaelevengofrance", null)).toBe("vf");
	});

	it("reconnaît une chaîne de sous-titrage", () => {
		expect(langueDeChaine("inazumatvfr", "Inazuma VOSTFR")).toBe("vostfr");
	});

	it("préfère VOSTFR quand les deux indices coexistent", () => {
		// Une chaîne « … VOSTFR France » contient aussi « france ».
		expect(langueDeChaine("chaine-vostfr-france", null)).toBe("vostfr");
	});

	it("rend null quand le nom ne tranche pas — inconnu vaut mieux que faux", () => {
		expect(langueDeChaine("inazumaeleven", "Inazuma Eleven")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Chronologie Wikipédia
// ---------------------------------------------------------------------------

const WIKI = `<h3><span>Saison 2: Académie Alius</span></h3>
<table><tr><th>No</th><th>Titre français</th><th>Kanji</th><th>Rōmaji</th><th>Date</th></tr>
<tr><td>27</td><td>Les Extraterrestres débarquent</td><td>宇宙人が来た!</td><td>Uchū-jin ga kita!</td><td>8 avril 2009</td></tr>
<tr><td>28</td><td>Le Deuxième assaut</td><td>第二の攻撃</td><td>Daini no kōgeki</td><td>15 avril 2009</td></tr></table>
<h2><span>Inazuma Eleven GO: Chrono Stone</span></h2>
<table><tr><th>No</th><th>Titre</th></tr>
<tr><td>1</td><td>Le Football a disparu</td><td>—</td><td>—</td><td>18 avril 2012</td></tr></table>`;

describe("chronologie Wikipédia", () => {
	it("découpe sur les titres de niveau 2 ET 3 — la page mêle les deux", () => {
		const sections = parserListeEpisodes(WIKI);
		expect(sections.map((s) => s.titre)).toEqual([
			"Saison 2: Académie Alius",
			"Inazuma Eleven GO: Chrono Stone",
		]);
	});

	it("rend le rang dans l'arc, pas la numérotation absolue", () => {
		// Wikipédia numérote d'une traite : la saison 2 va de 27 à 67.
		const episodes = parserListeEpisodes(WIKI)[0]!.episodes;
		expect(episodes.map((e) => [e.numero, e.numeroAbsolu])).toEqual([
			[1, 27],
			[2, 28],
		]);
	});

	it("lit titre français, japonais, rōmaji et date", () => {
		const premier = parserListeEpisodes(WIKI)[0]!.episodes[0]!;
		expect(premier.titreFr).toBe("Les Extraterrestres débarquent");
		expect(premier.titreJp).toBe("宇宙人が来た!");
		expect(premier.romaji).toBe("Uchū-jin ga kita!");
		expect(premier.diffusion).toBe("2009-04-08");
	});

	it("normalise les dates françaises, et refuse d'en inventer", () => {
		expect(normaliserDate("5 octobre 2008")).toBe("2008-10-05");
		expect(normaliserDate("1er avril 2012")).toBe("2012-04-01");
		expect(normaliserDate("bientôt")).toBeNull();
		expect(normaliserDate("32 brumaire 1799")).toBeNull();
	});

	it("rattache chaque section à son arc du catalogue", () => {
		expect(arcDeSection("Saison 2: Académie Alius")).toBe(2);
		expect(arcDeSection("Inazuma Eleven GO")).toBe(4);
		// L'ordre compte : « GO: Chrono Stone » contient aussi « go ».
		expect(arcDeSection("Inazuma Eleven GO: Chrono Stone")).toBe(5);
		expect(arcDeSection("Inazuma Eleven GO: Galaxy")).toBe(6);
		expect(arcDeSection("Notes et références")).toBeNull();
	});

	it("indexe par arc et numéro d'arc", () => {
		const index = indexerChronologie(parserListeEpisodes(WIKI));
		expect(index.get("2:1")?.titreFr).toBe("Les Extraterrestres débarquent");
		expect(index.get("5:1")?.diffusion).toBe("2012-04-18");
		// L'absolu de Wikipédia ne doit pas servir de clé.
		expect(index.get("2:27")).toBeUndefined();
	});

	it("ignore une section qu'on ne sait pas rattacher", () => {
		const index = indexerChronologie([
			{ titre: "Notes", episodes: [{ numero: 1, numeroAbsolu: 1, titreFr: "x", titreJp: null, romaji: null, diffusion: null }] },
		]);
		expect(index.size).toBe(0);
	});
});
