import type { Page } from "../api/browser.ts";

/**
 * Minifies HTML to reduce LLM token count.
 * Strips out script, style, svg, and irrelevant attributes.
 */
export function minifyHtmlForLLM(html: string): string {
	let minified = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
	minified = minified.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
	minified = minified.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");
	minified = minified.replace(/<!--[\s\S]*?-->/g, "");

	// Keep only class and id attributes, strip others (like style, data-*)
	// This is a naive regex approach suitable for well-formed HTML
	minified = minified.replace(/<([a-z0-9-]+)\s+([^>]+)>/gi, (_match, tag, attrsStr) => {
		const classMatch = attrsStr.match(/class="([^"]+)"/i);
		const idMatch = attrsStr.match(/id="([^"]+)"/i);

		let newAttrs = "";
		if (idMatch) newAttrs += ` ${idMatch[0]}`;
		if (classMatch) newAttrs += ` ${classMatch[0]}`;

		return `<${tag}${newAttrs}>`;
	});

	// Remove empty lines and excessive whitespace
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

	const systemPrompt = `You are an expert web scraper. Given an HTML snippet, generate robust CSS selectors to extract the information requested by the user.
Return ONLY a valid JSON object where keys are descriptive names for the requested data fields, and values are the corresponding CSS selectors. Do not include markdown formatting like \`\`\`json. Do not explain anything.`;

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
	const jsonText = data.content[0].text.trim();
	try {
		return JSON.parse(jsonText);
	} catch (_e) {
		// Attempt to extract JSON if it was wrapped in markdown despite instructions
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
		// We use `any` here because we only need `textContent()` from the returned handle
		const elements = await page.$$<{ textContent(): Promise<string> }>(selector);
		if (elements.length === 0) {
			result[key] = "";
		} else if (elements.length === 1) {
			result[key] = await elements[0].textContent();
		} else {
			result[key] = await Promise.all(elements.map((el) => el.textContent()));
		}
	}

	return result;
}

/**
 * Performs AI-driven data extraction on the given page based on a natural language instruction.
 * Returns both the extracted data and the LLM-generated CSS selectors.
 */
export async function aiExtractDOM(
	page: Page,
	instruction: string,
): Promise<{ data: Record<string, string | string[]>; selectors: Record<string, string> }> {
	const html = await page.content();
	const minified = minifyHtmlForLLM(html);
	const selectors = await callAnthropicForSelectors(minified, instruction);
	const data = await extractDataWithSelectors(page, selectors);

	return { data, selectors };
}
