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

import { existsSync } from "node:fs";
import { WorldBeybladeScraper } from "@aphrody-code/bxc/scrapers/worldbeyblade";

const COOKIES_PATH = "/home/ubuntu/.bxc/cookies/worldbeyblade.json";

async function main() {
	console.log("Starting WorldBeyblade sitemap generator...");

	const scraper = new WorldBeybladeScraper();

	try {
		let cookiesOption: string | undefined = undefined;
		if (existsSync(COOKIES_PATH)) {
			cookiesOption = COOKIES_PATH;
		} else {
			const fallbackPath = "/home/ubuntu/bxc/data/worldbeyblade_cookies.json";
			if (existsSync(fallbackPath)) {
				console.log(
					`Primary cookies path not found, using fallback: ${fallbackPath}`,
				);
				cookiesOption = fallbackPath;
			} else {
				console.warn(
					`Warning: Cookie file not found at ${COOKIES_PATH} or ${fallbackPath}. Running without cookies.`,
				);
			}
		}

		await scraper.init({
			profile: "http",
			cookies: cookiesOption,
		});

		console.log("Fetching index page to discover forums...");
		await scraper.checkLoginStatus(); // Gotos index.php

		const indexHtml = await scraper.page.content();

		// Find all Forum-XXX or forumdisplay.php links
		const forumLinks = [
			...indexHtml.matchAll(/href="Forum-([a-zA-Z0-9_-]+)"/gi),
		].map((m) => `Forum-${m[1]}`);
		const uniqueForums = [...new Set(forumLinks)];

		console.log(`Discovered ${uniqueForums.length} forums:`, uniqueForums);

		const urls: string[] = [
			"https://worldbeyblade.org/index.php",
			"https://worldbeyblade.org/search.php",
			"https://worldbeyblade.org/member.php?action=login",
		];

		// Add discovered forums
		for (const forum of uniqueForums) {
			urls.push(`https://worldbeyblade.org/${forum}`);
		}

		// Crawl first page of each forum to get threads
		for (const forum of uniqueForums.slice(0, 10)) {
			// Limit to top 10 forums to avoid rate limits
			try {
				console.log(`Crawling forum: ${forum}...`);
				const forumData = await scraper.getForum(forum, 1);
				for (const thread of forumData.threads) {
					if (thread.slug) {
						urls.push(`https://worldbeyblade.org/${thread.slug}`);
					} else {
						urls.push(
							`https://worldbeyblade.org/showthread.php?tid=${thread.tid}`,
						);
					}
				}
				// Polite delay to prevent rate limits
				await Bun.sleep(1000 + Math.floor(Math.random() * 1500));
			} catch (err) {
				console.warn(
					`Could not crawl forum ${forum}:`,
					err instanceof Error ? err.message : err,
				);
			}
		}

		// Always include important fetched pages requested by user
		urls.push("https://worldbeyblade.org/Thread-Beyblade-X-Rules");

		const uniqueUrls = [...new Set(urls)].sort();
		console.log(
			`Sitemap compiled successfully. Found ${uniqueUrls.length} pages.`,
		);

		// Generate XML sitemap
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueUrls.map((url) => `  <url>\n    <loc>${url}</loc>\n    <changefreq>daily</changefreq>\n  </url>`).join("\n")}
</urlset>\n`;

		await Bun.write("/home/ubuntu/bxc/data/worldbeyblade_sitemap.xml", xml);
		console.log(
			"Saved sitemap XML to /home/ubuntu/bxc/data/worldbeyblade_sitemap.xml",
		);
	} catch (err) {
		console.error("Failed to generate sitemap:", err);
	} finally {
		await scraper.close();
	}
}

main();
