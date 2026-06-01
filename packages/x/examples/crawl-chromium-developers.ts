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
 * crawl-chromium-developers.ts
 *
 * Architecture: Pattern B — ImpersonatedClient (curl-impersonate chrome146) +
 * RequestQueue (bun:sqlite) + zigquery FFI for DOM extraction.
 * Lightpanda is not used here because its binary is not compiled in vendor/.
 *
 * Stages:
 *   1. Crawl  — https://www.chromium.org/developers/ + 1 level of sub-pages.
 *              Respects robots.txt, deduplicates via RequestQueue, limit 50 URLs.
 *              Saves raw HTML to out/chromium-developers/raw/<slug>.html
 *              and metadata to out/chromium-developers/raw/<slug>.json
 *
 *   2. Extract — zigquery FFI parses title, intro, h2/h3 sections, code blocks,
 *               external links, last-updated date.
 *               Appends to out/chromium-developers/extracted.jsonl
 *
 *   3. Rewrite — GeminiClient.generate() if cookies/private/gemini.google.com.json
 *               is valid. Falls back to heuristic (first paragraph + h2 list).
 *
 *   4. Site    — Generates static HTML in out/chromium-developers/site/
 *               (index.html, pages/<slug>.html, assets/style.css, meta.json)
 *
 * Run:
 *   bun run examples/crawl-chromium-developers.ts
 *
 * Resume: delete crawl.db only to restart from zero. It auto-resumes on crash.
 */

import { join } from "node:path";
import { ImpersonatedClient } from "../src/ffi/curl-impersonate.ts";
import { RequestQueue } from "../src/queue/RequestQueue.ts";
import { RobotsFile } from "../src/utils/robots.ts";
import { parseHtml } from "../src/ffi/zigquery.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEED = "https://www.chromium.org/developers/";
const ORIGIN = "https://www.chromium.org";
const MAX_URLS = 50;
const CONCURRENCY = 3;
const RATE_DELAY_MS = 800; // polite delay between requests
const BXC_DIR = join(import.meta.dir, "..");
const OUT_DIR = join(BXC_DIR, "out/chromium-developers");
const QUEUE_DB = join(OUT_DIR, "crawl.db");
const RAW_DIR = join(OUT_DIR, "raw");
const EXTRACTED_JSONL = join(OUT_DIR, "extracted.jsonl");
const SITE_DIR = join(OUT_DIR, "site");
const GEMINI_COOKIES = join(BXC_DIR, "cookies/private/gemini.google.com.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawMeta {
	url: string;
	slug: string;
	fetchedAt: string;
	statusCode: number;
	contentType: string;
	size: number;
}

interface Section {
	level: "h2" | "h3";
	heading: string;
	paragraphs: string[];
}

interface ExtractedPage {
	url: string;
	slug: string;
	title: string;
	intro: string;
	sections: Section[];
	codeBlocks: string[];
	externalLinks: string[];
	lastUpdated: string | null;
	wordCount: number;
}

interface RewrittenPage extends ExtractedPage {
	tldr: string;
	bullets: string[];
	quote: string;
	geminiUsed: boolean;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function urlToSlug(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname
			.replace(/^\/+|\/+$/g, "")
			.replace(/[^a-z0-9]/gi, "-")
			.toLowerCase();
		return path || "index";
	} catch {
		return "page";
	}
}

function ensureUniqueSlug(slug: string, seen: Set<string>): string {
	if (!seen.has(slug)) {
		seen.add(slug);
		return slug;
	}
	let i = 2;
	while (seen.has(`${slug}-${i}`)) i++;
	const unique = `${slug}-${i}`;
	seen.add(unique);
	return unique;
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

function clamp(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 3) + "...";
}

function normalizeInternalUrl(href: string): string | null {
	try {
		if (href.startsWith("//")) href = "https:" + href;
		if (href.startsWith("/")) href = ORIGIN + href;
		const u = new URL(href);
		if (u.hostname !== "www.chromium.org" && u.hostname !== "chromium.org")
			return null;
		// strip fragment
		u.hash = "";
		// canonicalise trailing slash
		if (!u.pathname.endsWith("/") && !u.pathname.includes("."))
			u.pathname += "/";
		return u.toString();
	} catch {
		return null;
	}
}

function isDevPage(url: string): boolean {
	const u = new URL(url);
	return u.pathname.startsWith("/developers");
}

