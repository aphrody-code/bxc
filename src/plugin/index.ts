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
 * @module bxc/plugin
 *
 * Bun plugin entry points for the bxc ecosystem.
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
