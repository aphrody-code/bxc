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
 * platform-paths.ts — résolution de répertoires, purement fonctionnelle.
 *
 * Tout est injectable (`PlatformContext`) pour pouvoir tester la logique
 * Windows depuis Linux et inversement, sans toucher au système de fichiers.
 *
 * Conventions :
 *   - Linux/macOS : XDG (`$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`, …) avec les
 *     replis `~/.config`, `~/.cache`, `~/.local/share`, `~/.local/state`.
 *   - Windows     : `%APPDATA%\bxc` (config) et `%LOCALAPPDATA%\bxc\…`
 *     (cache, données, binaires).
 *   - `~/.bxc` reste la racine historique : si elle existe déjà, elle gagne,
 *     pour ne rien casser sur le VPS de production.
 *
 * Priorité générale : variables d'environnement > racine historique >
 * défauts de la plateforme.
 */

import { posix as posixPath, win32 as win32Path } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/** Contexte plateforme injectable. */
export interface PlatformContext {
	/** `process.platform` — "win32", "linux", "darwin", … */
	readonly platform: NodeJS.Platform;
	/** `process.arch` — "x64", "arm64", … */
	readonly arch: NodeJS.Architecture;
	/** Variables d'environnement (copie ou objet littéral en test). */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Répertoire personnel de l'utilisateur. */
	readonly home: string;
	/** Existence d'un chemin — injectable pour tester sans disque. */
	readonly exists: (path: string) => boolean;
}

/** Contexte du processus courant. */
export function currentPlatformContext(
	overrides: Partial<PlatformContext> = {},
): PlatformContext {
	return {
		platform: process.platform,
		arch: process.arch,
		env: process.env as Record<string, string | undefined>,
		home: homedir(),
		exists: existsSync,
		...overrides,
	};
}

/** `true` quand le contexte décrit une plateforme Windows. */
export function isWindows(ctx: PlatformContext): boolean {
	return ctx.platform === "win32";
}

/**
 * Module `node:path` correspondant au contexte.
 *
 * Permet de simuler des chemins Windows (`C:\Users\…`) depuis un hôte Linux :
 * `join` doit utiliser `\` quand `ctx.platform === "win32"`.
 */
export function pathFor(ctx: PlatformContext): typeof posixPath {
	return isWindows(ctx) ? (win32Path as unknown as typeof posixPath) : posixPath;
}

/** Séparateur de `PATH` : `;` sous Windows, `:` ailleurs. */
export function pathDelimiter(ctx: PlatformContext): string {
	return isWindows(ctx) ? ";" : ":";
}

/** Ajoute `.exe` au nom d'un exécutable sous Windows. */
export function executableName(base: string, ctx: PlatformContext): string {
	if (!isWindows(ctx)) return base;
	return base.toLowerCase().endsWith(".exe") ? base : `${base}.exe`;
}

/**
 * Étend un `~` de tête en chemin absolu.
 *
 * `process.env.HOME` n'existe pas sous Windows : le repli passe par
 * `ctx.home` (issu de `os.homedir()`), jamais par `HOME` seul.
 */
export function expandHome(input: string, ctx: PlatformContext): string {
	if (input !== "~" && !input.startsWith("~/") && !input.startsWith("~\\")) {
		return input;
	}
	const p = pathFor(ctx);
	const rest = input.slice(1).replace(/^[\\/]/, "");
	return rest ? p.join(ctx.home, ...rest.split(/[\\/]/)) : ctx.home;
}

/** Lit une variable d'environnement non vide. */
function envValue(
	ctx: PlatformContext,
	...names: readonly string[]
): string | undefined {
	for (const name of names) {
		const raw = ctx.env[name];
		if (typeof raw === "string" && raw.trim().length > 0) {
			return expandHome(raw.trim(), ctx);
		}
	}
	return undefined;
}

/** Racine historique `~/.bxc` (peut ne pas exister). */
export function legacyRoot(ctx: PlatformContext): string {
	return pathFor(ctx).join(ctx.home, ".bxc");
}

/**
 * Racine unifiée des données bxc.
 *
 * 1. `BXC_DIR` / `BXC_HOME`
 * 2. `~/.bxc` si le dossier existe déjà (VPS de production)
 * 3. défaut de plateforme : `%LOCALAPPDATA%\bxc` (Windows), `~/.bxc` (POSIX)
 */
