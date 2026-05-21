/**
 * @license
 * Copyright 2026 aphrody-code
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "bun:sqlite";

// Bxc Native Imports
import { Browser } from "../api/browser.ts";
import { detectFrameworks } from "../detect.ts";

const server = new McpServer({
	name: "bxc-native-mcp",
	version: "0.3.0",
});

/**
 * 1. SQLite Memory System Tuning
 */
const dbPath =
	process.env.BXC_MEMORY_DB || `${process.cwd()}/bxc-memory.sqlite`;
const db = new Database(dbPath);
db.run(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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
		if (args.action === "set" && args.value) {
			db.prepare(
				"INSERT OR REPLACE INTO memories (key, value) VALUES (?, ?)",
			).run(args.key, args.value);
			return {
				content: [
					{
						type: "text",
						text: `Memory '${args.key}' tuned and saved to SQLite.`,
					},
				],
			};
		} else {
			const result = db
				.prepare("SELECT value FROM memories WHERE key = ?")
				.get(args.key) as { value: string } | undefined;
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
		const page = await Browser.newPage({ profile: args.profile });
		try {
			await page.goto(args.url);
			const result = await page.evaluate(args.script);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} finally {
			await page.close();
		}
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error("Fatal error running Bxc MCP Server:", error);
	process.exit(1);
});
