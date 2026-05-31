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
 * @module bxc/google/style
 *
 * Google Style Guide rules for TypeScript and JavaScript.
 * Reference: https://google.github.io/styleguide/tsguide.html
 */

export interface StyleRule {
	id: string;
	description: string;
	example: string;
}

/**
 * Core Google Style Guide rules for TypeScript.
 */
export const GOOGLE_TS_STYLE_RULES: StyleRule[] = [
	{
		id: "indentation",
		description:
			"Use 2-space indentation (no tabs). Note: Bxc uses tabs via Biome.",
		example: "  if (true) {\n    return;\n  }",
	},
	{
		id: "semicolons",
		description: "Always use semicolons at the end of every statement.",
		example: "const x = 1;",
	},
	{
		id: "quotes",
		description: "Use single quotes (') by default.",
		example: "const s = 'hello';",
	},
	{
		id: "braces",
		description: "Always use braces for control structures.",
		example: "if (x) { doSomething(); }",
	},
	{
		id: "const-let",
		description:
			"Use const by default, let if reassignment is needed. Never use var.",
		example: "const x = 1; let y = 2; y = 3;",
	},
	{
		id: "naming",
		description:
			"lowerCamelCase for variables/functions, UpperCamelCase for classes/interfaces, CONSTANT_CASE for global constants.",
		example: "const myVar = 1; class MyClass {}; const MAX_COUNT = 10;",
	},
];

/**
 * Check if a code snippet follows basic Google Style Guide rules (partial).
 */
export function checkGoogleStyle(
	code: string,
): { ruleId: string; pass: boolean; message: string }[] {
	const results: { ruleId: string; pass: boolean; message: string }[] = [];

	if (code.includes("\t")) {
		results.push({
			ruleId: "indentation",
			pass: false,
			message: "Contains tabs instead of spaces.",
		});
	}

	if (code.includes("var ")) {
		results.push({
			ruleId: "const-let",
			pass: false,
			message: "Uses 'var' which is forbidden.",
		});
	}

	if (results.length === 0) {
		results.push({
			ruleId: "all",
			pass: true,
			message: "Basic style checks passed.",
		});
	}

	return results;
}
