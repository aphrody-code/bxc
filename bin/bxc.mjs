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
 * bxc — lanceur multiplateforme.
 *
 * Équivalent JavaScript de `bin/bxc` (le script bash reste en place pour le
 * lien symbolique du VPS). C'est CE fichier que déclare `package.json#bin` :
 * un `bun install -g` sous Windows produit un shim `.cmd`/`.ps1` exploitable,
 * ce qu'un script `#!/usr/bin/env bash` ne permet pas.
 *
 * Résolution, dans l'ordre :
 *   1. `dist/standalone/bxc-<plateforme>` s'il est présent et exécutable
 *      (sauf `BXC_FROM_SOURCE=1`)
 *   2. `bun run <racine>/src/cli/index.ts`
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const argv = process.argv.slice(2);

/** Suffixe de binaire standalone pour la plateforme courante. */
export function standaloneSuffix(platform = process.platform, arch = process.arch) {
	const archPart = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
	if (!archPart) return null;
	if (platform === "linux") return `linux-${archPart}`;
	if (platform === "darwin") return `darwin-${archPart}`;
	if (platform === "win32") return archPart === "x64" ? "windows-x64" : null;
	return null;
}

/** Chemins candidats du binaire compilé, du plus spécifique au plus général. */
export function standaloneCandidates(
	distDir,
	platform = process.platform,
	arch = process.arch,
) {
	const suffix = standaloneSuffix(platform, arch);
	if (!suffix) return [];
	const ext = platform === "win32" ? ".exe" : "";
	return [
		join(distDir, `bxc-${suffix}${ext}`),
		// La variante baseline (CPU sans AVX2) est la seule produite sur
		// certaines machines Windows : l'accepter évite un repli inutile
		// sur les sources.
		join(distDir, `bxc-${suffix}-baseline${ext}`),
	];
}

function isExecutable(path) {
	if (!existsSync(path)) return false;
	if (process.platform === "win32") return true;
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function run(cmd, args) {
	const res = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true });
	if (res.error) {
		if (res.error.code === "ENOENT") {
			process.stderr.write(
				`bxc: "${cmd}" introuvable dans le PATH. Installez Bun : https://bun.sh\n`,
			);
			process.exit(127);
		}
		throw res.error;
	}
	process.exit(res.status ?? 0);
}

function main() {
	// BXC_FROM_SOURCE=1 force le passage par les sources : les binaires
	// construits avec renommage d'identifiants cassent les eval CDP qui
	// référencent des fonctions par nom. Cf. scripts/build-standalone.ts.
	if (!process.env.BXC_FROM_SOURCE) {
		for (const candidate of standaloneCandidates(join(root, "dist", "standalone"))) {
			if (isExecutable(candidate)) run(candidate, argv);
		}
	}

	const entry = join(root, "src", "cli", "index.ts");
	// `process.execPath` vaut déjà `bun` quand le shim a été généré par Bun ;
	// sinon on retombe sur le `bun` du PATH (`bun.exe` sous Windows).
	const bun =
		process.env.BUN_BIN ??
		(typeof Bun !== "undefined" ? process.execPath : process.platform === "win32" ? "bun.exe" : "bun");
	run(bun, ["run", entry, ...argv]);
}

if (!process.env.BXC_LAUNCHER_NO_MAIN) {
	main();
}
