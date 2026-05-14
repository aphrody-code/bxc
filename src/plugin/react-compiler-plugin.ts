/**
 * @module bunlight/plugin/react-compiler-plugin
 *
 * Bun plugin that runs the official React Compiler (formerly "React Forget")
 * over `.ts`/`.tsx`/`.js`/`.jsx` files at build time. The compiler
 * automatically memoizes components and hooks, eliminating the need for
 * manual `useMemo` / `useCallback` / `React.memo`.
 *
 * Reference :
 *   https://github.com/facebook/react/tree/main/compiler
 *   https://react.dev/learn/react-compiler
 *   https://bun.com/docs/runtime/plugins
 *
 * The plugin is opt-in : it requires `@babel/core` and
 * `babel-plugin-react-compiler` in the consumer's package. When either is
 * absent, the plugin emits a stderr warning once and passes through
 * source unchanged — better than a hard failure.
 *
 * @example
 * ```ts
 * import { reactCompilerPlugin } from "@aphrody-code/bunlight/plugin";
 * await Bun.build({
 *   entrypoints: ["./app.tsx"],
 *   plugins: [reactCompilerPlugin({ target: "19" })],
 * });
 * ```
 */

import type { BunPlugin } from "bun";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReactCompilerPluginOptions {
	/**
	 * React major version to target. The compiler emits different runtime
	 * imports per major. Default: `"19"` (React 19 + auto-runtime helpers).
	 */
	target?: "17" | "18" | "19";
	/**
	 * If `true`, run the compiler in *all* annotation mode — only files with
	 * a `"use memo"` directive are transformed. Useful for incremental rollout.
	 * Default: `false` (compile every file matching the filter).
	 */
	annotationOnly?: boolean;
	/** Glob filter for files to process. Default: `/\.[mc]?[jt]sx?$/`. */
	filter?: RegExp;
	/**
	 * Abort the build on compile errors. Default: `false` — log to stderr
	 * and pass through original source so other plugins can run.
	 */
	failOnError?: boolean;
	/**
	 * Source-type used by Babel parser. Default: `"module"` (ES modules).
	 */
	sourceType?: "module" | "script";
}

// ---------------------------------------------------------------------------
// Lazy load Babel + the React Compiler plugin
// ---------------------------------------------------------------------------

interface BabelTransformResult {
	code?: string | null;
	map?: unknown;
}
interface BabelCore {
	transformAsync: (
		code: string,
		opts: Record<string, unknown>,
	) => Promise<BabelTransformResult | null>;
}

let babelCache: BabelCore | null = null;
let compilerPluginCache: unknown = null;
let resolutionAttempted = false;
let resolutionError: string | null = null;

async function loadBabelStack(): Promise<{
	babel: BabelCore;
	plugin: unknown;
} | null> {
	if (resolutionAttempted) {
		return babelCache && compilerPluginCache
			? { babel: babelCache, plugin: compilerPluginCache }
			: null;
	}
	resolutionAttempted = true;

	try {
		// Dynamic import keeps Babel out of the dependency graph until the
		// plugin actually fires.
		const babel = (await import("@babel/core")) as unknown as BabelCore;
		const plugin = await import("babel-plugin-react-compiler");
		babelCache = babel;
		compilerPluginCache = (plugin as { default?: unknown }).default ?? plugin;
		return { babel: babelCache, plugin: compilerPluginCache };
	} catch (err) {
		resolutionError = err instanceof Error ? err.message : String(err);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function reactCompilerPlugin(options: ReactCompilerPluginOptions = {}): BunPlugin {
	const filter = options.filter ?? /\.[mc]?[jt]sx?$/;
	const target = options.target ?? "19";
	const annotationOnly = options.annotationOnly ?? false;
	const failOnError = options.failOnError ?? false;
	const sourceType = options.sourceType ?? "module";

	let warnedMissing = false;

	return {
		name: "react-compiler",
		async setup(build) {
			build.onLoad({ filter }, async (args) => {
				const stack = await loadBabelStack();
				if (!stack) {
					if (!warnedMissing) {
						warnedMissing = true;
						process.stderr.write(
							`react-compiler-plugin: @babel/core or babel-plugin-react-compiler not installed (${resolutionError ?? "?"}). Pass-through.\n`,
						);
					}
					return undefined;
				}

				const source = await Bun.file(args.path).text();

				// In annotation-only mode, skip files without `"use memo"` to keep
				// transform overhead minimal during the rollout.
				if (annotationOnly && !/^\s*["']use memo["']/m.test(source)) {
					return undefined;
				}

				try {
					const result = await stack.babel.transformAsync(source, {
						filename: args.path,
						babelrc: false,
						configFile: false,
						sourceType,
						parserOpts: {
							plugins: ["jsx", "typescript"],
						},
						plugins: [
							[
								stack.plugin,
								{
									target,
									compilationMode: annotationOnly ? "annotation" : "infer",
								},
							],
						],
					});
					if (!result || typeof result.code !== "string") {
						return undefined;
					}
					return { contents: result.code, loader: pickLoader(args.path) };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (failOnError) {
						throw new Error(`react-compiler failed for ${args.path}: ${msg}`);
					}
					process.stderr.write(`react-compiler-plugin: skip ${args.path} (${msg.slice(0, 200)})\n`);
					return undefined;
				}
			});
		},
	};
}

function pickLoader(path: string): "ts" | "tsx" | "js" | "jsx" {
	if (path.endsWith(".tsx")) return "tsx";
	if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) return "ts";
	if (path.endsWith(".jsx")) return "jsx";
	return "js";
}
