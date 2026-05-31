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

import { googleWebSearch } from "../../google/search.ts";

/**
 * Native integration of the 'google_web_search' tool extracted from gemini-cli.
 * In gemini-cli, this delegates to the cloud Gemini API 'googleSearch' feature.
 * Here, we recode it natively to execute directly within our local Chromium engine
 * (Zero-Spawn Bxc engine), ensuring full local execution without cloud dependency.
 */
export const googleWebSearchTool = {
	name: "google_web_search",
	description:
		"Performs a web search using Google Search and returns the results. This tool is useful for finding up-to-date information on the internet based on a query.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query to find information on the web.",
			},
			hl: {
				type: "string",
				description: "Optional language code (e.g. 'en', 'fr').",
			},
			gl: {
				type: "string",
				description: "Optional country code (e.g. 'US', 'FR').",
			},
		},
		required: ["query"],
	},
	execute: async (args: {
		query: string;
		hl?: string;
		gl?: string;
	}): Promise<string> => {
		try {
			const results = await googleWebSearch(args.query, {
				hl: args.hl ?? "en",
				gl: args.gl ?? "US",
				num: 10,
			});

			if (results.length === 0) {
				return "No results found for the query.";
			}

			// Format results for optimal LLM context ingestion
			return results
				.map((r, i) => {
					return `Result [${i + 1}]:\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`;
				})
				.join("\n\n---\n\n");
		} catch (error) {
			return `Failed to execute google_web_search: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
};
