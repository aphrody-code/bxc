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
 * Nettoyage du dépôt : artefacts de build, journaux, dossiers temporaires.
 *
 * Sans passer par `rm -rf` : le script doit tourner sous Windows comme sous
 * Linux, et `rmSync` fait exactement la même chose sans dépendre d'un shell.
 * `vendor/` et l'intérieur des `node_modules` ne sont jamais parcourus — c'est
 * ce qui rend le balayage instantané au lieu de plusieurs secondes.
 *
 * **Simulation par défaut**, comme les purges X : la liste supprime
 * `node_modules/` et `dist/`, donc plusieurs minutes de réinstallation et de
 * recompilation. `--yes` exécute.
 */

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const execute = process.argv.includes("--yes") || process.argv.includes("-y");

console.log(
	execute
		? "🧹 Cleaning repository..."
		: "🧹 Simulation — rien ne sera supprimé (ajouter --yes pour exécuter)",
);

/** Dossiers supprimés à la racine, sans balayage. */
const roots = ["dist", ".turbo", "node_modules", "coverage"];

/** Motifs balayés dans l'arborescence de travail. */
const globs = [
	"**/*.log",
	"**/tmp",
	"**/temp",
	"**/.DS_Store",
	"screenshots/*.png",
];

for (const name of roots) {
	if (!existsSync(join(ROOT, name))) continue;
	if (!execute) {
		console.log(`  - ${name}`);
		continue;
	}
	try {
		rmSync(join(ROOT, name), { recursive: true, force: true });
		console.log(`  - Removed ${name}`);
	} catch (err) {
		console.log(`  ! ${name}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

for (const pattern of globs) {
	const glob = new Bun.Glob(pattern);
	let removed = 0;
	for (const match of glob.scanSync({
		cwd: ROOT,
		onlyFiles: false,
		followSymlinks: false,
		dot: true,
	})) {
		// Ne jamais descendre dans les dépendances ni dans les sources
		// vendorisées : elles ne sont pas à nous, et le balayage y coûte cher.
		if (match.includes("node_modules") || match.startsWith("vendor")) continue;
		removed++;
		if (!execute) continue;
		try {
			rmSync(join(ROOT, match), { recursive: true, force: true });
		} catch {
			// Un fichier disparu entre le balayage et la suppression n'est pas une erreur.
		}
	}
	if (removed) console.log(`  - ${execute ? "Removed " : ""}${removed} × ${pattern}`);
}

console.log(
	execute
		? "✨ Repository cleaned."
		: "✨ Rien n'a été supprimé — relancer avec `--yes` pour nettoyer.",
);