// ---------------------------------------------------------------------------
// Stage 1: Crawl
// ---------------------------------------------------------------------------

async function crawl(): Promise<Map<string, ExtractedPage>> {
	console.log("[crawl] initialising queue");
	const queue = RequestQueue.open(QUEUE_DB, {
		maxRetries: 2,
		lockTimeoutMs: 60_000,
	});
	queue.addRequest(SEED);

	const client = new ImpersonatedClient({
		profile: "chrome146",
		timeoutMs: 30_000,
	});
	const robots = await RobotsFile.fetch(SEED, { userAgent: "Bxc/1.0" });
	const crawlDelay = robots.crawlDelay("Bxc") ?? robots.crawlDelay("*");
	const delayMs = crawlDelay ? crawlDelay * 1000 : RATE_DELAY_MS;

	const slugSeen = new Set<string>();
	const extractedPages = new Map<string, ExtractedPage>();

	// Recover any stale locks from a previous crashed run
	const recovered = queue.recoverStaleLocks();
	if (recovered > 0)
		console.log(`[crawl] recovered ${recovered} stale locks from previous run`);

	let crawledCount = 0;
	let discovered = 0;

	process.on("SIGINT", () => {
		console.log("\n[crawl] SIGINT — closing queue and client");
		queue.close();
		client.close();
		process.exit(0);
	});

	const stats0 = queue.stats();
	console.log(
		`[crawl] queue: pending=${stats0.pending} done=${stats0.done} failed=${stats0.failed}`,
	);

	// Active worker slots
	const inFlight = new Set<Promise<void>>();

	async function processOne(req: { id: number; url: string }): Promise<void> {
		const { id, url } = req;

		if (!robots.isAllowed(url, "Bxc")) {
			console.log(`[crawl] robots.txt disallows ${url} — skipping`);
			queue.markDone(id);
			return;
		}

		try {
			console.log(`[crawl] [${crawledCount + 1}] GET ${url}`);
			const res = await client.fetch(url, {
				headers: {
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "en-US,en;q=0.9",
				},
			});

			const html = await res.text();
			const statusCode = res.status;
			const contentType = res.headers.get("content-type") ?? "";

			if (statusCode >= 400) {
				queue.markFailed(id, `HTTP ${statusCode}`);
				console.log(`[crawl] HTTP ${statusCode} for ${url}`);
				return;
			}

			// Derive slug
			const baseSlug = urlToSlug(url);
			const slug = ensureUniqueSlug(baseSlug, slugSeen);

			// Save raw HTML
			await Bun.write(`${RAW_DIR}/${slug}.html`, html);

			const meta: RawMeta = {
				url,
				slug,
				fetchedAt: new Date().toISOString(),
				statusCode,
				contentType,
				size: html.length,
			};
			await Bun.write(`${RAW_DIR}/${slug}.json`, JSON.stringify(meta, null, 2));

			// Extract immediately so we have the page data for link discovery
			const extracted = await extractPage(html, url, slug);
			extractedPages.set(slug, extracted);

			crawledCount++;
			console.log(
				`[crawl] [${crawledCount}] done: "${extracted.title}" (${extracted.wordCount} words)`,
			);

			// Discover sub-pages (1 level only from the seed domain /developers path)
			if ((discovered < MAX_URLS && url === SEED) || isDevPage(url)) {
				const doc = await parseHtml(html);
				try {
					const anchors = await doc.find("a[href]");
					for (let i = 0; i < anchors.count && discovered < MAX_URLS; i++) {
						const el = anchors.at(i);
						if (!el) continue;
						const href = el.getAttribute("href");
						el.destroy();
						const normalized = normalizeInternalUrl(href);
						if (!normalized) continue;
						if (!isDevPage(normalized)) continue;
						if (!queue.has(normalized)) {
							queue.addRequest(normalized);
							discovered++;
						}
					}
					anchors.destroy();
				} finally {
					doc.destroy();
				}
			}

			queue.markDone(id);
		} catch (err) {
			queue.markFailed(id, String(err));
			console.error(`[crawl] FAILED ${url}: ${String(err)}`);
		}
	}

	// Drain queue with bounded concurrency
	outer: while (true) {
		// Recover stale periodically
		queue.recoverStaleLocks();

		const stats = queue.stats();
		if (stats.pending === 0 && inFlight.size === 0) break;
		if (crawledCount >= MAX_URLS && stats.pending === 0 && inFlight.size === 0)
			break;

		// Fill up to CONCURRENCY
		while (inFlight.size < CONCURRENCY && crawledCount < MAX_URLS) {
			const batch = queue.fetchBatch(1);
			if (batch.length === 0) break;
			const req = batch[0];
			const p = processOne(req).finally(() => inFlight.delete(p));
			inFlight.add(p);
			await Bun.sleep(delayMs); // polite rate limit between dispatches
		}

		if (inFlight.size === 0) {
			// Nothing in flight and nothing pending
			break outer;
		}

		// Wait for any slot to open up
		await Promise.race(inFlight);
	}

	// Wait for all remaining
	await Promise.all(inFlight);

	const finalStats = queue.stats();
	console.log(
		`[crawl] complete: ${finalStats.done} done, ${finalStats.failed} failed`,
	);
	queue.close();
	client.close();

	return extractedPages;
}

