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
import { extractStructuredData } from "../google/fetch.ts";
import { googleSearchRich } from "../google/search.ts";

const server = new McpServer({
  name: "bxc-native-mcp",
  version: "0.4.0",
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
const dbPath = process.env.BXC_MEMORY_DB || `${process.cwd()}/bxc-memory.sqlite`;
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
      db.prepare("INSERT OR REPLACE INTO memories (key, value) VALUES (?, ?)").run(
        args.key,
        args.value,
      );
      return {
        content: [
          {
            type: "text",
            text: `Memory '${args.key}' tuned and saved to SQLite.`,
          },
        ],
      };
    } else {
      const result = db.prepare("SELECT value FROM memories WHERE key = ?").get(args.key) as
        | { value: string }
        | undefined;
      return {
        content: [
          {
            type: "text",
            text: result ? result.value : `No memory found for key '${args.key}'.`,
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
      // evaluate() requires a function; wrap the raw script string
      const result = await page.evaluate(new Function(args.script) as () => unknown);
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
      num: z.number().int().min(1).max(20).optional().describe("Number of results to request."),
      hl: z.string().optional().describe("UI language, e.g. 'en', 'fr'."),
      gl: z.string().optional().describe("Region bias, e.g. 'US', 'FR'."),
      domain: z.string().optional().describe("Google domain, e.g. 'google.fr'."),
      vertical: z
        .enum(["web", "images", "news", "videos", "books"])
        .default("web")
        .describe("Search vertical."),
      rich: z
        .boolean()
        .default(false)
        .describe("Include featured snippet / knowledge panel / PAA / related searches."),
    }),
  },
  async (args) => {
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
            text: JSON.stringify({ url: args.url, structured, markdown }, null, 2),
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
      search: z.string().optional().describe("Search/filter by player username"),
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
      list = list.filter((player) => player.username.toLowerCase().includes(query));
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
    description: "Retrieves WBO competitive metagame part rankings and top synergies.",
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
      partRankings = partRankings.filter((p) => getPartType(p.part) === args.type);
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error running Bxc MCP Server:", error);
  process.exit(1);
});
