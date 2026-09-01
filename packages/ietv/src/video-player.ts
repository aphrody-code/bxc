/**
 * Video Player abstraction — support multi-format + streaming
 *
 * Sera complété avec meilleure lib après recherche
 */

export interface VideoPlayerConfig {
	autoplay?: boolean;
	controls?: boolean;
	muted?: boolean;
	loop?: boolean;
	quality?: "360p" | "480p" | "720p" | "1080p" | "auto";
	preload?: "none" | "metadata" | "auto";
}

export interface PlaybackStats {
	resolution: string;
	bitrate: number;
	fps: number;
	codec: string;
	bufferHealth: number; // 0-100%
	networkSpeed: number; // Mbps
}

export class VideoPlayer {
	private config: VideoPlayerConfig;
	private element?: HTMLVideoElement;
	private stats?: PlaybackStats;

	constructor(config: VideoPlayerConfig = {}) {
		this.config = {
			autoplay: false,
			controls: true,
			muted: false,
			loop: false,
			quality: "auto",
			preload: "metadata",
			...config,
		};
	}

	/**
	 * Créer player pour élément HTML
	 */
	attach(element: HTMLVideoElement): void {
		this.element = element;
		this.element.autoplay = this.config.autoplay || false;
		this.element.controls = this.config.controls || true;
		this.element.muted = this.config.muted || false;
		this.element.loop = this.config.loop || false;
		this.element.preload = this.config.preload as any;
	}

	/**
	 * Charger une vidéo
	 */
	async load(url: string, format: "mp4" | "webm" | "hls" | "dash" = "mp4"): Promise<void> {
		if (!this.element) throw new Error("Player not attached to element");

		const source = document.createElement("source");
		source.src = url;
		source.type = this.getMimeType(format);

		this.element.innerHTML = "";
		this.element.appendChild(source);
	}

	/**
	 * Jouer/Pause
	 */
	play(): Promise<void> {
		if (!this.element) throw new Error("Player not attached");
		return this.element.play();
	}

	pause(): void {
		if (!this.element) throw new Error("Player not attached");
		this.element.pause();
	}

	/**
	 * Changer qualité
	 */
	setQuality(quality: "360p" | "480p" | "720p" | "1080p"): void {
		this.config.quality = quality;
		// Implémentation dépend de la source (HLS/DASH avec variants)
	}

	/**
	 * Stats en direct
	 */
	getStats(): PlaybackStats | undefined {
		if (!this.element) return undefined;

		return {
			resolution: `${this.element.videoWidth}x${this.element.videoHeight}`,
			bitrate: 0, // À obtenir depuis video.buffered
			fps: 30, // Approximatif
			codec: "h264", // À détecter
			bufferHealth: this.getBufferHealth(),
			networkSpeed: 0, // À mesurer
		};
	}

	private getBufferHealth(): number {
		if (!this.element?.buffered.length) return 0;

		const buffered = this.element.buffered.end(this.element.buffered.length - 1);
		const duration = this.element.duration;

		return duration > 0 ? (buffered / duration) * 100 : 0;
	}

	private getMimeType(format: string): string {
		const mimeTypes: Record<string, string> = {
			mp4: "video/mp4",
			webm: "video/webm",
			hls: "application/x-mpegURL",
			dash: "application/dash+xml",
		};
		return mimeTypes[format] || "video/mp4";
	}

	destroy(): void {
		if (this.element) {
			this.element.pause();
			this.element.src = "";
		}
	}
}

export default VideoPlayer;
