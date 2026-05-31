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
 * @module bxc/plugin/tailwind-plugin
 *
 * Bun plugin that compiles Tailwind CSS (v3 + v4) at build time.
 *
 * Triggered on any `.css` file containing Tailwind directives:
 *   - `@tailwind` (v3 layers : base, components, utilities)
 *   - `@import "tailwindcss"` (v4 entrypoint)
 *   - `@theme` / `@source` / `@utility` / `@custom-variant` (v4 CSS-first config)
 *   - `@apply`
 *
 * Compilation strategy:
 *   1. Prefer the local `tailwindcss` CLI when found in PATH or node_modules/.bin
 *      (works for both v3 and v4 — same flags `-i` / `-o` / `--content`).
 *   2. Fallback to `bunx tailwindcss` on cold installs.
 *   3. If neither succeeds, the plugin returns the raw CSS untouched and emits a
 *      stderr warning — better than failing the entire build.
 *
 * Reference:
 *   https://developers.google.com/tailwindlabs/tailwindcss
 *   https://tailwindcss.com/docs/installation/using-postcss
 *   https://bun.com/docs/runtime/plugins
 */

import { dirname, resolve as resolvePath } from "node:path";
import type { BunPlugin } from "bun";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TailwindPluginOptions {
	/**
	 * Glob(s) used by Tailwind to scan source files for class names.
	 * Default: `["src/**\/*.{html,ts,tsx,js,jsx,vue,svelte,astro}"]`.
	 */
	content?: readonly string[];
	/**
	 * Working directory passed to the Tailwind CLI. Defaults to `process.cwd()`.
	 * Useful when the plugin runs from a different cwd than the project root.
	 */
	cwd?: string;
	/**
	 * Path to a Tailwind config file (v3) or a `@config` CSS directive root
	 * (v4). When omitted, Tailwind auto-detects.
	 */
	configPath?: string;
	/** Enable Tailwind's `--minify`. Default: false. */
	minify?: boolean;
	/**
	 * Skip the plugin entirely for files that do not contain Tailwind
	 * directives. Default: true (we read the CSS first, sniff for markers,
	 * skip if absent).
	 */
	skipNonTailwind?: boolean;
	/**
	 * Path to the `tailwindcss` CLI binary. Default: auto-resolved via
	 * `node_modules/.bin/tailwindcss` then `which tailwindcss` then
	 * `bunx tailwindcss`.
	 */
	binaryPath?: string;
	/**
	 * If a `bunx`-style fallback is allowed when no local CLI is found.
	 * Default: true.
	 */
	allowBunxFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Tailwind directive detection
// ---------------------------------------------------------------------------

const TAILWIND_RE =
	/@(?:tailwind|apply|theme|source|utility|custom-variant|plugin|config)\b|@import\s+["']tailwindcss["']/i;

function looksLikeTailwind(css: string): boolean {
	return TAILWIND_RE.test(css);
}

// ---------------------------------------------------------------------------
// CLI resolution
// ---------------------------------------------------------------------------

interface ResolvedCli {
	cmd: string[];
	via: "explicit" | "node_modules" | "path" | "bunx";
}

/** Bun-native which — synchronous, no subprocess. */
function which(bin: string): string | null {
	return Bun.which(bin);
}

async function resolveCli(
	options: TailwindPluginOptions,
	cwd: string,
): Promise<ResolvedCli | null> {
	// Bun-native existence probe (Bun.file().exists() is async).
	if (options.binaryPath && (await Bun.file(options.binaryPath).exists())) {
		return { cmd: [options.binaryPath], via: "explicit" };
	}

	// 1. Local node_modules/.bin (most common in projects)
	const localBin = resolvePath(cwd, "node_modules/.bin/tailwindcss");
	if (await Bun.file(localBin).exists()) {
		return { cmd: [localBin], via: "node_modules" };
	}

	// 2. PATH (Bun.which is synchronous)
	const pathBin = which("tailwindcss");
	if (pathBin) {
		return { cmd: [pathBin], via: "path" };
	}

	// 3. bunx fallback
	if (options.allowBunxFallback !== false) {
		const bunx = which("bunx");
		if (bunx) {
			return { cmd: [bunx, "tailwindcss"], via: "bunx" };
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Compile via spawned CLI (works for both v3 and v4)
// ---------------------------------------------------------------------------

async function compileTailwind(
	css: string,
	cli: ResolvedCli,
	options: TailwindPluginOptions,
	cwd: string,
): Promise<string> {
	const args: string[] = [...cli.cmd, "--input", "-"];

	const content = options.content ?? [
		"src/**/*.{html,ts,tsx,js,jsx,vue,svelte,astro,md,mdx}",
	];
	for (const pattern of content) {
		args.push("--content", pattern);
	}

	if (options.configPath) {
		args.push("--config", options.configPath);
	}
	if (options.minify) {
		args.push("--minify");
	}

	const proc = Bun.spawn({
		cmd: args,
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	// Feed input CSS via stdin and close it.
	const writer =
		(proc.stdin as { write: (data: Uint8Array) => void; end: () => void }) ??
		null;
	if (writer && typeof writer.write === "function") {
		writer.write(new TextEncoder().encode(css));
		writer.end();
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(`tailwindcss exited ${exitCode}: ${stderr.slice(0, 400)}`);
	}
	if (!stdout.trim()) {
		throw new Error(
			`tailwindcss produced empty output (stderr: ${stderr.slice(0, 200)})`,
		);
	}
	return stdout;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Bun plugin that intercepts `.css` files containing Tailwind directives,
 * compiles them via the local `tailwindcss` CLI, and returns the resulting
 * CSS to the bundler. Files without Tailwind directives are passed through
 * unchanged.
 */
export function tailwindPlugin(options: TailwindPluginOptions = {}): BunPlugin {
	const skipNonTailwind = options.skipNonTailwind ?? true;
	let cliCache: ResolvedCli | null = null;
	let cliResolved = false;

	return {
		name: "tailwind",
		async setup(build) {
			const cwd =
				options.cwd ??
				(build.config?.root as string | undefined) ??
				process.cwd();

			build.onLoad({ filter: /\.css$/ }, async (args) => {
				const css = await Bun.file(args.path).text();

				if (skipNonTailwind && !looksLikeTailwind(css)) {
					// Pass through unchanged — Bun's CSS loader will handle it natively.
					return undefined;
				}

				if (!cliResolved) {
					cliCache = await resolveCli(options, cwd);
					cliResolved = true;
					if (!cliCache) {
						Bun.stderr.write(
							`tailwind-plugin: tailwindcss CLI not found (tried ${[
								"binaryPath",
								`${cwd}/node_modules/.bin/tailwindcss`,
								"$PATH",
								"bunx",
							].join(", ")}). Returning raw CSS untouched.\n`,
						);
					}
				}

				if (!cliCache) {
					return { contents: css, loader: "css" };
				}

				try {
					const compiled = await compileTailwind(css, cliCache, options, cwd);
					return { contents: compiled, loader: "css" };
				} catch (err) {
					Bun.stderr.write(
						`tailwind-plugin: compile failed for ${args.path} — ${err instanceof Error ? err.message : String(err)}\n`,
					);
					return { contents: css, loader: "css" };
				}
			});

			// Optional convenience: when a TS/TSX entrypoint imports a .css.ts shim
			// (`import css from "./styles.css?inline"`) we let it pass through since
			// the standard onLoad already handles it. No special onResolve needed.
			void dirname; // keep import alive even if branch is unused
		},
	};
}

// ---------------------------------------------------------------------------
// One-shot compiler (programmatic usage outside a build pipeline)
// ---------------------------------------------------------------------------

/**
 * Compile a CSS source string with Tailwind without going through Bun.build.
 *
 * @example
 * ```ts
 * import { compileTailwindCss } from "@aphrody-code/bxc/plugin";
 * const out = await compileTailwindCss(`@tailwind utilities;`, {
 *   content: ["src/**\/*.tsx"],
 *   minify: true,
 * });
 * ```
 */
export async function compileTailwindCss(
	css: string,
	options: TailwindPluginOptions = {},
): Promise<string> {
	const cwd = options.cwd ?? process.cwd();
	const cli = await resolveCli(options, cwd);
	if (!cli) {
		throw new Error(
			"tailwindcss CLI not found (looked in node_modules/.bin, $PATH, bunx). Install with: bun add -D tailwindcss @tailwindcss/cli",
		);
	}
	return compileTailwind(css, cli, options, cwd);
}
