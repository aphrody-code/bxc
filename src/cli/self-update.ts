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
 * `bxc self-update` — compare la version locale à la dernière release GitHub
 * `aphrody-code/bxc` et remplace le binaire de la cible courante.
 *
 * Multiplateforme :
 *   - Linux/macOS : le binaire est écrit puis `chmod 0755`, remplacement
 *     atomique par `rename`.
 *   - Windows : un exécutable en cours d'exécution ne peut pas être écrasé,
 *     mais il PEUT être renommé. On déplace donc l'ancien vers `.old-<ts>`
 *     avant de mettre le neuf en place, puis on tente la suppression.
 *
 * Tout est injectable (`SelfUpdateDeps`) : aucune requête réseau ni écriture
 * disque dans les tests.
 */

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { type CommonOptions, EXIT, logger } from "./shared.ts";
import {
	currentPlatformContext,
	isWindows,
	pathFor,
	resolveTempDir,
	type PlatformContext,
} from "../utils/platform-paths.ts";
import { resolveBxcConfig } from "../config/resolve.ts";

// ---------------------------------------------------------------------------
// Comparaison de versions
// ---------------------------------------------------------------------------

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	/** Identifiants de pré-release (`1.2.3-rc.1` → ["rc", "1"]). */
	prerelease: readonly (string | number)[];
}

/**
 * Analyse une version sémantique tolérante : `v` de tête accepté, champs
 * manquants comblés par 0, métadonnées `+build` ignorées.
 *
 * Renvoie `null` quand rien d'exploitable n'est trouvé (ex. "0.0.0-dev" reste
 * valide, mais "" ou "nightly" ne le sont pas).
 */
export function parseVersion(input: string): ParsedVersion | null {
	const trimmed = input.trim().replace(/^v/i, "");
	const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
		trimmed,
	);
	if (!match) return null;
	const prerelease = (match[4] ?? "")
		.split(".")
		.filter((s) => s.length > 0)
		.map((s) => (/^\d+$/.test(s) ? Number.parseInt(s, 10) : s));
	return {
		major: Number.parseInt(match[1] ?? "0", 10),
		minor: Number.parseInt(match[2] ?? "0", 10),
		patch: Number.parseInt(match[3] ?? "0", 10),
		prerelease,
	};
}