export function resolveRootDir(ctx: PlatformContext): string {
	const override = envValue(ctx, "BXC_DIR", "BXC_HOME");
	if (override) return override;

	const legacy = legacyRoot(ctx);
	if (ctx.exists(legacy)) return legacy;

	if (isWindows(ctx)) {
		const local = envValue(ctx, "LOCALAPPDATA");
		if (local) return win32Path.join(local, "bxc");
		return win32Path.join(ctx.home, "AppData", "Local", "bxc");
	}
	return legacy;
}

/**
 * Répertoire de configuration utilisateur.
 *
 * Windows : `%APPDATA%\bxc`. POSIX : `$XDG_CONFIG_HOME/bxc` sinon
 * `~/.config/bxc`. La racine historique `~/.bxc` l'emporte quand elle existe,
 * pour que le VPS continue de lire ses fichiers là où ils sont.
 */
export function resolveConfigDir(ctx: PlatformContext): string {
	const override = envValue(ctx, "BXC_CONFIG_DIR");
	if (override) return override;

	const rootOverride = envValue(ctx, "BXC_DIR", "BXC_HOME");
	if (rootOverride) return rootOverride;

	const legacy = legacyRoot(ctx);
	if (ctx.exists(legacy)) return legacy;

	if (isWindows(ctx)) {
		const appData = envValue(ctx, "APPDATA");
		if (appData) return win32Path.join(appData, "bxc");
		return win32Path.join(ctx.home, "AppData", "Roaming", "bxc");
	}
	const xdg = envValue(ctx, "XDG_CONFIG_HOME");
	if (xdg) return posixPath.join(xdg, "bxc");
	return posixPath.join(ctx.home, ".config", "bxc");
}

/** Répertoire de cache (`$XDG_CACHE_HOME/bxc`, `%LOCALAPPDATA%\bxc\cache`). */
export function resolveCacheDir(ctx: PlatformContext): string {
	const override = envValue(ctx, "BXC_CACHE_DIR");
	if (override) return override;

	const rootOverride = envValue(ctx, "BXC_DIR", "BXC_HOME");
	if (rootOverride) return pathFor(ctx).join(rootOverride, "cache");

	const legacy = legacyRoot(ctx);
	if (ctx.exists(legacy)) return posixPath.join(legacy, "cache");

	if (isWindows(ctx)) {
		return win32Path.join(resolveRootDir(ctx), "cache");
	}
	const xdg = envValue(ctx, "XDG_CACHE_HOME");
	if (xdg) return posixPath.join(xdg, "bxc");
	return posixPath.join(ctx.home, ".cache", "bxc");
}

/** Répertoire de données (`$XDG_DATA_HOME/bxc`, `%LOCALAPPDATA%\bxc\data`). */
export function resolveDataDir(ctx: PlatformContext): string {
	const override = envValue(ctx, "BXC_DATA_DIR");
	if (override) return override;

	const rootOverride = envValue(ctx, "BXC_DIR", "BXC_HOME");
	if (rootOverride) return rootOverride;

	const legacy = legacyRoot(ctx);
	if (ctx.exists(legacy)) return legacy;

	if (isWindows(ctx)) return win32Path.join(resolveRootDir(ctx), "data");

	const xdg = envValue(ctx, "XDG_DATA_HOME");
	if (xdg) return posixPath.join(xdg, "bxc");
	return posixPath.join(ctx.home, ".local", "share", "bxc");
}

/**
 * Répertoire d'installation du binaire `bxc` global.
 *
 * POSIX : `~/.local/bin` (pas besoin de `sudo`).
 * Windows : `%LOCALAPPDATA%\bxc\bin`, conforme à ce que pose `install.ps1`.
 */
export function resolveInstallBinDir(ctx: PlatformContext): string {
	const override = envValue(ctx, "BXC_INSTALL_DIR", "BXC_INSTALL");
	if (override) return override;
	if (isWindows(ctx)) return win32Path.join(resolveRootDir(ctx), "bin");
	return posixPath.join(ctx.home, ".local", "bin");
}

/** Répertoire temporaire de la plateforme, sans supposer `/tmp`. */
export function resolveTempDir(ctx: PlatformContext): string {
	const fromEnv = envValue(ctx, "TMPDIR", "TEMP", "TMP");
	if (fromEnv) return fromEnv;
	if (isWindows(ctx)) return win32Path.join(ctx.home, "AppData", "Local", "Temp");
	return "/tmp";
}
