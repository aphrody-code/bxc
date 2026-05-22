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
 */

import { join } from "node:path";
import { type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

const homedir = (): string => Bun.env.HOME ?? "/tmp";

export interface InstallOptions {
	dryRun?: boolean;
}

type LightpandaPlatformId = "x86_64-linux" | "aarch64-linux" | "x86_64-macos" | "aarch64-macos";

interface LightpandaPlatform {
	id: LightpandaPlatformId;
	dirName: "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";
	assetName: string;
}

export const VENDOR_DIR = Bun.env.BXC_VENDOR_DIR ?? join(homedir(), ".bxc", "vendor");
const LIGHTPANDA_TAG = Bun.env.LIGHTPANDA_RELEASE_TAG ?? "nightly";

function printUsage(): void {
	Bun.stdout.write(
		`bxc install — download Lightpanda for the current platform

Usage:
  bxc install [options]

Options:
  --dry-run      show what would be downloaded without writing to disk
  --help, -h     print this help
`,
	);
}

function fmtMB(bytes: number): string {
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function streamDownload(
	url: string,
	destPath: string,
	expectedSize: number,
	dryRun: boolean,
): Promise<void> {
	if (dryRun) {
		logger.log(`[dry-run] would download ${url} -> ${destPath}${expectedSize > 0 ? ` (${fmtMB(expectedSize)})` : ""}`);
		return;
	}

	const partial = `${destPath}.partial`;
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
					Bun.stdout.write(`\r[bxc install]   ${fmtMB(written)} / ${fmtMB(totalBytes)} (${pct}%)   `);
					lastPct = pct;
				}
			}
		}
		await writer.flush();
		await writer.end();
	} catch (err) {
		try { writer.end(); } catch {}
		throw err;
	}
	Bun.stdout.write("\n");
	await Bun.$`mv ${partial} ${destPath}`.quiet();
}

export function detectLightpandaPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): LightpandaPlatform | null {
	if (platform === "linux") {
		if (arch === "x64") return { id: "x86_64-linux", dirName: "linux-x64", assetName: "lightpanda-x86_64-linux" };
		if (arch === "arm64") return { id: "aarch64-linux", dirName: "linux-arm64", assetName: "lightpanda-aarch64-linux" };
	}
	if (platform === "darwin") {
		if (arch === "x64") return { id: "x86_64-macos", dirName: "darwin-x64", assetName: "lightpanda-x86_64-macos" };
		if (arch === "arm64") return { id: "aarch64-macos", dirName: "darwin-arm64", assetName: "lightpanda-aarch64-macos" };
	}
	return null;
}

export function resolveLightpandaPath(
	platform: LightpandaPlatform,
	vendorDir: string = VENDOR_DIR,
): string {
	return join(vendorDir, "lightpanda-bin", platform.dirName, "lightpanda");
}

async function fetchLightpandaAsset(
	platform: LightpandaPlatform,
	tag: string,
): Promise<{ url: string; size: number } | null> {
	const overrideUrl = Bun.env.LIGHTPANDA_DOWNLOAD_URL;
	if (overrideUrl) return { url: overrideUrl, size: 0 };

	const apiUrl = `https://api.github.com/repos/lightpanda-io/browser/releases/tags/${encodeURIComponent(tag)}`;
	try {
		const res = await fetch(apiUrl, {
			headers: { "User-Agent": "bxc-install", Accept: "application/vnd.github+json" },
		});
		if (!res.ok) {
			logger.warn(`GitHub API ${apiUrl} -> HTTP ${res.status}`);
			return null;
		}

		const body = (await res.json()) as any;
		const asset = body.assets?.find((a: any) => a.name === platform.assetName);
		if (!asset) {
			logger.warn(`No asset '${platform.assetName}' in release '${tag}'.`);
			return null;
		}
		return { url: asset.browser_download_url, size: asset.size };
	} catch (error) {
		logger.warn(`Failed to connect to ${apiUrl}: ${error}`);
		return null;
	}
}

export async function installLightpanda(
	dryRun = false,
	vendorDir: string = VENDOR_DIR,
): Promise<{ status: "installed" | "present" | "failed" | "unsupported"; path?: string }> {
	const platform = detectLightpandaPlatform();
	if (!platform) return { status: "unsupported" };

	const destPath = resolveLightpandaPath(platform, vendorDir);
	const existing = Bun.file(destPath);
	if (await existing.exists()) {
		if (existing.size > 0) {
			logger.log(`Lightpanda already installed: ${destPath} (${fmtMB(existing.size)})`);
			return { status: "present", path: destPath };
		}
	}

	logger.log(`Fetching Lightpanda release '${LIGHTPANDA_TAG}' for ${platform.dirName}...`);
	const asset = await fetchLightpandaAsset(platform, LIGHTPANDA_TAG);
	if (!asset) return { status: "failed" };

	logger.log(`Downloading Lightpanda: ${asset.url}`);
	try {
		await streamDownload(asset.url, destPath, asset.size, dryRun);
		if (!dryRun) {
			await Bun.$`chmod +x ${destPath}`.quiet();
			logger.log(`Installed Lightpanda: ${destPath}`);
		}
		return { status: "installed", path: destPath };
	} catch (err) {
		logger.warn(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
		return { status: "failed" };
	}
}

export async function runInstall(opts: { dryRun?: boolean }, vendorDir = VENDOR_DIR) {
	const lightpanda = await installLightpanda(opts.dryRun, vendorDir);
	return { lightpanda };
}

export async function main(args: string[], _opts: CommonOptions): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		printUsage();
		return;
	}
	const dryRun = args.includes("--dry-run");
	logger.log(`Installing binaries into ${VENDOR_DIR}${dryRun ? " [dry-run]" : ""}`);
	const lightpanda = await installLightpanda(dryRun, VENDOR_DIR);
	switch (lightpanda.status) {
		case "failed":
			logger.warn("Lightpanda install failed.");
			process.exit(1);
			break;
		case "unsupported":
			// Lightpanda ships no binary for this platform (e.g. Windows): the
			// `static` (HTTP + Rust DOM) profile and the native Chromium core
			// (`bxc chrome`) remain available; only the Lightpanda engine is absent.
			logger.warn(
				`Lightpanda is not available for ${process.platform}/${process.arch}; ` +
					"use the `static` profile or the native Chromium core (`bxc chrome`).",
			);
			process.exit(1);
			break;
		default:
			logger.log("Lightpanda installed successfully.");
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
