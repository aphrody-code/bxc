#!/usr/bin/env bun
/**
 * Bunlight postinstall — auto-download Lightpanda browser binary for the current platform.
 *
 * Behavior :
 * - Detects platform from process.platform + process.arch
 * - If binary already exists in vendor/lightpanda-bin/<platform>/lightpanda → skip
 * - Otherwise fetches latest GitHub release asset matching the platform, streams to disk via Bun.file().writer()
 * - Idempotent : safe to re-run (skips when file already on disk and non-zero size)
 * - Never blocks install : on any failure (network, unsupported platform, write error) logs a warning and exits 0
 *
 * Opt-out env vars :
 * - BUNLIGHT_NO_AUTOINSTALL=1 → skip entirely (user opt-out)
 * - CI=1                     → skip unless LIGHTPANDA_AUTOINSTALL=1 (CI environments often have caches)
 *
 * Override env vars :
 * - LIGHTPANDA_RELEASE_TAG   → fetch a specific release tag instead of "latest" (defaults to "nightly" upstream)
 * - LIGHTPANDA_DOWNLOAD_URL  → override asset URL entirely
 * - BUNLIGHT_VENDOR_DIR      → override target dir (default vendor/lightpanda-bin)
 *
 * Bun-native APIs only : Bun.file, Bun.write, Bun.$, fetch.
 */

type LightpandaPlatform =
	| "x86_64-linux"
	| "aarch64-linux"
	| "x86_64-macos"
	| "aarch64-macos";

type DetectedPlatform = {
	id: LightpandaPlatform;
	dirName: "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";
	assetName: string;
};

const TAG = process.env.LIGHTPANDA_RELEASE_TAG ?? "nightly";
const VENDOR_DIR_ENV = process.env.BUNLIGHT_VENDOR_DIR;

/**
 * Detect the current platform mapping.
 * Returns null if the platform is unsupported (Windows, freebsd, etc.).
 */
export function detectPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): DetectedPlatform | null {
	if (platform === "linux") {
		if (arch === "x64") {
			return {
				id: "x86_64-linux",
				dirName: "linux-x64",
				assetName: "lightpanda-x86_64-linux",
			};
		}
		if (arch === "arm64") {
			return {
				id: "aarch64-linux",
				dirName: "linux-arm64",
				assetName: "lightpanda-aarch64-linux",
			};
		}
		return null;
	}
	if (platform === "darwin") {
		if (arch === "x64") {
			return {
				id: "x86_64-macos",
				dirName: "darwin-x64",
				assetName: "lightpanda-x86_64-macos",
			};
		}
		if (arch === "arm64") {
			return {
				id: "aarch64-macos",
				dirName: "darwin-arm64",
				assetName: "lightpanda-aarch64-macos",
			};
		}
		return null;
	}
	return null;
}

/**
 * Decide whether the postinstall should run.
 * Returns a reason string if it should skip, or null if it should proceed.
 */
export function shouldSkip(
	env: Record<string, string | undefined> = process.env as Record<
		string,
		string | undefined
	>,
): string | null {
	if (env.BUNLIGHT_NO_AUTOINSTALL === "1") {
		return "BUNLIGHT_NO_AUTOINSTALL=1 (user opt-out)";
	}
	if (env.CI === "1" && env.LIGHTPANDA_AUTOINSTALL !== "1") {
		return "CI=1 detected and LIGHTPANDA_AUTOINSTALL!=1 (CI cache assumed)";
	}
	return null;
}

/**
 * Resolve the absolute target path for the Lightpanda binary.
 */
export function resolveTargetPath(
	platform: DetectedPlatform,
	rootDir: string = import.meta.dir,
	vendorOverride: string | undefined = VENDOR_DIR_ENV,
): string {
	const baseDir = vendorOverride
		? vendorOverride
		: `${rootDir}/../vendor/lightpanda-bin`;
	return `${baseDir}/${platform.dirName}/lightpanda`;
}

