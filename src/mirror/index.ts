/**
 * @module bunlight/mirror
 *
 * Public exports for the site-mirror feature. Re-exports `mirrorSite()`
 * and the option/manifest types from `./mirror.ts`.
 */

export {
	mirrorSite,
	type MirrorOptions,
	type MirrorProfile,
	type MirrorAssetRecord,
	type MirrorManifest,
} from "./mirror.ts";
