// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	internalDeps,
	orderWorkspaces,
	publishAll,
	readWorkspaces,
	type WorkspacePackage,
} from "../../scripts/publish-workspaces.ts";

function pkg(name: string, deps: string[] = [], extra: Partial<WorkspacePackage> = {}): WorkspacePackage {
	return { dir: `packages/${name}`, name: `@aphrody/${name}`, version: "1.0.0", deps: deps.map((d) => `@aphrody/${d}`), ...extra };
}

describe("ordre de publication", () => {
	test("une dépendance interne passe avant le paquet qui l'utilise", () => {
		const ordered = orderWorkspaces([pkg("xai", ["x"]), pkg("x"), pkg("wonderbot", ["ietv"]), pkg("ietv")]);
		const names = ordered.map((p) => p.name);
		expect(names.indexOf("@aphrody/x")).toBeLessThan(names.indexOf("@aphrody/xai"));
		expect(names.indexOf("@aphrody/ietv")).toBeLessThan(names.indexOf("@aphrody/wonderbot"));
	});

	test("l'ordre est déterministe à contrainte égale", () => {
		const packages = [pkg("zukan"), pkg("challonge"), pkg("fut")];
		expect(orderWorkspaces(packages).map((p) => p.name)).toEqual(
			orderWorkspaces([...packages].reverse()).map((p) => p.name),
		);
	});

	test("une dépendance externe au dépôt est ignorée", () => {
		const solo = { ...pkg("frames"), deps: [] };
		expect(orderWorkspaces([solo]).map((p) => p.name)).toEqual(["@aphrody/frames"]);
	});

	test("un cycle est nommé plutôt que bouclé", () => {
		expect(() => orderWorkspaces([pkg("a", ["b"]), pkg("b", ["a"])])).toThrow(/cycle de dépendances/);
	});

	test("ne retient que les dépendances internes déclarées", () => {
		const known = new Set(["@aphrody/x", "@aphrody/ietv"]);
		const deps = internalDeps(
			{
				dependencies: { "@aphrody/x": "1.1.0", zod: "^3" },
				peerDependencies: { "@aphrody/ietv": "0.1.0" },
				devDependencies: { "@aphrody/zukan": "0.1.5" },
			},
			known,
		);
		// Les dépendances de développement ne conditionnent pas la publication.
		expect(deps.sort()).toEqual(["@aphrody/ietv", "@aphrody/x"]);
	});
});

describe("publication", () => {
	const deps = (published: string[] = []) => {
		const calls: string[] = [];
		return {
			calls,
			hooks: {
				isPublished: async (name: string, version: string) => published.includes(`${name}@${version}`),
				publish: async (p: WorkspacePackage) => {
					calls.push(p.name);
				},
			},
		};
	};

	test("saute ce qui est déjà au registre", async () => {
		const { calls, hooks } = deps(["@aphrody/x@1.0.0"]);
		const report = await publishAll([pkg("x"), pkg("frames")], hooks);
		expect(calls).toEqual(["@aphrody/frames"]);
		expect(report).toMatchObject({ published: ["@aphrody/frames"], skipped: ["@aphrody/x"], failed: [] });
	});

	test("ne publie pas un paquet privé", async () => {
		const { calls, hooks } = deps();
		const report = await publishAll([pkg("interne", [], { private: true })], hooks);
		expect(calls).toEqual([]);
		expect(report.published).toEqual([]);
	});

	test("un échec n'arrête pas la série mais retient ce qui en dépend", async () => {
		const calls: string[] = [];
		const report = await publishAll([pkg("x"), pkg("xai", ["x"]), pkg("frames")], {
			isPublished: async () => false,
			publish: async (p) => {
				if (p.name === "@aphrody/x") throw new Error("403 du registre");
				calls.push(p.name);
			},
		});
		// frames est indépendant : il part quand même.
		expect(calls).toEqual(["@aphrody/frames"]);
		expect(report.failed.map((f) => f.name).sort()).toEqual(["@aphrody/x", "@aphrody/xai"]);
		expect(report.failed[1].error).toMatch(/dépendance non publiée/);
	});

	test("journalise chaque décision", async () => {
		const lignes: string[] = [];
		await publishAll([pkg("x")], {
			isPublished: async () => true,
			publish: async () => {},
			log: (m) => lignes.push(m),
		});
		expect(lignes[0]).toMatch(/sauté.*@aphrody\/x@1\.0\.0/);
	});
});

describe("lecture du dépôt", () => {
	test("trouve les paquets réels et place la racine après ses dépendances", () => {
		const packages = readWorkspaces(new URL("../..", import.meta.url).pathname);
		const names = packages.map((p) => p.name);
		expect(names).toContain("@aphrody/bxc");
		expect(names).toContain("@aphrody/x");
		expect(packages.every((p) => p.version.length > 0)).toBe(true);

		const ordered = orderWorkspaces(packages).map((p) => p.name);
		const racine = ordered.indexOf("@aphrody/bxc");
		for (const dep of packages.find((p) => p.name === "@aphrody/bxc")?.deps ?? []) {
			expect(ordered.indexOf(dep)).toBeLessThan(racine);
		}
	});
});
