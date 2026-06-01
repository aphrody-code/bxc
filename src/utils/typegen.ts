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
 * Generates TypeScript interfaces from an OpenAPI 3.0 schema object.
 */
export function generateTypeScriptTypes(openapiSchema: any, interfaceName = "ScrapedData"): string {
	if (!openapiSchema || !openapiSchema.paths) {
		return `export interface ${interfaceName} {\n\t[key: string]: any;\n}`;
	}

	// Find the response schema
	const paths = Object.values(openapiSchema.paths);
	if (paths.length === 0) {
		return `export interface ${interfaceName} {\n\t[key: string]: any;\n}`;
	}

	const getOperation = (paths[0] as any).get;
	if (!getOperation || !getOperation.responses || !getOperation.responses["200"]) {
		return `export interface ${interfaceName} {\n\t[key: string]: any;\n}`;
	}

	const responseSchema = getOperation.responses["200"].content?.["application/json"]?.schema;
	if (!responseSchema) {
		return `export interface ${interfaceName} {\n\t[key: string]: any;\n}`;
	}

	const lines: string[] = [];
	const visitedObjects = new Set<string>();

	function toTypeScriptType(schema: any, indent = "\t", parentKey = ""): string {
		if (!schema) return "any";

		switch (schema.type) {
			case "string":
				if (schema.format === "date-time") return "string; // ISO Date-Time";
				return "string;";
			case "number":
			case "integer":
				return "number;";
			case "boolean":
				return "boolean;";
			case "array": {
				const itemsType = toTypeScriptType(schema.items, indent, parentKey).trim().replace(/;$/, "");
				if (itemsType.includes("\n")) {
					return `Array<{\n${itemsType}\n${indent}}>;`;
				}
				return `${itemsType}[];`;
			}
			case "object": {
				if (!schema.properties || Object.keys(schema.properties).length === 0) {
					return "Record<string, any>;";
				}
				
				const propLines: string[] = [];
				for (const [k, v] of Object.entries(schema.properties)) {
					const val = v as any;
					const optional = val.nullable ? "?" : "";
					const innerType = toTypeScriptType(val, indent + "\t", k);
					propLines.push(`${indent}${k}${optional}: ${innerType.trim()}`);
				}
				return `{\n${propLines.join("\n")}\n${indent.slice(1)}};`;
			}
			default:
				return "any;";
		}
	}

	const resultBody = toTypeScriptType(responseSchema, "\t");
	
	lines.push(`/**`);
	lines.push(` * Auto-generated TypeScript interfaces for:`);
	lines.push(` * ${openapiSchema.info?.title || "Bxc Scraped Page"}`);
	lines.push(` * Source URL: ${openapiSchema.info?.description?.replace("Dynamically typed OpenAPI representation of crawled page: ", "") || "unknown"}`);
	lines.push(` */`);
	lines.push(`export interface ${interfaceName} ${resultBody.trim().replace(/;$/, "")}`);

	return lines.join("\n");
}
