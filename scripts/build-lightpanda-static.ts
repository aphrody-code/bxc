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

import { resolve } from "node:path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const WRAPPER_DIR = resolve(ROOT, "vendor/zigquery-wrapper");
const BUILD_OUT = resolve(ROOT, "build/lib");
const ZIG_BIN = Bun.env.ZIG ?? "zig"; // Assume zig is in PATH or use override

const argv = new Set(process.argv.slice(2));
const DEBUG = argv.has("--debug");
const optimize = DEBUG ? "Debug" : "ReleaseFast";

console.log(`[bxc] Building ZigQuery DOM library (optimize=${optimize})...`);

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
		console.log(`[bxc] copied ${art} → build/lib/`);
	}
}

// 3. Smoke test
const soPath = resolve(BUILD_OUT, shared);
if (await Bun.file(soPath).exists()) {
	console.log("[bxc] running smoke test...");
	const { dlopen, FFIType } = await import("bun:ffi");
	try {
		const lib = dlopen(soPath, {
			bl_init: { args: [], returns: FFIType.i32 },
		});
		const result = lib.symbols.bl_init();
		console.log(`[bxc] bl_init() = ${result} ✓`);
		lib.close();
	} catch (e) {
		console.error(`[bxc] ❌ Smoke test failed: ${e}`);
		process.exit(1);
	}
}

console.log("[bxc] ✓ done.");
