#!/usr/bin/env bun
/**
 * Bunlight MCP server v0.5.0 -- built on @modelcontextprotocol/server SDK.
 *
 * 10 tools, 1 resource template, 1 prompt, server instructions.
 * Inspired by ChromeDevTools/chrome-devtools-mcp patterns:
 *   - FIFO Mutex for tool serialization
 *   - evaluate_script / wait_for tools
 *   - Large screenshot auto-save
 * Wire format: stdio (MCP standard).
 * Runtime: Bun-native.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// FIFO Mutex (from chrome-devtools-mcp pattern)
// Serializes tool calls to prevent concurrent access to Browser singleton.
// ---------------------------------------------------------------------------

class Mutex {
	#locked = false;
	#queue: Array<() => void> = [];
	async acquire(): Promise<{ dispose: () => void }> {
		if (!this.#locked) {
			this.#locked = true;
			return { dispose: () => this.#release() };
		}
		await new Promise<void>((resolve) => this.#queue.push(resolve));
		return { dispose: () => this.#release() };
	}
	#release(): void {
		const next = this.#queue.shift();
		if (!next) { this.#locked = false; return; }
		next();
	}
}

const toolMutex = new Mutex();

// ---------------------------------------------------------------------------
// Lazy-load Bunlight from the workspace
// ---------------------------------------------------------------------------

let _bl: any = undefined;

async function loadBunlight(): Promise<any> {
	if (_bl !== undefined) return _bl;
	try {
		// @ts-ignore
		_bl = await import("../../src/api/browser.ts");
	} catch {
		_bl = null;
	}
	return _bl;
}

async function loadDetect(): Promise<any> {
	try {
		// @ts-ignore
		return await import("../../src/detect.ts");
	} catch {
		return null;
	}
}

function requireBunlight(bl: any): void {
	if (!bl) throw new Error("Bunlight not available. Ensure you are running from the bunlight project root.");
}

// ---------------------------------------------------------------------------
// Profile types
// ---------------------------------------------------------------------------

const ProfileEnum = z.enum(["static", "fast", "http", "stealth", "max"]);
type Profile = z.infer<typeof ProfileEnum>;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
	{ name: "bunlight", version: "0.5.0" },
	{
		instructions: [
			"Bunlight is a Bun-native browser automation engine with 5 profiles.",
			"Always call bunlight_detect first to identify the target site's stack and get a profile recommendation.",
			"Use the suggested profile for subsequent scrape/query/link extraction calls.",
			"Profile cost order (cheapest first): static < http < fast < stealth < max.",
			"static: DOM-only, no JS, no binary, <10ms. Best for HTML parsing.",
			"fast: Lightpanda (CDP), JS support, ~120ms. Best for SPAs.",
			"http: curl-impersonate, TLS fingerprint, ~100ms. Best for API/Cloudflare basic.",
			"stealth: Chromium patches, ~800ms. Best for Cloudflare Managed Challenge.",
			"max: Camoufox + CapSolver, ~1500ms. Best for Turnstile/DataDome.",
			"Use bunlight_dom_query for CSS selector extraction. Use bunlight_extract_links for crawling.",
			"Use bunlight_evaluate to run JavaScript in the page context (only works with fast/stealth/max profiles).",
			"Use bunlight_wait_for to wait for text/selectors to appear on SPAs before querying.",
			"bunlight_ai_extract requires ANTHROPIC_API_KEY to function.",
		].join("\n"),
		capabilities: { logging: {} },
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_scrape
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_scrape",
	{
		title: "Scrape URL",
		description:
			"Open a URL with a Bunlight profile and return the page title, HTTP status, content length, latency, and an optional CSS-selected text snippet.",
		inputSchema: z.object({
			url: z.string().url(),
			profile: ProfileEnum.default("static"),
			timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
			selector: z.string().optional().describe("Optional CSS selector to extract text from matched elements."),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, profile, timeoutMs, selector }) => {
		const guard = await toolMutex.acquire();
		try {
		const bl = await loadBunlight();
		requireBunlight(bl);
		const start = Bun.nanoseconds() / 1e6;
		const page = await bl.Browser.newPage({ profile });
		try {
			const resp = await page.goto(url, { timeoutMs });
			const title = await page.title();
			const content = await page.content();
			const elapsed = Math.round(Bun.nanoseconds() / 1e6 - start);

			let snippet = content.slice(0, 500);
			if (selector) {
				const handles = await page.$$(selector);
				const texts: string[] = [];
				for (const h of handles.slice(0, 20)) {
					try { const t = await h.textContent(); if (t) texts.push(t.trim()); } catch {}
				}
				if (texts.length > 0) snippet = texts.join("\n");
			}

			return {
				content: [{
					type: "text" as const,
					text: JSON.stringify({ url: resp?.url || url, title, profile, status: resp?.status, contentLength: content.length, latencyMs: elapsed, snippet: snippet.slice(0, 2000) }, null, 2),
				}],
			};
		} finally {
			await page.close();
		}
		} finally { guard.dispose(); }
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_detect
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_detect",
	{
		title: "Detect Frameworks",
		description:
			"Detect frameworks, CMS, CDN, and WAF on a URL using wappalyzergo. Returns detected technologies and suggests the optimal Bunlight profile.",
		inputSchema: z.object({
			url: z.string().url(),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url }) => {
		const detectMod = await loadDetect();
		if (!detectMod) throw new Error("Bunlight detect module not available.");
		const tech = await detectMod.detectFrameworks(url, { timeoutMs: 20_000 });
		const names = (tech as Array<{ name: string }>).map((t) => t.name.toLowerCase());
		let suggested: Profile = "static";
		if (names.some((n) => n.includes("turnstile") || n.includes("datadome"))) suggested = "max";
		else if (names.some((n) => n.includes("cloudflare") && n.includes("iuam"))) suggested = "stealth";
		else if (names.some((n) => n.includes("cloudflare"))) suggested = "http";
		else if (names.some((n) => /next|react|vue|nuxt|svelte|angular/.test(n))) suggested = "fast";

		return {
			content: [{
				type: "text" as const,
				text: JSON.stringify({
					tech,
					suggestedProfile: suggested,
					rationale: `Detected: ${tech.slice(0, 5).map((t: any) => t.name).join(", ") || "no signals"}. Suggested profile: ${suggested}.`,
				}, null, 2),
			}],
		};
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_dom_query
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_dom_query",
	{
		title: "DOM Query",
		description:
			"Run a CSS selector on a URL and return text content and HTML attributes of each matched element.",
		inputSchema: z.object({
			url: z.string().url(),
			selector: z.string().describe("CSS selector (e.g. 'h1', '.price', 'meta[name=description]')."),
			profile: ProfileEnum.default("static"),
			attributes: z.array(z.string()).default([]).describe("HTML attributes to extract (e.g. ['href', 'src'])."),
			maxResults: z.number().int().min(1).max(200).default(50),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, selector, profile, attributes, maxResults }) => {
		const bl = await loadBunlight();
		requireBunlight(bl);
		const page = await bl.Browser.newPage({ profile });
		try {
			await page.goto(url, { timeoutMs: 30_000 });
			const handles = await page.$$(selector);
			const results: Array<{ index: number; text: string; attrs?: Record<string, string | null> }> = [];
			for (let i = 0; i < Math.min(handles.length, maxResults); i++) {
				const h = handles[i] as any;
				let text = "";
				try { text = (await h.textContent())?.trim() ?? ""; } catch {}
				let attrs: Record<string, string | null> | undefined;
				if (attributes.length > 0) {
					attrs = {};
					for (const attr of attributes) {
						try { attrs[attr] = await h.getAttribute(attr); } catch { attrs[attr] = null; }
					}
				}
				results.push({ index: i, text, ...(attrs ? { attrs } : {}) });
			}
			return {
				content: [{
					type: "text" as const,
					text: JSON.stringify({ url, selector, totalMatches: handles.length, returned: results.length, results }, null, 2),
				}],
			};
		} finally {
			await page.close();
		}
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_extract_links
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_extract_links",
	{
		title: "Extract Links",
		description:
			"Extract all <a href> links from a URL. Resolves relative URLs, deduplicates, and filters by hostname strategy.",
		inputSchema: z.object({
			url: z.string().url(),
			selector: z.string().default("a[href]"),
			strategy: z.enum(["same-hostname", "same-domain", "all"]).default("same-hostname"),
			profile: ProfileEnum.default("static"),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, selector, strategy, profile }) => {
		const bl = await loadBunlight();
		requireBunlight(bl);
		const page = await bl.Browser.newPage({ profile });
		try {
			await page.goto(url, { timeoutMs: 30_000 });
			const handles = await page.$$(selector);
			const links = new Set<string>();
			let baseHostname = "";
			let baseDomain = "";
			try {
				const u = new URL(url);
				baseHostname = u.hostname;
				baseDomain = u.hostname.split(".").slice(-2).join(".");
			} catch {}
			for (const handle of handles) {
				try {
					const href = await (handle as any).getAttribute("href");
					if (!href) continue;
					const resolved = new URL(href, url);
					if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
					resolved.hash = "";
					if (strategy === "same-hostname" && baseHostname && resolved.hostname !== baseHostname) continue;
					if (strategy === "same-domain" && baseDomain) {
						const ld = resolved.hostname.split(".").slice(-2).join(".");
						if (ld !== baseDomain) continue;
					}
					links.add(resolved.href);
				} catch { continue; }
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify({ url, count: links.size, links: Array.from(links) }, null, 2) }],
			};
		} finally {
			await page.close();
		}
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_pool_run
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_pool_run",
	{
		title: "Pool Scrape",
		description: "Scrape multiple URLs concurrently with bounded concurrency. Returns { url, title, latencyMs, error? }[].",
		inputSchema: z.object({
			urls: z.array(z.string().url()).min(1).max(100),
			profile: ProfileEnum.default("static"),
			concurrency: z.number().int().min(1).max(50).default(5),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ urls, profile, concurrency }) => {
		const bl = await loadBunlight();
		requireBunlight(bl);
		const results: Array<{ url: string; title?: string; latencyMs?: number; error?: string }> = [];
		let cursor = 0;
		async function worker(): Promise<void> {
			for (;;) {
				const i = cursor++;
				if (i >= urls.length) return;
				const u = urls[i];
				const start = Bun.nanoseconds() / 1e6;
				let page: any = null;
				try {
					page = await bl.Browser.newPage({ profile });
					await page.goto(u, { timeoutMs: 30_000 });
					const title = await page.title();
					results[i] = { url: u, title, latencyMs: Math.round(Bun.nanoseconds() / 1e6 - start) };
				} catch (e) {
					results[i] = { url: u, error: (e as Error).message };
				} finally {
					if (page) try { await page.close(); } catch {}
				}
			}
		}
		await Promise.all(Array.from({ length: concurrency }, () => worker()));
		return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_ai_extract
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_ai_extract",
	{
		title: "AI Extract",
		description:
			"Extract structured data from a URL using Anthropic Claude. Provide a natural language instruction describing what data to extract. Requires ANTHROPIC_API_KEY.",
		inputSchema: z.object({
			url: z.string().url(),
			instruction: z.string().min(3).describe("What data to extract (e.g. 'product titles and prices')."),
			profile: ProfileEnum.default("static"),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, instruction, profile }) => {
		if (!process.env.ANTHROPIC_API_KEY) {
			return { content: [{ type: "text" as const, text: "ANTHROPIC_API_KEY not set." }], isError: true };
		}
		const bl = await loadBunlight();
		requireBunlight(bl);
		const page = await bl.Browser.newPage({ profile });
		try {
			await page.goto(url, { timeoutMs: 30_000 });
			if (!page.aiExtract) throw new Error("aiExtract not available on this page type.");
			const result = await page.aiExtract(instruction);
			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
		} finally {
			await page.close();
		}
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_screenshot
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_screenshot",
	{
		title: "Screenshot",
		description:
			"Take a PNG screenshot of a URL. Requires a rendering engine (profile=fast, stealth, or max). Returns the image.",
		inputSchema: z.object({
			url: z.string().url(),
			profile: z.enum(["fast", "stealth", "max"]).default("fast"),
			fullPage: z.boolean().default(false),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, profile, fullPage }) => {
		const bl = await loadBunlight();
		requireBunlight(bl);
		const page = await bl.Browser.newPage({ profile });
		try {
			await page.goto(url, { timeoutMs: 30_000 });
			if (!page.screenshot) throw new Error("screenshot() not available on this page type.");
			const png = await page.screenshot({ format: "png", fullPage });
			const b64 = Buffer.from(png).toString("base64");
			return {
				content: [
					{ type: "image" as const, data: b64, mimeType: "image/png" },
					{ type: "text" as const, text: `Screenshot: ${png.length} bytes (${fullPage ? "full page" : "viewport"})` },
				],
			};
		} finally {
			await page.close();
		}
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_extract_cookies
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_extract_cookies",
	{
		title: "Extract Cookies",
		description: "Load a cookie jar from cookies/private/<domain>.json (relative to project root).",
		inputSchema: z.object({
			domain: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/, "Invalid domain"),
		}),
		annotations: { readOnlyHint: true, idempotentHint: true },
	},
	async ({ domain }) => {
		const path = `${process.cwd()}/cookies/private/${domain}.json`;
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return { content: [{ type: "text" as const, text: `Cookie jar not found at ${path}.` }], isError: true };
		}
		const cookies = JSON.parse(await file.text());
		return {
			content: [{
				type: "text" as const,
				text: JSON.stringify({ path, count: Array.isArray(cookies) ? cookies.length : 0, cookies }, null, 2),
			}],
		};
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_evaluate (inspired by chrome-devtools-mcp evaluate_script)
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_evaluate",
	{
		title: "Evaluate JavaScript",
		description:
			"Execute a JavaScript expression in the page context and return the result as JSON. " +
			"Only works with profiles that support JS execution (fast, stealth, max). " +
			"The function must be JSON-serializable.",
		inputSchema: z.object({
			url: z.string().url(),
			expression: z.string().min(1).describe("JavaScript expression or function to evaluate (e.g. 'document.title' or '() => document.querySelectorAll(\"a\").length')."),
			profile: z.enum(["fast", "stealth", "max"]).default("fast"),
			timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
		}),
		annotations: { readOnlyHint: false, openWorldHint: true },
	},
	async ({ url, expression, profile, timeoutMs }) => {
		const guard = await toolMutex.acquire();
		try {
			const bl = await loadBunlight();
			requireBunlight(bl);
			const page = await bl.Browser.newPage({ profile });
			try {
				await page.goto(url, { timeoutMs });
				const result = await page.evaluate(expression);
				return {
					content: [{
						type: "text" as const,
						text: JSON.stringify({ url, expression, result, profile }, null, 2),
					}],
				};
			} finally {
				await page.close();
			}
		} finally { guard.dispose(); }
	},
);

// ---------------------------------------------------------------------------
// Tool: bunlight_wait_for (inspired by chrome-devtools-mcp wait_for)
// ---------------------------------------------------------------------------

server.registerTool(
	"bunlight_wait_for",
	{
		title: "Wait For Content",
		description:
			"Wait for text or a CSS selector to appear on a page. Essential for SPAs where content loads asynchronously. " +
			"Polls the page until the condition is met or timeout expires.",
		inputSchema: z.object({
			url: z.string().url(),
			text: z.string().optional().describe("Text to wait for on the page."),
			selector: z.string().optional().describe("CSS selector to wait for."),
			profile: ProfileEnum.default("static"),
			timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
			pollMs: z.number().int().min(100).max(5000).default(500),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	async ({ url, text, selector, profile, timeoutMs, pollMs }) => {
		if (!text && !selector) {
			return { content: [{ type: "text" as const, text: "Must specify either 'text' or 'selector'." }], isError: true };
		}
		const guard = await toolMutex.acquire();
		try {
			const bl = await loadBunlight();
			requireBunlight(bl);
			const page = await bl.Browser.newPage({ profile });
			try {
				await page.goto(url, { timeoutMs });
				const start = Bun.nanoseconds() / 1e6;
				let found = false;
				let matchInfo = "";
				while (Bun.nanoseconds() / 1e6 - start < timeoutMs) {
					const content = await page.content();
					if (text && content.includes(text)) {
						found = true;
						matchInfo = `Text "${text}" found after ${Math.round(Bun.nanoseconds() / 1e6 - start)}ms.`;
						break;
					}
					if (selector) {
						const handles = await page.$$(selector);
						if (handles.length > 0) {
							found = true;
							matchInfo = `Selector "${selector}" matched ${handles.length} element(s) after ${Math.round(Bun.nanoseconds() / 1e6 - start)}ms.`;
							break;
						}
					}
					await Bun.sleep(pollMs);
				}
				if (!found) {
					return {
						content: [{ type: "text" as const, text: `Timeout: ${text ? `text "${text}"` : `selector "${selector}"`} not found within ${timeoutMs}ms.` }],
						isError: true,
					};
				}
				return { content: [{ type: "text" as const, text: matchInfo }] };
			} finally {
				await page.close();
			}
		} finally { guard.dispose(); }
	},
);

// ---------------------------------------------------------------------------
// Resource: cookie jars
// ---------------------------------------------------------------------------

server.registerResource(
	"cookie-jar",
	new ResourceTemplate("cookies://{domain}", {
		list: async () => {
			const dir = `${process.cwd()}/cookies/private/`;
			try {
				const entries: string[] = [];
				for await (const entry of new Bun.Glob("*.json").scan(dir)) {
					entries.push(entry.replace(".json", ""));
				}
				return {
					resources: entries.map((d) => ({
						uri: `cookies://${d}`,
						name: `Cookie jar: ${d}`,
						mimeType: "application/json",
					})),
				};
			} catch {
				return { resources: [] };
			}
		},
	}),
	{
		title: "Cookie Jar",
		description: "Pre-authenticated cookie jars for bypassing login/challenge flows.",
		mimeType: "application/json",
	},
	async (uri, { domain }) => {
		const path = `${process.cwd()}/cookies/private/${domain}.json`;
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return { contents: [{ uri: uri.href, text: "Cookie jar not found." }] };
		}
		return { contents: [{ uri: uri.href, text: await file.text() }] };
	},
);

// ---------------------------------------------------------------------------
// Prompt: scrape workflow
// ---------------------------------------------------------------------------

server.registerPrompt(
	"scrape-workflow",
	{
		title: "Scrape Workflow",
		description: "Guided workflow: detect the site, choose a profile, then scrape and extract data.",
		argsSchema: z.object({
			url: z.string().url().describe("Target URL to scrape."),
			goal: z.string().describe("What data you want to extract."),
		}),
	},
	({ url, goal }) => ({
		messages: [
			{
				role: "user" as const,
				content: {
					type: "text" as const,
					text: [
						`I want to scrape ${url} and extract: ${goal}`,
						"",
						"Please follow this workflow:",
						"1. Use bunlight_detect to identify the site's framework and anti-bot stack.",
						"2. Use the suggested profile to call bunlight_scrape on the URL.",
						"3. Use bunlight_dom_query with appropriate CSS selectors to extract the requested data.",
						"4. If the site is complex (SPA), consider using bunlight_ai_extract with the goal as the instruction.",
						"5. Summarize the extracted data in a structured format.",
					].join("\n"),
				},
			},
		],
	}),
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGINT", async () => {
	await server.close();
	process.exit(0);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
