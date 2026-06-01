/**
 * @license
 * Copyright 2026 aphrody-code
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

// Bxc Native Imports (dynamically loaded inside tool execution for cold start speed)
let activePage: any = null;

async function getOrCreatePage(
	profile: "static" | "fast" | "http" | "stealth" | "max" = "stealth",
) {
	if (activePage) {
		return activePage;
	}
	const { Browser } = await import("../api/browser.ts");
	activePage = await Browser.newPage({ profile });
	return activePage;
}

const server = new McpServer({
	name: "bxc-native-mcp",
	version: "0.5.0",
});

/** Maps a friendly search vertical to Google's `udm` result-mode code. */
const VERTICAL_UDM: Record<string, number> = {
	web: 14,
	images: 2,
	news: 12,
	videos: 7,
	books: 36,
};

/**
 * 1. SQLite Memory System Tuning
 */
let db: Database | null = null;
let setStatement: any = null;
let getStatement: any = null;

function getDb() {
	if (db) return db;
	const dbPath =
		process.env.BXC_MEMORY_DB || `${process.cwd()}/bxc-memory.sqlite`;
	db = new Database(dbPath);
	db.run("PRAGMA journal_mode = WAL;");
	db.run("PRAGMA synchronous = NORMAL;");
	db.run("PRAGMA temp_store = MEMORY;");
	db.run(`
	  CREATE TABLE IF NOT EXISTS memories (
	    id INTEGER PRIMARY KEY AUTOINCREMENT,
	    key TEXT UNIQUE,
	    value TEXT,
	    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	  )
	`);
	setStatement = db.prepare(
		"INSERT OR REPLACE INTO memories (key, value) VALUES (?, ?)",
	);
	getStatement = db.prepare("SELECT value FROM memories WHERE key = ?");
	return db;
}

server.registerTool(
	"tune_memory_sqlite",
	{
		description:
			"Stores or retrieves a fine-tuned memory fact in the high-performance SQLite database.",
		inputSchema: z.object({
			action: z.enum(["get", "set"]),
			key: z.string(),
			value: z.string().optional(),
		}),
	},
	async (args) => {
		getDb();
		if (args.action === "set" && args.value) {
			setStatement.run(args.key, args.value);
			return {
				content: [
					{
						type: "text",
						text: `Memory '${args.key}' tuned and saved to SQLite.`,
					},
				],
			};
		} else {
			const result = getStatement.get(args.key) as
				| { value: string }
				| undefined;
			return {
				content: [
					{
						type: "text",
						text: result
							? result.value
							: `No memory found for key '${args.key}'.`,
					},
				],
			};
		}
	},
);

/**
 * 2. Scrape to Markdown
 */
server.registerTool(
	"bxc_scrape_markdown",
	{
		description: "Scrapes a URL and returns its content in clean GFM Markdown.",
		inputSchema: z.object({
			url: z.string().url(),
			profile: z.enum(["static", "fast", "http", "stealth"]).default("static"),
		}),
	},
	async (args) => {
		const { Browser } = await import("../api/browser.ts");
		const page = await Browser.newPage({ profile: args.profile });
		try {
			await page.goto(args.url);
			const markdown = await page.markdown();
			return { content: [{ type: "text", text: markdown }] };
		} finally {
			await page.close();
		}
	},
);

/**
 * 3. Detect Frameworks
 */
server.registerTool(
	"bxc_detect_frameworks",
	{
		description: "Identifies web frameworks and anti-bot protections on a URL.",
		inputSchema: z.object({
			url: z.string().url(),
		}),
	},
	async (args) => {
		const { Browser } = await import("../api/browser.ts");
		const { detectFrameworks } = await import("../detect.ts");
		const page = await Browser.newPage({ profile: "http" });
		try {
			await page.goto(args.url);
			const html = await page.content();
			const frameworks = await detectFrameworks({ html, headers: {} });
			return {
				content: [{ type: "text", text: JSON.stringify(frameworks, null, 2) }],
			};
		} finally {
			await page.close();
		}
	},
);

/**
 * 5. CDP Native JS Evaluation
 */
