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
 * @module bxc/cli/chrome
 *
 * `bxc chrome` — management of the native Chromium core.
 */

import { join } from "node:path";
import { ROOT, type CommonOptions, logger, parseCommonArgs } from "./shared.ts";

const CARGO_TOML = join(ROOT, "rust-bridge/Cargo.toml");

function resolveBinPath(): string | null {
	const ext = process.platform === "win32" ? ".exe" : "";
	const binName = `bxc-engine${ext}`;

	const paths = [
		join(ROOT, "rust-bridge", "target", "release", binName),
		join(ROOT, "rust-bridge", "target", "debug", binName),
		join(ROOT, "dist", binName),
		join(process.cwd(), binName),
	];

	for (const p of paths) {
		try {
			if (Bun.file(p).size > 0) return p;
		} catch {
			// ignore
		}
	}
	return null;
}

/** Révision de snapshot Chromium téléchargée par `bxc chrome fetch`. */
const CHROMIUM_SNAPSHOT_REVISION =
	Bun.env["BXC_CHROME_SNAPSHOT_REVISION"] ?? "1399999";

/**
 * URL du snapshot Chromium pour la plateforme courante.
 *
 * Les noms de dossier et d'archive viennent de
 * `chromium-browser-snapshots` : ils ne suivent ni `process.platform` ni
 * `process.arch`, d'où la table explicite. `null` quand Google ne publie pas
 * de snapshot pour la cible — mieux vaut le dire que télécharger un binaire
 * Linux sur une machine Windows.
 */
export function chromiumSnapshot(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
	revision: string = CHROMIUM_SNAPSHOT_REVISION,
): string | null {
	const table: Record<string, { dir: string; zip: string }> = {
		"linux-x64": { dir: "Linux_x64", zip: "chrome-linux" },
		"win32-x64": { dir: "Win_x64", zip: "chrome-win" },
		"darwin-x64": { dir: "Mac", zip: "chrome-mac" },
		"darwin-arm64": { dir: "Mac_Arm", zip: "chrome-mac" },
	};
	const entry = table[`${platform}-${arch}`];
	if (!entry) return null;
	return `https://storage.googleapis.com/chromium-browser-snapshots/${entry.dir}/${revision}/${entry.zip}.zip`;
}

/**
 * CLI Entry point for `bxc chrome ...`
 */
export async function main(
	args: string[],
	_opts: CommonOptions,
): Promise<void> {
	const subcommand = args[0];
	const bin = resolveBinPath();

	switch (subcommand) {
		case "fetch": {
			const explicit = args[1] ?? Bun.env["BXC_CHROME_FETCH_URL"];
			if (!explicit && !chromiumSnapshot()) {
				logger.error(
					`Aucun snapshot Chromium connu pour ${process.platform}/${process.arch}. ` +
						`Passez l'URL en argument ou via BXC_CHROME_FETCH_URL.`,
				);
				process.exit(1);
			}
			const url = explicit ?? (chromiumSnapshot() as string);
			logger.log(`[chrome] fetching native Chromium from ${url}...`);
			// Le repli `cargo run` n'est PAS un repli silencieux : il compile, il est lent, et
			// il echouait jusqu'ici en « no bin target named bxc-engine » (deux [[bin]] sans
			// default-run). Le dire, plutot que de laisser l'utilisateur lire un message de
			// cargo qui n'a rien a voir avec ce qu'il a demande.
			if (!bin) {
				logger.warn(
					"binaire bxc-engine introuvable — repli sur `cargo run` (compilation, 2-3 min a froid). " +
						"Pour l'eviter : cargo build -p bxc-engine --release --manifest-path " +
						CARGO_TOML,
				);
			}
			const spawnArgs = bin
				? [bin, "fetch", url]
				: [
						"cargo",
						"run",
						"--manifest-path",
						CARGO_TOML,
						"--bin",
						"bxc-engine",
						"--",
						"fetch",
						url,
					];

			const proc = Bun.spawn(spawnArgs, {
				stdout: "inherit",
				stderr: "inherit",
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				process.exit(exitCode);
			}
			break;
		}

		case "launch": {
			const pathIdx = args.indexOf("--path");
			let chromePath =
				pathIdx !== -1 ? args[pathIdx + 1] : Bun.env["BXC_CHROME_BIN"];

			if (!chromePath) {
				chromePath = Bun.env["CHROME_PATH"];
			}

			if (!chromePath) {
				const pathArgs = bin
					? [bin, "chrome-path"]
					: [
							"cargo",
							"run",
							"--manifest-path",
							CARGO_TOML,
							"--bin",
							"bxc-engine",
							"--",
							"chrome-path",
						];

				const pathProc = Bun.spawnSync(pathArgs, { env: Bun.env });
				chromePath = pathProc.stdout
					.toString()
					.trim()
					.split("\n")
					.pop()
					?.trim();
			}

			if (!chromePath) {
				logger.error("chrome path not found and auto-fetch failed.");
				process.exit(1);
			}

			logger.log(`[chrome] launching native Chromium from ${chromePath}...`);
			const launchArgs = bin
				? [bin, "launch", chromePath]
				: [
						"cargo",
						"run",
						"--manifest-path",
						CARGO_TOML,
						"--bin",
						"bxc-engine",
						"--",
						"launch",
						chromePath,
					];

			const proc = Bun.spawn(launchArgs, {
				stdout: "inherit",
				stderr: "inherit",
			});

			process.on("SIGINT", () => proc.kill());
			process.on("SIGTERM", () => proc.kill());

			await proc.exited;
			break;
		}

		default:
			logger.log("Usage: bxc chrome <fetch|launch>");
			process.exit(1);
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
