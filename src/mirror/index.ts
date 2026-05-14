/**
 * @module bunlight/mirror
 *
 * Public exports for the site-mirror feature. Re-exports `mirrorSite()`
 * and the option/manifest types from `./mirror.ts`.
 */

export {
	type MirrorAssetRecord,
	type MirrorManifest,
	type MirrorOptions,
	type MirrorProfile,
	mirrorSite,
} from "./mirror.ts";