// ---------------------------------------------------------------------------
// Stage 2: Extract structured data from HTML via zigquery
// ---------------------------------------------------------------------------

async function extractPage(
	html: string,
	url: string,
	slug: string,
): Promise<ExtractedPage> {
	let title = "";
	let intro = "";
	const sections: Section[] = [];
	const codeBlocks: string[] = [];
	const externalLinks: string[] = [];
	let lastUpdated: string | null = null;

	let doc;
	try {
		doc = await parseHtml(html);
	} catch {
		// If zigquery unavailable, return minimal extraction
		return {
			url,
			slug,
			title: slug,
			intro: "",
			sections: [],
			codeBlocks: [],
			externalLinks: [],
			lastUpdated: null,
			wordCount: 0,
		};
	}

	try {
		// Title: prefer <h1>, fall back to <title>
		const h1Sel = await doc.find("h1");
		if (h1Sel.count > 0) {
			title = h1Sel.at(0)?.textContent().trim() ?? "";
		}
		h1Sel.destroy();

		if (!title) {
			const titleSel = await doc.find("title");
			if (titleSel.count > 0) {
				title = titleSel.at(0)?.textContent().trim() ?? "";
			}
			titleSel.destroy();
		}

		// Intro: first <p> in main content area
		const pSel = await doc.find(
			"article p, main p, .content p, .entry-content p, div.page p",
		);
		if (pSel.count > 0) {
			intro = pSel.at(0)?.textContent().trim() ?? "";
		} else {
			// Fallback: any first <p>
			const allP = await doc.find("p");
			if (allP.count > 0) {
				intro = allP.at(0)?.textContent().trim() ?? "";
			}
			allP.destroy();
		}
		pSel.destroy();

		// H2 sections
		const h2Sel = await doc.find("h2");
		for (let i = 0; i < h2Sel.count; i++) {
			const el = h2Sel.at(i);
			const heading = el?.textContent().trim() ?? "";
			el?.destroy();
			sections.push({ level: "h2", heading, paragraphs: [] });
		}
		h2Sel.destroy();

		// H3 sections
		const h3Sel = await doc.find("h3");
		for (let i = 0; i < h3Sel.count; i++) {
			const el = h3Sel.at(i);
			const heading = el?.textContent().trim() ?? "";
			el?.destroy();
			sections.push({ level: "h3", heading, paragraphs: [] });
		}
		h3Sel.destroy();

		// Code blocks
		const codeSel = await doc.find("pre, code");
		for (let i = 0; i < Math.min(codeSel.count, 10); i++) {
			const el = codeSel.at(i);
			const text = el?.textContent().trim() ?? "";
			el?.destroy();
			if (text.length > 10) codeBlocks.push(text);
		}
		codeSel.destroy();

		// External links
		const aSel = await doc.find("a[href]");
		for (let i = 0; i < aSel.count; i++) {
			const el = aSel.at(i);
			const href = el?.getAttribute("href") ?? "";
			el?.destroy();
			try {
				const u = new URL(href);
				if (
					u.hostname !== "www.chromium.org" &&
					u.hostname !== "chromium.org"
				) {
					externalLinks.push(href);
				}
			} catch {
				/* relative or invalid */
			}
		}
		aSel.destroy();

		// Last-updated: look for <time> or common "Last updated" text
		const timeSel = await doc.find("time");
		if (timeSel.count > 0) {
			const el = timeSel.at(0);
			lastUpdated =
				el?.getAttribute("datetime") || el?.textContent().trim() || null;
			el?.destroy();
		}
		timeSel.destroy();
	} finally {
		doc.destroy();
	}

	const allText = [title, intro, ...sections.map((s) => s.heading)].join(" ");
	return {
		url,
		slug,
		title: title || slug,
		intro,
		sections: sections.slice(0, 20), // cap to avoid huge pages
		codeBlocks: codeBlocks.slice(0, 5),
		externalLinks: [...new Set(externalLinks)].slice(0, 30),
		lastUpdated,
		wordCount: wordCount(allText),
	};
}

