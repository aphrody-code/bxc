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
 * scripts/mass_scrape_wbo.ts
 *
 * A massive scraper and mapper for worldbeyblade.org.
 * Supports:
 *   1. --target=wiki  (MediaWiki API, crawls Beywiki articles, bypasses Cloudflare Turnstile).
 *   2. --target=forum (MyBB scraper, crawls threads and posts, requires valid session/cookies).
 *
 * Features:
 *   - Concurrency pooling.
 *   - Pacing & delays to prevent rate limits.
 *   - Checkpoint-based resumability.
 *   - Automatic output structuring.
 *
 * Usage:
 *   bun scripts/mass_scrape_wbo.ts --target=wiki --concurrency=5
 *   bun scripts/mass_scrape_wbo.ts --target=forum --cookies=data/worldbeyblade_cookies.json --profile=http
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	WorldBeybladeScraper,
	type WorldBeybladePost,
} from "../src/scrapers/worldbeyblade.ts";

const ARGS = new Set(Bun.argv.slice(2));
const TARGET = [...ARGS].find((a) => a.startsWith("--target="))?.split("=")[1] ?? "wiki";
const CONCURRENCY = Number(
	[...ARGS].find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 3,
);
const COOKIES_PATH =
	[...ARGS].find((a) => a.startsWith("--cookies="))?.split("=")[1] ??
	"/home/ubuntu/.bxc/cookies/worldbeyblade.json";
const PROFILE =
	[...ARGS].find((a) => a.startsWith("--profile="))?.split("=")[1] ?? "ghost";

const OUT_DIR = "/home/ubuntu/bxc/data/wbo_scraped";
const WIKI_DIR = join(OUT_DIR, "wiki");
const FORUM_DIR = join(OUT_DIR, "forum");

// Ensure directories exist
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
if (!existsSync(WIKI_DIR)) mkdirSync(WIKI_DIR, { recursive: true });
if (!existsSync(FORUM_DIR)) mkdirSync(FORUM_DIR, { recursive: true });

// Checkpoint structures
interface WikiCheckpoint {
	processedPageIds: number[];
	lastContinue: string | null;
}

interface ForumCheckpoint {
	processedThreadIds: number[];
	forumsVisited: number[];
}

// Major Forum Category IDs to scrape fallback
const FALLBACK_FORUM_IDS = [
	111, // Beyblade X
	91,  // Beyblade X Organized Play
	86,  // WBO Organized Play
	2,   // General Beyblade
	12,  // Beyblade Tournaments
	9,   // Beyblade Custom
	10,  // Beyblade Marketplace
	105, // Beyblade Burst
	44,  // Metal Fight Beyblade
	43,  // Plastic Gen (Original)
];

// Helper for pacing/sleep
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1. Wiki Scraper (MediaWiki api.php)
 */
