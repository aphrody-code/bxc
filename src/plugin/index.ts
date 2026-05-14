/**
 * @module bunlight/plugin
 *
 * Bun plugin entry points for the bunlight ecosystem.
 *
 * Currently exposed:
 *   - `lightpandaPlugin`              factory returning a BunPlugin that
 *                                     intercepts `lightpanda:<url>` imports
 *                                     and emits Lightpanda-rendered HTML.
 *   - `registerLightpandaPlugin`      one-shot runtime registration.
 *   - `clearLightpandaCache`          drop the in-memory render cache.
 *   - `lightpandaCacheStats`          inspect cache state.
 *
 * Usage docs: https://bun.com/docs/runtime/plugins
 */

export {
	clearLightpandaCache,
	type LightpandaPluginOptions,
	lightpandaCacheStats,
	lightpandaPlugin,
	registerLightpandaPlugin,
	renderPage,
} from "./lightpanda-plugin.ts";
export {
	type ModularizeImportsPluginOptions,
	modularizeImportsPlugin,
} from "./modularize-imports-plugin.ts";

export {
	getNextDirectivesManifest,
	getNextRouteManifest,
	type NextDirectivesManifest,
	type NextPluginOptions,
	type NextRoute,
	type NextRouteManifest,
	nextDirectivesPlugin,
	nextEnvPlugin,
	nextPlugin,
	nextRouterPlugin,
	nextShimsPlugin,
} from "./next-plugin.ts";

export {
	type ReactCompilerPluginOptions,
	reactCompilerPlugin,
} from "./react-compiler-plugin.ts";
export {
	compileTailwindCss,
	type TailwindPluginOptions,
	tailwindPlugin,
} from "./tailwind-plugin.ts";
