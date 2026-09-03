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
 * Résolution de chemins multiplateforme.
 *
 * Toute la logique Windows est vérifiée depuis Linux : le contexte
 * (`platform`, `env`, `home`, `exists`) est injecté, aucun accès disque.
 */

import { describe, expect, test } from "bun:test";
import {
	executableName,
	expandHome,
	isWindows,
	legacyRoot,
	pathDelimiter,
	resolveCacheDir,
	resolveConfigDir,
	resolveDataDir,
	resolveInstallBinDir,
	resolveRootDir,
	resolveTempDir,
	type PlatformContext,
} from "../../src/utils/platform-paths.ts";

function linux(
	env: Record<string, string | undefined> = {},
	exists: (p: string) => boolean = () => false,
): PlatformContext {
	return {
		platform: "linux",
		arch: "x64",
		env,
		home: "/home/ubuntu",
		exists,
	};
}

function windows(
	env: Record<string, string | undefined> = {},
	exists: (p: string) => boolean = () => false,
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
		exists,
	};
}

describe("isWindows / pathDelimiter / executableName", () => {
	test("détecte la plateforme", () => {
		expect(isWindows(windows())).toBe(true);
		expect(isWindows(linux())).toBe(false);
	});

	test("sépare le PATH avec ';' sous Windows", () => {
		expect(pathDelimiter(windows())).toBe(";");
		expect(pathDelimiter(linux())).toBe(":");
	});

	test("ajoute .exe une seule fois", () => {
		expect(executableName("bxc", windows())).toBe("bxc.exe");
		expect(executableName("bxc.exe", windows())).toBe("bxc.exe");
		expect(executableName("bxc.EXE", windows())).toBe("bxc.EXE");
		expect(executableName("bxc", linux())).toBe("bxc");
	});
});

describe("expandHome", () => {
	test("étend ~ sans passer par HOME", () => {
		// `HOME` est volontairement absent : c'est le cas Windows.
		expect(expandHome("~/.bxc/cookies", linux())).toBe(
			"/home/ubuntu/.bxc/cookies",
		);
		expect(expandHome("~/.bxc/cookies", windows())).toBe(
			"C:\\Users\\yohan\\.bxc\\cookies",
		);
	});

	test("accepte un séparateur Windows en entrée", () => {
		expect(expandHome("~\\.bxc\\bin", windows())).toBe(
			"C:\\Users\\yohan\\.bxc\\bin",
		);
	});

	test("laisse les chemins absolus intacts", () => {
		expect(expandHome("/var/lib/bxc", linux())).toBe("/var/lib/bxc");
		expect(expandHome("D:\\data\\bxc", windows())).toBe("D:\\data\\bxc");
		expect(expandHome("relatif/ok", linux())).toBe("relatif/ok");
	});

	test("~ seul renvoie le home", () => {
		expect(expandHome("~", windows())).toBe("C:\\Users\\yohan");
	});
});

describe("resolveRootDir", () => {
	test("BXC_DIR gagne sur tout", () => {
		expect(resolveRootDir(linux({ BXC_DIR: "/srv/bxc" }))).toBe("/srv/bxc");
		expect(resolveRootDir(windows({ BXC_DIR: "D:\\bxc" }))).toBe("D:\\bxc");
	});

	test("BXC_HOME est accepté comme alias", () => {
		expect(resolveRootDir(linux({ BXC_HOME: "/srv/bxc2" }))).toBe("/srv/bxc2");
	});

	test("un BXC_DIR avec ~ est étendu", () => {
		expect(resolveRootDir(linux({ BXC_DIR: "~/ailleurs" }))).toBe(
			"/home/ubuntu/ailleurs",
		);
	});

	test("POSIX : ~/.bxc reste le défaut (production VPS)", () => {
		expect(resolveRootDir(linux())).toBe("/home/ubuntu/.bxc");
	});

	test("Windows : %LOCALAPPDATA%\\bxc quand ~/.bxc n'existe pas", () => {
		expect(resolveRootDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc",
		);
	});

	test("Windows : ~/.bxc l'emporte s'il existe déjà", () => {
		const ctx = windows({}, (p) => p === "C:\\Users\\yohan\\.bxc");
		expect(resolveRootDir(ctx)).toBe("C:\\Users\\yohan\\.bxc");
	});

	test("Windows sans LOCALAPPDATA : replie sur AppData\\Local", () => {
		const ctx = windows({ LOCALAPPDATA: undefined });
		expect(resolveRootDir(ctx)).toBe("C:\\Users\\yohan\\AppData\\Local\\bxc");
	});
});