function fmtMB(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function log(msg: string): void {
	console.log(`[bunlight postinstall] ${msg}`);
}

function warn(msg: string): void {
	console.warn(`[bunlight postinstall] WARNING : ${msg}`);
}

/**
 * Fetch the GitHub release manifest for a given tag.
 * Returns the asset that matches the platform's assetName, or null on any error.
 */
async function fetchReleaseAsset(
	platform: DetectedPlatform,
	tag: string,
): Promise<{ url: string; size: number } | null> {
	const overrideUrl = process.env.LIGHTPANDA_DOWNLOAD_URL;
	if (overrideUrl) {
		return { url: overrideUrl, size: 0 };
	}
	const apiUrl = `https://api.github.com/repos/lightpanda-io/browser/releases/tags/${encodeURIComponent(tag)}`;
	const res = await fetch(apiUrl, {
		headers: {
			"User-Agent": "bunlight-postinstall",
			Accept: "application/vnd.github+json",
		},
	});
	if (!res.ok) {
		warn(`GitHub API ${apiUrl} → HTTP ${res.status}`);
		return null;
	}
	const body = (await res.json()) as {
		assets?: Array<{
			name: string;
			size: number;
			browser_download_url: string;
		}>;
	};
	const asset = body.assets?.find((a) => a.name === platform.assetName);
	if (!asset) {
		warn(
			`No asset named '${platform.assetName}' in release '${tag}' (assets present : ${body.assets?.map((a) => a.name).join(", ") ?? "none"})`,
		);
		return null;
	}
	return { url: asset.browser_download_url, size: asset.size };
}

/**
 * Stream-download a URL into a target file via Bun.file().writer().
 * Writes to <target>.partial first, then atomic-renames to target.
 */
async function streamDownload(
	url: string,
	targetPath: string,
	expectedSize: number,
): Promise<{ written: number }> {
	const partial = `${targetPath}.partial`;
	await Bun.$`mkdir -p ${targetPath.substring(0, targetPath.lastIndexOf("/"))}`.quiet();
	const res = await fetch(url, {
		headers: { "User-Agent": "bunlight-postinstall" },
		redirect: "follow",
	});
	if (!res.ok || !res.body) {
		throw new Error(`download failed : HTTP ${res.status} for ${url}`);
	}
	const writer = Bun.file(partial).writer();
	let written = 0;
	const reader = res.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			writer.write(value);
			written += value.byteLength;
		}
		await writer.flush();
		await writer.end();
	} catch (err) {
		try {
			writer.end();
		} catch {
			// ignore — best-effort cleanup
		}
		throw err;
	}
	if (expectedSize > 0 && written !== expectedSize) {
		throw new Error(
			`size mismatch : expected ${expectedSize} bytes, got ${written}`,
		);
	}
	await Bun.$`mv ${partial} ${targetPath}`.quiet();
	return { written };
}

/**
 * Run the postinstall flow. Always resolves (never throws) — exit code is always 0
 * to avoid breaking `bun install` on transient errors.
 */
