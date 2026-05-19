# Skill: Bxc AI Extraction (`bxc-extract`)

Use this skill when you need to transform scraped HTML into structured JSON using local AI (Gemma 4).

## When to use
- Extracting product details, articles, or structured data from complex sites.
- You need high-accuracy JSON that follows a specific schema.
- Traditional regex or CSS selectors are too brittle.

## Workflow
1. Scrape the URL to HTML using `bxc scrape <url>`.
2. Define a Zod-like schema for the data you need.
3. Pass the HTML and schema to the extraction tool (via MCP or library).

## Tools
- `bxc_extract_structured`: MCP tool for structured extraction.
- `/bxc:extract <url> --schema <path>`: Slash command for quick extraction.
