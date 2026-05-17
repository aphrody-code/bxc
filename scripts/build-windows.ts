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
 * build-windows.ts — Cross-platform Bxc Windows build (Linux/macOS host).
 *
 * Mirrors scripts/build-windows.ps1 but runs from any Bun host using only
 * Bun-native APIs + Zig cross-compile. No WSL, no MSYS2, no Wine required.
 *
 * Pipeline (matches the .ps1 sibling) :
 *   1. Verify prerequisites (bun, zig, curl)
 *   2. Build Lightpanda (zig build -Dtarget=x86_64-windows-gnu) from
 *      lightpanda-io/browser source. Zig's hermetic linker handles the
 *      Windows ABI without MSVC/MSYS2.
 *   3. Cross-compile bxc.exe via `bun build --compile
 *      --target=bun-windows-x64`.
 *   4. Fetch curl-impersonate Windows DLL from lexiforest/curl-impersonate
 *      releases.
 *   5. Bundle the three artifacts into a single release zip.
 *
 * Usage :
 *   bun scripts/build-windows.ts                           # full build
 *   bun scripts/build-windows.ts --skip-lightpanda         # binary fallback
 *   bun scripts/build-windows.ts --baseline                # pre-AVX2
 *   bun scripts/build-windows.ts --arch arm64              # ARM64 target
 *   bun scripts/build-windows.ts --lightpanda-ref nightly  # specific Lightpanda ref
 *
 * Environment overrides :
 *   BXC_CURL_VERSION   curl-impersonate release tag (default v1.5.6)
 *   BXC_ZIG_TARGET     override Zig triple (default x86_64-windows-gnu)
 *   BXC_LIGHTPANDA_URL skip Lightpanda build, fetch this URL instead
 *
 * Outputs in dist/standalone/windows/ :
 *   bxc.exe
 *   lightpanda.exe
 *   libcurl-impersonate.dll
 *   bxc-windows-x64.zip            (or aarch64-baseline variants)
 */

import { $ } from "bun";

interface Args {
	arch: "x64" | "arm64";
	baseline: boolean;
	skipLightpanda: boolean;
	skipCurl: boolean;
	lightpandaRef: string;
	curlVersion: string;
}

function parseArgs(argv: readonly string[]): Args {
	const out: Args = {
		arch: "x64",
		baseline: false,
		skipLightpanda: false,
		skipCurl: false,
		lightpandaRef: "main",
		curlVersion: Bun.env.BXC_CURL_VERSION ?? "v1.5.6",
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--arch":
				out.arch = argv[++i] === "arm64" ? "arm64" : "x64";
				break;
			case "--baseline":
				out.baseline = true;
				break;
			case "--skip-lightpanda":
				out.skipLightpanda = true;
				break;
			case "--skip-curl":
				out.skipCurl = true;
				break;
			case "--lightpanda-ref":
				out.lightpandaRef = argv[++i] ?? "main";
				break;
			case "--curl-version":
				out.curlVersion = argv[++i] ?? out.curlVersion;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
		}
	}
	return out;
}

function printUsage(): void {
	Bun.stdout.write(
		`build-windows.ts — cross-compile Bxc + Lightpanda for Windows from Linux/macOS

Usage:
  bun scripts/build-windows.ts [--arch x64|arm64] [--baseline] [--skip-lightpanda]
                               [--skip-curl] [--lightpanda-ref <ref>] [--curl-version <vX.Y.Z>]

Outputs in dist/standalone/windows/.
`,
	);
}

async function assertCmd(cmd: string, hint: string): Promise<string> {
	try {
		const text = await $`${cmd} --version`.text();
		return text.trim().split("\n")[0] ?? "";
	} catch {
		console.error(`Missing prerequisite: ${cmd}`);
		console.error(`  Install hint: ${hint}`);
		process.exit(1);
	}
}