// ---------------------------------------------------------------------------
// Stage 3: AI rewrite (Gemini or heuristic)
// ---------------------------------------------------------------------------

interface GeminiClient {
	generate(prompt: string, options?: any): Promise<{ text: string }>;
	resetChat(): void;
	stop(): Promise<void>;
}

async function tryGeminiBootstrap(): Promise<GeminiClient | null> {
	try {
		const cookieExists = await Bun.file(GEMINI_COOKIES).exists();
		if (!cookieExists) {
			console.log("[gemini] cookie file not found, falling back to heuristic");
			return null;
		}
		const client = null /* gemini removed from main */;
		// gemini removed
		// Lightweight probe
		const probe = { text: "" } /* gemini removed */;
		if (!probe.text.toLowerCase().includes("ok"))
			throw new Error("probe returned unexpected text");
		console.log("[gemini] bootstrap succeeded");
		return client;
	} catch (err) {
		console.log(
			`[gemini] cookies expired or invalid, falling back to heuristic: ${String(err)}`,
		);
		return null;
	}
}

function heuristicRewrite(page: ExtractedPage): {
	tldr: string;
	bullets: string[];
	quote: string;
} {
	const h2s = page.sections
		.filter((s) => s.level === "h2")
		.slice(0, 5)
		.map((s) => s.heading);

	const tldr = page.intro
		? clamp(page.intro, 300)
		: `${page.title} is a page on the Chromium developers documentation site.`;

	const bullets: string[] =
		h2s.length > 0
			? h2s.map((h) => `Section: ${h}`)
			: ["No structured sections found on this page."];

	const quote = page.intro ? clamp(page.intro, 150) : page.title;

	return { tldr, bullets, quote };
}

async function rewritePage(
	page: ExtractedPage,
	gemini: GeminiClient | null,
): Promise<RewrittenPage> {
	if (!gemini) {
		const { tldr, bullets, quote } = heuristicRewrite(page);
		return { ...page, tldr, bullets, quote, geminiUsed: false };
	}

	const prompt = `
You are a technical documentation editor. Given the following page from Chromium developers documentation:

Title: ${page.title}
URL: ${page.url}
Intro: ${clamp(page.intro, 500)}
Sections: ${page.sections.map((s) => `${s.level}: ${s.heading}`).join(", ")}

Write:
1. A TL;DR of exactly 2 sentences.
2. A list of 5 key bullet points (each starting with "-").
3. One short memorable quote (1 sentence, under 100 characters).

Format your response as JSON: {"tldr":"...","bullets":["..."],"quote":"..."}
Do not wrap in markdown code fences. Output only the JSON object.
`.trim();

	try {
		gemini.resetChat();
		const reply = await gemini.generate(prompt);
		const text = reply.text.trim();
		// Strip possible markdown fences
		const jsonText = text
			.replace(/^```json\s*/i, "")
			.replace(/```\s*$/i, "")
			.trim();
		const parsed = JSON.parse(jsonText) as {
			tldr: string;
			bullets: string[];
			quote: string;
		};
		return {
			...page,
			tldr: parsed.tldr ?? heuristicRewrite(page).tldr,
			bullets: Array.isArray(parsed.bullets)
				? parsed.bullets.slice(0, 5)
				: heuristicRewrite(page).bullets,
			quote: parsed.quote ?? heuristicRewrite(page).quote,
			geminiUsed: true,
		};
	} catch (err) {
		console.log(
			`[gemini] parse failed for "${page.title}": ${String(err)} — using heuristic`,
		);
		const { tldr, bullets, quote } = heuristicRewrite(page);
		return { ...page, tldr, bullets, quote, geminiUsed: false };
	}
}

// ---------------------------------------------------------------------------
// Stage 4: Static site generation
// ---------------------------------------------------------------------------

