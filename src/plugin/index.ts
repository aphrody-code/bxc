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
	lightpandaPlugin,
	registerLightpandaPlugin,
	renderPage,
	clearLightpandaCache,
	lightpandaCacheStats,
	type LightpandaPluginOptions,
} from "./lightpanda-plugin.ts";

export {
	tailwindPlugin,
	compileTailwindCss,
	type TailwindPluginOptions,
} from "./tailwind-plugin.ts";

export {
	nextPlugin,
	nextShimsPlugin,
	nextDirectivesPlugin,
	nextRouterPlugin,
	nextEnvPlugin,
	getNextDirectivesManifest,
	getNextRouteManifest,
	type NextPluginOptions,
	type NextRoute,
	type NextRouteManifest,
	type NextDirectivesManifest,
} from "./next-plugin.ts";

export {
	reactCompilerPlugin,
	type ReactCompilerPluginOptions,
} from "./react-compiler-plugin.ts";

export {
	modularizeImportsPlugin,
	type ModularizeImportsPluginOptions,
} from "./modularize-imports-plugin.ts";
