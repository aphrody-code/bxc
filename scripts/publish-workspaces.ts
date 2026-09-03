#!/usr/bin/env bun
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
 * Publie les paquets du dépôt sur npm, dans le bon ordre.
 *
 * La racine `@aphrody/bxc` épingle **toutes** ses dépendances `@aphrody/*` à
 * une version exacte. Publier la racine sans publier ces paquets livre un
 * paquet qui ne s'installe pas : `bun add @aphrody/bxc` échoue sur la première
 * version absente du registre. Le workflow ne publiait que trois paquets sur
 * quinze — d'où ce script.
 *
 * Deux règles, et rien d'autre :
 *
 *  1. **les dépendances d'abord** : `@aphrody/xai` dépend de `@aphrody/x`,
 *     `@aphrody/wonderbot` de `@aphrody/ietv` — un tri topologique évite de
 *     publier un paquet dont la dépendance n'est pas encore au registre ;
 *  2. **une version déjà publiée est sautée**, pas réessayée : seuls les
 *     paquets effectivement bumpés partent, et le workflow ne s'arrête pas sur
 *     un `EPUBLISHCONFLICT`.
 *
 * Tout ce qui touche au réseau ou au disque est injectable — cf.
 * `test/scripts/publish-workspaces.test.ts`, qui vérifie l'ordre et les sauts
 * sans rien publier.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Un paquet publiable du dépôt. */
export interface WorkspacePackage {
	/** Chemin relatif à la racine du dépôt (`.` pour la racine). */
	dir: string;
	name: string;
	version: string;
	private?: boolean;
	/** Dépendances internes au dépôt, `@aphrody/*` uniquement. */
	deps: string[];
}

/** Dépendances internes déclarées par un `package.json`. */
export function internalDeps(manifest: Record<string, unknown>, known: Set<string>): string[] {
	const all: string[] = [];
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		const block = manifest[field];
		if (block && typeof block === "object") all.push(...Object.keys(block));
	}
	return [...new Set(all.filter((name) => known.has(name)))];
}

/**
 * Trie les paquets pour que chacun paraisse après ses dépendances internes.
 *
 * L'ordre est déterministe : à contrainte égale, l'ordre alphabétique tranche,
 * pour qu'une exécution ressemble à la précédente dans les journaux de CI.
 */
export function orderWorkspaces(packages: WorkspacePackage[]): WorkspacePackage[] {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const ordered: WorkspacePackage[] = [];
	const done = new Set<string>();
	const visiting = new Set<string>();

	const visit = (pkg: WorkspacePackage, trail: string[]): void => {
		if (done.has(pkg.name)) return;
		if (visiting.has(pkg.name)) {
			throw new Error(`cycle de dépendances : ${[...trail, pkg.name].join(" → ")}`);
		}
		visiting.add(pkg.name);
		for (const dep of [...pkg.deps].sort()) {
			const target = byName.get(dep);
			if (target) visit(target, [...trail, pkg.name]);
		}
		visiting.delete(pkg.name);
		done.add(pkg.name);
		ordered.push(pkg);
	};

	for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) {
		visit(pkg, []);
	}
	return ordered;
}

/** Lit les paquets du dépôt : les workspaces, puis la racine. */
export function readWorkspaces(root: string): WorkspacePackage[] {
	const dirs = readdirSync(join(root, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join("packages", entry.name))
		.filter((dir) => existsSync(join(root, dir, "package.json")));

	const manifests = [...dirs, "."].map((dir) => ({
		dir,
		manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Record<
			string,
			unknown
		>,
	}));
	const known = new Set(manifests.map(({ manifest }) => String(manifest.name)));

	return manifests.map(({ dir, manifest }) => ({
		dir,
		name: String(manifest.name),
		version: String(manifest.version),
		private: manifest.private === true,
		deps: internalDeps(manifest, known),
	}));
}

/** Points d'injection : le registre et l'exécution des commandes. */
export interface PublishDeps {
	/** Vrai si `name@version` est déjà au registre. */
	isPublished: (name: string, version: string) => Promise<boolean>;
	/** Publie le paquet du répertoire donné. */
	publish: (pkg: WorkspacePackage) => Promise<void>;
	log?: (message: string) => void;
}

/** Ce qu'une exécution a fait, paquet par paquet. */
export interface PublishReport {
	published: string[];
	skipped: string[];
	failed: Array<{ name: string; error: string }>;
}

/**
 * Publie tout ce qui doit l'être.
 *
 * Un échec n'interrompt pas la série : les paquets suivants qui n'en dépendent
 * pas peuvent encore partir, et le rapport final dit exactement ce qui a
 * échoué. Le script sort en erreur s'il reste quoi que ce soit dans `failed`.
 */
export async function publishAll(
	packages: WorkspacePackage[],
	deps: PublishDeps,
): Promise<PublishReport> {
	const log = deps.log ?? (() => {});
	const report: PublishReport = { published: [], skipped: [], failed: [] };
	const broken = new Set<string>();

	for (const pkg of orderWorkspaces(packages)) {
		if (pkg.private) {
			log(`ignoré ${pkg.name} (privé)`);
			continue;
		}
		const blocking = pkg.deps.filter((dep) => broken.has(dep));
		if (blocking.length) {
			const error = `dépendance non publiée : ${blocking.join(", ")}`;
			log(`échec  ${pkg.name}@${pkg.version} — ${error}`);
			report.failed.push({ name: pkg.name, error });
			broken.add(pkg.name);
			continue;
		}
		if (await deps.isPublished(pkg.name, pkg.version)) {
			log(`sauté  ${pkg.name}@${pkg.version} (déjà publié)`);
			report.skipped.push(pkg.name);
			continue;
		}
		try {
			await deps.publish(pkg);
			log(`publié ${pkg.name}@${pkg.version}`);
			report.published.push(pkg.name);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			log(`échec  ${pkg.name}@${pkg.version} — ${error}`);
			report.failed.push({ name: pkg.name, error });
			broken.add(pkg.name);
		}
	}
	return report;
}

const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

async function isPublishedOnRegistry(name: string, version: string): Promise<boolean> {
	const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}/${version}`, {
		headers: { accept: "application/json" },
	});
	return response.status === 200;
}

async function publishWithBun(root: string, pkg: WorkspacePackage): Promise<void> {
	const proc = Bun.spawn(
		["bun", "publish", "--access", "public", "--registry", REGISTRY],
		{ cwd: join(root, pkg.dir), stdout: "inherit", stderr: "inherit" },
	);
	const code = await proc.exited;
	if (code !== 0) throw new Error(`bun publish a rendu ${code}`);
}

if (import.meta.main) {
	const root = process.cwd();
	const dryRun = process.argv.includes("--dry-run");
	const packages = readWorkspaces(root);

	const report = await publishAll(packages, {
		isPublished: isPublishedOnRegistry,
		publish: dryRun
			? async () => {
					/* --dry-run : on montre l'ordre, on ne publie rien */
				}
			: (pkg) => publishWithBun(root, pkg),
		log: (message) => console.log(message),
	});

	console.log(
		`\n${report.published.length} publié(s), ${report.skipped.length} sauté(s), ${report.failed.length} en échec`,
	);
	if (report.failed.length) process.exit(1);
}
