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
 * build-win32.ts — optimised native Windows build of bxc (branch `win32`).
 *
 * Produces, into `bin/`:
 *   - `bxc.exe`              standalone CLI (Bun runtime embedded)
 *   - `bxc-mcp.exe`          standalone MCP stdio server
 *   - `bxc-engine.exe`       native Rust CDP/browser engine (release)
 *   - `bxc_rust_bridge.dll`  Rust cdylib FFI bridge (DOM parse / html→md)
 *
 * Bun production flags (https://bun.com/docs/bundler/executables):
 *   --minify              whitespace + identifiers + syntax → smaller binary
 *   --bytecode            JS pre-compiled to JSC bytecode → ~2x faster startup
 *   --sourcemap=linked    zstd sourcemap embedded → real stack traces
 *   --target …-modern     this host is an AVX2 i7 → modern beats baseline
 *   --define              BUILD_VERSION / BUILD_TIME as zero-cost constants
 *
 * GOTCHA (CLAUDE.md / memory): do NOT pass `--smol`. The Bun Windows standalone
 * runtime segfaults under `--smol`; that flag was the original bxc crash. This
 * build deliberately omits it.
 */

import { $ } from "bun";
import { join } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin");
const RB = join(ROOT, "rust-bridge");

const version = (await Bun.file(join(ROOT, "package.json")).json()).version ?? "0.0.0";
const buildTime = new Date().toISOString();

async function exists(p: string): Promise<boolean> {
	try {
		return (await Bun.file(p).exists()) || (await Bun.file(p).size) >= 0;
	} catch {
		return false;
	}
}

async function compile(entry: string, outfile: string): Promise<void> {
	console.error(`[build-win32] compile ${entry} → ${outfile}`);
	const noBytecode = Bun.env.BXC_NO_BYTECODE === "1";
	const args = [
		"build",
		entry,
		"--compile",
		"--target=bun-windows-x64-modern",
		"--minify",
		"--sourcemap=linked",
		...(noBytecode ? [] : ["--bytecode"]),
		`--define=BXC_VERSION__='${JSON.stringify(version)}'`,
		`--define=BXC_BUILD_TIME__='${JSON.stringify(buildTime)}'`,
		"--outfile",
		outfile,
		// NB: no --smol — segfaults the Bun Windows standalone runtime.
	];
	await $`bun ${args}`.cwd(ROOT);
}

async function main(): Promise<void> {
	await mkdir(BIN, { recursive: true });

	// 1. Rust cdylib + engine (release). Assumes `cargo build --release` already
	//    ran (build:win invokes it); copy the artifacts into bin/.
	const rel = join(RB, "target", "release");
	const dll = join(rel, "bxc_rust_bridge.dll");
	const engine = join(rel, "bxc-engine.exe");

	if (await exists(dll)) {
		await copyFile(dll, join(BIN, "bxc_rust_bridge.dll"));
		console.error("[build-win32] bin/bxc_rust_bridge.dll");
	} else {
		console.error("[build-win32] WARN cdylib missing — run `cargo build --release` in rust-bridge");
	}
	if (await exists(engine)) {
		await copyFile(engine, join(BIN, "bxc-engine.exe"));
		console.error("[build-win32] bin/bxc-engine.exe");
	} else {
		console.error("[build-win32] WARN bxc-engine.exe missing");
	}

	// 2. Standalone CLI + MCP server (no --smol).
	await compile("src/cli/index.ts", join(BIN, "bxc.exe"));
	await compile("src/mcp/server.ts", join(BIN, "bxc-mcp.exe"));

	console.error(`[build-win32] done → ${BIN}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