function comparePrerelease(
	a: readonly (string | number)[],
	b: readonly (string | number)[],
): number {
	// Semver : une version sans pré-release est supérieure à la même avec.
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const x = a[i];
		const y = b[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xNum = typeof x === "number";
		const yNum = typeof y === "number";
		if (xNum && yNum) {
			if (x !== y) return (x as number) < (y as number) ? -1 : 1;
		} else if (xNum !== yNum) {
			// Numérique < alphanumérique.
			return xNum ? -1 : 1;
		} else if (x !== y) {
			return (x as string) < (y as string) ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Compare deux versions : `-1` si `a < b`, `0` si égales, `1` si `a > b`.
 *
 * Une version illisible est traitée comme la plus ancienne possible : un
 * binaire `0.0.0-dev` doit toujours se voir proposer la mise à jour.
 */
export function compareVersions(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	if (!pa && !pb) return 0;
	if (!pa) return -1;
	if (!pb) return 1;
	if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
	if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
	if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
	return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** `true` si `latest` est strictement plus récente que `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
	return compareVersions(current, latest) < 0;
}

// ---------------------------------------------------------------------------
// Sélection de cible
// ---------------------------------------------------------------------------

export interface UpdateTarget {
	/** Suffixe canonique : `linux-x64`, `windows-x64`, … */
	readonly suffix: string;
	/** Noms d'assets acceptés, par ordre de préférence. */
	readonly assetCandidates: readonly string[];
	/** Nom du fichier binaire une fois installé. */
	readonly binaryName: string;
}

/**
 * Cible de release pour une plateforme/architecture.
 *
 * Windows accepte à la fois l'exécutable nu produit par
 * `scripts/build-standalone.ts` (`bxc-windows-x64.exe`) et l'archive produite
 * par `scripts/build-windows.ts` (`bxc-windows-x64.zip`) : l'ordre des
 * candidats décide, la présence réelle dans la release tranche.
 */
export function detectUpdateTarget(
	platform: NodeJS.Platform,
	arch: NodeJS.Architecture,
	opts: { baseline?: boolean } = {},
): UpdateTarget | null {
	const archSuffix = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
	if (!archSuffix) return null;

	if (platform === "win32") {
		if (archSuffix !== "x64") return null;
		const base = opts.baseline ? "bxc-windows-x64-baseline" : "bxc-windows-x64";
		return {
			suffix: opts.baseline ? "windows-x64-baseline" : "windows-x64",
			assetCandidates: [
				`${base}.exe`,
				"bxc-windows-x64.exe",
				`${base}.zip`,
				"bxc-windows-x64.zip",
			],
			binaryName: "bxc.exe",
		};
	}

	if (platform === "linux" || platform === "darwin") {
		const suffix = `${platform}-${archSuffix}`;
		// `macos-*` reste accepté : c'est le nom historique des assets produits
		// par .github/workflows/release.yml avant l'alignement sur `darwin-*`.
		const legacy = platform === "darwin" ? `bxc-macos-${archSuffix}` : null;
		return {
			suffix,
			assetCandidates: [
				`bxc-${suffix}`,
				...(legacy ? [legacy] : []),
				`bxc-${suffix}.tar.gz`,
				...(legacy ? [`${legacy}.tar.gz`] : []),
			],
			binaryName: "bxc",
		};
	}
	return null;
}

/** `true` quand l'asset est une archive à extraire plutôt qu'un binaire nu. */
export function isArchiveAsset(name: string): boolean {
	const lowered = name.toLowerCase();
	return (
		lowered.endsWith(".zip") ||
		lowered.endsWith(".tar.gz") ||
		lowered.endsWith(".tgz")
	);
}

export interface ReleaseAsset {
	readonly name: string;
	readonly browser_download_url: string;
	readonly size?: number;
}

export interface ReleaseInfo {
	readonly tag_name: string;
	readonly assets: readonly ReleaseAsset[];
	readonly html_url?: string;
}

/** Choisit le premier asset de la release qui matche un candidat. */
export function selectAsset(
	assets: readonly ReleaseAsset[],
	candidates: readonly string[],
): ReleaseAsset | null {
	for (const candidate of candidates) {
		const found = assets.find((a) => a.name === candidate);
		if (found) return found;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Plan de mise à jour
// ---------------------------------------------------------------------------

export type UpdateStatus =
	| "up-to-date"
	| "update-available"
	| "unsupported-platform"
	| "asset-missing"
	| "release-unavailable";

export interface UpdatePlan {
	readonly status: UpdateStatus;
	readonly currentVersion: string;
	readonly latestVersion?: string;
	readonly target?: UpdateTarget;
	readonly asset?: ReleaseAsset;
	readonly destination?: string;
	readonly detail?: string;
}

export interface PlanUpdateInput {
	readonly currentVersion: string;
	readonly release: ReleaseInfo | null;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly destination: string;
	readonly baseline?: boolean;
	/** Force la mise à jour même si les versions sont identiques. */
	readonly force?: boolean;
}

/**
 * Décide quoi faire — sans aucun effet de bord.
 *
 * C'est le cœur testable : réseau, disque et horloge sont hors de cette
 * fonction.
 */
export function planUpdate(input: PlanUpdateInput): UpdatePlan {
	const target = detectUpdateTarget(input.platform, input.arch, {
		baseline: input.baseline,
	});
	if (!target) {
		return {
			status: "unsupported-platform",
			currentVersion: input.currentVersion,
			detail: `${input.platform}/${input.arch} n'a pas de binaire publié`,
		};
	}
	if (!input.release) {
		return {
			status: "release-unavailable",
			currentVersion: input.currentVersion,
			target,
			detail: "release GitHub introuvable",
		};
	}

	const latestVersion = input.release.tag_name.replace(/^v/i, "");
	const newer = isNewerVersion(input.currentVersion, latestVersion);
	if (!newer && !input.force) {
		return {
			status: "up-to-date",
			currentVersion: input.currentVersion,
			latestVersion,
			target,
		};
	}

	const asset = selectAsset(input.release.assets, target.assetCandidates);
	if (!asset) {
		return {
			status: "asset-missing",
			currentVersion: input.currentVersion,
			latestVersion,
			target,
			detail: `aucun asset parmi ${target.assetCandidates.join(", ")} dans ${input.release.tag_name}`,
		};
	}

	return {
		status: "update-available",
		currentVersion: input.currentVersion,
		latestVersion,
		target,
		asset,
		destination: input.destination,
	};
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

export interface SelfUpdateDeps {
	readonly ctx?: PlatformContext;
	readonly fetchImpl?: typeof fetch;
	/** Écrit le binaire téléchargé à sa place définitive. */
	readonly writeBinary?: (
		destination: string,
		bytes: Uint8Array,
		ctx: PlatformContext,
	) => void;
	/** Version courante — par défaut celle du binaire en cours. */
	readonly currentVersion?: string;
	/** Horodatage utilisé pour nommer l'ancien binaire (Windows). */
	readonly now?: () => number;
}

/**
 * Écrit le nouveau binaire.
 *
 * Le fichier temporaire vit à côté de la destination (même volume) pour que le
 * `rename` reste atomique — `%TEMP%` et `C:\Users\…` sont souvent sur des
 * volumes différents sous Windows, où un `rename` cross-device échoue.
 */
export function writeBinaryAtomic(
	destination: string,
	bytes: Uint8Array,
	ctx: PlatformContext,
): void {
	const p = pathFor(ctx);
	const dir = p.dirname(destination);
	mkdirSync(dir, { recursive: true });

	const tmp = `${destination}.new-${process.pid}`;
	writeFileSync(tmp, bytes);
	if (!isWindows(ctx)) {
		chmodSync(tmp, 0o755);
	}

	if (isWindows(ctx)) {
		// Un .exe en cours d'exécution ne peut pas être écrasé, mais il peut
		// être renommé : on décale l'ancien puis on met le neuf en place.
		const backup = `${destination}.old-${Date.now()}`;
		try {
			renameSync(destination, backup);
		} catch {
			// Pas de binaire précédent : rien à décaler.
		}
		renameSync(tmp, destination);
		try {
			rmSync(backup, { force: true });
		} catch {
			// Le fichier est encore mappé : Windows le libérera au redémarrage.
		}
		return;
	}

	renameSync(tmp, destination);
}

/**
 * Extrait le binaire `bxc` d'une archive `.zip` / `.tar.gz`.
 *
 * `tar` sait lire les deux formats et est présent partout : bsdtar est livré
 * avec Windows depuis la build 17063, et GNU tar sur Linux/macOS. Ça évite
 * d'embarquer un décompresseur ou d'appeler `unzip`, absent de Windows.
 */
export function extractBinaryFromArchive(
	archiveBytes: Uint8Array,
	binaryName: string,
	workDir: string,
	ctx: PlatformContext,
): Uint8Array<ArrayBuffer> {
	const p = pathFor(ctx);
	const stamp = `${process.pid}-${Date.now()}`;
	const dir = p.join(workDir, `bxc-update-${stamp}`);
	const archivePath = p.join(dir, "asset.archive");
	mkdirSync(dir, { recursive: true });
	try {
		writeFileSync(archivePath, archiveBytes);
		const res = Bun.spawnSync({
			cmd: ["tar", "-xf", archivePath, "-C", dir],
			stdout: "pipe",
			stderr: "pipe",
		});
		if (res.exitCode !== 0) {
			throw new Error(
				`tar -xf a échoué (${res.exitCode}) : ${new TextDecoder().decode(res.stderr).trim()}`,
			);
		}
		const { readdirSync, readFileSync, statSync } =
			require("node:fs") as typeof import("node:fs");
		const stack = [dir];
		while (stack.length > 0) {
			const current = stack.pop() as string;
			for (const entry of readdirSync(current)) {
				const full = p.join(current, entry);
				if (statSync(full).isDirectory()) {
					stack.push(full);
				} else if (entry === binaryName) {
					return new Uint8Array(readFileSync(full));
				}
			}
		}
		throw new Error(`"${binaryName}" introuvable dans l'archive`);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Nettoyage best-effort.
		}
	}
}

/** Interroge l'API GitHub pour la dernière release (ou un tag précis). */
export async function fetchRelease(
	repo: string,
	tag: string | undefined,
	fetchImpl: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
	const url = tag
		? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
		: `https://api.github.com/repos/${repo}/releases/latest`;
	try {
		const res = await fetchImpl(url, {
			headers: {
				"User-Agent": "bxc-self-update",
				Accept: "application/vnd.github+json",
			},
			redirect: "follow",
		});
		if (!res.ok) {
			logger.warn(`GitHub API ${url} -> HTTP ${res.status}`);
			return null;
		}
		const body = (await res.json()) as ReleaseInfo;
		if (!body?.tag_name) return null;
		return { ...body, assets: body.assets ?? [] };
	} catch (err) {
		logger.warn(
			`Impossible de joindre ${url} : ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

export interface SelfUpdateArgs {
	check: boolean;
	force: boolean;
	json: boolean;
	tag?: string;
	destination?: string;
	baseline: boolean;
}

export function parseSelfUpdateArgs(argv: readonly string[]): SelfUpdateArgs {
	const out: SelfUpdateArgs = {
		check: false,
		force: false,
		json: false,
		baseline: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--check":
			case "-n":
			case "--dry-run":
				out.check = true;
				break;
			case "--force":
			case "-f":
				out.force = true;
				break;
			case "--json":
				out.json = true;
				break;
			case "--baseline":
				out.baseline = true;
				break;
			case "--tag":
				out.tag = argv[++i];
				break;
			case "--dest":
			case "--destination":
				out.destination = argv[++i];
				break;
			default:
				break;
		}
	}
	return out;
}

/** Où écrire le binaire mis à jour. */
export function resolveDestination(
	ctx: PlatformContext,
	target: UpdateTarget,
	explicit?: string,
): string {
	if (explicit) return explicit;
	const p = pathFor(ctx);
	// Un binaire compilé se remplace lui-même ; en mode source (`bun run`),
	// `process.execPath` est l'exécutable `bun` : on retombe sur installDir.
	const exec = process.execPath ?? "";
	const execBase = exec ? p.basename(exec).toLowerCase() : "";
	if (execBase === "bxc" || execBase === "bxc.exe") return exec;

	const { settings } = resolveBxcConfig({ ctx });
	return p.join(settings.installDir, target.binaryName);
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc self-update — met à jour le binaire depuis les releases GitHub

Usage:
  bxc self-update [options]

Options:
  --check, -n        n'écrit rien : compare et affiche le verdict
  --force, -f        réinstalle même si la version est déjà à jour
  --tag <vX.Y.Z>     cible une release précise (défaut : latest)
  --dest <path>      chemin du binaire à remplacer
  --baseline         cible la variante baseline (CPU sans AVX2, Windows)
  --json             sortie JSON
  --help, -h         affiche cette aide

Environnement:
  BXC_RELEASE_REPO   dépôt GitHub interrogé (défaut aphrody-code/bxc)
  BXC_INSTALL_DIR    répertoire d'installation quand bxc tourne depuis les sources
`,
	);
}

export async function main(
	args: string[],
	opts: CommonOptions,
	deps: SelfUpdateDeps = {},
): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		printUsage();
		return;
	}
	const parsed = parseSelfUpdateArgs(args);
	const ctx = deps.ctx ?? currentPlatformContext();
	const { settings } = resolveBxcConfig({ ctx });
	const currentVersion = deps.currentVersion ?? readCurrentVersion();

	const release = await fetchRelease(
		settings.releaseRepo,
		parsed.tag,
		deps.fetchImpl ?? fetch,
	);

	const target = detectUpdateTarget(ctx.platform, ctx.arch, {
		baseline: parsed.baseline,
	});
	const destination = target
		? resolveDestination(ctx, target, parsed.destination)
		: "";

	const plan = planUpdate({
		currentVersion,
		release,
		platform: ctx.platform,
		arch: ctx.arch,
		destination,
		baseline: parsed.baseline,
		force: parsed.force,
	});

	const emit = (payload: Record<string, unknown>): void => {
		if (parsed.json || opts.json) {
			Bun.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		}
	};

	switch (plan.status) {
		case "unsupported-platform":
			logger.error(`Plateforme non supportée : ${plan.detail}`);
			emit({ status: plan.status, detail: plan.detail });
			process.exit(EXIT.MISUSE);
			return;
		case "release-unavailable":
			logger.error(
				`Impossible de lire la dernière release de ${settings.releaseRepo}.`,
			);
			emit({ status: plan.status, repo: settings.releaseRepo });
			process.exit(EXIT.SOFTWARE);
			return;
		case "up-to-date":
			logger.log(
				`bxc ${plan.currentVersion} est à jour (dernière release : ${plan.latestVersion}).`,
				opts,
			);
			emit({
				status: plan.status,
				current: plan.currentVersion,
				latest: plan.latestVersion,
			});
			return;
		case "asset-missing":
			logger.error(`Mise à jour impossible : ${plan.detail}`);
			emit({ status: plan.status, detail: plan.detail });
			process.exit(EXIT.SOFTWARE);
			return;
		case "update-available":
			break;
	}

	logger.log(
		`Mise à jour disponible : ${plan.currentVersion} -> ${plan.latestVersion} (${plan.asset?.name}).`,
		opts,
	);
	emit({
		status: plan.status,
		current: plan.currentVersion,
		latest: plan.latestVersion,
		asset: plan.asset?.name,
		destination: plan.destination,
		wouldWrite: !parsed.check,
	});

	if (parsed.check) {
		logger.log(`[--check] rien n'a été écrit (cible : ${plan.destination}).`, opts);
		return;
	}

	const url = plan.asset?.browser_download_url;
	if (!url || !plan.destination) {
		logger.error("Asset ou destination manquant.");
		process.exit(EXIT.SOFTWARE);
		return;
	}

	logger.log(`Téléchargement ${url}`, opts);
	const fetchImpl = deps.fetchImpl ?? fetch;
	const res = await fetchImpl(url, {
		headers: { "User-Agent": "bxc-self-update" },
		redirect: "follow",
	});
	if (!res.ok) {
		logger.error(`HTTP ${res.status} en téléchargeant ${url}`);
		process.exit(EXIT.SOFTWARE);
		return;
	}
	let bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.byteLength === 0) {
		logger.error("Téléchargement vide — abandon.");
		process.exit(EXIT.SOFTWARE);
		return;
	}

	if (plan.asset && isArchiveAsset(plan.asset.name)) {
		const workDir = resolveTempDir(ctx);
		try {
			bytes = extractBinaryFromArchive(
				bytes,
				plan.target?.binaryName ?? "bxc",
				workDir,
				ctx,
			);
		} catch (err) {
			logger.error(
				`Extraction de ${plan.asset.name} impossible : ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			process.exit(EXIT.SOFTWARE);
			return;
		}
	}

	const write = deps.writeBinary ?? writeBinaryAtomic;
	try {
		write(plan.destination, bytes, ctx);
	} catch (err) {
		logger.error(
			`Écriture impossible dans ${plan.destination} : ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		process.exit(EXIT.SOFTWARE);
		return;
	}

	logger.log(
		`bxc ${plan.latestVersion} installé dans ${plan.destination}.`,
		opts,
	);
}

declare const __BXC_VERSION__: string;

/** Version du binaire courant (constante de build, sinon package.json). */
export function readCurrentVersion(): string {
	if (typeof __BXC_VERSION__ !== "undefined") return __BXC_VERSION__;
	try {
		const { ROOT } = require("./shared.ts") as { ROOT: string };
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { join } = require("node:path") as typeof import("node:path");
		const pkg = JSON.parse(
			readFileSync(join(ROOT, "package.json"), "utf-8"),
		) as { version?: string };
		return pkg.version ?? "0.0.0-dev";
	} catch {
		return "0.0.0-dev";
	}
}
