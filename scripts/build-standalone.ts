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
 * build-standalone.ts — Production-grade standalone Bxc executables.
 *
 * Output : dist/standalone/bxc-{linux-x64,linux-arm64,darwin-x64,darwin-arm64}
 *
 * Bun production flags applied (https://bun.com/docs/bundler/executables) :
 *   --minify              syntax/whitespace/identifiers, smaller binaries
 *   --sourcemap=linked    zstd-compressed sourcemap embedded for stack traces
 *   --bytecode            JS pre-compiled to JSC bytecode → 2x faster startup
 *   --define              BUILD_VERSION + BUILD_TIME embedded as constants
 *   --compile-exec-argv   --smol applied at every invocation (low-memory)
 *   --target              one of bun-{linux-x64,linux-arm64,darwin-x64,darwin-arm64}
 *
 * Entry point : src/cli/index.ts (the full subcommand router :
 *   serve / install / recon / docs / detect / scrape / cookies / har).
 *
 * Usage :
 *   bun scripts/build-standalone.ts                            all 4 targets
 *   BXC_TARGETS=linux-x64 bun scripts/build-standalone.ts subset
 *   BXC_HOST_ONLY=1 bun scripts/build-standalone.ts       host arch only
 *   BXC_BASELINE=1 bun scripts/build-standalone.ts        pre-2013 CPU compat
 *   BXC_NO_BYTECODE=1 bun scripts/build-standalone.ts     skip bytecode (debug builds)
 *
 * Notes :
 *   - The cdylib zigquery (liblightpanda_dom.so) and curl-impersonate
 *     (libcurl-impersonate-chrome.so) remain external runtime FFI deps.
 *   - Externals (electron, playwright-core/lib/zipBundle) are dynamic-required
 *     at runtime only when the stealth profile spawns Chromium ; when absent
 *     stealth gracefully degrades.
 *   - Cross-compile darwin/arm64 from a linux-x64 host requires the Bun mirror
 *     to ship those runtimes — CI matrix builds each on its native runner.
 *   - Exit code : 0 if at least one target built ; 1 if all targets failed.
 */

import { $ } from "bun";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

interface BuildTarget {
	readonly target: string; // bun --target=<...>
	readonly suffix: string; // dist/standalone/bxc-<suffix>
}

// Baseline (pre-2013 Nehalem CPUs without AVX2) variant only applies to x64.
// macOS arm64 + linux arm64 do not have a baseline distinction.
const BASELINE = Bun.env.BXC_BASELINE === "1";
const ALL_TARGETS: readonly BuildTarget[] = [
	{
		target: BASELINE ? "bun-linux-x64-baseline" : "bun-linux-x64",
		suffix: "linux-x64",
	},
	{ target: "bun-linux-arm64", suffix: "linux-arm64" },
	{
		target: BASELINE ? "bun-darwin-x64-baseline" : "bun-darwin-x64",
		suffix: "darwin-x64",
	},
	{ target: "bun-darwin-arm64", suffix: "darwin-arm64" },
	// Windows x64 — Bun supports cross-compiling these from Linux/macOS.
	{ target: "bun-windows-x64", suffix: "windows-x64" },
	{ target: "bun-windows-x64-baseline", suffix: "windows-x64-baseline" },
];

/** Windows targets must emit a `.exe` outfile. */
function outfileFor(outDir: string, suffix: string): string {
	const base = `${outDir}/bxc-${suffix}`;
	return suffix.startsWith("windows-") ? `${base}.exe` : base;
}

// Modules pulled in by patchright-core's electron loader and playwright-core
// internals — only required when stealth profile is wired at runtime. Mark as
// external so `bun build --compile` doesn't try to resolve them statically.
const EXTERNALS: readonly string[] = [
	"electron",
	"playwright-core/lib/zipBundle",
];

interface BuildResult {
	readonly target: string;
	readonly out: string;
	readonly ok: boolean;
	readonly sizeMb?: string;
	readonly err?: string;
}

function pickTargets(): readonly BuildTarget[] {
	const env = Bun.env.BXC_TARGETS?.trim();
	if (env && env.length > 0) {
		const wanted = new Set(
			env
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0),
		);
		const known = new Set(ALL_TARGETS.map((t) => t.suffix));
		for (const w of wanted) {
			if (!known.has(w)) {
				throw new Error(
					`Unknown target "${w}" — valid : ${[...known].join(", ")}`,
				);
			}
		}
		return ALL_TARGETS.filter((t) => wanted.has(t.suffix));
	}
	if (Bun.env.BXC_HOST_ONLY === "1") {
		const arch = process.arch;
		const platform = process.platform;
		const wantedSuffix =
			platform === "linux" && arch === "x64"
				? "linux-x64"
				: platform === "linux" && arch === "arm64"
					? "linux-arm64"
					: platform === "darwin" && arch === "x64"
						? "darwin-x64"
						: platform === "darwin" && arch === "arm64"
							? "darwin-arm64"
							: undefined;
		if (!wantedSuffix) {
			throw new Error(`Unsupported host : ${platform}/${arch}`);
		}
		return ALL_TARGETS.filter((t) => t.suffix === wantedSuffix);
	}
	return ALL_TARGETS;
}

