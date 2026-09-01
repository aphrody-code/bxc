/**
 * Player vidéo IETV — media-chrome (UI) + hls.js (protocole HLS).
 *
 * Les deux bibliothèques sont des `peerDependencies` **optionnelles** et ne
 * sont chargées qu'à l'exécution, dans un contexte navigateur :
 * `@aphrody/ietv` reste utilisable côté serveur (scraper, cache, CLI) sans
 * jamais les tirer dans le bundle.
 *
 * ```ts
 * const player = new IETVPlayer({ autoplay: false });
 * await player.mount(document.querySelector("#player")!);
 * await player.load("https://cdn.example/ep1.m3u8");
 * ```
 *
 * Les deux chargeurs (`loadHls`, `loadMediaChrome`) sont injectables : c'est
 * ce qui permet de tester le player sans DOM ni réseau.
 */

import type HlsJs from "hls.js";
import type { ErrorData, HlsConfig, Level } from "hls.js";

/** Instance hls.js. */
export type HlsInstance = HlsJs;
/** Constructeur hls.js (ce que renvoie `import("hls.js")`). */
export type HlsConstructor = typeof HlsJs;

/** Conteneurs/protocoles reconnus par {@link IETVPlayer.load}. */
export type VideoFormat = "mp4" | "webm" | "hls" | "dash";

export interface VideoPlayerConfig {
	autoplay?: boolean;
	controls?: boolean;
	muted?: boolean;
	loop?: boolean;
	preload?: "none" | "metadata" | "auto";
	/** Image d'attente. */
	poster?: string;
	crossOrigin?: "anonymous" | "use-credentials" | null;
	/**
	 * Qualité de départ : `"auto"` laisse hls.js choisir selon la bande
	 * passante, un entier force l'index de variante.
	 */
	startQuality?: "auto" | number;
	/** Configuration passée telle quelle à hls.js. */
	hlsConfig?: Partial<HlsConfig>;
	/**
	 * Monter l'interface media-chrome autour de la balise `<video>`.
	 * `false` = contrôles natifs du navigateur.
	 */
	chrome?: boolean;
	/** Chargeur hls.js — injectable pour les tests. */
	loadHls?: () => Promise<HlsConstructor>;
	/** Chargeur media-chrome (import à effet de bord) — injectable. */
	loadMediaChrome?: () => Promise<unknown>;
	/** Notifié à chaque changement de variante effectif. */
	onQualityChange?: (quality: PlayerQuality) => void;
	/** Notifié sur erreur fatale, après échec des tentatives de reprise. */
	onError?: (error: Error) => void;
	/** Horloge utilisée pour mesurer les fps — injectable pour les tests. */
	now?: () => number;
}

export interface PlaybackStats {
	/** `"1920x1080"`, ou `"0x0"` tant qu'aucune frame n'est décodée. */
	resolution: string;
	/** Débit de la variante courante, en bits/s (0 hors HLS). */
	bitrate: number;
	/** Images/s mesurées entre deux appels ; retombe sur la valeur déclarée. */
	fps: number;
	/** Codec vidéo de la variante courante, `null` si inconnu. */
	codec: string | null;
	/** Secondes de vidéo déjà tamponnées devant la tête de lecture. */
	bufferedAhead: number;
	/** `bufferedAhead` ramené en % de la cible de tampon hls.js. */
	bufferHealth: number;
	/** Estimation de bande passante hls.js, en Mbps (0 hors HLS). */
	networkSpeed: number;
	/** Frames décodées / abandonnées depuis le début de la lecture. */
	droppedFrames: number;
}

export interface PlayerQuality {
	/** Index de variante hls.js, `-1` pour le mode automatique. */
	index: number;
	label: string;
	height: number;
	width: number;
	bitrate: number;
	codec: string | null;
}

const MIME_TYPES: Record<VideoFormat, string> = {
	mp4: "video/mp4",
	webm: "video/webm",
	hls: "application/vnd.apple.mpegurl",
	dash: "application/dash+xml",
};

