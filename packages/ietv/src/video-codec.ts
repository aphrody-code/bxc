/**
 * Video codec & compression — transcode + optimization
 *
 * Sera complété avec meilleure lib après recherche
 */

export type VideoCodec = "h264" | "h265" | "vp9" | "av1";
export type AudioCodec = "aac" | "opus" | "mp3";

export interface CompressionProfile {
	name: string;
	videoCodec: VideoCodec;
	audioCodec: AudioCodec;
	resolution: "360p" | "480p" | "720p" | "1080p";
	bitrate: string; // "500k", "2000k", etc.
	fps: number;
}

export interface CompressionJob {
	id: string;
	input: string;
	output: string;
	profile: CompressionProfile;
	progress: number; // 0-100
	status: "pending" | "running" | "done" | "failed";
	eta?: number; // seconds
	error?: string;
}

/**
 * Profils de compression pré-définis
 */
export const COMPRESSION_PROFILES: Record<string, CompressionProfile> = {
	// Mobile low-bandwidth
	mobile_360: {
		name: "Mobile (360p)",
		videoCodec: "h264",
		audioCodec: "aac",
		resolution: "360p",
		bitrate: "500k",
		fps: 24,
	},

	// Mobile normal
	mobile_480: {
		name: "Mobile (480p)",
		videoCodec: "h264",
		audioCodec: "aac",
		resolution: "480p",
		bitrate: "1000k",
		fps: 30,
	},

	// Web optimal (quality/size)
	web_720: {
		name: "Web (720p)",
		videoCodec: "h265",
		audioCodec: "aac",
		resolution: "720p",
		bitrate: "2000k",
		fps: 30,
	},

	// Desktop high-quality
	desktop_1080: {
		name: "Desktop (1080p)",
		videoCodec: "h265",
		audioCodec: "aac",
		resolution: "1080p",
		bitrate: "4000k",
		fps: 30,
	},

	// Future-proof (AV1)
	av1_future: {
		name: "Future (AV1 1080p)",
		videoCodec: "av1",
		audioCodec: "opus",
		resolution: "1080p",
		bitrate: "1500k",
		fps: 30,
	},
};

/**
 * Video Codec Manager
 */
export class VideoCodec {
	/**
	 * Get recommended profile based on device + network
	 */
	static recommendProfile(
		deviceType: "mobile" | "tablet" | "desktop",
		bandwidth: number, // Mbps
	): CompressionProfile {
		if (deviceType === "mobile") {
			return bandwidth < 2 ? COMPRESSION_PROFILES.mobile_360 : COMPRESSION_PROFILES.mobile_480;
		}

		if (deviceType === "tablet") {
			return bandwidth < 5 ? COMPRESSION_PROFILES.mobile_480 : COMPRESSION_PROFILES.web_720;
		}

		// Desktop
		return bandwidth < 8 ? COMPRESSION_PROFILES.web_720 : COMPRESSION_PROFILES.desktop_1080;
	}

	/**
	 * Estimate file size after compression
	 */
	static estimateFileSize(
		durationSeconds: number,
		profile: CompressionProfile,
	): number {
		const bitrate = parseInt(profile.bitrate) * 1000; // Convert k to bits
		const bytes = (bitrate / 8) * durationSeconds; // bits to bytes
		return bytes;
	}

	/**
	 * Format file size for display
	 */
	static formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
	}

	/**
	 * Codec support detection
	 */
	static canPlayCodec(codec: VideoCodec): boolean {
		if (typeof document === "undefined") return false;

		const video = document.createElement("video");
		const mimeTypes: Record<VideoCodec, string> = {
			h264: 'video/mp4; codecs="avc1.42E01E"',
			h265: 'video/mp4; codecs="hev1.1.1.L93.B0"',
			vp9: 'video/webm; codecs="vp9"',
			av1: 'video/mp4; codecs="av01.0.08M.08"',
		};

		return video.canPlayType(mimeTypes[codec]) !== "";
	}

	/**
	 * Quality vs file size tradeoff
	 */
	static getQualityMetrics(profile: CompressionProfile) {
		const metrics: Record<string, { quality: number; filesize: number }> = {
			"360p": { quality: 2, filesize: 1 },
			"480p": { quality: 3, filesize: 1.5 },
			"720p": { quality: 5, filesize: 2.5 },
			"1080p": { quality: 8, filesize: 4 },
		};

		return metrics[profile.resolution] || { quality: 3, filesize: 1.5 };
	}
}

export default VideoCodec;
