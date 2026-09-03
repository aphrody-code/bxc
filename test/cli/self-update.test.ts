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
 * `bxc self-update` — comparaison de versions, sélection d'asset, plan.
 *
 * Aucun appel réseau : les releases sont des objets littéraux.
 */

import { describe, expect, test } from "bun:test";
import {
	compareVersions,
	detectUpdateTarget,
	isArchiveAsset,
	isNewerVersion,
	parseSelfUpdateArgs,
	parseVersion,
	planUpdate,
	selectAsset,
	type ReleaseInfo,
} from "../../src/cli/self-update.ts";

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

describe("parseVersion", () => {
	test("accepte le préfixe v et les champs manquants", () => {
		expect(parseVersion("v1.2.3")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: [],
		});
		expect(parseVersion("2")).toEqual({
			major: 2,
			minor: 0,
			patch: 0,
			prerelease: [],
		});
	});

	test("découpe la pré-release en identifiants typés", () => {
		expect(parseVersion("1.0.0-rc.2")?.prerelease).toEqual(["rc", 2]);
		expect(parseVersion("0.0.0-dev")?.prerelease).toEqual(["dev"]);
	});

	test("ignore les métadonnées de build", () => {
		expect(parseVersion("1.2.3+abc123")?.patch).toBe(3);
	});

	test("rejette ce qui n'est pas une version", () => {
		expect(parseVersion("")).toBeNull();
		expect(parseVersion("nightly")).toBeNull();
		expect(parseVersion("latest")).toBeNull();
	});
});

