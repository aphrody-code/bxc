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

import type { Page } from "../api/browser.ts";

import { htmlToMarkdown } from "../rust/bridge.ts";

/**
 * Minifies HTML to reduce LLM token count using the native Rust bridge.
 * Converts to Markdown to strip out all non-content noise.
 */
export async function minifyHtmlForLLM(html: string): Promise<string> {
	// Use the native high-performance Rust bridge to convert to Markdown (strips noise)
	let minified = htmlToMarkdown(html) || html;

	// Basic minification
	minified = minified.replace(/\s+/g, " ");
	return minified.trim();
}

/**
 * Calls Anthropic's Claude API to generate CSS selectors based on the instruction.
 */
export async function callAnthropicForSelectors(
	minifiedHtml: string,
	instruction: string,
): Promise<Record<string, string>> {
	const apiKey = Bun.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
	}

	const systemPrompt = `You are an expert web scraper specialized in the Google ecosystem. Given an HTML snippet from a Google property, generate robust CSS selectors to extract the information requested.
Return ONLY a valid JSON object where keys are descriptive names for the requested data fields, and values are the corresponding CSS selectors. Do not include markdown formatting. Do not explain anything.`;

	const userPrompt = `Instruction: ${instruction}\n\nHTML:\n${minifiedHtml.slice(0, 100000)}`;

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: "claude-3-5-sonnet-20241022",
			max_tokens: 1024,
			system: systemPrompt,
			messages: [{ role: "user", content: userPrompt }],
			temperature: 0,
		}),
	});

	if (!response.ok) {
		throw new Error(
			`Anthropic API error: ${response.status} ${response.statusText} - ${await response.text()}`,
		);
	}

	const data = (await response.json()) as { content: { text: string }[] };
	const jsonText = (data.content[0]?.text ?? "").trim();
	try {
		return JSON.parse(jsonText);
	} catch {
		const match = jsonText.match(/\{[\s\S]*\}/);
		if (match) {
			return JSON.parse(match[0]);
		}
		throw new Error(`Failed to parse LLM response as JSON: ${jsonText}`);
	}
}

/**
 * Extracts data from a Page using the generated selectors.
 */
export async function extractDataWithSelectors(
	page: Page,
	selectors: Record<string, string>,
): Promise<Record<string, string | string[]>> {
	const result: Record<string, string | string[]> = {};

	for (const [key, selector] of Object.entries(selectors)) {
		const elements = await page.$$<any>(selector);
		if (elements.length === 0) {
			result[key] = "";
		} else if (elements.length === 1) {
			result[key] = (await elements[0].textContent()) ?? "";
		} else {
			result[key] = await Promise.all(
				elements.map(async (el) => (await el.textContent()) ?? ""),
			);
		}
	}

	return result;
}

/**
 * Resolves a natural language query to a CSS selector using Anthropic's Claude API.
 * Falls back to a basic heuristic if no API key is provided, fully bypassing the old Python mock.
 */
export async function resolveSemantic(
	query: string,
	html: string,
): Promise<{ status: string; selector: string; message?: string }> {
	const apiKey = Bun.env.ANTHROPIC_API_KEY;
	if (apiKey) {
		try {
			const minified = await minifyHtmlForLLM(html);
			const selectors = await callAnthropicForSelectors(minified, query);
			// We expect Anthropic to return {"target": "css_selector"}
			const selector = Object.values(selectors)[0] || "*";
			return { status: "success", selector };
		} catch (err) {
			return { status: "error", selector: "", message: String(err) };
		}
	}

	// Mock logic fallback (same as the old python script)
	const q = query.toLowerCase();
	let selector = "*";
	if (q.includes("a") || q.includes("link")) {
		selector = "a";
	} else if (q.includes("button")) {
		selector = "button";
	} else if (q.includes("input") || q.includes("search")) {
		selector = "input";
	}

	return { status: "success", selector };
}

/**
 * Performs AI-driven data extraction on the given page based on a natural language instruction.
 * Returns both the extracted data and the LLM-generated CSS selectors.
 * Example instruction: "Extract all search result titles from google.com"
 */
export async function aiExtractDOM(
	page: Page,
	instruction: string,
): Promise<{
	data: Record<string, string | string[]>;
	selectors: Record<string, string>;
}> {
	const html = await page.content();
	const minified = await minifyHtmlForLLM(html);
	const selectors = await callAnthropicForSelectors(minified, instruction);
	const data = await extractDataWithSelectors(page, selectors);

	return { data, selectors };
}
