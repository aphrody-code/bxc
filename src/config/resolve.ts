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
 * resolve.ts — résolution centralisée de la configuration bxc.
 *
 * Une seule fonction, `resolveBxcConfig()`, entièrement injectable :
 * plateforme, environnement, home et lecture de fichier sont des paramètres.
 * Aucun `Bun.env` dispersé, aucune lecture de disque implicite → testable
 * sans réseau, sans disque et avec des chemins Windows simulés.
 *
 * Ordre de priorité (du plus fort au plus faible) :
 *   1. variables d'environnement (`BXC_*`)
 *   2. fichier de configuration utilisateur (`<configDir>/config.json`)
 *   3. défauts dérivés de la plateforme
 */

import {
	currentPlatformContext,
	pathFor,
	resolveCacheDir,
	resolveConfigDir,
	resolveDataDir,
	resolveInstallBinDir,
	resolveRootDir,
	type PlatformContext,
} from "../utils/platform-paths.ts";

/** Dépôt GitHub des releases officielles. */
export const DEFAULT_RELEASE_REPO = "aphrody-code/bxc";

/** Réglages effectifs, tous résolus en chemins absolus. */
export interface BxcSettings {
	/** Racine des données bxc (`~/.bxc`, `%LOCALAPPDATA%\bxc`, …). */
	rootDir: string;
	/** Répertoire du fichier de configuration. */
	configDir: string;
	/** Répertoire de cache. */
	cacheDir: string;
	/** Répertoire de données persistantes. */
	dataDir: string;
	/** Bocaux à cookies. */
	cookiesDir: string;
	/** Binaires tiers téléchargés (Lightpanda, …). */
	vendorDir: string;
	/** Binaires extraits du bundle (cdylib FFI, …). */
	binDir: string;
	/** Où `bxc self-update` écrit le binaire global. */
	installDir: string;
	/** Base SQLite d'audit/cache. */
	cacheFile: string;
	/** Dépôt GitHub interrogé pour les mises à jour. */
	releaseRepo: string;
	/** Tag de release Lightpanda visé par `bxc install`. */
	lightpandaTag: string;
	/** Proxy HTTP/SOCKS par défaut. */
	proxy?: string;
	/** Désactive la validation TLS. */
	insecure: boolean;
	/** Réduit la sortie. */
	quiet: boolean;
	/** Délai global par défaut, en millisecondes. */
	timeoutMs: number;
}

/** Provenance de chaque réglage. */
export type SettingSource = "env" | "file" | "default";

export interface ResolvedBxcConfig {
	readonly settings: BxcSettings;
	readonly sources: Readonly<Record<keyof BxcSettings, SettingSource>>;
	/** Chemin du fichier de configuration considéré (existant ou non). */
	readonly configPath: string;
	/** `true` si le fichier a été lu et analysé avec succès. */
	readonly configLoaded: boolean;
	/** Message d'erreur si le fichier existe mais est illisible/invalide. */
	readonly configError?: string;
}

/** Forme (partielle) du fichier `config.json`. */
export interface BxcConfigFile {
	rootDir?: string;
	cookiesDir?: string;
	vendorDir?: string;
	binDir?: string;
	installDir?: string;
	cacheFile?: string;
	releaseRepo?: string;
	lightpandaTag?: string;
	proxy?: string;
	insecure?: boolean;
	quiet?: boolean;
	timeoutMs?: number;
}

export interface ResolveConfigDeps {
	/** Contexte plateforme (injectable pour simuler Windows). */
	ctx?: PlatformContext;
	/**
	 * Lecture du fichier de configuration. Doit renvoyer `null` quand le
	 * fichier n'existe pas — jamais lever pour un simple ENOENT.
	 */
	readFile?: (path: string) => string | null;
}