async function runWikiScraper() {
	console.log(`[wiki-scraper] Starting Beywiki crawling (concurrency=${CONCURRENCY})...`);
	
	const checkpointPath = join(OUT_DIR, "wiki_checkpoint.json");
	let checkpoint: WikiCheckpoint = { processedPageIds: [], lastContinue: null };
	
	if (existsSync(checkpointPath)) {
		try {
			checkpoint = JSON.parse(await Bun.file(checkpointPath).text());
			console.log(`[wiki-scraper] Resuming. Already processed: ${checkpoint.processedPageIds.length} pages.`);
		} catch (e) {
			console.warn("[wiki-scraper] Checkpoint file corrupted, starting fresh.");
		}
	}

	const processedSet = new Set<number>(checkpoint.processedPageIds);
	
	// Step 1. Get all pages
	console.log("[wiki-scraper] Retrieving complete page list from wiki API...");
	const pages: Array<{ pageid: number; ns: number; title: string }> = [];
	let hasMore = true;
	let apcontinue = checkpoint.lastContinue;

	while (hasMore) {
		const url = `http://wiki.worldbeyblade.org/api.php?action=query&list=allpages&aplimit=500&format=json${
			apcontinue ? `&apcontinue=${encodeURIComponent(apcontinue)}` : ""
		}`;
		
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json() as any;
			
			if (data.query?.allpages) {
				pages.push(...data.query.allpages);
			}
			
			if (data.continue?.apcontinue) {
				apcontinue = data.continue.apcontinue;
				console.log(`  … Found ${pages.length} pages so far. Continuing from ${apcontinue}`);
				
				// Save intermediate continue checkpoint
				checkpoint.lastContinue = apcontinue;
				await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
			} else {
				hasMore = false;
			}
		} catch (err) {
			console.error("[wiki-scraper] Failed to fetch page list batch:", err);
			hasMore = false;
		}
		await delay(300);
	}

	console.log(`[wiki-scraper] Discovered ${pages.length} total pages. Filtering already processed...`);
	const pendingPages = pages.filter(p => !processedSet.has(p.pageid));
	console.log(`[wiki-scraper] ${pendingPages.length} pages left to fetch.`);

	// Step 2. Pool to fetch page content
	let completed = 0;
	
	const worker = async (workerId: number) => {
		for (;;) {
			const pageIdx = completed++;
			if (pageIdx >= pendingPages.length) break;
			
			const page = pendingPages[pageIdx];
			try {
				const queryUrl = `http://wiki.worldbeyblade.org/api.php?action=query&prop=revisions&pageids=${page.pageid}&rvprop=content&format=json`;
				const res = await fetch(queryUrl);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const details = await res.json() as any;
				
				const pageData = details.query?.pages?.[page.pageid];
				const content = pageData?.revisions?.[0]?.["*"] ?? "";
				
				const outputDoc = {
					pageid: page.pageid,
					ns: page.ns,
					title: page.title,
					content,
					scrapedAt: new Date().toISOString(),
				};
				
				// Save article
				const filePath = join(WIKI_DIR, `page_${page.pageid}.json`);
				await Bun.write(filePath, JSON.stringify(outputDoc, null, 2));
				
				processedSet.add(page.pageid);
				checkpoint.processedPageIds = [...processedSet];
				
				// Save checkpoint every 10 pages
				if (processedSet.size % 10 === 0) {
					await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
				}
				
				console.log(`[w${workerId}] Saved: "${page.title}" (${processedSet.size}/${pages.length})`);
			} catch (err) {
				console.error(`[w${workerId}] Error on page ${page.title} (ID: ${page.pageid}):`, err);
			}
			// Polite delay
			await delay(150 + Math.floor(Math.random() * 200));
		}
	};

	const workers = Array.from({ length: Math.min(CONCURRENCY, pendingPages.length) }, (_, i) => worker(i));
	await Promise.all(workers);
	
	// Final checkpoint save
	checkpoint.lastContinue = null;
	await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
	
	// Compile catalog
	console.log("[wiki-scraper] Compiling final catalog database...");
	const catalog = pages.map(p => ({
		pageid: p.pageid,
		title: p.title,
		ns: p.ns,
		localPath: `wiki/page_${p.pageid}.json`
	}));
	await Bun.write(join(OUT_DIR, "wiki_catalog.json"), JSON.stringify(catalog, null, 2));
	console.log(`[wiki-scraper] Done. Saved database to ${join(OUT_DIR, "wiki_catalog.json")}`);
}

/**
 * 2. Forum Scraper (MyBB threads + posts)
 */
