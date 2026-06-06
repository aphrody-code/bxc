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
 * @module bxc/google/gemini-scraper
 *
 * Static scraper and parser for the Gemini Web App.
 */

import { GEMINI_HOST, GEMINI_APP_URL, DEFAULT_USER_AGENT } from "./gemini-web.ts";

/** @deprecated Alias of {@link GEMINI_HOST}; kept so existing importers keep working. */
export const GEMINI_BASE_URL = GEMINI_HOST;

// Feature patterns
const RPC_SERVICE_RE = /"(assistant\.lamda\.[a-zA-Z0-9_./]+)"/g;
const RPC_METHOD_RE = /"(assistant\.lamda\.[a-zA-Z0-9_./]+\/[a-zA-Z0-9_]+)"/g;
const BOQ_HASH_RE = /\b([A-Z][a-zA-Z0-9]{5})\b/g;

// Advanced AST-like mapping regex for Hx constructors linking hashes to RPCs
const BOQ_RPC_MAP_RE = /Hx\("([a-zA-Z0-9_]{5,6})",\s*.*?\s*\[\s*[^\]]*"\/([a-zA-Z0-9_]+Service\.[a-zA-Z0-9_]+)"\]/g;

// CSS class patterns (including common material/layout prefixes)
const CSS_CLASS_RE = /\b((?:g|bp|mat|gemini|chat|sidebar|conversation|button)-[a-zA-Z0-9_-]+)\b/g;
const CSS_VAR_RE = /(--[a-zA-Z0-9_-]+)/g;

