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

import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { resolveBxcConfig } from "../config/resolve.ts";

/** Crée le répertoire si besoin, puis le renvoie. Idempotent. */
function ensureDir(dir: string): string {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Racine unifiée des données bxc.
 *
 * Résolution déléguée à `resolveBxcConfig()` : `BXC_DIR`/`BXC_HOME`, puis
 * `config.json`, puis le défaut de plateforme (`~/.bxc` sous POSIX,
 * `%LOCALAPPDATA%\bxc` sous Windows quand `~/.bxc` n'existe pas).
 */
export function getBxcDir(): string {
	return ensureDir(resolveBxcConfig().settings.rootDir);
}

/** Bocaux à cookies (`<root>/cookies`, ou `BXC_COOKIES_DIR`). */
export function getCookiesDir(): string {
	return ensureDir(resolveBxcConfig().settings.cookiesDir);
}

/** Binaires extraits du bundle (`<root>/bin`, ou `BXC_BIN_DIR`). */
export function getBinDir(): string {
	return ensureDir(resolveBxcConfig().settings.binDir);
}

/** Binaires tiers téléchargés (`<root>/vendor`, ou `BXC_VENDOR_DIR`). */
export function getVendorDir(): string {
	return ensureDir(resolveBxcConfig().settings.vendorDir);
}

/** Profils de navigateur (`<root>/user-data`). */
export function getUserDataDir(): string {
	return ensureDir(join(getBxcDir(), "user-data"));
}

/**
 * Chemin d'un fichier dans la racine bxc.
 *
 * Le nom par défaut (`cache.sqlite`) respecte `BXC_CACHE_FILE`.
 */
export function getCacheFile(name = "cache.sqlite"): string {
	const { settings } = resolveBxcConfig();
	if (name === "cache.sqlite") return settings.cacheFile;
	return join(settings.rootDir, name);
}

/**
 * Resolves a cookie jar identifier or path.
 *
 * If `nameOrPath` is a simple alphanumeric/kebab name (e.g. "google", "xcom", "challonge"),
 * it automatically maps it to `~/.bxc/cookies/<name>.json`.
 * If the file does not exist, it checks if a `.txt` file exists.
 * Otherwise, it treats it as a standard relative or absolute filesystem path.
 */
export function resolveCookiePath(nameOrPath: string): string {
	if (!nameOrPath) {
		return join(getCookiesDir(), "google.json");
	}

	// If it contains slashes or path symbols, treat as raw path
	if (
		nameOrPath.includes("/") ||
		nameOrPath.includes("\\") ||
		nameOrPath.endsWith(".json") ||
		nameOrPath.endsWith(".txt")
	) {
		return nameOrPath;
	}

	// Try .json first, then fallback to .txt if it exists
	const jsonPath = join(getCookiesDir(), `${nameOrPath}.json`);
	const txtPath = join(getCookiesDir(), `${nameOrPath}.txt`);

	if (!existsSync(jsonPath) && existsSync(txtPath)) {
		return txtPath;
	}

	return jsonPath;
}
