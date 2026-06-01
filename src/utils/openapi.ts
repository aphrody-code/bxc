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

export interface ExtractedPageData {
	url: string;
	title: string;
	description?: string;
	markdown: string;
	structuredData?: any;
	links?: string[];
	timestamp: string;
}

export function generateOpenApiSchema(data: ExtractedPageData): any {
	const properties: Record<string, any> = {
		url: { type: "string", format: "uri", example: data.url },
		title: { type: "string", example: data.title },
		description: { type: "string", example: data.description || "" },
		markdown: { type: "string", description: "GFM Markdown of the page content", example: data.markdown.slice(0, 200) },
		timestamp: { type: "string", format: "date-time", example: data.timestamp }
	};

	if (data.links && data.links.length > 0) {
		properties.links = {
			type: "array",
			items: { type: "string", format: "uri" },
			example: data.links.slice(0, 5)
		};
	}

	// Dynamically infer types for JSON-LD/structured data to produce well-typed OpenAPI schemas
	if (data.structuredData) {
		const inferSchema = (obj: any): any => {
			if (obj === null || obj === undefined) return { type: "string", nullable: true };
			if (typeof obj === "string") return { type: "string", example: obj.slice(0, 100) };
			if (typeof obj === "number") return { type: "number", example: obj };
			if (typeof obj === "boolean") return { type: "boolean", example: obj };
			if (Array.isArray(obj)) {
				const itemSchema = obj.length > 0 ? inferSchema(obj[0]) : { type: "string" };
				return { type: "array", items: itemSchema };
			}
			if (typeof obj === "object") {
				const props: Record<string, any> = {};
				for (const [k, v] of Object.entries(obj)) {
					const safeKey = k.replace(/[^a-zA-Z0-9_]/g, "_");
					props[safeKey] = inferSchema(v);
				}
				return { type: "object", properties: props };
			}
			return { type: "string" };
		};

		properties.structuredData = inferSchema(data.structuredData);
	}

	let pathName = "/";
	try {
		const urlObj = new URL(data.url);
		pathName = "/" + urlObj.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "_");
		if (pathName === "/") pathName = "/root";
	} catch {
		pathName = "/scraped_page";
	}

	return {
		openapi: "3.0.0",
		info: {
			title: `Bxc Auto-Generated API for ${data.title.slice(0, 50)}`,
			description: `Dynamically typed OpenAPI representation of crawled page: ${data.url}`,
			version: "1.0.0"
		},
		paths: {
			[pathName]: {
				get: {
					summary: `Retrieve scraped details of ${data.title.slice(0, 50)}`,
					description: `Returns the parsed Markdown, metadata, and JSON-LD extracted from the page.`,
					responses: {
						"200": {
							description: "Typed structured page content",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties
									}
								}
							}
						}
					}
				}
			}
		}
	};
}