const CSS = `
/* Material 3 inspired, OKLCH colors, system fonts */
:root {
  color-scheme: light dark;
  --bg: oklch(97% 0.01 260);
  --surface: oklch(100% 0 0);
  --on-surface: oklch(20% 0.02 260);
  --primary: oklch(45% 0.18 250);
  --primary-container: oklch(90% 0.06 250);
  --secondary: oklch(55% 0.12 200);
  --outline: oklch(75% 0.02 260);
  --code-bg: oklch(94% 0.01 260);
  --radius: 12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: oklch(15% 0.02 260);
    --surface: oklch(20% 0.02 260);
    --on-surface: oklch(90% 0.01 260);
    --primary: oklch(75% 0.12 250);
    --primary-container: oklch(30% 0.08 250);
    --secondary: oklch(70% 0.1 200);
    --outline: oklch(35% 0.02 260);
    --code-bg: oklch(25% 0.02 260);
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--on-surface);
  line-height: 1.7;
  font-size: 16px;
}
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  background: var(--primary);
  color: oklch(98% 0.01 260);
  padding: 1.5rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.01em; }
header .theme-toggle {
  cursor: pointer;
  background: transparent;
  border: 1px solid oklch(80% 0.05 260 / 40%);
  border-radius: 6px;
  color: inherit;
  padding: 0.3rem 0.7rem;
  font-size: 0.85rem;
}
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
.search-box {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--outline);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--on-surface);
  font-size: 1rem;
  margin-bottom: 2rem;
}
.page-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.25rem;
}
.page-card {
  background: var(--surface);
  border: 1px solid var(--outline);
  border-radius: var(--radius);
  padding: 1.25rem;
  transition: box-shadow 0.15s;
}
.page-card:hover { box-shadow: 0 4px 20px oklch(20% 0.05 260 / 12%); }
.page-card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
.page-card p { font-size: 0.875rem; color: oklch(45% 0.02 260); line-height: 1.5; }
@media (prefers-color-scheme: dark) {
  .page-card p { color: oklch(65% 0.02 260); }
}
.page-card .meta { font-size: 0.75rem; color: var(--secondary); margin-top: 0.75rem; }
.tldr-box {
  background: var(--primary-container);
  border-left: 4px solid var(--primary);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 1.25rem 1.5rem;
  margin-bottom: 2rem;
}
.tldr-box .label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--primary); margin-bottom: 0.5rem; }
.tldr-box p { font-size: 1rem; line-height: 1.6; }
.bullets { margin: 1.5rem 0; padding-left: 1.25rem; }
.bullets li { margin-bottom: 0.5rem; }
blockquote {
  border-left: 3px solid var(--secondary);
  padding-left: 1rem;
  font-style: italic;
  color: var(--secondary);
  margin: 1.5rem 0;
}
h2 { font-size: 1.4rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--outline); padding-bottom: 0.25rem; }
h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
p { margin-bottom: 1rem; }
pre, code {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  background: var(--code-bg);
  border-radius: 6px;
  font-size: 0.875rem;
}
pre { padding: 1rem; overflow-x: auto; margin: 1rem 0; }
code { padding: 0.15em 0.4em; }
.section-list { list-style: none; padding: 0; }
.section-list li { padding: 0.4rem 0; border-bottom: 1px solid var(--outline); font-size: 0.9rem; }
.section-list li::before { content: "— "; color: var(--secondary); }
.breadcrumb { font-size: 0.85rem; color: var(--secondary); margin-bottom: 1.5rem; }
.source-link { font-size: 0.8rem; color: var(--secondary); display: inline-block; margin-top: 1rem; }
footer {
  text-align: center;
  padding: 2rem;
  font-size: 0.8rem;
  color: var(--secondary);
  border-top: 1px solid var(--outline);
  margin-top: 3rem;
}
.badge {
  display: inline-block;
  background: var(--primary-container);
  color: var(--primary);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  margin-left: 0.5rem;
}
.hidden { display: none !important; }
`;