// Interactive element selectors/attributes found in code
const INTERACTIVE_ROLE_RE = /role=["'](button|menu|dialog|tab|checkbox|combobox|listbox|option)["']/g;
const ARIA_ATTR_RE = /\b(aria-[a-z0-9-]+)\b/g;

// Model names & feature references
const MODEL_REF_RE = /\b(gemini-2\.[0-9]-(?:flash|pro|ultra|lite)|flash-lite|flash|pro|ultra)\b/gi;
const FEATURE_FLAG_RE = /\b(enable_[a-zA-Z0-9_]+|disable_[a-zA-Z0-9_]+|is_[a-zA-Z0-9_]+_enabled)\b/g;

export interface ScrapedData {
	script_urls: string[];
	css_classes: string[];
	css_variables: string[];
	rpc_services: string[];
	rpc_methods: string[];
	rpc_mappings: Record<string, string>;
	boq_hashes: string[];
	interactive_roles: string[];
	aria_attributes: string[];
	models: string[];
	feature_flags: string[];
	buttons: Array<{ tag: string; text: string }>;
}

export function parseContents(
	html: string,
	scriptUrls: string[],
	bundles: string[],
): ScrapedData {
	const cssClasses = new Set<string>();
	const cssVariables = new Set<string>();
	const rpcServices = new Set<string>();
	const rpcMethods = new Set<string>();
	const rpcMappings: Record<string, string> = {};
	const boqHashes = new Set<string>();
	const interactiveRoles = new Set<string>();
	const ariaAttributes = new Set<string>();
	const models = new Set<string>();
	const featureFlags = new Set<string>();
	const buttons: Array<{ tag: string; text: string }> = [];

	// 1. Parse main HTML shell
	// Look for buttons in the HTML
	const buttonTagMatches = html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi);
	for (const match of buttonTagMatches) {
		const text = match[1].replace(/<[^>]+>/g, "").trim();
		buttons.push({ tag: "button", text });
	}

	const roleButtonMatches = html.matchAll(/<[a-z0-9]+[^>]*role=["']button["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi);
	for (const match of roleButtonMatches) {
		const text = match[1].replace(/<[^>]+>/g, "").trim();
		if (text) {
			buttons.push({ tag: "role=button", text });
		}
	}

	// Scan HTML for CSS classes
	for (const match of html.matchAll(CSS_CLASS_RE)) {
		cssClasses.add(match[1]);
	}

	// Scan HTML for ARIA attributes
	for (const match of html.matchAll(ARIA_ATTR_RE)) {
		ariaAttributes.add(match[1]);
	}

	// Scan HTML inline style tags for CSS variables
	const styleBlocks = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
	for (const match of styleBlocks) {
		for (const varMatch of match[1].matchAll(CSS_VAR_RE)) {
			cssVariables.add(varMatch[1]);
		}
	}

	// 2. Parse JS bundles
	for (const jsContent of bundles) {
		// Extract CSS Classes
		for (const match of jsContent.matchAll(CSS_CLASS_RE)) {
			cssClasses.add(match[1]);
		}

		// Extract CSS Variables from JS code literals
		for (const match of jsContent.matchAll(CSS_VAR_RE)) {
			cssVariables.add(match[1]);
		}

		// Extract RPC services and methods
		for (const match of jsContent.matchAll(RPC_SERVICE_RE)) {
			rpcServices.add(match[1]);
		}
		for (const match of jsContent.matchAll(RPC_METHOD_RE)) {
			rpcMethods.add(match[1]);
		}
		for (const match of jsContent.matchAll(BOQ_HASH_RE)) {
			boqHashes.add(match[1]);
		}

		// Extract Boq Hx mappings
		for (const match of jsContent.matchAll(BOQ_RPC_MAP_RE)) {
			rpcMappings[match[1]] = match[2];
		}

		// Extract Interactive roles
		for (const match of jsContent.matchAll(INTERACTIVE_ROLE_RE)) {
			interactiveRoles.add(match[1]);
		}

		// Extract ARIA attributes
		for (const match of jsContent.matchAll(ARIA_ATTR_RE)) {
			ariaAttributes.add(match[1]);
		}

		// Extract Model references
		for (const match of jsContent.matchAll(MODEL_REF_RE)) {
			models.add(match[1].toLowerCase());
		}

		// Extract Feature flags
		for (const match of jsContent.matchAll(FEATURE_FLAG_RE)) {
			featureFlags.add(match[1]);
		}
	}

	// Filter out common false-positive Boq hashes
	const filteredBoqHashes = new Set<string>();
	const boqHashFilterRe = /^[A-Z][a-z0-9]+[A-Za-z0-9]*$/;
	for (const h of boqHashes) {
		if (h.length === 6 && boqHashFilterRe.test(h)) {
			filteredBoqHashes.add(h);
		}
	}

	// Include mapped hashes in the filtered set
	for (const h of Object.keys(rpcMappings)) {
		filteredBoqHashes.add(h);
	}

	// Deduplicate buttons
	const seenButtons = new Set<string>();
	const dedupedButtons: Array<{ tag: string; text: string }> = [];
	for (const btn of buttons) {
		const btnKey = `${btn.tag}:${btn.text}`;
		if (!seenButtons.has(btnKey)) {
			seenButtons.add(btnKey);
			dedupedButtons.push(btn);
		}
	}

	// Build clean sorted mappings
	const sortedMappings: Record<string, string> = {};
	for (const k of Object.keys(rpcMappings).sort()) {
		sortedMappings[k] = rpcMappings[k];
	}

	return {
		script_urls: scriptUrls,
		css_classes: [...cssClasses].sort(),
		css_variables: [...cssVariables].sort(),
		rpc_services: [...rpcServices].sort(),
		rpc_methods: [...rpcMethods].sort(),
		rpc_mappings: sortedMappings,
		boq_hashes: [...filteredBoqHashes].sort(),
		interactive_roles: [...interactiveRoles].sort(),
		aria_attributes: [...ariaAttributes].sort(),
		models: [...models].sort(),
		feature_flags: [...featureFlags].sort(),
		buttons: dedupedButtons,
	};
}

export class GeminiScraper {
	private userAgent: string;
	private headers: Record<string, string>;

	constructor(userAgent: string = DEFAULT_USER_AGENT) {
		this.userAgent = userAgent;
		this.headers = {
			"User-Agent": this.userAgent,
			"Accept-Language": "en-US,en;q=0.9",
		};
	}

	async fetchPageAndBundles(): Promise<{ html: string; scriptUrls: string[] }> {
		const resp = await fetch(GEMINI_APP_URL, { headers: this.headers });
		if (!resp.ok) {
			throw new Error(`Failed to fetch Gemini Web App: HTTP ${resp.status}`);
		}
		const html = await resp.text();

		// Extract JS file URLs from script tags and link preloads
		const jsUrls = new Set<string>();

		const scriptSrcMatches = html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
		for (const match of scriptSrcMatches) {
			jsUrls.add(match[1]);
		}

		const linkMatches = html.matchAll(/<link\b[^>]*>/gi);
		for (const match of linkMatches) {
			const linkTag = match[0];
			if (linkTag.includes('as="script"') || linkTag.includes("as='script'") || linkTag.includes("as=script")) {
				const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
				if (hrefMatch) {
					jsUrls.add(hrefMatch[1]);
				}
			}
		}

		// Convert relative URLs to absolute
		const absoluteUrls: string[] = [];
		for (const url of jsUrls) {
			if (url.startsWith("//")) {
				absoluteUrls.push(`https:${url}`);
			} else if (url.startsWith("/")) {
				absoluteUrls.push(`${GEMINI_BASE_URL}${url}`);
			} else if (!url.startsWith("http")) {
				absoluteUrls.push(`${GEMINI_BASE_URL}/${url}`);
			} else {
				absoluteUrls.push(url);
			}
		}

		return { html, scriptUrls: absoluteUrls };
	}

	async fetchBundle(url: string): Promise<string> {
		try {
			const resp = await fetch(url, { headers: this.headers });
			if (!resp.ok) {
				return "";
			}
			return await resp.text();
		} catch {
			return "";
		}
	}

	async scrape(): Promise<ScrapedData> {
		const { html, scriptUrls } = await this.fetchPageAndBundles();

		// Download script bundles in parallel
		const bundlePromises = scriptUrls.map((url) => this.fetchBundle(url));
		const bundles = await Promise.all(bundlePromises);
		const validBundles = bundles.filter((content) => content.length > 0);

		return parseContents(html, scriptUrls, validBundles);
	}

	formatMarkdownReport(data: ScrapedData): string {
		const lines: string[] = [
			"# Gemini Web App Static Code Analysis Report",
			"",
			"This report summarizes the features, interactive elements, CSS layout tokens, and backend RPC endpoints extracted from the Gemini Web App frontend code bundles.",
			"",
			"## 1. Scraped JavaScript Bundles",
			`Successfully resolved and analyzed **${data.script_urls.length}** main script and preload bundles:`,
		];
		for (const url of data.script_urls) {
			lines.push(`- [${url.split("/").pop()}](${url})`);
		}

		lines.push(
			"",
			"## 2. Interactive Buttons & Elements",
			`Found **${data.buttons.length}** distinct interactive buttons in the core page HTML shell:`
		);
		for (const btn of data.buttons) {
			lines.push(`- **${btn.text}** (tag: \`${btn.tag}\`)`);
		}

		lines.push(
			"",
			"## 3. CSS Classes & Layout tokens",
			`Found **${data.css_classes.length}** distinct semantic and layout-related CSS classes (filtered by common prefixes):`
		);
		for (const cls of data.css_classes.slice(0, 50)) {
			lines.push(`- \`${cls}\``);
		}
		if (data.css_classes.length > 50) {
			lines.push(`- *... and ${data.css_classes.length - 50} more*`);
		}

		lines.push(
			"",
			"## 4. CSS Custom Variables & Design Tokens",
			`Found **${data.css_variables.length}** custom properties (design variables) defining colors, spacing, and typography:`
		);
		for (const v of data.css_variables.slice(0, 100)) {
			lines.push(`- \`${v}\``);
		}
		if (data.css_variables.length > 100) {
			lines.push(`- *... and ${data.css_variables.length - 100} more*`);
		}

		lines.push(
			"",
			"## 5. JS Functions & Boq RPC Endpoints",
			"### Boq Action Hash to RPC Method Mappings",
			"Mappings used by the `batchexecute` protocol to execute remote backend actions:"
		);
		for (const [h, m] of Object.entries(data.rpc_mappings)) {
			lines.push(`- **${h}** -> \`${m}\``);
		}

		lines.push("", "### RPC Services");
		for (const svc of data.rpc_services) {
			lines.push(`- \`${svc}\``);
		}

		lines.push("", "### RPC Methods");
		for (const method of data.rpc_methods) {
			lines.push(`- \`${method}\``);
		}

		lines.push("", "### Known Boq batchexecute hashes (e.g. conversation/UI state handlers)");
		for (const h of data.boq_hashes.slice(0, 50)) {
			lines.push(`- \`${h}\``);
		}
		if (data.boq_hashes.length > 50) {
			lines.push(`- *... and ${data.boq_hashes.length - 50} more*`);
		}

		lines.push("", "## 6. Model Identifiers & Features", "### Target Models Reference");
		for (const model of data.models) {
			lines.push(`- \`${model}\``);
		}

		lines.push("", "### Feature Flags");
		for (const flag of data.feature_flags.slice(0, 50)) {
			lines.push(`- \`${flag}\``);
		}
		if (data.feature_flags.length > 50) {
			lines.push(`- *... and ${data.feature_flags.length - 50} more*`);
		}

		lines.push("", "## 7. Accessibility & ARIA layout", "### Interactive Roles");
		for (const role of data.interactive_roles) {
			lines.push(`- \`${role}\``);
		}

		lines.push("", "### ARIA Attributes");
		for (const attr of data.aria_attributes) {
			lines.push(`- \`${attr}\``);
		}

		return lines.join("\n");
	}
}