describe("compareVersions", () => {
	test("ordonne major, minor, patch", () => {
		expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
		expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
		expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
		expect(compareVersions("0.8.0", "0.8.0")).toBe(0);
		expect(compareVersions("v0.8.0", "0.8.0")).toBe(0);
	});

	test("une pré-release est inférieure à la version finale", () => {
		expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
		expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
		expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
		expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
		// Un identifiant numérique passe avant un alphanumérique (semver §11).
		expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
		// Un préfixe commun mais plus court est inférieur.
		expect(compareVersions("1.0.0-rc", "1.0.0-rc.1")).toBe(-1);
	});

	test("une version illisible est la plus ancienne", () => {
		expect(compareVersions("0.0.0-dev", "0.8.0")).toBe(-1);
		expect(compareVersions("inconnue", "0.8.0")).toBe(-1);
		expect(compareVersions("inconnue", "aussi-inconnue")).toBe(0);
	});

	test("isNewerVersion est strict", () => {
		expect(isNewerVersion("0.8.0", "0.9.0")).toBe(true);
		expect(isNewerVersion("0.8.0", "0.8.0")).toBe(false);
		expect(isNewerVersion("0.9.0", "0.8.0")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Cibles
// ---------------------------------------------------------------------------

describe("detectUpdateTarget", () => {
	test("Linux et macOS visent le binaire nu", () => {
		expect(detectUpdateTarget("linux", "x64")?.assetCandidates[0]).toBe(
			"bxc-linux-x64",
		);
		expect(detectUpdateTarget("linux", "arm64")?.assetCandidates[0]).toBe(
			"bxc-linux-arm64",
		);
		expect(detectUpdateTarget("darwin", "arm64")?.binaryName).toBe("bxc");
	});

	test("macOS accepte encore le nom historique macos-*", () => {
		expect(detectUpdateTarget("darwin", "x64")?.assetCandidates).toContain(
			"bxc-macos-x64",
		);
	});

	test("Windows préfère le .exe, l'archive en repli", () => {
		const target = detectUpdateTarget("win32", "x64");
		expect(target?.binaryName).toBe("bxc.exe");
		expect(target?.assetCandidates[0]).toBe("bxc-windows-x64.exe");
		expect(target?.assetCandidates).toContain("bxc-windows-x64.zip");
	});

	test("Windows baseline vise d'abord la variante baseline", () => {
		const target = detectUpdateTarget("win32", "x64", { baseline: true });
		expect(target?.assetCandidates[0]).toBe("bxc-windows-x64-baseline.exe");
		// Le non-baseline reste un repli acceptable.
		expect(target?.assetCandidates).toContain("bxc-windows-x64.exe");
	});

	test("plateformes et architectures non publiées", () => {
		expect(detectUpdateTarget("win32", "arm64")).toBeNull();
		expect(detectUpdateTarget("linux", "ia32")).toBeNull();
		expect(detectUpdateTarget("freebsd", "x64")).toBeNull();
	});
});

describe("isArchiveAsset", () => {
	test("reconnaît zip, tar.gz et tgz", () => {
		expect(isArchiveAsset("bxc-windows-x64.zip")).toBe(true);
		expect(isArchiveAsset("bxc-linux-x64.tar.gz")).toBe(true);
		expect(isArchiveAsset("bxc-linux-x64.TGZ")).toBe(true);
		expect(isArchiveAsset("bxc-linux-x64")).toBe(false);
		expect(isArchiveAsset("bxc-windows-x64.exe")).toBe(false);
	});
});

describe("selectAsset", () => {
	const assets = [
		{ name: "bxc-linux-x64.tar.gz", browser_download_url: "u1" },
		{ name: "bxc-linux-x64", browser_download_url: "u2" },
	];

	test("respecte l'ordre des candidats, pas celui de la release", () => {
		expect(selectAsset(assets, ["bxc-linux-x64", "bxc-linux-x64.tar.gz"])?.name).toBe(
			"bxc-linux-x64",
		);
	});

	test("retombe sur le candidat suivant", () => {
		expect(selectAsset(assets, ["bxc-linux-arm64", "bxc-linux-x64.tar.gz"])?.name).toBe(
			"bxc-linux-x64.tar.gz",
		);
	});

	test("null quand rien ne matche", () => {
		expect(selectAsset(assets, ["bxc-windows-x64.exe"])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** Release calquée sur ce que publie réellement aphrody-code/bxc. */
function release(tag: string): ReleaseInfo {
	return {
		tag_name: tag,
		assets: [
			{ name: "bxc-linux-x64", browser_download_url: `https://x/${tag}/linux` },
			{ name: "bxc-darwin-arm64", browser_download_url: `https://x/${tag}/mac` },
			{
				name: "bxc-windows-x64.exe",
				browser_download_url: `https://x/${tag}/win`,
			},
		],
	};
}

describe("planUpdate", () => {
	const base = {
		platform: "linux" as NodeJS.Platform,
		arch: "x64" as NodeJS.Architecture,
		destination: "/home/u/.local/bin/bxc",
	};

	test("à jour", () => {
		const plan = planUpdate({
			...base,
			currentVersion: "0.8.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("up-to-date");
		expect(plan.latestVersion).toBe("0.8.0");
		expect(plan.asset).toBeUndefined();
	});

	test("mise à jour disponible : asset et destination résolus", () => {
		const plan = planUpdate({
			...base,
			currentVersion: "0.7.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("update-available");
		expect(plan.asset?.name).toBe("bxc-linux-x64");
		expect(plan.destination).toBe("/home/u/.local/bin/bxc");
	});

	test("--force propose la réinstallation à version égale", () => {
		const plan = planUpdate({
			...base,
			currentVersion: "0.8.0",
			release: release("v0.8.0"),
			force: true,
		});
		expect(plan.status).toBe("update-available");
	});

	test("une version locale plus récente n'est jamais rétrogradée", () => {
		const plan = planUpdate({
			...base,
			currentVersion: "0.9.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("up-to-date");
	});

	test("un binaire de dev est toujours candidat", () => {
		const plan = planUpdate({
			...base,
			currentVersion: "0.0.0-dev",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("update-available");
	});

	test("Windows choisit le .exe", () => {
		const plan = planUpdate({
			...base,
			platform: "win32",
			destination: "C:\\Users\\y\\AppData\\Local\\bxc\\bin\\bxc.exe",
			currentVersion: "0.7.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("update-available");
		expect(plan.asset?.name).toBe("bxc-windows-x64.exe");
		expect(plan.target?.binaryName).toBe("bxc.exe");
	});

	test("plateforme sans binaire publié", () => {
		const plan = planUpdate({
			...base,
			platform: "win32",
			arch: "arm64",
			currentVersion: "0.7.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("unsupported-platform");
	});

	test("release injoignable", () => {
		const plan = planUpdate({ ...base, currentVersion: "0.7.0", release: null });
		expect(plan.status).toBe("release-unavailable");
	});

	test("release sans l'asset attendu", () => {
		const plan = planUpdate({
			...base,
			arch: "arm64",
			currentVersion: "0.7.0",
			release: release("v0.8.0"),
		});
		expect(plan.status).toBe("asset-missing");
		expect(plan.detail).toContain("bxc-linux-arm64");
	});
});

describe("parseSelfUpdateArgs", () => {
	test("--check n'écrit rien", () => {
		expect(parseSelfUpdateArgs(["--check"]).check).toBe(true);
		expect(parseSelfUpdateArgs(["--dry-run"]).check).toBe(true);
		expect(parseSelfUpdateArgs(["-n"]).check).toBe(true);
		expect(parseSelfUpdateArgs([]).check).toBe(false);
	});

	test("lit tag, destination et drapeaux", () => {
		const args = parseSelfUpdateArgs([
			"--tag",
			"v0.9.0",
			"--dest",
			"/opt/bin/bxc",
			"--force",
			"--baseline",
			"--json",
		]);
		expect(args.tag).toBe("v0.9.0");
		expect(args.destination).toBe("/opt/bin/bxc");
		expect(args.force).toBe(true);
		expect(args.baseline).toBe(true);
		expect(args.json).toBe(true);
	});

	test("ignore les arguments inconnus", () => {
		expect(() => parseSelfUpdateArgs(["--inconnu", "valeur"])).not.toThrow();
	});
});
