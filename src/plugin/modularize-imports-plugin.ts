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
 * @module bxc/plugin/modularize-imports-plugin
 *
 * Bun plugin that rewrites named imports of barrel packages (lodash, ramda,
 * date-fns, react-icons, ...) into per-symbol deep imports for better
 * tree-shaking. Equivalent to next-swc's `modularizeImports` transform.
 *
 * Reference :
 *   https://developers.google.com/vercel/next.js/blob/canary/packages/next-swc/README.md
 *   https://nextjs.org/docs/app/api-reference/config/next-config-js/modularizeImports
 *
 * Example transform :
 *   import { debounce, throttle } from "lodash";
 *     ↓
 *   import debounce from "lodash/debounce";
 *   import throttle from "lodash/throttle";
 *
 * Pattern templates use `{{member}}` (camelCase symbol) and
 * `{{kebab-case}}` / `{{PascalCase}}` placeholders for per-package quirks
 * (react-icons → `react-icons/fa/FaBeer`).
 */

import type { BunPlugin } from "bun";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ModularizeImportsPluginOptions {
	/**
	 * Map of source-package → rewrite rule.
	 *
	 * `transform`  : path template using `{{member}}`, `{{kebabCase member}}`,
	 *                or `{{ camelCase member }}`. Defaults to `{{member}}`.
	 * `preventFullImport` : when `true`, throw if a side-effectful or
	 *                default import is encountered (default false).
	 *
	 * Defaults below cover the most common barrel packages.
	 */
	rules?: Record<
		string,
		{
			transform?: string;
			preventFullImport?: boolean;
			skipDefaultConversion?: boolean;
		}
	>;
	/** File extensions to process. Default: ts/tsx/js/jsx/mjs/cjs. */
	filter?: RegExp;
}

// ---------------------------------------------------------------------------
// Default rules (port of next.js defaults)
// ---------------------------------------------------------------------------

const DEFAULT_RULES: NonNullable<ModularizeImportsPluginOptions["rules"]> = {
	lodash: { transform: "lodash/{{member}}", preventFullImport: false },
	"lodash-es": { transform: "lodash-es/{{member}}", preventFullImport: false },
	"date-fns": { transform: "date-fns/{{member}}" },
	ramda: { transform: "ramda/{{kebabCase member}}" },
	"@mui/material": { transform: "@mui/material/{{member}}" },
	"@mui/icons-material": { transform: "@mui/icons-material/{{member}}" },
	"react-bootstrap": { transform: "react-bootstrap/{{member}}" },
	"react-icons/fa": { transform: "react-icons/fa/{{member}}" },
	"react-icons/md": { transform: "react-icons/md/{{member}}" },
	"react-icons/io": { transform: "react-icons/io/{{member}}" },
	"react-icons/ai": { transform: "react-icons/ai/{{member}}" },
	"react-icons/bi": { transform: "react-icons/bi/{{member}}" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function camelCase(s: string): string {
	return s
		.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
		.replace(/^(.)/, (m) => m.toLowerCase());
}

function kebabCase(s: string): string {
	return s
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

function applyTemplate(template: string, member: string): string {
	return template
		.replace(/\{\{\s*kebabCase\s+member\s*\}\}/g, kebabCase(member))
		.replace(/\{\{\s*camelCase\s+member\s*\}\}/g, camelCase(member))
		.replace(/\{\{\s*member\s*\}\}/g, member);
}

/**
 * Regex-based AST-lite rewrite of named-import lines. Tradeoff: simpler
 * + zero-dep, but doesn't see imports rewritten by other ES-transform
 * plugins. For mature pipelines, swap with a Babel pass.
 */
function rewriteImports(
	source: string,
	rules: NonNullable<ModularizeImportsPluginOptions["rules"]>,
): { code: string; changed: boolean } {
	const importRe =
		/^\s*import\s*(?:type\s+)?\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']\s*;?\s*$/gm;
	let changed = false;
	const code = source.replace(
		importRe,
		(full, names: string, source: string) => {
			const rule = rules[source];
			if (!rule) return full;
			const transform = rule.transform ?? `${source}/{{member}}`;
			const members = names
				.split(",")
				.map((n) => n.trim())
				.filter(Boolean);
			const lines: string[] = [];
			for (const raw of members) {
				// Handle `{ original as alias }`
				const aliasMatch = raw.match(
					/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
				);
				const original = aliasMatch?.[1] ?? raw;
				const alias = aliasMatch?.[2] ?? raw;
				const target = applyTemplate(transform, original);
				if (rule.skipDefaultConversion) {
					lines.push(`import { ${original} as ${alias} } from "${target}";`);
				} else {
					lines.push(`import ${alias} from "${target}";`);
				}
			}
			changed = true;
			return lines.join("\n");
		},
	);
	return { code, changed };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function modularizeImportsPlugin(
	options: ModularizeImportsPluginOptions = {},
): BunPlugin {
	const rules = { ...DEFAULT_RULES, ...options.rules };
	const filter = options.filter ?? /\.[mc]?[jt]sx?$/;

	return {
		name: "modularize-imports",
		setup(build) {
			build.onLoad({ filter }, async (args) => {
				const source = await Bun.file(args.path).text();
				// Cheap pre-filter: skip files without any of the targeted package names
				if (
					!Object.keys(rules).some(
						(p) => source.includes(`"${p}"`) || source.includes(`'${p}'`),
					)
				) {
					return undefined;
				}
				const { code, changed } = rewriteImports(source, rules);
				if (!changed) return undefined;
				return { contents: code, loader: pickLoader(args.path) };
			});
		},
	};
}

function pickLoader(path: string): "ts" | "tsx" | "js" | "jsx" {
	if (path.endsWith(".tsx")) return "tsx";
	if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts"))
		return "ts";
	if (path.endsWith(".jsx")) return "jsx";
	return "js";
}