async function buildLightpanda(args: Args, distDir: string): Promise<boolean> {
	const ref = args.lightpandaRef;
	const target =
		Bun.env.BXC_ZIG_TARGET ??
		(args.arch === "arm64" ? "aarch64-windows-gnu" : "x86_64-windows-gnu");

	const overrideUrl = Bun.env.BXC_LIGHTPANDA_URL;
	if (overrideUrl) {
		console.log(`[lightpanda] using override URL ${overrideUrl}`);
		const out = `${distDir}/lightpanda.exe`;
		await $`curl -#SfLo ${out} ${overrideUrl}`.nothrow();
		return await Bun.file(out).exists();
	}

	const src = `${import.meta.dir}/../vendor/lightpanda-src`;
	const srcExists = await Bun.file(`${src}/build.zig`).exists();

	if (!srcExists) {
		console.log(`[lightpanda] cloning lightpanda-io/browser@${ref} -> ${src}`);
		await $`git clone --depth 1 --branch ${ref} https://github.com/lightpanda-io/browser.git ${src}`;
	} else {
		console.log(`[lightpanda] vendor/lightpanda-src present — pulling ${ref}`);
		await $`git -C ${src} fetch origin ${ref}`.nothrow();
		await $`git -C ${src} checkout ${ref}`.nothrow();
		await $`git -C ${src} pull --ff-only origin ${ref}`.nothrow();
	}

	console.log(
		`[lightpanda] zig build -Dtarget=${target} -Doptimize=ReleaseFast`,
	);
	const result = await $`zig build -Dtarget=${target} -Doptimize=ReleaseFast`
		.cwd(src)
		.nothrow();

	if (result.exitCode !== 0) {
		console.warn(
			`[lightpanda] native zig build failed (exit ${result.exitCode}). Trying release binary fallback ...`,
		);
		const releaseUrl = `https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-${target}.exe`;
		const out = `${distDir}/lightpanda.exe`;
		const dl = await $`curl -#SfLo ${out} ${releaseUrl}`.nothrow();
		if (dl.exitCode !== 0) {
			console.warn(
				`[lightpanda] no prebuilt for ${target} — bxc will run without Lightpanda support.`,
			);
			return false;
		}
		console.log(`[lightpanda] OK (fallback prebuilt) -> ${out}`);
		return true;
	}

	const built = `${src}/zig-out/bin/lightpanda.exe`;
	if (await Bun.file(built).exists()) {
		await Bun.write(`${distDir}/lightpanda.exe`, Bun.file(built));
		console.log(`[lightpanda] OK -> ${distDir}/lightpanda.exe`);
		return true;
	}
	console.warn(`[lightpanda] zig build succeeded but ${built} missing.`);
	return false;
}

async function buildBxcExe(args: Args, distDir: string): Promise<void> {
	const arch = args.arch === "arm64" ? "aarch64" : "x64";
	const target = args.baseline
		? `bun-windows-${arch}-baseline`
		: `bun-windows-${arch}-baseline`; // Force baseline for maximum compatibility
	const repoRoot = `${import.meta.dir}/..`;
	const out = `${distDir}/bxc.exe`;

	const pkg = JSON.parse(await Bun.file(`${repoRoot}/package.json`).text()) as {
		version: string;
	};
	const buildTime = new Date().toISOString();

	console.log(`[bxc] bun build --compile --target=${target} (with bytecode)`);
	// --bytecode moves JS parsing to build-time (30-50% faster startup)
	await $`bun build src/cli/index.ts --compile --target=${target} \
		--minify --bytecode --sourcemap=linked \
		--external electron --external playwright-core/lib/zipBundle \
		--define __BXC_VERSION__="\"${pkg.version}\"" \
		--define __BXC_BUILD_TIME__="\"${buildTime}\"" \
		--outfile ${out}`.cwd(repoRoot);

	const size = ((await Bun.file(out).stat()).size / 1024 / 1024).toFixed(2);
	console.log(`[bxc] OK ${out} (${size} MB)`);
}

async function buildRustBridge(args: Args, distDir: string): Promise<void> {
	const arch = args.arch === "arm64" ? "aarch64" : "x86_64";
	const target = `${arch}-pc-windows-msvc`;
	const repoRoot = `${import.meta.dir}/..`;
	
	console.log(`\n[rust] build rust-bridge for ${target} (VS 2026 Insider / MSVC ABI)`);
	
	// Ultra-aggressive MSVC optimization pipeline
	const result = await $`cargo xwin build --release --target=${target} --manifest-path rust-bridge/Cargo.toml`.nothrow();
	
	if (result.exitCode !== 0) {
		console.error("[rust] VS 2026 MSVC build failed. Ensure cargo-xwin and Windows SDK are reachable.");
		process.exit(1);
	}

	const binName = "bxc-engine.exe";
	const libName = "bxc_rust_bridge.dll";
	
	await Bun.write(`${distDir}/${binName}`, Bun.file(`${repoRoot}/rust-bridge/target/${target}/release/${binName}`));
	await Bun.write(`${distDir}/${libName}`, Bun.file(`${repoRoot}/rust-bridge/target/${target}/release/${libName}`));
	console.log(`[rust] OK (Static CRT + LTO Fat) -> ${distDir}/${binName}`);
}