export async function runPostinstall(
	rootDir: string = import.meta.dir,
): Promise<{
	status: "skipped" | "downloaded" | "present" | "failed";
	reason?: string;
	path?: string;
}> {
	const skipReason = shouldSkip();
	if (skipReason !== null) {
		log(`skipping : ${skipReason}`);
		return { status: "skipped", reason: skipReason };
	}

	const platform = detectPlatform();
	if (!platform) {
		warn(
			`unsupported platform ${process.platform}/${process.arch} — Lightpanda is currently published for linux x64/arm64 and darwin x64/arm64 only. Falling back to manual install.`,
		);
		return {
			status: "skipped",
			reason: `unsupported platform ${process.platform}/${process.arch}`,
		};
	}

	const targetPath = resolveTargetPath(platform, rootDir);

	const existing = Bun.file(targetPath);
	if (await existing.exists()) {
		const size = existing.size;
		if (size > 0) {
			log(
				`already present : ${targetPath} (${fmtMB(size)}) — skipping download`,
			);
			return { status: "present", path: targetPath };
		}
		warn(`existing file is empty, re-downloading : ${targetPath}`);
	}

	log(
		`detected ${platform.dirName} (${platform.id}), looking up release '${TAG}'`,
	);
	const asset = await fetchReleaseAsset(platform, TAG);
	if (!asset) {
		warn(
			`could not resolve release asset — manual install required : https://github.com/lightpanda-io/browser/releases`,
		);
		return { status: "failed", reason: "release asset lookup failed" };
	}

	log(
		`downloading ${asset.url} → ${targetPath}${asset.size ? ` (${fmtMB(asset.size)})` : ""}`,
	);
	try {
		const { written } = await streamDownload(asset.url, targetPath, asset.size);
		await Bun.$`chmod +x ${targetPath}`.quiet();
		log(`installed lightpanda binary : ${targetPath} (${fmtMB(written)})`);
		return { status: "downloaded", path: targetPath };
	} catch (err) {
		warn(
			`download failed : ${err instanceof Error ? err.message : String(err)}. Manual install : https://github.com/lightpanda-io/browser/releases`,
		);
		return {
			status: "failed",
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

// ---------------------------------------------------------------------------
// Extended profile install via BUNLIGHT_INSTALL_PROFILES env var
// ---------------------------------------------------------------------------

/**
 * Parse the BUNLIGHT_INSTALL_PROFILES env var and run additional installs.
 *
 * Supported values (comma-separated) :
 *   stealth  — install Chrome for Testing (required by profile=stealth)
 *   max      — install Camoufox v135 (required by profile=max)
 *   all      — both of the above
 *
 * This runs after the standard Lightpanda install.
 * Always resolves — never throws — does not affect the exit code.
 *
 * Requires BUNLIGHT_NO_PROMPT=1 or non-interactive stdin because postinstall
 * cannot prompt the user interactively. If prompt suppression is not set and
 * "max" is requested, the install is skipped with a warning.
 */
export async function runProfileInstalls(): Promise<void> {
	const profilesEnv = process.env.BUNLIGHT_INSTALL_PROFILES;
	if (!profilesEnv) return;

	const tokens = profilesEnv
		.toLowerCase()
		.split(",")
		.map((s) => s.trim());
	const wantStealth =
		tokens.includes("stealth") ||
		tokens.includes("all") ||
		tokens.includes("chromium");
	const wantMax =
		tokens.includes("max") ||
		tokens.includes("all") ||
		tokens.includes("camoufox");

	if (!wantStealth && !wantMax) return;

	// Lazy-import install helpers to avoid loading them in the common path.
	let installChromium: typeof import("../src/cli/install.ts").installChromium;
	let installCamoufox: typeof import("../src/cli/install.ts").installCamoufox;
	try {
		const installMod = await import("../src/cli/install.ts");
		installChromium = installMod.installChromium;
		installCamoufox = installMod.installCamoufox;
	} catch (err) {
		warn(
			`[profile-install] could not load install module : ${err instanceof Error ? err.message : String(err)}`,
		);
		return;
	}

	if (wantStealth) {
		log(
			"[profile-install] BUNLIGHT_INSTALL_PROFILES includes stealth — installing Chrome for Testing...",
		);
		try {
			const result = await installChromium(false);
			if (result.status === "failed") {
				warn(
					"[profile-install] Chrome for Testing install failed (non-fatal).",
				);
			}
		} catch (err) {
			warn(
				`[profile-install] Chrome for Testing install error : ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (wantMax) {
		if (process.env.BUNLIGHT_NO_PROMPT !== "1") {
			warn(
				"[profile-install] Camoufox install requested via BUNLIGHT_INSTALL_PROFILES=max but" +
					" BUNLIGHT_NO_PROMPT is not set. Skipping to avoid hanging a non-interactive install." +
					" Set BUNLIGHT_NO_PROMPT=1 to auto-confirm.",
			);
			return;
		}
		log(
			"[profile-install] BUNLIGHT_INSTALL_PROFILES includes max — installing Camoufox...",
		);
		try {
			const result = await installCamoufox(false);
			if (result.status === "failed") {
				warn("[profile-install] Camoufox install failed (non-fatal).");
			}
		} catch (err) {
			warn(
				`[profile-install] Camoufox install error : ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

if (import.meta.main) {
	// Hard guard : a postinstall must NEVER break `bun install` / `bun update`,
	// even on a module-load throw or an unexpected rejection. Any error here is
	// logged and swallowed — exit code is unconditionally 0.
	try {
		await runPostinstall();
		// Fire-and-forget : failures are logged, never affect the exit code.
		await runProfileInstalls();
	} catch (err) {
		warn(
			`postinstall aborted (non-fatal) : ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	process.exit(0);
}