describe("resolveConfigDir", () => {
	test("POSIX : XDG_CONFIG_HOME puis ~/.config", () => {
		expect(resolveConfigDir(linux({ XDG_CONFIG_HOME: "/home/u/.cfg" }))).toBe(
			"/home/u/.cfg/bxc",
		);
		expect(resolveConfigDir(linux())).toBe("/home/ubuntu/.config/bxc");
	});

	test("Windows : %APPDATA%\\bxc", () => {
		expect(resolveConfigDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Roaming\\bxc",
		);
	});

	test("~/.bxc existant reste la config du VPS", () => {
		const ctx = linux({}, (p) => p === "/home/ubuntu/.bxc");
		expect(resolveConfigDir(ctx)).toBe("/home/ubuntu/.bxc");
	});

	test("BXC_CONFIG_DIR gagne", () => {
		expect(resolveConfigDir(linux({ BXC_CONFIG_DIR: "/etc/bxc" }))).toBe(
			"/etc/bxc",
		);
	});
});

describe("resolveCacheDir / resolveDataDir", () => {
	test("POSIX : XDG puis ~/.cache et ~/.local/share", () => {
		expect(resolveCacheDir(linux())).toBe("/home/ubuntu/.cache/bxc");
		expect(resolveDataDir(linux())).toBe("/home/ubuntu/.local/share/bxc");
		expect(resolveCacheDir(linux({ XDG_CACHE_HOME: "/c" }))).toBe("/c/bxc");
		expect(resolveDataDir(linux({ XDG_DATA_HOME: "/d" }))).toBe("/d/bxc");
	});

	test("Windows : sous %LOCALAPPDATA%\\bxc", () => {
		expect(resolveCacheDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\cache",
		);
		expect(resolveDataDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\data",
		);
	});

	test("BXC_DIR force tout sous la même racine", () => {
		expect(resolveCacheDir(windows({ BXC_DIR: "D:\\bxc" }))).toBe(
			"D:\\bxc\\cache",
		);
		expect(resolveDataDir(linux({ BXC_DIR: "/srv/bxc" }))).toBe("/srv/bxc");
	});
});

describe("resolveInstallBinDir", () => {
	test("POSIX : ~/.local/bin, sans sudo", () => {
		expect(resolveInstallBinDir(linux())).toBe("/home/ubuntu/.local/bin");
	});

	test("Windows : la racine bxc + \\bin, comme install.ps1", () => {
		expect(resolveInstallBinDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\bxc\\bin",
		);
	});

	test("BXC_INSTALL_DIR et BXC_INSTALL sont honorés", () => {
		expect(resolveInstallBinDir(linux({ BXC_INSTALL_DIR: "/opt/bin" }))).toBe(
			"/opt/bin",
		);
		expect(resolveInstallBinDir(windows({ BXC_INSTALL: "D:\\bin" }))).toBe(
			"D:\\bin",
		);
	});
});

describe("resolveTempDir", () => {
	test("POSIX : TMPDIR puis /tmp", () => {
		expect(resolveTempDir(linux({ TMPDIR: "/scratch" }))).toBe("/scratch");
		expect(resolveTempDir(linux())).toBe("/tmp");
	});

	test("Windows : TEMP, jamais /tmp", () => {
		expect(resolveTempDir(windows({ TEMP: "C:\\Temp" }))).toBe("C:\\Temp");
		expect(resolveTempDir(windows())).toBe(
			"C:\\Users\\yohan\\AppData\\Local\\Temp",
		);
	});
});

describe("legacyRoot", () => {
	test("est ~/.bxc sur les deux plateformes", () => {
		expect(legacyRoot(linux())).toBe("/home/ubuntu/.bxc");
		expect(legacyRoot(windows())).toBe("C:\\Users\\yohan\\.bxc");
	});
});