function renderIndexHtml(pages: RewrittenPage[]): string {
	const cards = pages
		.map(
			(p) => `
    <div class="page-card" data-title="${Bun.escapeHTML(p.title.toLowerCase())}">
      <h2><a href="pages/${p.slug}.html">${Bun.escapeHTML(p.title)}</a></h2>
      <p>${Bun.escapeHTML(clamp(p.tldr, 140))}</p>
      <div class="meta">${p.wordCount} words${p.geminiUsed ? ' <span class="badge">AI</span>' : ""}</div>
    </div>`,
		)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chromium Developers — AI Reference</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header>
  <h1>Chromium Developers — AI Reference</h1>
  <button class="theme-toggle" onclick="document.documentElement.style.colorScheme=document.documentElement.style.colorScheme==='light'?'dark':'light'">Toggle theme</button>
</header>
<main class="container">
  <input class="search-box" type="search" placeholder="Search pages..." id="search" aria-label="Search pages">
  <div class="page-grid" id="grid">
${cards}
  </div>
</main>
<footer>Generated by Bxc &bull; Source: chromium.org (CC-BY 2.5) &bull; Re-styled and summarised by AI</footer>
<script>
  const input = document.getElementById('search');
  const cards = Array.from(document.querySelectorAll('.page-card'));
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    cards.forEach(c => {
      const match = !q || c.dataset.title.includes(q);
      c.classList.toggle('hidden', !match);
    });
  });
