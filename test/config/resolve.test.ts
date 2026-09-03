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
 * Résolution de configuration : env > fichier > défauts.
 *
 * Ni disque ni réseau : `readFile` et le contexte plateforme sont injectés.
 */

import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RELEASE_REPO,
	defaultConfigFile,
	resolveBxcConfig,
	resolveConfigPath,
} from "../../src/config/resolve.ts";
import type { PlatformContext } from "../../src/utils/platform-paths.ts";

function ctxLinux(
	env: Record<string, string | undefined> = {},
): PlatformContext {
	return {
		platform: "linux",
		arch: "x64",
		env,
		home: "/home/ubuntu",
		exists: () => false,
	};
}

function ctxWindows(
	env: Record<string, string | undefined> = {},
): PlatformContext {
	return {
		platform: "win32",
		arch: "x64",
		env: {
			APPDATA: "C:\\Users\\yohan\\AppData\\Roaming",
			LOCALAPPDATA: "C:\\Users\\yohan\\AppData\\Local",
			...env,
		},
		home: "C:\\Users\\yohan",
		exists: () => false,
	};
}

const noFile = () => null;

describe("resolveConfigPath", () => {
	test("POSIX : sous XDG", () => {
		expect(resolveConfigPath(ctxLinux())).toBe(
			"/home/ubuntu/.config/bxc/config.json",
		);
	});

	test("Windows : sous %APPDATA%", () => {
		expect(resolveConfigPath(ctxWindows())).toBe(
			"C:\\Users\\yohan\\AppData\\Roaming\\bxc\\config.json",
		);
	});

	test("BXC_CONFIG_FILE gagne", () => {
		expect(resolveConfigPath(ctxLinux({ BXC_CONFIG_FILE: "/etc/b.json" }))).toBe(
			"/etc/b.json",
		);
	});
});

describe("défauts sans fichier ni variable", () => {
	test("POSIX", () => {
		const { settings, sources, configLoaded } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: noFile,
		});
		expect(configLoaded).toBe(false);
		expect(settings.rootDir).toBe("/home/ubuntu/.bxc");
		expect(settings.cookiesDir).toBe("/home/ubuntu/.bxc/cookies");
		expect(settings.vendorDir).toBe("/home/ubuntu/.bxc/vendor");
		expect(settings.binDir).toBe("/home/ubuntu/.bxc/bin");
		expect(settings.cacheFile).toBe("/home/ubuntu/.bxc/cache.sqlite");
		expect(settings.installDir).toBe("/home/ubuntu/.local/bin");
		expect(settings.releaseRepo).toBe(DEFAULT_RELEASE_REPO);
		expect(settings.timeoutMs).toBe(30_000);
		expect(settings.insecure).toBe(false);
		expect(sources.rootDir).toBe("default");
	});

	test("Windows : aucun chemin POSIX ne subsiste", () => {
		const { settings } = resolveBxcConfig({
			ctx: ctxWindows(),
			readFile: noFile,
		});
		expect(settings.rootDir).toBe("C:\\Users\\yohan\\AppData\\Local\\bxc");
		expect(settings.cookiesDir).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\cookies",
		);
		expect(settings.installDir).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\bin",
		);
		for (const value of Object.values(settings)) {
			if (typeof value === "string") expect(value.startsWith("/")).toBe(false);
		}
	});
});