server.registerTool(
	"bxc_cdp_evaluate",
	{
		description: "Executes raw JavaScript in the page context via V8.",
		inputSchema: z.object({
			url: z.string().url(),
			script: z.string(),
			profile: z.enum(["static", "fast", "http", "stealth"]).default("stealth"),
		}),
	},
	async (args) => {
		const { Browser } = await import("../api/browser.ts");
		const page = await Browser.newPage({ profile: args.profile });
		try {
			await page.goto(args.url);
			// evaluate() requires a function; wrap the raw script string
			const result = await page.evaluate(
				new Function(args.script) as () => unknown,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} finally {
			await page.close();
		}
	},
);

/**
 * 6. Google Web Search (powerful)
 */
server.registerTool(
	"bxc_search",
	{
		description:
			"Powerful Google Web Search. Returns ranked organic results (title, URL, snippet) and, with `rich`, the featured snippet / knowledge panel / People-Also-Ask / related searches. Authenticates automatically from ~/.bxc/cookies/google.json when present. Prefer this over manual scraping for any web lookup, fact-finding, current-events, or research task. Supports verticals (web/images/news/videos/books).",
		inputSchema: z.object({
			query: z.string().describe("The search query."),
			num: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe("Number of results to request."),
			hl: z.string().optional().describe("UI language, e.g. 'en', 'fr'."),
			gl: z.string().optional().describe("Region bias, e.g. 'US', 'FR'."),
			domain: z
				.string()
				.optional()
				.describe("Google domain, e.g. 'google.fr'."),
			vertical: z
				.enum(["web", "images", "news", "videos", "books"])
				.default("web")
				.describe("Search vertical."),
			rich: z
				.boolean()
				.default(false)
				.describe(
					"Include featured snippet / knowledge panel / PAA / related searches.",
				),
		}),
	},
	async (args) => {
		const { googleSearchRich } = await import("../google/search.ts");
		const r = await googleSearchRich(args.query, {
			hl: args.hl,
			gl: args.gl,
			num: args.num,
			domain: args.domain,
			udm: args.rich ? undefined : (VERTICAL_UDM[args.vertical] ?? 14),
			classic: !args.rich,
		});
		const payload = {
			query: r.query,
			authenticated: r.authenticated,
			transport: r.profileUsed,
			totalResults: r.totalResults,
			correctedQuery: r.correctedQuery,
			organic: r.organic.map((o) => ({
				position: o.position,
				title: o.title,
				url: o.url,
				snippet: o.snippet,
			})),
			...(args.rich
				? {
						featuredSnippet: r.featuredSnippet,
						knowledgePanel: r.knowledgePanel,
						peopleAlsoAsk: r.peopleAlsoAsk,
						relatedSearches: r.relatedSearches,
					}
				: {}),
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		};
	},
);

/**
 * 7. Google-grade fetch + structured-data extraction
 */
server.registerTool(
	"bxc_google_fetch",
	{
		description:
			"Fetches a URL and returns its clean GFM Markdown plus structured metadata extracted in one pass: JSON-LD, OpenGraph, Twitter cards, canonical URL and meta description. Ideal for handing an AI both a page's content and its machine-readable metadata in a single call.",
		inputSchema: z.object({
			url: z.string().url(),
			profile: z.enum(["static", "http", "fast", "stealth"]).default("http"),
		}),
	},
	async (args) => {
		const { Browser } = await import("../api/browser.ts");
		const { extractStructuredData } = await import("../google/fetch.ts");
		const page = await Browser.newPage({ profile: args.profile });
		try {
			await page.goto(args.url);
			const html = await page.content();
			const structured = await extractStructuredData(html);
			const markdown = await page.markdown();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ url: args.url, structured, markdown },
							null,
							2,
						),
					},
				],
			};
		} finally {
			await page.close();
		}
	},
);

/**
 * 8. WBO Leaderboard Standings
 */
server.registerTool(
	"bxc_wbo_rankings",
	{
		description: "Retrieves the parsed WBO player rankings leaderboard.",
		inputSchema: z.object({
			category: z
				.enum(["General/Top", "Burst", "Metal"])
				.default("General/Top")
				.describe("Leaderboard format/category"),
			search: z
				.string()
				.optional()
				.describe("Search/filter by player username"),
		}),
	},
	async (args) => {
		const filePath = `${process.cwd()}/data/wbo_rankings_parsed.json`;
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return {
				content: [
					{
						type: "text",
						text: "WBO rankings parsed database not found. Run parse_rankings_all script first.",
					},
				],
			};
		}

		let list = (await file.json()) as any[];
		list = list.filter((player) => player.category === args.category);
		if (args.search) {
			const query = args.search.toLowerCase();
			list = list.filter((player) =>
				player.username.toLowerCase().includes(query),
			);
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(list.slice(0, 50), null, 2),
				},
			],
		};
	},
);

/**
 * 9. WBO Metagame Part Ratings & Synergies
 */
server.registerTool(
	"bxc_wbo_metagame",
	{
		description:
			"Retrieves WBO competitive metagame part rankings and top synergies.",
		inputSchema: z.object({
			type: z
				.enum(["all", "blade", "ratchet", "bit", "synergies"])
				.default("all")
				.describe("Focus area: part type or combo synergies"),
		}),
	},
	async (args) => {
		const filePath = `${process.cwd()}/data/bbx_metagame_data.json`;
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return {
				content: [
					{
						type: "text",
						text: "WBO metagame database not found. Run bbx_metagame_analyst script first.",
					},
				],
			};
		}

		const data = (await file.json()) as any;

		// Helper functions to identify part types
		const isRatchet = (part: string) => /^\d-\d+$/.test(part);
		const getPartType = (part: string) => {
			if (isRatchet(part)) return "ratchet";
			if (
				[
					"Ball",
					"Point",
					"Taper",
					"Flat",
					"Rush",
					"Gear Flat",
					"Spike",
					"Needle",
					"High Needle",
					"Orb",
					"Low Flat",
					"Gear Ball",
				].includes(part) ||
				part.toLowerCase().includes("needle") ||
				part.toLowerCase().includes("flat") ||
				part.toLowerCase().includes("ball") ||
				part.toLowerCase().includes("point") ||
				part.toLowerCase().includes("taper") ||
				part.toLowerCase().includes("orb") ||
				part.toLowerCase().includes("spike") ||
				part.toLowerCase().includes("rush")
			) {
				return "bit";
			}
			return "blade";
		};

		if (args.type === "synergies") {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data.combo_synergy.slice(0, 30), null, 2),
					},
				],
			};
		}

		let partRankings = data.part_rankings as any[];
		if (args.type !== "all") {
			partRankings = partRankings.filter(
				(p) => getPartType(p.part) === args.type,
			);
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							metadata: data.metadata,
							part_rankings: partRankings.slice(0, 30),
						},
						null,
						2,
					),
				},
			],
		};
	},
);

/**
 * 10. Unified Browser Automation Tools
 */