</script>
</body>
</html>`;
}

function renderPageHtml(page: RewrittenPage): string {
	const sectionItems = page.sections
		.map((s) => `<li>${Bun.escapeHTML(s.heading)}</li>`)
		.join("\n");

	const codeBlocksHtml = page.codeBlocks
		.map((c) => `<pre><code>${Bun.escapeHTML(c)}</code></pre>`)
		.join("\n");

	const externalLinksHtml = page.externalLinks
		.slice(0, 10)
		.map(
			(l) =>
				`<li><a href="${Bun.escapeHTML(l)}" rel="noopener noreferrer" target="_blank">${Bun.escapeHTML(l)}</a></li>`,
		)
		.join("\n");

	const bulletsHtml = page.bullets
		.map((b) => `<li>${Bun.escapeHTML(b.replace(/^[-*]\s*/, ""))}</li>`)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Bun.escapeHTML(page.title)} — Chromium Developers AI Reference</title>
<meta name="description" content="${Bun.escapeHTML(clamp(page.tldr, 160))}">
<link rel="stylesheet" href="../assets/style.css">
</head>
<body>
<header>
  <h1><a href="../index.html" style="color:inherit">Chromium Developers — AI Reference</a></h1>
  <button class="theme-toggle" onclick="document.documentElement.style.colorScheme=document.documentElement.style.colorScheme==='light'?'dark':'light'">Toggle theme</button>
</header>
<main class="container">
  <nav class="breadcrumb"><a href="../index.html">Home</a> / ${Bun.escapeHTML(page.title)}</nav>

  <h1>${Bun.escapeHTML(page.title)}</h1>

  <div class="tldr-box">
    <div class="label">TL;DR${page.geminiUsed ? " (AI)" : " (heuristic)"}</div>
    <p>${Bun.escapeHTML(page.tldr)}</p>
  </div>

  ${bulletsHtml ? `<ul class="bullets">${bulletsHtml}</ul>` : ""}

  ${page.quote ? `<blockquote>${Bun.escapeHTML(page.quote)}</blockquote>` : ""}

  ${page.intro ? `<h2>Introduction</h2><p>${Bun.escapeHTML(page.intro)}</p>` : ""}

  ${sectionItems ? `<h2>Sections</h2><ul class="section-list">${sectionItems}</ul>` : ""}

  ${codeBlocksHtml ? `<h2>Code Examples</h2>${codeBlocksHtml}` : ""}

  ${externalLinksHtml ? `<h2>External References</h2><ul>${externalLinksHtml}</ul>` : ""}

  ${page.lastUpdated ? `<p style="font-size:0.8rem;color:var(--secondary)">Last updated: ${Bun.escapeHTML(page.lastUpdated)}</p>` : ""}

  <a class="source-link" href="${Bun.escapeHTML(page.url)}" rel="noopener noreferrer" target="_blank">View original on chromium.org</a>
</main>
<footer>Generated by Bxc &bull; Source: chromium.org (CC-BY 2.5) &bull; Re-styled and summarised by AI</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const t0 = Bun.nanoseconds();

	// Stage 1 — Crawl
	console.log("\n=== Stage 1: Crawl ===");
	const extractedPages = await crawl();

	// Stage 2 — Persist extracted JSONL (pages already extracted inline during crawl)
	console.log("\n=== Stage 2: Persist extraction ===");

	// Also re-extract any raw pages that exist on disk but weren't in this run (resume case)
	const rawFiles = Array.from(
		new Bun.Glob("*.json").scanSync({ cwd: RAW_DIR }),
	);
	for (const metaFile of rawFiles) {
		try {
			const meta = JSON.parse(
				await Bun.file(`${RAW_DIR}/${metaFile}`).text(),
			) as RawMeta;
			if (!extractedPages.has(meta.slug)) {
				const htmlPath = `${RAW_DIR}/${meta.slug}.html`;
				if (await Bun.file(htmlPath).exists()) {
					const html = await Bun.file(htmlPath).text();
					extractedPages.set(
						meta.slug,
						await extractPage(html, meta.url, meta.slug),
					);
				}
			}
		} catch {
			/* skip malformed meta */
		}
	}

	const extractedWriter = Bun.file(EXTRACTED_JSONL).writer();
	for (const page of extractedPages.values()) {
		extractedWriter.write(JSON.stringify(page) + "\n");
	}
	await extractedWriter.end();
	console.log(
		`[extract] wrote ${extractedPages.size} pages to extracted.jsonl`,
	);

	// Stage 3 — Rewrite
	console.log("\n=== Stage 3: AI Rewrite ===");
	const gemini = await tryGeminiBootstrap();
	const rewritten: RewrittenPage[] = [];
	let geminiCount = 0;
	let heuristicCount = 0;

	for (const page of extractedPages.values()) {
		const rw = await rewritePage(page, gemini);
		rewritten.push(rw);
		if (rw.geminiUsed) geminiCount++;
		else heuristicCount++;
		console.log(
			`[rewrite] "${rw.title}" [${rw.geminiUsed ? "gemini" : "heuristic"}]`,
		);
		if (gemini && rw.geminiUsed) await Bun.sleep(500); // rate-limit Gemini
	}

	if (gemini) await gemini.stop();

	// Stage 4 — Site generation
	console.log("\n=== Stage 4: Site generation ===");
	await Bun.write(`${SITE_DIR}/assets/style.css`, CSS);

	// Sort by wordCount desc for "top pages"
	rewritten.sort((a, b) => b.wordCount - a.wordCount);

	// index.html
	await Bun.write(`${SITE_DIR}/index.html`, renderIndexHtml(rewritten));

	// individual pages
	for (const page of rewritten) {
		await Bun.write(
			`${SITE_DIR}/pages/${page.slug}.html`,
			renderPageHtml(page),
		);
	}

	// meta.json
	const meta = {
		generatedAt: new Date().toISOString(),
		totalPages: rewritten.length,
		geminiUsed: geminiCount,
		heuristicUsed: heuristicCount,
		pages: rewritten.map((p) => ({
			slug: p.slug,
			title: p.title,
			url: p.url,
			wordCount: p.wordCount,
			geminiUsed: p.geminiUsed,
		})),
	};
	await Bun.write(`${SITE_DIR}/meta.json`, JSON.stringify(meta, null, 2));

	// Compute disk size
	let diskBytes = 0;
	for await (const f of new Bun.Glob("**/*").scan({ cwd: SITE_DIR })) {
		try {
			const stat = await Bun.file(`${SITE_DIR}/${f}`).size;
			diskBytes += stat;
		} catch {
			/* skip */
		}
	}

	const elapsed = ((Bun.nanoseconds() - t0) / 1e9).toFixed(1);

	// top 5 pages
	const top5 = rewritten.slice(0, 5);

	console.log(`
=== Final Report ===
URLs crawled:      ${extractedPages.size}
Pages generated:   ${rewritten.length}
Gemini rewrites:   ${geminiCount}
Heuristic rewrites:${heuristicCount}
Rewrite method:    ${geminiCount > 0 ? "gemini" : "heuristic"}
Total site size:   ${(diskBytes / 1024).toFixed(0)} KB (${(diskBytes / 1024 / 1024).toFixed(2)} MB)
Elapsed:           ${elapsed}s

Top 5 pages by word count:
${top5.map((p, i) => `  ${i + 1}. ${p.title} (${p.wordCount} words)`).join("\n")}

Serve with:
  bunx serve ${SITE_DIR}
  # or: python3 -m http.server 8080 --directory ${SITE_DIR}
`);
}

main().catch((err) => {
	console.error("[fatal]", err);
	process.exit(1);
});
