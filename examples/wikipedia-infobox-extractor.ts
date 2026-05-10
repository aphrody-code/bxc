/**
 * Example — Wikipedia Infobox Extractor (profile: static)
 *
 * Fetches 10 Wikipedia pages for technology topics and extracts their infobox
 * data (label/value pairs) using Bunlight's static profile (zigquery cdylib
 * in-process DOM, no browser binary needed).
 *
 * Profile choice: "static"
 * Wikipedia serves well-formed static HTML with no anti-bot protections for
 * reasonable request rates. The static profile is 5-10x faster than "fast"
 * (Lightpanda sub-process) for pure DOM extraction tasks.
 *
 * Usage:
 *   bun run examples/wikipedia-infobox-extractor.ts
 *
 * Output:
 *   storage/datasets/wikipedia-infoboxes/data.jsonl  (one JSON row per topic)
 *   storage/datasets/wikipedia-infoboxes/meta.json
 */

import { Browser } from "../src/api/browser.ts";
import type { Page } from "../src/api/browser.ts";
import { Dataset } from "../src/storage/Dataset.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxRow {
	label: string;
	value: string;
}

interface TopicRecord {
	topic: string;
	url: string;
	title: string;
	infobox: Record<string, string>;
	rows: InboxRow[];
	fetchedAt: string;
}

// Element handle shape exposed by Page#makeHandle (internal duck-type)
interface ElementHandle {
	nodeId: number;
	textContent(): Promise<string>;
	outerHTML(): Promise<string>;
	getAttribute(name: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const TOPICS = [
	"JavaScript",
	"TypeScript",
	"Bun_(software)",
	"Node.js",
	"Python_(programming_language)",
	"Rust_(programming_language)",
	"Go_(programming_language)",
	"WebAssembly",
	"Deno_(software)",
	"V8_(JavaScript_engine)",
];

const WIKIPEDIA_BASE = "https://en.wikipedia.org/wiki";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips wikitext markup characters and collapses whitespace.
 * The static profile returns raw text via textContent() — clean it up.
 */
function normalizeValue(raw: string): string {
	return raw
		.replace(/\[[\d]+\]/g, "") // remove citation brackets [1], [2]
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extracts infobox rows from a Wikipedia page.
 * Infoboxes use <table class="infobox ..."> with <th> labels and <td> values.
 */
async function extractInfobox(page: Page): Promise<InboxRow[]> {
	// Query all infobox table rows — Wikipedia uses class="infobox" or "infobox vevent" etc.
	const rows = await page.$$<ElementHandle>(".infobox tr");
	const result: InboxRow[] = [];

	for (const row of rows) {
		const html = await row.outerHTML();
		// Only process rows that have both a th (label) and td (value)
		if (!html.includes("<th") || !html.includes("<td")) continue;

		// Extract label from <th> text and value from <td> text
		const labelMatch = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(html);
		const valueMatch = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
		if (!labelMatch || !valueMatch) continue;

		const label = normalizeValue(labelMatch[1].replace(/<[^>]+>/g, ""));
		const value = normalizeValue(valueMatch[1].replace(/<[^>]+>/g, ""));

		if (label && value) {
			result.push({ label, value });
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const dataset = await Dataset.open("wikipedia-infoboxes");

console.log(`Extracting infoboxes for ${TOPICS.length} Wikipedia topics (profile: static)...`);

for (let i = 0; i < TOPICS.length; i++) {
	const topic = TOPICS[i];
	const url = `${WIKIPEDIA_BASE}/${encodeURIComponent(topic)}`;
	const start = performance.now();

	// Each page gets its own static transport (no concurrent CDP id collision)
	const page = (await Browser.newPage({ profile: "static" })) as Page;

	let record: TopicRecord;
	try {
		await page.goto(url);
		const title = await page.title();
		const rows = await extractInfobox(page);

		// Build a flat key/value map for easy consumption
		const infobox: Record<string, string> = {};
		for (const { label, value } of rows) {
			// Keep only the first occurrence of duplicate labels
			if (!(label in infobox)) infobox[label] = value;
		}

		record = {
			topic,
			url,
			title,
			infobox,
			rows,
			fetchedAt: new Date().toISOString(),
		};

		const elapsedMs = Math.round(performance.now() - start);
		const rowCount = rows.length;
		console.log(
			`  [${i + 1}/${TOPICS.length}] "${topic}" — ${rowCount} infobox rows (${elapsedMs}ms)`,
		);
	} catch (err) {
		console.error(`  [${i + 1}/${TOPICS.length}] FAILED "${topic}": ${String(err)}`);
		record = {
			topic,
			url,
			title: "",
			infobox: {},
			rows: [],
			fetchedAt: new Date().toISOString(),
		};
	} finally {
		await page.close();
	}

	await dataset.pushData(record);

	// Small delay between pages to be a polite bot (Wikipedia's robots.txt
	// allows crawling but requests reasonable rates)
	if (i < TOPICS.length - 1) await Bun.sleep(500);
}

const count = dataset.getItemCount();
await dataset.close();

console.log(`\nDone. ${count} topics saved to storage/datasets/wikipedia-infoboxes/data.jsonl`);
