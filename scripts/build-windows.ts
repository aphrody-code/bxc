#!/usr/bin/env bun
/**
 * build-windows.ts — Cross-platform Bunlight Windows build (Linux/macOS host).
 *
 * Mirrors scripts/build-windows.ps1 but runs from any Bun host using only
 * Bun-native APIs + Zig cross-compile. No WSL, no MSYS2, no Wine required.
 *
 * Pipeline (matches the .ps1 sibling) :
 *   1. Verify prerequisites (bun, zig, curl)
 *   2. Build Lightpanda (zig build -Dtarget=x86_64-windows-gnu) from
 *      lightpanda-io/browser source. Zig's hermetic linker handles the
 *      Windows ABI without MSVC/MSYS2.
 *   3. Cross-compile bunlight.exe via `bun build --compile
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
 *   BUNLIGHT_CURL_VERSION   curl-impersonate release tag (default v1.5.6)
 *   BUNLIGHT_ZIG_TARGET     override Zig triple (default x86_64-windows-gnu)
 *   BUNLIGHT_LIGHTPANDA_URL skip Lightpanda build, fetch this URL instead
 *
 * Outputs in dist/standalone/windows/ :
 *   bunlight.exe
 *   lightpanda.exe
 *   libcurl-impersonate.dll
 *   bunlight-windows-x64.zip            (or aarch64-baseline variants)
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
		curlVersion: process.env.BUNLIGHT_CURL_VERSION ?? "v1.5.6",
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
	process.stdout.write(
		`build-windows.ts — cross-compile Bunlight + Lightpanda for Windows from Linux/macOS

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
		process.env.BUNLIGHT_ZIG_TARGET ??
		(args.arch === "arm64" ? "aarch64-windows-gnu" : "x86_64-windows-gnu");

	const overrideUrl = process.env.BUNLIGHT_LIGHTPANDA_URL;
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

	console.log(`[lightpanda] zig build -Dtarget=${target} -Doptimize=ReleaseFast`);
	const result = await $`zig build -Dtarget=${target} -Doptimize=ReleaseFast`.cwd(src).nothrow();

	if (result.exitCode !== 0) {
		console.warn(
			`[lightpanda] native zig build failed (exit ${result.exitCode}). Trying release binary fallback ...`,
		);
		const releaseUrl = `https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-${target}.exe`;
		const out = `${distDir}/lightpanda.exe`;
		const dl = await $`curl -#SfLo ${out} ${releaseUrl}`.nothrow();
		if (dl.exitCode !== 0) {
			console.warn(
				`[lightpanda] no prebuilt for ${target} — bunlight will run without Lightpanda support.`,
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

async function buildBunlightExe(args: Args, distDir: string): Promise<void> {
	const arch = args.arch === "arm64" ? "aarch64" : "x64";
	const target = args.baseline ? `bun-windows-${arch}-baseline` : `bun-windows-${arch}`;
	const repoRoot = `${import.meta.dir}/..`;
	const out = `${distDir}/bunlight.exe`;

	const pkg = JSON.parse(await Bun.file(`${repoRoot}/package.json`).text()) as {
		version: string;
	};
	const buildTime = new Date().toISOString();

	console.log(`[bunlight] bun build --compile --target=${target}`);
	await $`bun build src/cli/index.ts --compile --target=${target} \
		--minify --sourcemap=linked --bytecode \
		--external electron --external playwright-core/lib/zipBundle \
		--define BUILD_VERSION="\"${pkg.version}\"" \
		--define BUILD_TIME="\"${buildTime}\"" \
		--outfile ${out}`.cwd(repoRoot);

	const size = ((await Bun.file(out).stat()).size / 1024 / 1024).toFixed(2);
	console.log(`[bunlight] OK ${out} (${size} MB)`);
}

async function fetchCurlImpersonate(args: Args, distDir: string): Promise<boolean> {
	const ver = args.curlVersion;
	const tmpZip = `/tmp/libcurl-impersonate-${ver}-windows.zip`;
	const url = `https://github.com/lexiforest/curl-impersonate/releases/download/${ver}/libcurl-impersonate-${ver}.x86_64-win64.zip`;

	console.log(`[curl-impersonate] fetching ${url}`);
	const dl = await $`curl -#SfLo ${tmpZip} ${url}`.nothrow();
	if (dl.exitCode !== 0) {
		console.warn(
			`[curl-impersonate] download failed — bunlight will lack http profile on Windows.`,
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
		? `bunlight-windows-${arch}-baseline.zip`
		: `bunlight-windows-${arch}.zip`;
	const zipPath = `${distDir}/${zipName}`;

	const candidates = ["bunlight.exe", "lightpanda.exe", "libcurl-impersonate.dll"];
	const present: string[] = [];
	for (const f of candidates) {
		if (await Bun.file(`${distDir}/${f}`).exists()) present.push(f);
	}

	if (present.length === 0) {
		console.error("[bundle] no artifacts to bundle.");
		process.exit(1);
	}

	await $`rm -f ${zipPath}`.nothrow();
	await $`zip -j ${zipPath} ${present.map((p) => `${distDir}/${p}`)}`.cwd(distDir).quiet();

	const size = ((await Bun.file(zipPath).stat()).size / 1024 / 1024).toFixed(2);
	console.log(`[bundle] OK ${zipName} (${size} MB) [${present.length} files]`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log(`[1/5] Prerequisites check`);
	await assertCmd("bun", "https://bun.sh/install");
	await assertCmd("zig", "https://ziglang.org/download/");
	await assertCmd("curl", "apt install curl / brew install curl");

	const distDir = `${import.meta.dir}/../dist/standalone/windows`;
	await $`mkdir -p ${distDir}`;

	console.log(`\n[2/5] Lightpanda native build`);
	if (!args.skipLightpanda) {
		await buildLightpanda(args, distDir);
	} else {
		console.log("  skipped (--skip-lightpanda)");
	}

	console.log(`\n[3/5] Bunlight standalone executable`);
	await buildBunlightExe(args, distDir);

	console.log(`\n[4/5] curl-impersonate Windows DLL`);
	if (!args.skipCurl) {
		await fetchCurlImpersonate(args, distDir);
	} else {
		console.log("  skipped (--skip-curl)");
	}

	console.log(`\n[5/5] Bundle release zip`);
	await bundleZip(args, distDir);

	console.log("\nDone. Artifacts:");
	const lsOut = await $`ls -la ${distDir}`.text();
	console.log(lsOut);
}

main().catch((err: unknown) => {
	console.error("Fatal:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