server.registerTool(
	"browser_navigate",
	{
		description:
			"Navigate the active browser page to a URL and wait for it to load.",
		inputSchema: z.object({
			url: z.string().url().describe("URL to navigate to."),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("stealth")
				.describe("Stealth profile to use."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage(args.profile);
		const res = await page.goto(args.url);
		return {
			content: [
				{
					type: "text",
					text: `Navigated to ${args.url}. Status: ${res.status} ${res.statusText}`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_snapshot",
	{
		description:
			"Get the current page content as text (title, URL, and readable body text or GFM Markdown).",
		inputSchema: z.object({}),
	},
	async () => {
		const page = await getOrCreatePage();
		const title = await page.title();
		const url = page.url();
		const markdown = await page.markdown();
		return {
			content: [
				{
					type: "text",
					text: `URL: ${url}\nTitle: ${title}\n\n${markdown}`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_click",
	{
		description: "Click an element matching the CSS selector.",
		inputSchema: z.object({
			selector: z.string().describe("CSS selector of the element to click."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.click(args.selector);
		return {
			content: [
				{
					type: "text",
					text: `Clicked element: ${args.selector}`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_fill",
	{
		description: "Set the value of an input element.",
		inputSchema: z.object({
			selector: z.string().describe("CSS selector of the input element."),
			value: z.string().describe("Value to set."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.evaluate(
			({ selector, value }: { selector: string; value: string }) => {
				const el = document.querySelector(selector) as HTMLInputElement | null;
				if (!el) throw new Error(`Element not found: ${selector}`);
				el.value = value;
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
			},
			{ selector: args.selector, value: args.value },
		);
		return {
			content: [
				{
					type: "text",
					text: `Filled element '${args.selector}' with value.`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_type",
	{
		description: "Type text into an input element.",
		inputSchema: z.object({
			selector: z.string().describe("CSS selector of the element."),
			text: z.string().describe("Text to type."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.type(args.selector, args.text);
		return {
			content: [
				{
					type: "text",
					text: `Typed into element '${args.selector}'.`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_press_key",
	{
		description:
			"Dispatch a keyboard event (press key) on an element or the document.",
		inputSchema: z.object({
			key: z.string().describe("Key name (e.g. Enter, Tab, Escape)."),
			selector: z
				.string()
				.optional()
				.describe("CSS selector (optional, defaults to document)."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.evaluate(
			({ key, selector }: { key: string; selector: string }) => {
				const target = selector ? document.querySelector(selector) : document;
				if (!target) throw new Error(`Element not found: ${selector}`);
				target.dispatchEvent(
					new KeyboardEvent("keydown", { key, bubbles: true }),
				);
				target.dispatchEvent(
					new KeyboardEvent("keyup", { key, bubbles: true }),
				);
			},
			{ key: args.key, selector: args.selector ?? "" },
		);
		return {
			content: [
				{
					type: "text",
					text: `Pressed key '${args.key}'.`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_select_option",
	{
		description: "Select an option from a <select> element.",
		inputSchema: z.object({
			selector: z.string().describe("CSS selector of the select element."),
			value: z.string().describe("Value or text of the option to select."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.evaluate(
			({ selector, value }: { selector: string; value: string }) => {
				const el = document.querySelector(selector) as HTMLSelectElement | null;
				if (!el) throw new Error(`Element not found: ${selector}`);
				const opts = Array.from(el.options);
				const opt = opts.find((o) => o.value === value || o.text === value);
				if (!opt) throw new Error(`Option not found: ${value}`);
				el.value = opt.value;
				el.dispatchEvent(new Event("change", { bubbles: true }));
			},
			{ selector: args.selector, value: args.value },
		);
		return {
			content: [
				{
					type: "text",
					text: `Selected option '${args.value}' in element '${args.selector}'.`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_evaluate",
	{
		description:
			"Evaluate a JavaScript expression in the page context and return the result.",
		inputSchema: z.object({
			expression: z.string().describe("JavaScript expression to evaluate."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		const result = await page.evaluate((expr: string) => {
			return new Function(`return ${expr}`)();
		}, args.expression);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"browser_wait_for",
	{
		description: "Wait for a CSS selector to appear in the DOM.",
		inputSchema: z.object({
			selector: z.string().describe("CSS selector to wait for."),
			timeout: z.number().default(30).describe("Timeout in seconds."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		await page.waitForSelector(args.selector, args.timeout * 1000);
		return {
			content: [
				{
					type: "text",
					text: `Found element: ${args.selector}`,
				},
			],
		};
	},
);

server.registerTool(
	"browser_screenshot",
	{
		description: "Capture a PNG screenshot of the current page viewport.",
		inputSchema: z.object({
			fullPage: z
				.boolean()
				.default(false)
				.describe("Capture full page beyond viewport."),
		}),
	},
	async (args) => {
		const page = await getOrCreatePage();
		const buffer = await page.screenshot({ fullPage: args.fullPage });
		const base64 = Buffer.from(buffer).toString("base64");
		return {
			content: [
				{
					type: "image",
					data: base64,
					mimeType: "image/png",
				},
			],
		};
	},
);

server.registerTool(
	"browser_close",
	{
		description: "Close the current browser page and reset state.",
		inputSchema: z.object({}),
	},
	async () => {
		if (activePage) {
			await activePage.close().catch(() => {});
			activePage = null;
		}
		return {
			content: [
				{
					type: "text",
					text: "Browser closed and state reset.",
				},
			],
		};
	},
);

server.registerTool(
	"bxc_zukan",
	{
		description:
			"Scrapes zukan.inazuma.jp (character list or character details).",
		inputSchema: z.object({
			action: z.enum(["list", "chara"]),
			param: z
				.string()
				.optional()
				.describe("Character ID or query parameter for details (q parameter)."),
			locale: z.enum(["ja", "en", "fr"]).default("ja"),
		}),
	},
	async (args) => {
		const { ZukanScraper } = await import("@aphrody-code/zukan");
		const scraper = new ZukanScraper();
		if (args.action === "list") {
			const list = await scraper.getCharacterList(args.locale);
			return {
				content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
			};
		} else {
			if (!args.param)
				throw new Error("Missing target character parameter ('q')");
			const detail = await scraper.getCharacterDetail(args.param, args.locale);
			return {
				content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
			};
		}
	},
);

/**
 * 11. Specialized Scrapers & Verticals
 */
server.registerTool(
	"bxc_fut_price",
	{
		description:
			"Scrapes the live console/PC price of a FIFA/FC player from FUTBin.",
		inputSchema: z.object({
			url: z.string().url().describe("The FUTBin player URL."),
			profile: z
				.enum(["http", "ghost"])
				.default("ghost")
				.describe("The stealth profile to use."),
		}),
	},
	async (args) => {
		const { scrapeFutBinPrice } = await import("@aphrody-code/fut");
		const result = await scrapeFutBinPrice(args.url, args.profile);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
		};
	},
);

server.registerTool(
	"bxc_fut_player",
	{
		description:
			"Scrapes detailed player statistics, attributes, and traits from FUTGG.",
		inputSchema: z.object({
			url: z.string().url().describe("The FUTGG player URL."),
			profile: z
				.enum(["static", "http", "ghost"])
				.default("static")
				.describe("The stealth profile to use."),
		}),
	},
	async (args) => {
		const { scrapeFutGgPlayer } = await import("@aphrody-code/fut");
		const result = await scrapeFutGgPlayer(args.url, args.profile);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
		};
	},
);

server.registerTool(
	"bxc_voiranime_search",
	{
		description:
			"Searches for an anime in the VoirAnime catalog (French streaming directory).",
		inputSchema: z.object({
			query: z.string().describe("The search term (e.g. 'inazuma')."),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("static"),
		}),
	},
	async (args) => {
		const { VoiranimeScraper } = await import("@aphrody-code/voiranime");
		const scraper = new VoiranimeScraper({ profile: args.profile });
		try {
			const results = await scraper.search(args.query);
			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		} finally {
			await scraper.close().catch(() => {});
		}
	},
);

server.registerTool(
	"bxc_voiranime_info",
	{
		description:
			"Gets metadata, details, and the episodes list for a specific anime series.",
		inputSchema: z.object({
			slugOrUrl: z
				.string()
				.describe(
					"The anime slug (e.g. 'inazuma-eleven-vf') or full VoirAnime URL.",
				),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("static"),
		}),
	},
	async (args) => {
		const { VoiranimeScraper } = await import("@aphrody-code/voiranime");
		const scraper = new VoiranimeScraper({ profile: args.profile });
		try {
			const info = await scraper.getAnime(args.slugOrUrl);
			return {
				content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
			};
		} finally {
			await scraper.close().catch(() => {});
		}
	},
);

server.registerTool(
	"bxc_voiranime_resolve",
	{
		description:
			"Resolves a video embed iframe URL (e.g. Vidmoly, Filemoon) to its direct streaming link.",
		inputSchema: z.object({
			embedUrl: z.string().url().describe("The iframe/embed URL."),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("static"),
		}),
	},
	async (args) => {
		const { VoiranimeScraper } = await import("@aphrody-code/voiranime");
		const scraper = new VoiranimeScraper({ profile: args.profile });
		try {
			const source = await scraper.resolveSource(args.embedUrl, {
				enumerateQualities: true,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(source, null, 2) }],
			};
		} finally {
			await scraper.close().catch(() => {});
		}
	},
);

server.registerTool(
	"bxc_xcom_profile",
	{
		description: "Scrapes public information from a Twitter / X.com profile.",
		inputSchema: z.object({
			username: z
				.string()
				.describe("The Twitter username (with or without @)."),
			screenshot: z
				.boolean()
				.default(false)
				.describe("Capture a screenshot of the profile page."),
			aiExtract: z
				.boolean()
				.default(false)
				.describe("Extract structured properties using local AI."),
		}),
	},
	async (args) => {
		const { XComScraper } = await import("@aphrody-code/xcom");
		const scraper = new XComScraper();
		try {
			await scraper.init();
			const cleanUsername = args.username.replace(/^@/, "");
			const result = await scraper.extractProfile(
				cleanUsername,
				args.screenshot,
			);
			let aiInfo: any = null;
			if (args.aiExtract) {
				try {
					aiInfo = await scraper.aiExtractProfileInfo();
				} catch (aiErr) {
					// ignore
				}
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								username: result.username,
								markdown: result.markdownSnapshot,
								screenshotLength: result.screenshot?.byteLength ?? 0,
								aiInfo,
							},
							null,
							2,
						),
					},
				],
			};
		} finally {
			await scraper.close().catch(() => {});
		}
	},
);

server.registerTool(
	"bxc_recon",
	{
		description:
			"Probes a target URL and produces a full reconnaissance report (HTTP/CDN info, frameworks, assets, CSS selectors).",
		inputSchema: z.object({
			url: z.string().url().describe("Target URL to analyze."),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("http")
				.describe("The transport profile to use."),
			screenshot: z
				.boolean()
				.default(false)
				.describe("Capture screenshot (requires fast/stealth/max profile)."),
		}),
	},
	async (args) => {
		const { recon } = await import("../cli/recon.ts");
		const result = await recon({
			url: args.url,
			profile: args.profile,
			screenshot: args.screenshot,
			quiet: true,
			timeoutMs: 30000,
			json: true,
		} as any);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
		};
	},
);

server.registerTool(
	"bxc_mirror",
	{
		description:
			"Downloads and mirrors a complete site (HTML/CSS/JS/images) to a local directory.",
		inputSchema: z.object({
			url: z.string().url().describe("The website URL to mirror."),
			outDir: z
				.string()
				.describe("Local output directory path to save the mirrored site."),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("http")
				.describe("The transport profile to use."),
			concurrency: z
				.number()
				.default(6)
				.describe("Parallel downloads concurrency."),
			sameOriginOnly: z
				.boolean()
				.default(false)
				.describe("Skip cross-origin assets."),
			recursive: z
				.boolean()
				.default(false)
				.describe("Enable recursive multi-page crawling."),
			maxPages: z.number().optional().describe("Maximum HTML pages to crawl."),
			maxDepth: z.number().optional().describe("Maximum crawl depth."),
			compress: z
				.boolean()
				.default(false)
				.describe("Pre-compress text assets with gzip sidecar files."),
			discoverHidden: z
				.boolean()
				.default(false)
				.describe("Discover hidden pages via robots.txt and sitemaps."),
			resolveSubdomains: z
				.boolean()
				.default(false)
				.describe("Scrape and resolve subdomains of the seed host."),
			resolveCdns: z
				.union([z.boolean(), z.array(z.string())])
				.optional()
				.describe(
					"Resolve and download assets/pages on CDNs (boolean or array of domains).",
				),
			allowedDomains: z
				.array(z.string())
				.optional()
				.describe("Allow only these domains for crawling and downloading."),
			excludedDomains: z
				.array(z.string())
				.optional()
				.describe("Exclude these domains from crawling and downloading."),
			allowedPaths: z
				.array(z.string())
				.optional()
				.describe("Allow only paths starting with these prefixes."),
			excludedPaths: z
				.array(z.string())
				.optional()
				.describe("Exclude paths starting with these prefixes."),
			noParent: z
				.boolean()
				.default(false)
				.describe("Only crawl pages under the seed URL directory path."),
			noHostDirectories: z
				.boolean()
				.default(false)
				.describe("Skip creating host-name directories for same-origin files."),
			delayMs: z
				.number()
				.optional()
				.describe("Throttle wait time (milliseconds) between crawls."),
			har: z
				.string()
				.optional()
				.describe("Output path to save the crawl session as a HAR log."),
			proxy: z
				.string()
				.optional()
				.describe("Proxy server URL (e.g. http://127.0.0.1:8080)."),
			proxyAuth: z
				.string()
				.optional()
				.describe("Proxy credentials (e.g. user:password)."),
			auth: z
				.string()
				.optional()
				.describe("Server credentials (e.g. user:password)."),
			httpVersion: z
				.enum(["1.0", "1.1", "2.0", "3.0", "default"])
				.optional()
				.describe("Set default HTTP version to request."),
			verbose: z
				.boolean()
				.optional()
				.describe("Enable verbose libcurl logging."),
		}),
	},
	async (args) => {
		const { mirrorSite } = await import("../mirror/index.ts");
		await mirrorSite(args.url, {
			outDir: args.outDir,
			profile: args.profile,
			concurrency: args.concurrency,
			sameOriginOnly: args.sameOriginOnly,
			recursive: args.recursive,
			maxPages: args.maxPages,
			maxDepth: args.maxDepth,
			compress: args.compress,
			discoverHidden: args.discoverHidden,
			resolveSubdomains: args.resolveSubdomains,
			resolveCdns: args.resolveCdns,
			allowedDomains: args.allowedDomains,
			excludedDomains: args.excludedDomains,
			allowedPaths: args.allowedPaths,
			excludedPaths: args.excludedPaths,
			noParent: args.noParent,
			noHostDirectories: args.noHostDirectories,
			delayMs: args.delayMs,
			har: args.har,
			proxy: args.proxy,
			proxyAuth: args.proxyAuth,
			auth: args.auth,
			httpVersion: args.httpVersion,
			verbose: args.verbose,
		});
		return {
			content: [
				{
					type: "text",
					text: `Successfully mirrored site ${args.url} to directory: ${args.outDir}`,
				},
			],
		};
	},
);

server.registerTool(
	"bxc_challonge",
	{
		description:
			"Extracts a typed Challonge tournament snapshot (matches, rounds, standings, participants).",
		inputSchema: z.object({
			urlOrPath: z
				.string()
				.describe(
					"Challonge URL (e.g., https://challonge.com/tournament_slug) or local directory path.",
				),
			profile: z
				.enum(["static", "fast", "http", "stealth", "max"])
				.default("http")
				.describe("Stealth profile to use."),
		}),
	},
	async (args) => {
		const { extractChallongeTournament, extractChallongeTournamentFromFile } =
			await import("@aphrody-code/challonge");
		const { Browser } = await import("../api/browser.ts");
		if (/^https?:\/\//.test(args.urlOrPath)) {
			const page = await Browser.newPage({ profile: args.profile });
			try {
				await page.goto(args.urlOrPath);
				const html = await page.content();
				const result = extractChallongeTournament(html, {
					url: args.urlOrPath,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} finally {
				await page.close();
			}
		} else {
			const result = await extractChallongeTournamentFromFile(args.urlOrPath);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		}
	},
);

server.registerTool(
	"bxc_worldbeyblade",
	{
		description:
			"Scrapes or automates worldbeyblade.org forums (profile, thread, forum, search, inbox, sendpm).",
		inputSchema: z.object({
			action: z.enum([
				"status",
				"profile",
				"thread",
				"forum",
				"search",
				"inbox",
				"sendpm",
			]),
			target: z
				.string()
				.optional()
				.describe(
					"User name, uid, URL, thread ID, or query depending on action.",
				),
			page: z.number().default(1).describe("Page number for threads/forums."),
			cookies: z.string().optional().describe("Path to cookies JSON file."),
			pmSubject: z
				.string()
				.optional()
				.describe("Subject of Private Message (sendpm action)."),
			pmBody: z
				.string()
				.optional()
				.describe("Body of Private Message (sendpm action)."),
		}),
	},
	async (args) => {
		const { WorldBeybladeScraper } = await import(
			"@aphrody-code/worldbeyblade"
		);
		const scraper = new WorldBeybladeScraper();
		try {
			const defaultCookie = existsSync("data/worldbeyblade_cookies.json")
				? "data/worldbeyblade_cookies.json"
				: "worldbeyblade";
			await scraper.init({
				cookies: args.cookies || defaultCookie,
			});
			if (args.action === "status") {
				const loggedIn = await scraper.checkLoginStatus();
				return {
					content: [
						{ type: "text", text: JSON.stringify({ loggedIn }, null, 2) },
					],
				};
			} else if (args.action === "profile") {
				if (!args.target) throw new Error("Missing target username/UID");
				const profile = await scraper.getProfile(args.target);
				return {
					content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
				};
			} else if (args.action === "thread") {
				if (!args.target) throw new Error("Missing target thread slug/ID/URL");
				const thread = await scraper.getThread(args.target, args.page);
				return {
					content: [{ type: "text", text: JSON.stringify(thread, null, 2) }],
				};
			} else if (args.action === "forum") {
				if (!args.target) throw new Error("Missing target forum slug/ID/URL");
				const forum = await scraper.getForum(args.target, args.page);
				return {
					content: [{ type: "text", text: JSON.stringify(forum, null, 2) }],
				};
			} else if (args.action === "search") {
				if (!args.target) throw new Error("Missing target search query");
				const results = await scraper.search(args.target);
				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
				};
			} else if (args.action === "inbox") {
				const inbox = await scraper.getInbox();
				return {
					content: [{ type: "text", text: JSON.stringify(inbox, null, 2) }],
				};
			} else {
				if (!args.target)
					throw new Error("Missing target username to send PM to");
				if (!args.pmSubject || !args.pmBody)
					throw new Error("Missing pmSubject or pmBody");
				await scraper.sendPM(args.target, args.pmSubject, args.pmBody);
				return {
					content: [
						{
							type: "text",
							text: `Private message successfully sent to ${args.target}`,
						},
					],
				};
			}
		} finally {
			await scraper.close().catch(() => {});
		}
	},
);

server.registerTool(
	"bxc_actor_run",
	{
		description:
			"Runs a local script, a directory with actor.json/package.json, or a remote Git repository URL as a Bxc Actor. You can optionally provide custom input JSON, storage dir, and control purge behavior.",
		inputSchema: z.object({
			actorPath: z
				.string()
				.describe("The file path, directory path, or Git URL of the Actor."),
			input: z
				.record(z.string(), z.any())
				.optional()
				.describe("Input key-value pairs for the Actor run."),
			purge: z
				.boolean()
				.default(true)
				.describe("Purge default storage on start."),
			storageDir: z
				.string()
				.optional()
				.describe("Custom storage directory path."),
		}),
	},
	async (args) => {
		const { main: actorCliMain } = await import("../cli/actor.ts");
		const cliArgs = ["run", args.actorPath];
		if (args.input) {
			cliArgs.push("--input", JSON.stringify(args.input));
		}
		if (args.storageDir) {
			cliArgs.push("--storage-dir", args.storageDir);
		}
		if (args.purge === false) {
			cliArgs.push("--no-purge");
		}
		try {
			await actorCliMain(
				cliArgs,
				{ insecure: false, quiet: true, json: false, timeoutMs: 30000 },
				{ exitProcess: false },
			);
			return {
				content: [
					{
						type: "text",
						text: `Actor run completed successfully. Target: ${args.actorPath}`,
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Actor run failed. Error: ${String(err)}`,
					},
				],
			};
		}
	},
);

/**
 * Bxc Autonomous Crawler MCP Tools
 */
server.registerTool(
	"bxc_crawl_recursive",
	{
		description:
			"Starts a recursive background crawl for a list of URLs on the VPS, matching depth constraints and domain restrictions. Ideal for scraping and indexing sites recursively.",
		inputSchema: z.object({
			urls: z.array(z.string().url()).describe("URLs to start crawling from."),
			allowedDomains: z
				.array(z.string())
				.optional()
				.describe("Restrict crawl to these domains."),
			maxDepth: z
				.number()
				.int()
				.min(1)
				.default(3)
				.describe("Maximum crawl depth."),
			maxRequests: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("Maximum total requests to crawl."),
			profile: z
				.enum(["static", "fast", "stealth", "max"])
				.default("stealth")
				.describe("Browser profile to use."),
		}),
	},
	async (args) => {
		const { AutonomousCrawler } = await import(
			"../crawler/AutonomousCrawler.ts"
		);
		const crawler = new AutonomousCrawler({
			allowedDomains: args.allowedDomains,
			maxDepth: args.maxDepth,
			maxRequests: args.maxRequests,
			profile: args.profile,
		});

		crawler.run(args.urls).catch((err) => {
			console.error("[MCP background-crawler] Error:", err);
		});

		return {
			content: [
				{
					type: "text",
					text: `Autonomous recursive crawl successfully launched in background. Initial URLs: ${args.urls.join(", ")}`,
				},
			],
		};
	},
);

server.registerTool(
	"bxc_get_url_data",
	{
		description:
			"Retrieves cached or live crawled data (title, status, markdown content, structured JSON metadata, and OpenAPI schema) for a given URL on the VPS. Checks Redis first, then SQLite, then crawls live.",
		inputSchema: z.object({
			url: z.string().url().describe("The URL to fetch data for."),
			force: z
				.boolean()
				.default(false)
				.describe("If true, crawls live and bypasses cache."),
		}),
	},
	async (args) => {
		const { redis } = await import("bun");
		const { BxcDB } = await import("../db/BxcDB.ts");
		const { AutonomousCrawler } = await import(
			"../crawler/AutonomousCrawler.ts"
		);

		let data: any = null;
		let source = "cache";

		if (!args.force) {
			const cached = await redis.get(`bxc:cache:url:${args.url}`);
			if (cached) {
				data = JSON.parse(cached);
				source = "redis";
			} else {
				const db = new BxcDB();
				try {
					const row = db.getScrapeByUrl(args.url);
					if (row) {
						data = {
							url: row.url,
							title: row.metadata ? JSON.parse(row.metadata).title || "" : "",
							status: row.status,
							markdown: row.markdown || "",
							structured: row.json_data ? JSON.parse(row.json_data) : null,
							openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
							timestamp: row.timestamp,
						};
						await redis.set(
							`bxc:cache:url:${args.url}`,
							JSON.stringify(data),
							"EX",
							86400,
						);
						source = "sqlite";
					}
				} finally {
					db.close();
				}
			}
		}

		if (!data) {
			const crawler = new AutonomousCrawler({ maxRequests: 1 });
			await crawler.run([args.url]);
			const db = new BxcDB();
			try {
				const row = db.getScrapeByUrl(args.url);
				if (row) {
					data = {
						url: row.url,
						title: row.metadata ? JSON.parse(row.metadata).title || "" : "",
						status: row.status,
						markdown: row.markdown || "",
						structured: row.json_data ? JSON.parse(row.json_data) : null,
						openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
						timestamp: row.timestamp,
					};
					source = "live-crawl";
				}
			} finally {
				db.close();
			}
		}

		if (!data) {
			return {
				content: [
					{
						type: "text",
						text: `Error: Failed to crawl or retrieve page data for ${args.url}`,
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ source, data }, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"bxc_get_url_openapi",
	{
		description:
			"Retrieves the well-typed OpenAPI schema generated for a given crawled URL on the VPS.",
		inputSchema: z.object({
			url: z
				.string()
				.url()
				.describe("The URL to fetch the OpenAPI schema for."),
		}),
	},
	async (args) => {
		const { redis } = await import("bun");
		const { BxcDB } = await import("../db/BxcDB.ts");
		const { AutonomousCrawler } = await import(
			"../crawler/AutonomousCrawler.ts"
		);

		let openapi: any = null;

		const cached = await redis.get(`bxc:cache:url:${args.url}`);
		if (cached) {
			openapi = JSON.parse(cached).openapi;
		} else {
			const db = new BxcDB();
			try {
				const row = db.getScrapeByUrl(args.url);
				if (row && row.openapi_spec) {
					openapi = JSON.parse(row.openapi_spec);
				}
			} finally {
				db.close();
			}
		}

		if (!openapi) {
			const crawler = new AutonomousCrawler({ maxRequests: 1 });
			await crawler.run([args.url]);
			const db = new BxcDB();
			try {
				const row = db.getScrapeByUrl(args.url);
				if (row && row.openapi_spec) {
					openapi = JSON.parse(row.openapi_spec);
				}
			} finally {
				db.close();
			}
		}

		if (!openapi) {
			return {
				content: [
					{
						type: "text",
						text: `Error: Failed to generate OpenAPI schema for ${args.url}`,
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(openapi, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"bxc_crawl_stats",
	{
		description:
			"Retrieves statistics from the request queue of the autonomous crawler.",
		inputSchema: z.object({}),
	},
	async () => {
		const { RequestQueue } = await import("../queue/RequestQueue.ts");
		const queue = RequestQueue.open("bxc-autonomous-crawler");
		const stats = queue.stats();
		queue.close();
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(stats, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"bxc_get_url_types",
	{
		description:
			"Retrieves generated TypeScript interface definitions representing the schema of a given crawled URL on the VPS.",
		inputSchema: z.object({
			url: z
				.string()
				.url()
				.describe("The URL to generate TypeScript interfaces for."),
		}),
	},
	async (args) => {
		const { redis } = await import("bun");
		const { BxcDB } = await import("../db/BxcDB.ts");
		const { AutonomousCrawler } = await import(
			"../crawler/AutonomousCrawler.ts"
		);
		const { generateTypeScriptTypes } = await import("../utils/typegen.ts");

		let openapi: any = null;
		let title = "PageData";

		const cached = await redis.get(`bxc:cache:url:${args.url}`);
		if (cached) {
			const parsed = JSON.parse(cached);
			openapi = parsed.openapi;
			title = parsed.title || title;
		} else {
			const db = new BxcDB();
			try {
				const row = db.getScrapeByUrl(args.url);
				if (row && row.openapi_spec) {
					openapi = JSON.parse(row.openapi_spec);
					title = row.metadata
						? JSON.parse(row.metadata).title || title
						: title;
				}
			} finally {
				db.close();
			}
		}

		if (!openapi) {
			const crawler = new AutonomousCrawler({ maxRequests: 1 });
			await crawler.run([args.url]);
			const db = new BxcDB();
			try {
				const row = db.getScrapeByUrl(args.url);
				if (row && row.openapi_spec) {
					openapi = JSON.parse(row.openapi_spec);
					title = row.metadata
						? JSON.parse(row.metadata).title || title
						: title;
				}
			} finally {
				db.close();
			}
		}

		if (!openapi) {
			return {
				content: [
					{
						type: "text",
						text: `Error: Failed to generate schema or types for ${args.url}`,
					},
				],
				isError: true,
			};
		}

		const safeInterfaceName =
			title.replace(/[^a-zA-Z0-9]/g, "") || "ScrapedData";
		const tsTypes = generateTypeScriptTypes(openapi, safeInterfaceName);

		return {
			content: [
				{
					type: "text",
					text: tsTypes,
				},
			],
		};
	},
);

server.registerTool(
	"bxc_semantic_search",
	{
		description:
			"Performs ranked semantic similarity search on all crawled web pages on the VPS using cosine similarity.",
		inputSchema: z.object({
			query: z.string().describe("The search query."),
			limit: z
				.number()
				.int()
				.min(1)
				.default(5)
				.describe("Maximum number of results to return."),
		}),
	},
	async (args) => {
		const { BxcDB } = await import("../db/BxcDB.ts");
		const { getEmbedding, cosineSimilarity } = await import(
			"../utils/vector.ts"
		);

		const queryVector = await getEmbedding(args.query);
		const db = new BxcDB();
		try {
			const rows = db.getAllScrapesWithVectors();
			const results = rows.map((r) => {
				let metadataParsed = {};
				try {
					metadataParsed = JSON.parse(r.metadata);
				} catch {}
				let vectorParsed: number[] = [];
				try {
					vectorParsed = JSON.parse(r.vector);
				} catch {}

				const similarity = cosineSimilarity(queryVector, vectorParsed);
				return {
					url: r.url,
					metadata: metadataParsed,
					markdown: r.markdown ? r.markdown.slice(0, 300) + "..." : "",
					similarity,
				};
			});

			results.sort((a, b) => b.similarity - a.similarity);
			const sliced = results.slice(0, args.limit);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ query: args.query, results: sliced },
							null,
							2,
						),
					},
				],
			};
		} finally {
			db.close();
		}
	},
);

server.registerTool(
	"bxc_keyword_search",
	{
		description:
			"Performs full-text keyword search on all crawled web pages on the VPS using SQLite FTS5 rank relevancy matching.",
		inputSchema: z.object({
			query: z.string().describe("The search keyword or query phrase."),
			limit: z
				.number()
				.int()
				.min(1)
				.default(10)
				.describe("Maximum number of results to return."),
		}),
	},
	async (args) => {
		const { BxcDB } = await import("../db/BxcDB.ts");
		const db = new BxcDB();
		try {
			const rows = db.searchFullText(args.query, args.limit);
			const results = rows.map((r) => {
				let metadataParsed = {};
				try {
					metadataParsed = JSON.parse(r.metadata);
				} catch {}
				return {
					url: r.url,
					profile: r.profile,
					status: r.status,
					metadata: metadataParsed,
					markdown: r.markdown ? r.markdown.slice(0, 300) + "..." : "",
					timestamp: r.timestamp,
					rank: r.rank,
				};
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ query: args.query, results }, null, 2),
					},
				],
			};
		} finally {
			db.close();
		}
	},
);

server.registerTool(
	"bxc_crawl_replay_failed",
	{
		description:
			"Replays and retries all failed requests currently stored in the crawler's dead-letter queue.",
		inputSchema: z.object({}),
	},
	async () => {
		const { AutonomousCrawler } = await import(
			"../crawler/AutonomousCrawler.ts"
		);
		const crawler = new AutonomousCrawler();
		const count = crawler.replayFailed();
		return {
			content: [
				{
					type: "text",
					text: `Successfully re-queued ${count} failed crawler requests from DLQ.`,
				},
			],
		};
	},
);

server.registerTool(
	"bxc_x_client",
	{
		description:
			"Native X / Twitter client (cookie auth, no API key). Fetch a profile, a user's tweets, search the Latest timeline, trending news, or resolve the authenticated account. Auth uses an auth_token + ct0 cookie pair from the session file / X_AUTH_TOKEN+X_CT0 env, or an explicit cookie string.",
		inputSchema: z.object({
			action: z
				.enum(["profile", "tweets", "search", "news", "whoami"])
				.describe("Operation to run."),
			handle: z
				.string()
				.optional()
				.describe("@handle (screen name) for profile/tweets."),
			query: z.string().optional().describe("Search query for action=search."),
			count: z
				.number()
				.int()
				.min(1)
				.max(100)
				.default(20)
				.describe("Number of items to fetch for tweets/search/news."),
			cookie: z
				.string()
				.optional()
				.describe(
					'Explicit "auth_token=...; ct0=..." pair (overrides session/env).',
				),
		}),
	},
	async (args) => {
		const { XClient, XSession, getNews } = await import("@aphrody-code/x");
		const session = args.cookie
			? XSession.fromCookieString(args.cookie)
			: XSession.loadOrEnv();
		const client = new XClient(session);

		let payload: unknown;
		switch (args.action) {
			case "profile": {
				if (!args.handle) throw new Error("action=profile requires handle");
				payload = await client.userByScreenName(args.handle.replace(/^@/, ""));
				break;
			}
			case "tweets": {
				if (!args.handle) throw new Error("action=tweets requires handle");
				const uid = await client.userIdFor(args.handle.replace(/^@/, ""));
				payload = await client.userTweets(uid, args.count, undefined, 1);
				break;
			}
			case "search": {
				if (!args.query) throw new Error("action=search requires query");
				payload = await client.search(args.query, args.count);
				break;
			}
			case "news":
				payload = await getNews(client, args.count);
				break;
			case "whoami":
				payload = await client.whoami();
				break;
		}

		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		};
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Pre-warm dynamic imports in the background to eliminate first-call execution latency
	setTimeout(() => {
		Promise.all([
			import("../api/browser.ts"),
			import("../google/search.ts"),
			import("../google/fetch.ts"),
			import("../detect.ts"),
			import("@aphrody-code/fut"),
			import("@aphrody-code/voiranime"),
			import("@aphrody-code/xcom"),
			import("@aphrody-code/x"),
			import("../cli/recon.ts"),
			import("../mirror/index.ts"),
			import("@aphrody-code/challonge"),
			import("@aphrody-code/worldbeyblade"),
			import("../cli/actor.ts"),
		]).catch(() => {});
	}, 100);
}

main().catch((error) => {
	console.error("Fatal error running Bxc MCP Server:", error);
	process.exit(1);
});
