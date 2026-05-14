#!/usr/bin/env bun
/**
 * build-standalone.ts — Production-grade standalone Bunlight executables.
 *
 * Output : dist/standalone/bunlight-{linux-x64,linux-arm64,darwin-x64,darwin-arm64}
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
 *   BUNLIGHT_TARGETS=linux-x64 bun scripts/build-standalone.ts subset
 *   BUNLIGHT_HOST_ONLY=1 bun scripts/build-standalone.ts       host arch only
 *   BUNLIGHT_BASELINE=1 bun scripts/build-standalone.ts        pre-2013 CPU compat
 *   BUNLIGHT_NO_BYTECODE=1 bun scripts/build-standalone.ts     skip bytecode (debug builds)
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

interface BuildTarget {
	readonly target: string; // bun --target=<...>
	readonly suffix: string; // dist/standalone/bunlight-<suffix>
}

// Baseline (pre-2013 Nehalem CPUs without AVX2) variant only applies to x64.
// macOS arm64 + linux arm64 do not have a baseline distinction.
const BASELINE = process.env.BUNLIGHT_BASELINE === "1";
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
	const base = `${outDir}/bunlight-${suffix}`;
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
	const env = process.env.BUNLIGHT_TARGETS?.trim();
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
	if (process.env.BUNLIGHT_HOST_ONLY === "1") {
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
		__BUNLIGHT_VERSION__: version,
		__BUNLIGHT_BUILD_TIME__: buildTime,
		BUILD_VERSION: version,
		BUILD_TIME: buildTime,
		"process.env.NODE_ENV": "production",
	};
	const enableBytecode = process.env.BUNLIGHT_NO_BYTECODE !== "1";

	const targets = pickTargets();
	if (targets.length === 0) {
		console.error(
			"[build-standalone] No targets selected (empty BUNLIGHT_TARGETS ?)",
		);
		Bun.exit(1);
	}
	console.log(
		`[build-standalone] version=${version} time=${buildTime} bytecode=${enableBytecode} baseline=${BASELINE}`,
	);
	console.log(
		`[build-standalone] Targets : ${targets.map((t) => t.suffix).join(", ")}`,
	);

	const results: BuildResult[] = [];
	for (const t of targets) {
		const r = await buildOne(t, entry, outDir, defines, enableBytecode);
		results.push(r);
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
		Bun.exit(1);
	}
	if (failCount > 0) {
		console.warn(
			"[build-standalone] Some targets failed. CI matrix (.github/workflows/release.yml) builds each target on its native runner.",
		);
	}
}

await main();
