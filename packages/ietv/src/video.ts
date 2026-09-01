/**
 * Surface vidéo d'IETV : lecture (navigateur) et transcodage (serveur).
 *
 * Le player n'a de sens que dans un document ; l'importer côté serveur est
 * sans danger, ses dépendances (`media-chrome`, `hls.js`) ne sont chargées
 * qu'au montage.
 */

export {
	IETVPlayer,
	bufferHealthPercent,
	bufferedAheadOf,
	inferFormat,
	mimeTypeFor,
	qualityLabel,
	type HlsConstructor,
	type HlsInstance,
	type PlaybackStats,
	type PlayerQuality,
	type VideoFormat,
	type VideoPlayerConfig,
} from "./video-player";

export {
	COMPRESSION_PROFILES,
	VideoCodec,
	VideoTranscoder,
	containerFor,
	ensureNativeCodecs,
	mediabunnyVideoCodec,
	profileHeight,
	resetNativeCodecs,
	type AudioCodecName,
	type CompressionProfile,
	type CompressionProfileName,
	type Container,
	type ConversionLike,
	type MediaInfo,
	type Resolution,
	type TranscodeOptions,
	type TranscodeResult,
	type TranscoderDeps,
	type VideoCodecName,
} from "./video-codec";

export { VideoSearch, type SearchResult, type SearchOptions } from "./video-search";