function defaultReadFile(path: string): string | null {
	try {
		// `readFileSync` est importé paresseusement : la résolution de config
		// doit rester utilisable dans un contexte sans accès disque.
		const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
		if (!existsSync(path)) return null;
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function envString(
	ctx: PlatformContext,
	...names: readonly string[]
): string | undefined {
	for (const name of names) {
		const raw = ctx.env[name];
		if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
	}
	return undefined;
}

function envBool(
	ctx: PlatformContext,
	...names: readonly string[]
): boolean | undefined {
	const raw = envString(ctx, ...names);
	if (raw === undefined) return undefined;
	const lowered = raw.toLowerCase();
	if (["1", "true", "yes", "on"].includes(lowered)) return true;
	if (["0", "false", "no", "off"].includes(lowered)) return false;
	return undefined;
}

function envInt(
	ctx: PlatformContext,
	...names: readonly string[]
): number | undefined {
	const raw = envString(ctx, ...names);
	if (raw === undefined) return undefined;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Chemin du fichier de configuration pour un contexte donné. */
export function resolveConfigPath(ctx: PlatformContext): string {
	const explicit = envString(ctx, "BXC_CONFIG_FILE");
	if (explicit) return explicit;
	return pathFor(ctx).join(resolveConfigDir(ctx), "config.json");
}

/**
 * Résout la configuration effective.
 *
 * Ne crée aucun répertoire et n'écrit rien : c'est une fonction pure vis-à-vis
 * du système de fichiers, à la lecture du `config.json` près.
 */
export function resolveBxcConfig(
	deps: ResolveConfigDeps = {},
): ResolvedBxcConfig {
	const ctx = deps.ctx ?? currentPlatformContext();
	const readFile = deps.readFile ?? defaultReadFile;
	const p = pathFor(ctx);

	const configPath = resolveConfigPath(ctx);
	let file: BxcConfigFile = {};
	let configLoaded = false;
	let configError: string | undefined;

	const raw = readFile(configPath);
	if (raw !== null) {
		try {
			// Retirer le BOM : Windows PowerShell 5.1 en écrit un avec
			// `Set-Content -Encoding UTF8`, et `JSON.parse` le refuse.
			const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				file = parsed as BxcConfigFile;
				configLoaded = true;
			} else {
				configError = `${configPath}: l'objet racine doit être un objet JSON`;
			}
		} catch (err) {
			configError = `${configPath}: JSON invalide (${
				err instanceof Error ? err.message : String(err)
			})`;
		}
	}

	const sources: Record<string, SettingSource> = {};

	function pick<T>(
		key: keyof BxcSettings,
		fromEnv: T | undefined,
		fromFile: T | undefined,
		fallback: T,
	): T {
		if (fromEnv !== undefined) {
			sources[key] = "env";
			return fromEnv;
		}
		if (fromFile !== undefined) {
			sources[key] = "file";
			return fromFile;
		}
		sources[key] = "default";
		return fallback;
	}

	const rootDir = pick(
		"rootDir",
		envString(ctx, "BXC_DIR", "BXC_HOME"),
		file.rootDir,
		resolveRootDir(ctx),
	);
	const configDir = resolveConfigDir(ctx);
	sources.configDir = ctx.env.BXC_CONFIG_DIR ? "env" : "default";
	const cacheDir = resolveCacheDir(ctx);
	sources.cacheDir = ctx.env.BXC_CACHE_DIR ? "env" : "default";
	const dataDir = resolveDataDir(ctx);
	sources.dataDir = ctx.env.BXC_DATA_DIR ? "env" : "default";

	const settings: BxcSettings = {
		rootDir,
		configDir,
		cacheDir,
		dataDir,
		cookiesDir: pick(
			"cookiesDir",
			envString(ctx, "BXC_COOKIES_DIR"),
			file.cookiesDir,
			p.join(rootDir, "cookies"),
		),
		vendorDir: pick(
			"vendorDir",
			envString(ctx, "BXC_VENDOR_DIR"),
			file.vendorDir,
			p.join(rootDir, "vendor"),
		),
		binDir: pick(
			"binDir",
			envString(ctx, "BXC_BIN_DIR"),
			file.binDir,
			p.join(rootDir, "bin"),
		),
		installDir: pick(
			"installDir",
			envString(ctx, "BXC_INSTALL_DIR", "BXC_INSTALL"),
			file.installDir,
			resolveInstallBinDir(ctx),
		),
		cacheFile: pick(
			"cacheFile",
			envString(ctx, "BXC_CACHE_FILE"),
			file.cacheFile,
			p.join(rootDir, "cache.sqlite"),
		),
		releaseRepo: pick(
			"releaseRepo",
			envString(ctx, "BXC_RELEASE_REPO"),
			file.releaseRepo,
			DEFAULT_RELEASE_REPO,
		),
		lightpandaTag: pick(
			"lightpandaTag",
			envString(ctx, "LIGHTPANDA_RELEASE_TAG"),
			file.lightpandaTag,
			"nightly",
		),
		proxy: pick<string | undefined>(
			"proxy",
			envString(ctx, "BXC_PROXY", "HTTPS_PROXY", "HTTP_PROXY"),
			file.proxy,
			undefined,
		),
		insecure: pick(
			"insecure",
			envBool(ctx, "BXC_INSECURE"),
			file.insecure,
			false,
		),
		quiet: pick("quiet", envBool(ctx, "BXC_QUIET"), file.quiet, false),
		timeoutMs: pick(
			"timeoutMs",
			envInt(ctx, "BXC_TIMEOUT_MS"),
			file.timeoutMs,
			30_000,
		),
	};

	return {
		settings,
		sources: sources as Record<keyof BxcSettings, SettingSource>,
		configPath,
		configLoaded,
		configError,
	};
}

/** Contenu du `config.json` écrit par les installeurs. */
export function defaultConfigFile(ctx: PlatformContext): BxcConfigFile {
	return {
		rootDir: resolveRootDir(ctx),
		installDir: resolveInstallBinDir(ctx),
		releaseRepo: DEFAULT_RELEASE_REPO,
		lightpandaTag: "nightly",
		timeoutMs: 30_000,
	};
}

let _cached: ResolvedBxcConfig | null = null;

/** Configuration du processus courant, résolue une seule fois. */
export function bxcConfig(): ResolvedBxcConfig {
	if (!_cached) _cached = resolveBxcConfig();
	return _cached;
}

/** Réinitialise le cache (tests uniquement). */
export function resetBxcConfigCache(): void {
	_cached = null;
}
