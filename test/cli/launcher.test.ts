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
 * `bin/bxc.mjs` — lanceur multiplateforme déclaré dans `package.json#bin`.
 *
 * Le lanceur ne s'exécute pas à l'import ici : `BXC_LAUNCHER_NO_MAIN` est posé
 * avant, sinon l'import lancerait la CLI dans le processus de test.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

process.env.BXC_LAUNCHER_NO_MAIN = "1";
// Chemin via une variable : le lanceur est du JavaScript sans déclarations,
// un import littéral déclencherait TS7016 au typecheck.
const launcherPath = "../../bin/bxc.mjs";
const launcher = await import(launcherPath);
const { standaloneSuffix, standaloneCandidates } = launcher as {
	standaloneSuffix: (p: string, a: string) => string | null;
	standaloneCandidates: (dir: string, p: string, a: string) => string[];
};

describe("standaloneSuffix", () => {
	test("couvre les cibles publiées", () => {
		expect(standaloneSuffix("linux", "x64")).toBe("linux-x64");
		expect(standaloneSuffix("linux", "arm64")).toBe("linux-arm64");
		expect(standaloneSuffix("darwin", "x64")).toBe("darwin-x64");
		expect(standaloneSuffix("darwin", "arm64")).toBe("darwin-arm64");
		expect(standaloneSuffix("win32", "x64")).toBe("windows-x64");
	});

	test("null pour ce qui n'est pas publié", () => {
		expect(standaloneSuffix("win32", "arm64")).toBeNull();
		expect(standaloneSuffix("linux", "ia32")).toBeNull();
		expect(standaloneSuffix("freebsd", "x64")).toBeNull();
	});
});

describe("standaloneCandidates", () => {
	test("POSIX : pas de suffixe .exe", () => {
		const dist = join("/repo", "dist", "standalone");
		expect(standaloneCandidates(dist, "linux", "x64")).toEqual([
			join(dist, "bxc-linux-x64"),
			join(dist, "bxc-linux-x64-baseline"),
		]);
	});

	test("Windows : .exe sur chaque candidat, baseline incluse", () => {
		const dist = join("/repo", "dist", "standalone");
		const candidates = standaloneCandidates(dist, "win32", "x64");
		expect(candidates).toHaveLength(2);
		expect(candidates.every((c) => c.endsWith(".exe"))).toBe(true);
		expect(candidates[0]?.endsWith("bxc-windows-x64.exe")).toBe(true);
		expect(candidates[1]?.endsWith("bxc-windows-x64-baseline.exe")).toBe(true);
	});

	test("liste vide sur une cible non publiée", () => {
		expect(standaloneCandidates("/repo/dist", "win32", "arm64")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// `bxc chrome fetch` — snapshot Chromium par plateforme
// ---------------------------------------------------------------------------

const { chromiumSnapshot } = await import("../../src/cli/chrome.ts");

describe("chromiumSnapshot", () => {
	test("chaque plateforme reçoit SON archive", () => {
		expect(chromiumSnapshot("linux", "x64", "1400000")).toBe(
			"https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/1400000/chrome-linux.zip",
		);
		expect(chromiumSnapshot("win32", "x64", "1400000")).toBe(
			"https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/1400000/chrome-win.zip",
		);
		expect(chromiumSnapshot("darwin", "arm64", "1400000")).toContain("Mac_Arm");
	});

	test("null plutôt qu'un binaire de la mauvaise plateforme", () => {
		expect(chromiumSnapshot("win32", "arm64")).toBeNull();
		expect(chromiumSnapshot("linux", "arm64")).toBeNull();
		expect(chromiumSnapshot("freebsd", "x64")).toBeNull();
	});
});