async function fileSizeMb(path: string): Promise<string> {
	const stat = await Bun.file(path).stat();
	return (stat.size / 1024 / 1024).toFixed(1);
}

async function readPackageVersion(root: string): Promise<string> {
	try {
		const pkg = (await Bun.file(`${root}/package.json`).json()) as {
			version?: string;
		};
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

async function buildOne(
	t: BuildTarget,
	entry: string,
	outDir: string,
	defines: Record<string, string>,
	enableBytecode: boolean,
): Promise<BuildResult> {
	const out = outfileFor(outDir, t.suffix);
	console.log(`[build-standalone] Building ${t.target} -> ${out}`);

	// Production flags per https://bun.com/docs/bundler/executables :
	//   --minify              full minification (whitespace+syntax+identifiers)
	//   --sourcemap=linked    zstd-compressed sourcemap embedded for stack traces
	//   --bytecode            JS pre-compiled to JSC bytecode → 2x faster startup
	//   --define K=V          build-time constants (BUILD_VERSION, BUILD_TIME)
	//   --compile-exec-argv   --smol applied automatically at every invocation
	//   --no-compile-autoload-tsconfig  deterministic runtime (skip tsconfig.json read)
	//   --no-compile-autoload-package-json  same for package.json
	const defineArgs = Object.entries(defines).flatMap(([k, v]) => [
		"--define",
		`${k}=${JSON.stringify(v)}`,
	]);
	const externalArgs = EXTERNALS.flatMap((e) => ["--external", e]);

	const cmd: string[] = [
		"bun",
		"build",
		entry,
		"--compile",
		`--target=${t.target}`,
		`--outfile=${out}`,
		"--minify",
		"--sourcemap=linked",
		"--compile-exec-argv=--smol",
		"--no-compile-autoload-tsconfig",
		"--no-compile-autoload-package-json",
		...defineArgs,
		...externalArgs,
	];
	if (enableBytecode) cmd.push("--bytecode");

	const proc = Bun.spawn({
		cmd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		const tail = (stderr || stdout).split("\n").slice(-8).join("\n").trim();
		return {
			target: t.target,
			out,
			ok: false,
			err: tail || `exit ${exitCode}`,
		};
	}
	const exists = await Bun.file(out).exists();
	if (!exists) {
		return {
			target: t.target,
			out,
			ok: false,
			err: "outfile missing after build",
		};
	}
	const sizeMb = await fileSizeMb(out);
	return { target: t.target, out, ok: true, sizeMb };
}

function renderTable(results: readonly BuildResult[]): string {
	const headers = ["target", "ok", "sizeMB", "error"];
	const rows = results.map((r) => [
		r.target,
		r.ok ? "yes" : "no",
		r.sizeMb ?? "—",
		r.ok ? "—" : (r.err ?? "unknown").slice(0, 80).replace(/\s+/g, " "),
	]);
	const widths = headers.map((h, i) =>
		Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
	);
	const fmt = (cells: readonly string[]): string =>
		cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
	const sep = widths.map((w) => "-".repeat(w)).join("  ");
	return [fmt(headers), sep, ...rows.map((r) => fmt(r.map(String)))].join("\n");
}

function getBinaryPathsForTarget(suffix: string): {
	rustBridge: string | null;
	curlImpersonate: string | null;
} {
	const root = join(import.meta.dir, "..");
	let rustBridge: string | null = null;
	let curlImpersonate: string | null = null;

	if (suffix === "linux-x64") {
		rustBridge = join(
			root,
			"rust-bridge",
			"target",
			"release",
			"libbxc_rust_bridge.so",
		);
	} else if (suffix === "linux-arm64") {
		rustBridge = join(
			root,
			"rust-bridge",
			"target",
			"aarch64-unknown-linux-gnu",
			"release",
			"libbxc_rust_bridge.so",
		);
	} else if (suffix.startsWith("windows-")) {
		rustBridge = join(
			root,
			"rust-bridge",
			"target",
			"x86_64-pc-windows-msvc",
			"release",
			"bxc_rust_bridge.dll",
		);
		if (!Bun.file(rustBridge).size) {
			rustBridge = join(root, "dist", suffix, "bxc_rust_bridge.dll");
		}
	} else if (suffix.startsWith("darwin-")) {
		const arch = suffix.endsWith("arm64") ? "aarch64" : "x86_64";
		rustBridge = join(
			root,
			"rust-bridge",
			"target",
			`${arch}-apple-darwin`,
			"release",
			"libbxc_rust_bridge.dylib",
		);
	}

	// Double check existence. If file size is 0 or it throws, it doesn't exist.
	try {
		if (rustBridge && Bun.file(rustBridge).size <= 0) rustBridge = null;
	} catch {
		rustBridge = null;
	}

	return { rustBridge, curlImpersonate };
}

function findCurlImpersonate(suffix: string): string | null {
	const root = join(import.meta.dir, "..");
	const vendor = join(root, "vendor", "curl-impersonate");
	let candidates: string[] = [];

	if (suffix === "linux-x64" || suffix === "linux-arm64") {
		candidates = [
			join(vendor, "libcurl-impersonate.so.4.8.0"),
			join(vendor, "libcurl-impersonate.so.4"),
			join(vendor, "libcurl-impersonate.so"),
			join(vendor, "libcurl-impersonate-chrome.so.4.8.0"),
			join(vendor, "libcurl-impersonate-chrome.so.4"),
			join(vendor, "libcurl-impersonate-chrome.so"),
		];
	} else if (suffix.startsWith("darwin-")) {
		candidates = [
			join(vendor, "libcurl-impersonate.4.dylib"),
			join(vendor, "libcurl-impersonate.dylib"),
			join(vendor, "libcurl-impersonate-chrome.4.dylib"),
			join(vendor, "libcurl-impersonate-chrome.dylib"),
		];
	} else if (suffix.startsWith("windows-")) {
		candidates = [
			join(vendor, "libcurl-impersonate.dll"),
			join(vendor, "libcurl-impersonate-chrome.dll"),
			join(root, "dist", suffix, "libcurl-impersonate.dll"),
		];
	}

	for (const c of candidates) {
		try {
			if (Bun.file(c).size > 0) return c;
		} catch {
			// ignore
		}
	}
	return null;
}

async function generateEmbeddedAssetsForTarget(t: BuildTarget): Promise<void> {
	const root = join(import.meta.dir, "..");
	const { rustBridge } = getBinaryPathsForTarget(t.suffix);
	const curlImpersonate = findCurlImpersonate(t.suffix);

	const destFile = join(root, "src", "rust", "embedded-assets.ts");

	if (!rustBridge && !curlImpersonate) {
		console.log(
			`[build-standalone] No embedded assets found for ${t.suffix}. Compiling with no-op fallback.`,
		);
		const defaultContent = `/**
 * Auto-generated by build-standalone.ts. Do not modify manually.
 */
export const hasEmbedded = false;
export const rustBridgeAsset: string = "";
export const curlImpersonateAsset: string = "";
`;
		writeFileSync(destFile, defaultContent);
		return;
	}

	console.log(`[build-standalone] Embedding assets for ${t.suffix}:`);
	if (rustBridge) console.log(`  - Rust bridge: ${rustBridge}`);
	if (curlImpersonate) console.log(`  - Curl impersonate: ${curlImpersonate}`);

	let content = `/**
 * Auto-generated by build-standalone.ts. Do not modify manually.
 */
export const hasEmbedded = true;
`;

	if (rustBridge) {
		content += `// @ts-ignore
import rustBridgeAsset from ${JSON.stringify(rustBridge)} with { type: "file" };
export { rustBridgeAsset };
`;
	} else {
		content += `export const rustBridgeAsset = "";\n`;
	}

	if (curlImpersonate) {
		content += `// @ts-ignore
import curlImpersonateAsset from ${JSON.stringify(curlImpersonate)} with { type: "file" };
export { curlImpersonateAsset };
`;
	} else {
		content += `export const curlImpersonateAsset = "";\n`;
	}

	writeFileSync(destFile, content);
}

async function restoreDefaultEmbeddedAssets(): Promise<void> {
	const root = join(import.meta.dir, "..");
	const destFile = join(root, "src", "rust", "embedded-assets.ts");
	const defaultContent = `/**
 * Auto-generated by build-standalone.ts. Do not modify manually.
 */
export const hasEmbedded = false;
export const rustBridgeAsset: string = "";
export const curlImpersonateAsset: string = "";
`;
	writeFileSync(destFile, defaultContent);
}

async function main(): Promise<void> {
	const root = `${import.meta.dir}/..`;
	// Build the full CLI router (serve + install + recon + detect + scrape + cookies + har)
	// — not just `serve.ts`. The router lazy-imports each subcommand.
	const entry = `${root}/src/cli/index.ts`;
	const outDir = `${root}/dist/standalone`;

	const entryExists = await Bun.file(entry).exists();
	if (!entryExists) {
		throw new Error(`Entry point not found : ${entry}`);
	}

	await $`mkdir -p ${outDir}`.quiet();

	const version = await readPackageVersion(root);
	const buildTime = new Date().toISOString();
	// `--define` substitutes identifiers verbatim. The custom names below match
	// the `declare const` shims in src/cli/index.ts, so dev mode (where the
	// identifier is undefined) keeps using `typeof __X__ !== "undefined"`
	// branches that read from package.json.
	const defines: Record<string, string> = {
		__BXC_VERSION__: version,
		__BXC_BUILD_TIME__: buildTime,
		BUILD_VERSION: version,
		BUILD_TIME: buildTime,
		"Bun.env.NODE_ENV": "production",
	};
	const enableBytecode = Bun.env.BXC_NO_BYTECODE !== "1";

	const targets = pickTargets();
	if (targets.length === 0) {
		console.error(
			"[build-standalone] No targets selected (empty BXC_TARGETS ?)",
		);
		process.exit(1);
	}
	console.log(
		`[build-standalone] version=${version} time=${buildTime} bytecode=${enableBytecode} baseline=${BASELINE}`,
	);
	console.log(
		`[build-standalone] Targets : ${targets.map((t) => t.suffix).join(", ")}`,
	);

	const results: BuildResult[] = [];
	try {
		for (const t of targets) {
			await generateEmbeddedAssetsForTarget(t);
			const res = await buildOne(t, entry, outDir, defines, enableBytecode);
			results.push(res);
		}
	} finally {
		await restoreDefaultEmbeddedAssets();
	}

	for (const r of results) {
		if (r.ok) {
			console.log(`  ok ${r.out} -> ${r.sizeMb} MB`);
		} else {
			const errLine = (r.err ?? "").split("\n")[0]?.slice(0, 200) ?? "";
			console.log(`  FAIL ${r.target} : ${errLine}`);
		}
	}

	console.log("\n[build-standalone] Summary :\n");
	console.log(renderTable(results));

	const okCount = results.filter((r) => r.ok).length;
	const failCount = results.length - okCount;
	console.log(
		`\n[build-standalone] ${okCount}/${results.length} target(s) built successfully${failCount > 0 ? ` (${failCount} failed)` : ""}.`,
	);

	if (okCount === 0) {
		console.error("[build-standalone] All builds failed");
		process.exit(1);
	}
	if (failCount > 0) {
		console.warn(
			"[build-standalone] Some targets failed. CI matrix (.github/workflows/release.yml) builds each target on its native runner.",
		);
	}
}

await main();
