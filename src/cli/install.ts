#!/usr/bin/env bun
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

/**
 * `bxc install` — download Lightpanda for the current platform.
 *
 * bxc is Lightpanda-only by design. Chrome / Chromium / Firefox /
 * Edge / Safari and any derivative (patchright, Playwright Chromium,
 * Camoufox FF) are forbidden. There are no `--with-*` flags.
 *
 * Usage:
 *   bxc install                  # Lightpanda only (~100 MB)
 *   bxc install --dry-run        # print what would be downloaded, no side effects
 *
 * Environment overrides:
 *   BXC_VENDOR_DIR          — base dir for binaries (default ~/.bxc/vendor)
 *   LIGHTPANDA_RELEASE_TAG       — Lightpanda release tag (default "nightly")
 *   LIGHTPANDA_DOWNLOAD_URL      — skip Google Developers lookup, use this URL directly
 *
 * Bun-native only: Bun.file, Bun.write, Bun.$, fetch global.
 */

import { join } from "node:path";

// Bun-native HOME resolution — no os dependency.
const homedir = (): string => Bun.env.HOME ?? Bun.env.HOME ?? "/tmp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOptions {
	dryRun?: boolean;
}

type LightpandaPlatformId = "x86_64-linux" | "aarch64-linux" | "x86_64-macos" | "aarch64-macos";

interface LightpandaPlatform {
	id: LightpandaPlatformId;
	/** Subdirectory name under vendor/lightpanda-bin */
	dirName: "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";
	assetName: string;
}

/** Chrome for Testing platform tokens. */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default vendor root — can be overridden by env var. */
export const VENDOR_DIR = Bun.env.BXC_VENDOR_DIR ?? join(homedir(), ".bxc", "vendor");

const LIGHTPANDA_TAG = Bun.env.LIGHTPANDA_RELEASE_TAG ?? "nightly";

// Forbidden engine versions removed: bxc is Lightpanda-only.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
	Bun.stdout.write(`[bxc install] ${msg}\n`);
}

function warn(msg: string): void {
	Bun.stderr.write(`[bxc install] WARNING : ${msg}\n`);
}

function fmtMB(bytes: number): string {
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Stream-download a URL to destPath, writing progress to stdout.
 * Uses a .partial temp file for atomicity.
 */
async function streamDownload(
	url: string,
	destPath: string,
	expectedSize: number,
	dryRun: boolean,
): Promise<void> {
	if (dryRun) {
		log(
			`[dry-run] would download ${url} -> ${destPath}${expectedSize > 0 ? ` (${fmtMB(expectedSize)})` : ""}`,
		);
		return;
	}

	const partial = `${destPath}.partial`;
	// Ensure parent directory exists.
	const parentDir = destPath.substring(0, destPath.lastIndexOf("/"));
	await Bun.$`mkdir -p ${parentDir}`.quiet();

	const res = await fetch(url, {
		headers: { "User-Agent": "bxc-install" },
		redirect: "follow",
	});
	if (!res.ok || !res.body) {
		throw new Error(`HTTP ${res.status} downloading ${url}`);
	}

	const contentLength = res.headers.get("content-length");
	const totalBytes = contentLength ? parseInt(contentLength, 10) : expectedSize;

	const writer = Bun.file(partial).writer();
	let written = 0;
	let lastPct = -1;
	const reader = res.body.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			writer.write(value);
			written += value.byteLength;
			if (totalBytes > 0) {
				const pct = Math.floor((written / totalBytes) * 100);
				if (pct !== lastPct && pct % 10 === 0) {
					Bun.stdout.write(
						`\r[bxc install]   ${fmtMB(written)} / ${fmtMB(totalBytes)} (${pct}%)   `,
					);
					lastPct = pct;
				}
			}
		}
		await writer.flush();
		await writer.end();
	} catch (err) {
		try {
			writer.end();
		} catch {
			// best-effort cleanup
		}
		throw err;
	}

	Bun.stdout.write("\n");

	// Atomic rename.
	await Bun.$`mv ${partial} ${destPath}`.quiet();
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function detectLightpandaPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): LightpandaPlatform | null {
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
	}
	return null;
}

// detectChromiumPlatform removed: forbidden engine.

// ---------------------------------------------------------------------------
// Lightpanda install
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path where the Lightpanda binary should be stored.
 */
export function resolveLightpandaPath(
	platform: LightpandaPlatform,
	vendorDir: string = VENDOR_DIR,
): string {
	return join(vendorDir, "lightpanda-bin", platform.dirName, "lightpanda");
}

/**
 * Fetch Google Developers release asset metadata for Lightpanda.
 */
