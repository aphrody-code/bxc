#!/usr/bin/env bun

/**
 * Build script — ZigQuery DOM-only library → liblightpanda_dom.{so,a}
 *
 * This builds the high-performance DOM/CSS engine used by the 'static' profile.
 *
 * Steps:
 *   1. Build vendor/zigquery-wrapper via zig build
 *   2. Copy results to build/lib/
 *   3. Smoke test: dlopen + bl_init
 *
 * Usage:
 *   bun scripts/build-lightpanda-static.ts
 */

import { resolve } from "path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const WRAPPER_DIR = resolve(ROOT, "vendor/zigquery-wrapper");
const BUILD_OUT = resolve(ROOT, "build/lib");
const ZIG_BIN = process.env.ZIG ?? "zig"; // Assume zig is in PATH or use override

const argv = new Set(process.argv.slice(2));
const DEBUG = argv.has("--debug");
const optimize = DEBUG ? "Debug" : "ReleaseFast";

console.log(`[bunlight] Building ZigQuery DOM library (optimize=${optimize})...`);

// 1. Build via zig build
await $`mkdir -p ${BUILD_OUT}`;
await $`${ZIG_BIN} build -Doptimize=${optimize}`.cwd(WRAPPER_DIR);

// 2. Copy artifacts
const suffix = process.platform === "darwin" ? "dylib" : "so";
const shared = `liblightpanda_dom.${suffix}`;
const static_lib = "liblightpanda_dom.a";

for (const art of [shared, static_lib]) {
	const src = resolve(WRAPPER_DIR, "zig-out/lib", art);
	if (await Bun.file(src).exists()) {
		await $`cp ${src} ${BUILD_OUT}/`;
		console.log(`[bunlight] copied ${art} → build/lib/`);
	}
}

// 3. Smoke test
const soPath = resolve(BUILD_OUT, shared);
if (await Bun.file(soPath).exists()) {
	console.log("[bunlight] running smoke test...");
	const { dlopen, FFIType } = await import("bun:ffi");
	try {
		const lib = dlopen(soPath, {
			bl_init: { args: [], returns: FFIType.i32 },
		});
		const result = lib.symbols.bl_init();
		console.log(`[bunlight] bl_init() = ${result} ✓`);
		lib.close();
	} catch (e) {
		console.error(`[bunlight] ❌ Smoke test failed: ${e}`);
		process.exit(1);
	}
}

console.log("[bunlight] ✓ done.");

