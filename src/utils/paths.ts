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
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";

/**
 * Returns the unified root bxc directory (defaults to ~/.bxc).
 * Can be overridden via BXC_DIR or BXC_HOME environment variables.
 * Automatically ensures the directory and its parents exist.
 */
export function getBxcDir(): string {
	const customDir = Bun.env.BXC_DIR ?? Bun.env.BXC_HOME;
	const rootDir = customDir ? customDir : join(homedir(), ".bxc");

	if (!existsSync(rootDir)) {
		mkdirSync(rootDir, { recursive: true });
	}
	return rootDir;
}

/**
 * Returns the unified cookies folder (~/.bxc/cookies).
 */
export function getCookiesDir(): string {
	const dir = join(getBxcDir(), "cookies");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Returns the unified binary folder (~/.bxc/bin).
 */
export function getBinDir(): string {
	const dir = join(getBxcDir(), "bin");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Returns the unified vendor folder (~/.bxc/vendor).
 */
export function getVendorDir(): string {
	const dir = join(getBxcDir(), "vendor");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Returns the unified user data folder (~/.bxc/user-data).
 */
export function getUserDataDir(): string {
	const dir = join(getBxcDir(), "user-data");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Returns a file path inside the unified cache/database.
 */
export function getCacheFile(name = "cache.sqlite"): string {
	return join(getBxcDir(), name);
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
	if (nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.endsWith(".json") || nameOrPath.endsWith(".txt")) {
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