/** Cible de tampon hls.js par défaut, en secondes (`maxBufferLength`). */
const DEFAULT_TARGET_BUFFER = 30;

/** Type MIME associé à un conteneur. */
export function mimeTypeFor(format: VideoFormat): string {
	return MIME_TYPES[format];
}

/**
 * Devine le conteneur depuis l'URL. Les paramètres de requête et l'ancre sont
 * ignorés : `…/master.m3u8?token=abc` reste du HLS.
 */
export function inferFormat(url: string): VideoFormat {
	const path = url.split(/[?#]/, 1)[0]!.toLowerCase();
	if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
	if (path.endsWith(".mpd")) return "dash";
	if (path.endsWith(".webm")) return "webm";
	return "mp4";
}

/** Libellé d'une variante : `"1080p"`, ou le nom donné par la playlist. */
export function qualityLabel(level: Pick<Level, "height" | "name">): string {
	if (level.height > 0) return `${level.height}p`;
	return level.name || "?";
}

/**
 * Santé du tampon en % : secondes d'avance rapportées à la cible. Bornée à
 * 100 — au-delà de la cible, le tampon est plein, pas « meilleur ».
 */
export function bufferHealthPercent(
	bufferedAhead: number,
	targetSeconds = DEFAULT_TARGET_BUFFER
): number {
	if (targetSeconds <= 0) return 0;
	return Math.max(0, Math.min(100, (bufferedAhead / targetSeconds) * 100));
}

/** Secondes déjà tamponnées devant `currentTime`, en ignorant les trous. */
export function bufferedAheadOf(
	buffered: TimeRanges | undefined,
	currentTime: number
): number {
	if (!buffered) return 0;
	for (let i = 0; i < buffered.length; i++) {
		const start = buffered.start(i);
		const end = buffered.end(i);
		if (currentTime >= start && currentTime <= end) return end - currentTime;
	}
	return 0;
}

/** Squelette media-chrome monté autour de la balise `<video>`. */
const CHROME_CONTROLS = [
	"media-play-button",
	"media-seek-backward-button",
	"media-seek-forward-button",
	"media-mute-button",
	"media-volume-range",
	"media-time-range",
	"media-time-display",
	"media-playback-rate-button",
	"media-fullscreen-button",
] as const;

export class IETVPlayer {
	private readonly config: Required<
		Pick<VideoPlayerConfig, "autoplay" | "controls" | "muted" | "loop" | "preload" | "chrome">
	> &
		VideoPlayerConfig;

	private video?: HTMLVideoElement;
	private hls?: HlsInstance;
	/** Racine créée par `mount()` — `undefined` avec `attach()`. */
	private root?: HTMLElement;
	private lastFrameSample?: { frames: number; at: number };
	private measuredFps = 0;

	constructor(config: VideoPlayerConfig = {}) {
		this.config = {
			autoplay: false,
			controls: true,
			muted: false,
			loop: false,
			preload: "metadata",
			chrome: true,
			...config,
		};
	}

	/**
	 * Construit `<media-controller>` + `<video slot="media">` dans `container`
	 * et renvoie la balise vidéo. Les éléments media-chrome sont enregistrés à
	 * l'import ; sans la dépendance, on retombe sur les contrôles natifs.
	 */
	async mount(container: HTMLElement): Promise<HTMLVideoElement> {
		const doc = container.ownerDocument;
		const video = doc.createElement("video");
		this.applyConfig(video);

		let chromeReady = false;
		if (this.config.chrome) {
			try {
				await (this.config.loadMediaChrome ?? (() => import("media-chrome")))();
				chromeReady = true;
			} catch {
				// media-chrome absent : contrôles natifs, le player reste utilisable.
				chromeReady = false;
			}
		}

		if (chromeReady) {
			video.slot = "media";
			// media-chrome fournit ses propres contrôles : ceux du navigateur
			// feraient doublon.
			video.controls = false;

			const controller = doc.createElement("media-controller");
			controller.appendChild(video);

			const bar = doc.createElement("media-control-bar");
			for (const tag of CHROME_CONTROLS) bar.appendChild(doc.createElement(tag));
			controller.appendChild(bar);

			container.appendChild(controller);
			this.root = controller;
		} else {
			container.appendChild(video);
			this.root = video;
		}

		this.video = video;
		return video;
	}

	/** Utilise une balise `<video>` déjà présente dans le document. */
	attach(video: HTMLVideoElement): void {
		this.video = video;
		this.root = undefined;
		this.applyConfig(video);
	}

	private applyConfig(video: HTMLVideoElement): void {
		video.autoplay = this.config.autoplay;
		video.controls = this.config.controls;
		video.muted = this.config.muted;
		video.loop = this.config.loop;
		video.preload = this.config.preload;
		if (this.config.poster) video.poster = this.config.poster;
		if (this.config.crossOrigin !== undefined) video.crossOrigin = this.config.crossOrigin;
	}

	private requireVideo(): HTMLVideoElement {
		if (!this.video) {
			throw new Error("IETVPlayer : appeler mount() ou attach() avant de charger une source");
		}
		return this.video;
	}

	/**
	 * Charge une source. Le HLS passe par hls.js sauf si le navigateur le lit
	 * nativement (Safari), auquel cas la lecture native est préférée : elle est
	 * matérielle et moins coûteuse.
	 */
	async load(url: string, format: VideoFormat = inferFormat(url)): Promise<void> {
		const video = this.requireVideo();
		this.teardownHls();
		this.lastFrameSample = undefined;
		this.measuredFps = 0;

		if (format !== "hls") {
			if (format === "dash" && !this.canPlayNatively(video, "dash")) {
				throw new Error(
					"IETVPlayer : DASH non supporté nativement — servir la même source en HLS, " +
						"ou attacher un moteur DASH à la balise <video> avant load()"
				);
			}
			video.src = url;
			return;
		}

		if (this.canPlayNatively(video, "hls")) {
			video.src = url;
			return;
		}

		const Hls = await (this.config.loadHls ?? (() => import("hls.js").then((m) => m.default)))();
		if (!Hls.isSupported()) {
			throw new Error("IETVPlayer : HLS indisponible (ni support natif, ni Media Source Extensions)");
		}

		const hls = new Hls({
			startLevel: typeof this.config.startQuality === "number" ? this.config.startQuality : -1,
			...this.config.hlsConfig,
		});

		this.hls = hls;
		this.wireHlsEvents(hls, Hls, video);

		hls.attachMedia(video);
		hls.loadSource(url);
	}

	private canPlayNatively(video: HTMLVideoElement, format: VideoFormat): boolean {
		if (typeof video.canPlayType !== "function") return false;
		return video.canPlayType(MIME_TYPES[format]) !== "";
	}

	private wireHlsEvents(hls: HlsInstance, Hls: HlsConstructor, video: HTMLVideoElement): void {
		hls.on(Hls.Events.LEVEL_SWITCHED, () => {
			const quality = this.getCurrentQuality();
			if (quality) this.config.onQualityChange?.(quality);
		});

		hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
			if (!data.fatal) return;

			// Séquence de reprise recommandée par hls.js : relancer le
			// chargement sur erreur réseau, vider les tampons sur erreur média,
			// abandonner au-delà.
			switch (data.type) {
				case Hls.ErrorTypes.NETWORK_ERROR:
					hls.startLoad();
					return;
				case Hls.ErrorTypes.MEDIA_ERROR:
					hls.recoverMediaError();
					return;
				default:
					this.teardownHls();
					video.removeAttribute("src");
					this.config.onError?.(
						new Error(`hls.js : erreur fatale ${data.type} / ${data.details}`, {
							cause: data.error,
						})
					);
			}
		});
	}

	play(): Promise<void> {
		return this.requireVideo().play();
	}

	pause(): void {
		this.requireVideo().pause();
	}

	seek(seconds: number): void {
		this.requireVideo().currentTime = seconds;
	}

	/**
	 * Variantes disponibles, `auto` en tête. Vide hors HLS : un MP4 progressif
	 * n'expose qu'une seule rendition.
	 */
	getQualities(): PlayerQuality[] {
		if (!this.hls) return [];
		const levels = this.hls.levels ?? [];
		if (levels.length === 0) return [];

		return [
			{ index: -1, label: "auto", height: 0, width: 0, bitrate: 0, codec: null },
			...levels.map((level, index) => ({
				index,
				label: qualityLabel(level),
				height: level.height,
				width: level.width,
				bitrate: level.bitrate,
				codec: level.videoCodec ?? null,
			})),
		];
	}

	/** Variante réellement servie ; `null` hors HLS ou avant le manifeste. */
	getCurrentQuality(): PlayerQuality | null {
		if (!this.hls) return null;
		const level = this.hls.levels?.[this.hls.currentLevel];
		if (!level) return null;
		return {
			index: this.hls.currentLevel,
			label: qualityLabel(level),
			height: level.height,
			width: level.width,
			bitrate: level.bitrate,
			codec: level.videoCodec ?? null,
		};
	}

	/**
	 * Force une variante, ou `"auto"` pour rendre la main à l'ABR. L'index
	 * porte sur `getQualities()` privé de son entrée `auto`.
	 */
	setQuality(quality: "auto" | number): void {
		if (!this.hls) {
			throw new Error("IETVPlayer : le choix de qualité demande une source HLS");
		}
		this.hls.nextLevel = quality === "auto" ? -1 : quality;
	}

	/** `true` quand l'ABR pilote lui-même la variante. */
	isAutoQuality(): boolean {
		return this.hls ? this.hls.autoLevelEnabled : false;
	}

	/**
	 * Instantané de lecture. `fps` est mesuré entre deux appels ; le premier
	 * appel retombe donc sur la fréquence déclarée par la playlist.
	 */
	getStats(): PlaybackStats | undefined {
		const video = this.video;
		if (!video) return undefined;

		const level = this.hls?.levels?.[this.hls.currentLevel];
		const bufferedAhead = bufferedAheadOf(video.buffered, video.currentTime);
		const targetBuffer =
			this.hls?.config?.maxBufferLength ??
			this.config.hlsConfig?.maxBufferLength ??
			DEFAULT_TARGET_BUFFER;

		const quality = video.getVideoPlaybackQuality?.();

		return {
			resolution: `${video.videoWidth}x${video.videoHeight}`,
			bitrate: level?.bitrate ?? 0,
			fps: this.sampleFps(quality?.totalVideoFrames ?? 0) || level?.frameRate || 0,
			codec: level?.videoCodec ?? null,
			bufferedAhead,
			bufferHealth: bufferHealthPercent(bufferedAhead, targetBuffer),
			networkSpeed: this.hls ? this.hls.bandwidthEstimate / 1_000_000 : 0,
			droppedFrames: quality?.droppedVideoFrames ?? 0,
		};
	}

	/** Dérive les fps du delta de frames décodées entre deux relevés. */
	private sampleFps(totalFrames: number): number {
		const now = (this.config.now ?? Date.now)();
		const previous = this.lastFrameSample;
		this.lastFrameSample = { frames: totalFrames, at: now };

		if (!previous) return 0;
		const elapsed = (now - previous.at) / 1000;
		const decoded = totalFrames - previous.frames;
		// Deux relevés trop rapprochés donnent un rapport instable : on garde
		// la dernière mesure valable.
		if (elapsed < 0.2 || decoded < 0) return this.measuredFps;

		this.measuredFps = decoded / elapsed;
		return this.measuredFps;
	}

	private teardownHls(): void {
		if (!this.hls) return;
		this.hls.destroy();
		this.hls = undefined;
	}

	/** Libère hls.js et retire le DOM créé par `mount()`. */
	destroy(): void {
		this.teardownHls();
		if (this.video) {
			this.video.pause();
			this.video.removeAttribute("src");
			this.video.load();
		}
		this.root?.remove();
		this.root = undefined;
		this.video = undefined;
	}
}

export default IETVPlayer;
