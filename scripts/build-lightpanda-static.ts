#!/usr/bin/env bun
/**
 * Build script — Lightpanda cdylib (DOM-only, no V8) → liblightpanda.{so,a}
 *
 * Étapes:
 *   1. Vérifie que vendor/lightpanda est présent (clone si manquant)
 *   2. Applique les patches dans patches/
 *   3. Build via zig build avec flags -Dno_v8=true -Doptimize=ReleaseFast
 *   4. Copie le résultat dans build/lib/
 *   5. Smoke test : dlopen + appel d'une fonction
 *
 * Usage:
 *   bun scripts/build-lightpanda-static.ts            # build par défaut
 *   bun scripts/build-lightpanda-static.ts --dynamic  # cdylib seulement
 *   bun scripts/build-lightpanda-static.ts --static   # static lib seulement
 *   bun scripts/build-lightpanda-static.ts --debug    # debug build
 */

import { $ } from "bun";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR_LIGHTPANDA = resolve(ROOT, "vendor/lightpanda");
const PATCHES_DIR = resolve(ROOT, "patches");
const BUILD_OUT = resolve(ROOT, "build/lib");
const ZIG_BIN = process.env.ZIG ?? "/home/ubuntu/.local/zig-0.15.2/zig";

const argv = new Set(process.argv.slice(2));
const DEBUG = argv.has("--debug");
const ONLY_DYNAMIC = argv.has("--dynamic");
const ONLY_STATIC = argv.has("--static");

const optimize = DEBUG ? "Debug" : "ReleaseFast";

console.log(`[bunlight] Building Lightpanda cdylib (no_v8=true, optimize=${optimize})`);

// 1. Vérifier que le vendor est présent
if (!(await Bun.file(VENDOR_LIGHTPANDA).exists())) {
	console.log("[bunlight] vendor/lightpanda missing — cloning…");
	await $`git clone --depth 1 https://github.com/lightpanda-io/browser ${VENDOR_LIGHTPANDA}`.quiet();
}

// 2. Appliquer les patches (idempotent: skip si déjà appliqués)
const patches = await Array.fromAsync(new Bun.Glob("*.patch").scan({ cwd: PATCHES_DIR }));
patches.sort();
for (const patch of patches) {
	const patchPath = resolve(PATCHES_DIR, patch);
	const check = await $`git apply --check ${patchPath}`.cwd(VENDOR_LIGHTPANDA).nothrow();
	if (check.exitCode === 0) {
		console.log(`[bunlight] applying patch ${patch}`);
		await $`git apply ${patchPath}`.cwd(VENDOR_LIGHTPANDA);
	} else {
		console.log(`[bunlight] patch ${patch} already applied or stale, skipping`);
	}
}

// 3. Build avec zig build (utilise le target lib ajouté par les patches)
await $`mkdir -p ${BUILD_OUT}`;

const zigArgs = ["build", "lib", `-Dno_v8=true`, `-Doptimize=${optimize}`];
if (ONLY_DYNAMIC) zigArgs.push("-Dlinkage=dynamic");
if (ONLY_STATIC) zigArgs.push("-Dlinkage=static");

console.log(`[bunlight] zig ${zigArgs.join(" ")}`);
await $`${ZIG_BIN} ${zigArgs}`.cwd(VENDOR_LIGHTPANDA);

// 4. Copier les artefacts
const artefacts = ["liblightpanda.so", "liblightpanda.a", "liblightpanda.dylib"];
for (const art of artefacts) {
	const src = resolve(VENDOR_LIGHTPANDA, "zig-out/lib", art);
	if (await Bun.file(src).exists()) {
		await $`cp ${src} ${BUILD_OUT}/`;
		console.log(`[bunlight] copied ${art} → build/lib/`);
	}
}

// 5. Smoke test
const soPath = resolve(BUILD_OUT, "liblightpanda.so");
if (await Bun.file(soPath).exists()) {
	console.log("[bunlight] running smoke test…");
	const { dlopen, FFIType, suffix } = await import("bun:ffi");
	void suffix;
	const lib = dlopen(soPath, {
		bl_init: { args: [], returns: FFIType.i32 },
	});
	const result = lib.symbols.bl_init();
	console.log(`[bunlight] bl_init() = ${result} ✓`);
	lib.close();
}

console.log("[bunlight] ✓ done.");