async function fetchCurlImpersonate(
	args: Args,
	distDir: string,
): Promise<boolean> {
	const ver = args.curlVersion;
	const tmpZip = `/tmp/libcurl-impersonate-${ver}-windows.zip`;
	const url = `https://github.com/lexiforest/curl-impersonate/releases/download/${ver}/libcurl-impersonate-${ver}.x86_64-win64.zip`;

	console.log(`[curl-impersonate] fetching ${url}`);
	const dl = await $`curl -#SfLo ${tmpZip} ${url}`.nothrow();
	if (dl.exitCode !== 0) {
		console.warn(
			`[curl-impersonate] download failed — bxc will lack http profile on Windows.`,
		);
		return false;
	}

	const extractDir = `/tmp/curl-impersonate-extract-${Bun.hash(ver)}`;
	await $`rm -rf ${extractDir}`.nothrow();
	await $`mkdir -p ${extractDir}`;
	await $`unzip -o ${tmpZip} -d ${extractDir}`.quiet().nothrow();

	const glob = new Bun.Glob("**/libcurl-impersonate*.dll");
	let found: string | null = null;
	for await (const f of glob.scan({ cwd: extractDir, absolute: true })) {
		found = f;
		break;
	}
	if (!found) {
		console.warn(`[curl-impersonate] DLL not found inside ${tmpZip}`);
		return false;
	}

	await Bun.write(`${distDir}/libcurl-impersonate.dll`, Bun.file(found));
	console.log(`[curl-impersonate] OK -> ${distDir}/libcurl-impersonate.dll`);
	await $`rm -rf ${extractDir} ${tmpZip}`.nothrow();
	return true;
}

async function bundleZip(args: Args, distDir: string): Promise<void> {
	const arch = args.arch === "arm64" ? "aarch64" : "x64";
	const zipName = args.baseline
		? `bxc-windows-${arch}-baseline.zip`
		: `bxc-windows-${arch}.zip`;
	const zipPath = `${distDir}/${zipName}`;

	const candidates = [
		"bxc.exe",
		"lightpanda.exe",
		"bxc-engine.exe",
		"libcurl-impersonate.dll",
		"bxc_rust_bridge.dll",
	];
	const present: string[] = [];
	for (const f of candidates) {
		if (await Bun.file(`${distDir}/${f}`).exists()) present.push(f);
	}

	if (present.length === 0) {
		console.error("[bundle] no artifacts to bundle.");
		process.exit(1);
	}

	await $`rm -f ${zipPath}`.nothrow();
	await $`zip -j ${zipPath} ${present.map((p) => `${distDir}/${p}`)}`
		.cwd(distDir)
		.quiet();

	const size = ((await Bun.file(zipPath).stat()).size / 1024 / 1024).toFixed(2);
	console.log(`[bundle] OK ${zipName} (${size} MB) [${present.length} files]`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log(`[1/6] Prerequisites check`);
	await assertCmd("bun", "https://bun.sh/install");
	await assertCmd("zig", "https://ziglang.org/download/");
	await assertCmd("curl", "apt install curl / brew install curl");
	await assertCmd("cargo-xwin", "cargo install cargo-xwin");

	const distDir = `${import.meta.dir}/../dist/standalone/windows`;
	await $`mkdir -p ${distDir}`;

	console.log(`\n[2-5/6] Building components in parallel...`);
	const tasks = [];
	if (!args.skipLightpanda) tasks.push(buildLightpanda(args, distDir));
	tasks.push(buildBxcExe(args, distDir));
	tasks.push(buildRustBridge(args, distDir));
	if (!args.skipCurl) tasks.push(fetchCurlImpersonate(args, distDir));

	await Promise.all(tasks);

	console.log(`\n[6/6] Bundle release zip`);
	await bundleZip(args, distDir);

	console.log("\nDone. Artifacts:");
	const lsOut = await $`ls -la ${distDir}`.text();
	console.log(lsOut);
}

main();