describe("priorité env > fichier > défaut", () => {
	const file = JSON.stringify({
		rootDir: "/srv/from-file",
		vendorDir: "/srv/from-file/vendor",
		releaseRepo: "fork/bxc",
		timeoutMs: 5000,
		quiet: true,
	});

	test("le fichier écrase les défauts", () => {
		const { settings, sources, configLoaded } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: () => file,
		});
		expect(configLoaded).toBe(true);
		expect(settings.rootDir).toBe("/srv/from-file");
		expect(settings.releaseRepo).toBe("fork/bxc");
		expect(settings.timeoutMs).toBe(5000);
		expect(settings.quiet).toBe(true);
		expect(sources.rootDir).toBe("file");
		expect(sources.releaseRepo).toBe("file");
		// Non mentionné dans le fichier : dérivé de rootDir.
		expect(settings.cookiesDir).toBe("/srv/from-file/cookies");
		expect(sources.cookiesDir).toBe("default");
	});

	test("l'environnement écrase le fichier", () => {
		const { settings, sources } = resolveBxcConfig({
			ctx: ctxLinux({
				BXC_DIR: "/srv/from-env",
				BXC_RELEASE_REPO: "env/bxc",
				BXC_TIMEOUT_MS: "1234",
				BXC_QUIET: "0",
			}),
			readFile: () => file,
		});
		expect(settings.rootDir).toBe("/srv/from-env");
		expect(settings.releaseRepo).toBe("env/bxc");
		expect(settings.timeoutMs).toBe(1234);
		// "0" est bien lu comme faux, il n'écrase pas avec `true`.
		expect(settings.quiet).toBe(false);
		expect(sources.rootDir).toBe("env");
		expect(sources.quiet).toBe("env");
	});

	test("une variable vide ne compte pas comme définie", () => {
		const { settings, sources } = resolveBxcConfig({
			ctx: ctxLinux({ BXC_RELEASE_REPO: "   " }),
			readFile: () => file,
		});
		expect(settings.releaseRepo).toBe("fork/bxc");
		expect(sources.releaseRepo).toBe("file");
	});

	test("BXC_TIMEOUT_MS illisible retombe sur le fichier", () => {
		const { settings } = resolveBxcConfig({
			ctx: ctxLinux({ BXC_TIMEOUT_MS: "beaucoup" }),
			readFile: () => file,
		});
		expect(settings.timeoutMs).toBe(5000);
	});
});

describe("robustesse du fichier", () => {
	test("JSON invalide : défauts conservés + erreur signalée", () => {
		const { settings, configLoaded, configError } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: () => "{ pas du json",
		});
		expect(configLoaded).toBe(false);
		expect(configError).toContain("JSON invalide");
		expect(settings.rootDir).toBe("/home/ubuntu/.bxc");
	});

	test("racine non-objet : refusée sans casser", () => {
		const { configLoaded, configError } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: () => "[1, 2, 3]",
		});
		expect(configLoaded).toBe(false);
		expect(configError).toContain("objet JSON");
	});

	test("fichier absent : aucune erreur", () => {
		const { configError, configLoaded } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: noFile,
		});
		expect(configLoaded).toBe(false);
		expect(configError).toBeUndefined();
	});
});

describe("proxy", () => {
	test("HTTPS_PROXY est repris quand BXC_PROXY est absent", () => {
		const { settings } = resolveBxcConfig({
			ctx: ctxLinux({ HTTPS_PROXY: "http://127.0.0.1:8080" }),
			readFile: noFile,
		});
		expect(settings.proxy).toBe("http://127.0.0.1:8080");
	});

	test("aucun proxy configuré : undefined", () => {
		const { settings } = resolveBxcConfig({
			ctx: ctxLinux(),
			readFile: noFile,
		});
		expect(settings.proxy).toBeUndefined();
	});
});

describe("defaultConfigFile", () => {
	test("décrit ce que posent les installeurs", () => {
		expect(defaultConfigFile(ctxLinux())).toEqual({
			rootDir: "/home/ubuntu/.bxc",
			installDir: "/home/ubuntu/.local/bin",
			releaseRepo: DEFAULT_RELEASE_REPO,
			lightpandaTag: "nightly",
			timeoutMs: 30_000,
		});
		expect(defaultConfigFile(ctxWindows()).installDir).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\bin",
		);
	});
});

describe("BOM UTF-8", () => {
	test("un config.json écrit par PowerShell 5.1 reste lisible", () => {
		// `Set-Content -Encoding UTF8` préfixe le fichier d'un U+FEFF que
		// `JSON.parse` refuse — le resolver doit le retirer.
		const withBom = `﻿${JSON.stringify({ releaseRepo: "fork/bxc" })}`;
		const { settings, configLoaded, configError } = resolveBxcConfig({
			ctx: ctxWindows(),
			readFile: () => withBom,
		});
		expect(configLoaded).toBe(true);
		expect(configError).toBeUndefined();
		expect(settings.releaseRepo).toBe("fork/bxc");
	});
});