async function runForumScraper() {
	console.log("[forum-scraper] Starting worldbeyblade.org forum crawler...");
	
	const checkpointPath = join(OUT_DIR, "forum_checkpoint.json");
	let checkpoint: ForumCheckpoint = { processedThreadIds: [], forumsVisited: [] };
	
	if (existsSync(checkpointPath)) {
		try {
			checkpoint = JSON.parse(await Bun.file(checkpointPath).text());
			console.log(`[forum-scraper] Resuming. Visited: ${checkpoint.forumsVisited.length} forums, ${checkpoint.processedThreadIds.length} threads.`);
		} catch (e) {
			console.warn("[forum-scraper] Checkpoint file corrupted.");
		}
	}
	
	const processedThreadIds = new Set<number>(checkpoint.processedThreadIds);
	const visitedForums = new Set<number>(checkpoint.forumsVisited);

	const scraper = new WorldBeybladeScraper();
	
	try {
		let cookiesOption: string | undefined = undefined;
		if (existsSync(COOKIES_PATH)) {
			cookiesOption = COOKIES_PATH;
		} else {
			const fallbackPath = "/home/ubuntu/bxc/data/worldbeyblade_cookies.json";
			if (existsSync(fallbackPath)) {
				console.log(`[forum-scraper] Primary cookies path not found, using fallback: ${fallbackPath}`);
				cookiesOption = fallbackPath;
			} else {
				console.warn(`[forum-scraper] Warning: Cookie file not found at ${COOKIES_PATH} or ${fallbackPath}. Running without cookies.`);
			}
		}

		// Initialize session using specified transport (defaults to ghost)
		await scraper.init({
			profile: PROFILE as "ghost" | "http",
			cookies: cookiesOption,
		});
		
		const isLoggedIn = await scraper.checkLoginStatus();
		if (!isLoggedIn) {
			console.warn("[forum-scraper] Running session as Guest. Private forums might be locked.");
		}

		// Step 1: Discover forums from sitemap or main index
		let forumsToScrape = [...FALLBACK_FORUM_IDS];
		
		const sitemapPath = "/home/ubuntu/bxc/data/worldbeyblade_sitemap.xml";
		if (existsSync(sitemapPath)) {
			console.log("[forum-scraper] Inspecting sitemap to extract more forum IDs...");
			const sitemapXml = await Bun.file(sitemapPath).text();
			const matches = [...sitemapXml.matchAll(/Forum-([a-zA-Z0-9_-]+)/gi)];
			const parsedFids = matches.map(m => m[1]).filter(f => /^\d+$/.test(f)).map(f => parseInt(f, 10));
			if (parsedFids.length > 0) {
				forumsToScrape = [...new Set([...forumsToScrape, ...parsedFids])];
			}
		}

		console.log(`[forum-scraper] Target forums checklist:`, forumsToScrape);

		// Step 2: Loop and crawl forums
		for (const fid of forumsToScrape) {
			if (visitedForums.has(fid)) continue;
			
			console.log(`[forum-scraper] Crawling subforum FID: ${fid}...`);
			let currentPage = 1;
			let totalPages = 1;
			
			try {
				do {
					console.log(`  Forum ${fid}: Loading page ${currentPage}/${totalPages}...`);
					const forumData = await scraper.getForum(fid, currentPage);
					totalPages = forumData.totalPages;
					
					for (const thread of forumData.threads) {
						if (processedThreadIds.has(thread.tid)) continue;
						
						console.log(`    Scraping thread [${thread.tid}] "${thread.title}"...`);
						
						try {
							// Fetch all posts in the thread
							let threadPage = 1;
							let threadTotalPages = 1;
							const allPosts: WorldBeybladePost[] = [];
							
							do {
								const threadData = await scraper.getThread(thread.tid, threadPage);
								threadTotalPages = threadData.totalPages;
								allPosts.push(...threadData.posts);
								threadPage++;
								await delay(500 + Math.floor(Math.random() * 500));
							} while (threadPage <= threadTotalPages && threadPage <= 5); // Limit to top 5 pages per thread to avoid huge scans

							const threadDoc = {
								tid: thread.tid,
								title: thread.title,
								slug: thread.slug,
								authorName: thread.authorName,
								authorUid: thread.authorUid,
								replies: thread.replies,
								views: thread.views,
								posts: allPosts,
								scrapedAt: new Date().toISOString(),
							};

							// Save to file
							const threadFilePath = join(FORUM_DIR, `thread_${thread.tid}.json`);
							await Bun.write(threadFilePath, JSON.stringify(threadDoc, null, 2));
							
							processedThreadIds.add(thread.tid);
							checkpoint.processedThreadIds = [...processedThreadIds];
							await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
							
							console.log(`      Saved thread ${thread.tid}. Total: ${processedThreadIds.size} threads.`);
						} catch (threadErr) {
							console.error(`      [forum-scraper] Failed to scrape thread ${thread.tid}:`, threadErr);
						}
						await delay(1000 + Math.floor(Math.random() * 1500));
					}
					
					currentPage++;
					await delay(1000 + Math.floor(Math.random() * 1000));
				} while (currentPage <= totalPages && currentPage <= 3); // Limit to top 3 pages of threads per forum

				visitedForums.add(fid);
				checkpoint.forumsVisited = [...visitedForums];
				await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
				
			} catch (err) {
				console.error(`[forum-scraper] Failed to parse forum ${fid}:`, err);
			}
		}

		console.log("[forum-scraper] Mass forum crawl complete.");
	} finally {
		await scraper.close();
	}
}

async function main() {
	const t0 = Date.now();
	if (TARGET === "wiki") {
		await runWikiScraper();
	} else if (TARGET === "forum") {
		await runForumScraper();
	} else {
		console.error(`[error] Unknown target: "${TARGET}". Choose "wiki" or "forum".`);
		process.exit(1);
	}
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(`[mass-scraper] Finished execution in ${secs}s.`);
}

main().catch((err) => {
	console.error("FATAL ERROR:", err);
	process.exit(1);
});