async function fetchLightpandaAsset(
	platform: LightpandaPlatform,
	tag: string,
): Promise<{ url: string; size: number } | null> {
	const overrideUrl = Bun.env.LIGHTPANDA_DOWNLOAD_URL;
	if (overrideUrl) {
		return { url: overrideUrl, size: 0 };
	}

	const apiUrl = `https://api.developers.google.com/repos/lightpanda-io/browser/releases/tags/${encodeURIComponent(tag)}`;
	try {
		const res = await fetch(apiUrl, {
			headers: {
				"User-Agent": "bxc-install",
				Accept: "application/vnd.github+json",
			},
		});
		if (!res.ok) {
			warn(`Google Developers API ${apiUrl} -> HTTP ${res.status}`);
			return null;
		}

		type GHRelease = {
			assets?: Array<{
				name: string;
				size: number;
				browser_download_url: string;
			}>;
		};
		const body = (await res.json()) as GHRelease;
		const asset = body.assets?.find((a) => a.name === platform.assetName);
		if (!asset) {
			warn(
				`No asset '${platform.assetName}' in release '${tag}'. Available: ${body.assets?.map((a) => a.name).join(", ") ?? "none"}`,
			);
			return null;
		}
		return { url: asset.browser_download_url, size: asset.size };
	} catch (error) {
		warn(`Failed to connect to ${apiUrl}: ${error}`);
		return null;
	}
}

/**
 * Install the Lightpanda binary for the current platform.
 * Idempotent: skips if the file already exists with non-zero size.
 */
export async function installLightpanda(
	dryRun = false,
	vendorDir: string = VENDOR_DIR,
): Promise<{ status: "installed" | "present" | "failed" | "unsupported"; path?: string }> {
	const platform = detectLightpandaPlatform();
	if (!platform) {
		warn(
			`Unsupported platform ${process.platform}/${process.arch}. Lightpanda supports linux-x64, linux-arm64, darwin-x64, darwin-arm64.`,
		);
		return { status: "unsupported" };
	}

	const destPath = resolveLightpandaPath(platform, vendorDir);

	// Idempotency check.
	const existing = Bun.file(destPath);
	if (await existing.exists()) {
		if (existing.size > 0) {
			log(`Lightpanda already installed: ${destPath} (${fmtMB(existing.size)})`);
			return { status: "present", path: destPath };
		}
		warn(`Existing file is empty, re-downloading: ${destPath}`);
	}

	log(`Fetching Lightpanda release '${LIGHTPANDA_TAG}' for ${platform.dirName}...`);
	const asset = await fetchLightpandaAsset(platform, LIGHTPANDA_TAG);
	if (!asset) {
		warn(
			"Could not resolve release asset. Manual install: https://developers.google.com/lightpanda-io/browser/releases",
		);
		return { status: "failed" };
	}

	log(`Downloading Lightpanda: ${asset.url}${asset.size > 0 ? ` (${fmtMB(asset.size)})` : ""}`);
	try {
		await streamDownload(asset.url, destPath, asset.size, dryRun);
		if (!dryRun) {
			await Bun.$`chmod +x ${destPath}`.quiet();
			log(`Installed Lightpanda: ${destPath}`);
		}
		return { status: "installed", path: destPath };
	} catch (err) {
		warn(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
		return { status: "failed" };
	}
}

// ---------------------------------------------------------------------------
// Chromium (Chrome for Testing) install
// ---------------------------------------------------------------------------

/**
 * Install Chrome for Testing at the pinned version.
 * Idempotent: skips if the chrome binary already exists.
 */
// installChromium / installCamoufox removed: bxc is Lightpanda-only.
// Forbidden engines: Chrome / Chromium / Firefox / Edge / Safari and any derivative.
// For server-grade anti-detection use launchGhostBrowser from src/profiles/ghost/.

export async function runInstall(
	options: InstallOptions,
	vendorDir: string = VENDOR_DIR,
): Promise<{ lightpanda: Awaited<ReturnType<typeof installLightpanda>> }> {
	const dryRun = options.dryRun ?? false;

	log(`Installing binaries into ${vendorDir}${dryRun ? " [dry-run]" : ""}`);

	const lightpanda = await installLightpanda(dryRun, vendorDir);

	if (lightpanda.status === "failed") {
		warn("Lightpanda install failed. Check warnings above for manual install instructions.");
	} else {
		log("Lightpanda installed successfully.");
	}

	return { lightpanda };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

/**
 * Parse argv for the `install` subcommand and run.
 * argv should be `process.argv.slice(3)` (after "bun", "<script>", "install").
 */
export async function main(argv: string[]): Promise<void> {
	const dryRun = argv.includes("--dry-run");
	const help = argv.includes("--help") || argv.includes("-h");
	if (help) {
		Bun.stdout.write(
			`bxc install — download Lightpanda for the current platform

Usage:
  bxc install [options]

Options:
  --dry-run         print what would be downloaded without side effects
  --help, -h        show this help

Environment overrides:
  BXC_VENDOR_DIR        base directory for binaries (default ~/.bxc/vendor)
  LIGHTPANDA_RELEASE_TAG     Lightpanda release tag (default: nightly)
  LIGHTPANDA_DOWNLOAD_URL    override Lightpanda download URL

bxc is Lightpanda-only. Forbidden engines : Chrome / Chromium /
Firefox / Edge / Safari and any derivative.
`,
		);
		return;
	}

	await runInstall({ dryRun });
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
