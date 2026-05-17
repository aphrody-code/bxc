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

import { GoogleMassScanner } from "../src/google/mass-scanner.ts";

/**
 * Example 10: Massive Google Audit
 * 
 * Performs real-time DNS/CDN/Sitemap analysis on 1000+ Google pages.
 */

async function main() {
	const scanner = new GoogleMassScanner({
		concurrency: 24,
		maxPages: 5656
	});

	// Seed list of Google properties to audit
	const seeds = [
		"https://www.google.com",
		"https://material.io",
		"https://design.google",
		"https://cloud.google.com",
		"https://developers.google.com",
		"https://chrome.google.com",
		"https://firebase.google.com",
		"https://tensorflow.org",
		"https://go.dev",
		"https://angular.io",
		"https://flutter.dev",
		"https://web.dev",
		"https://lit.dev",
		"https://dart.dev",
		"https://blog.google",
		"https://about.google",
		"https://sustainability.google",
		"https://workspace.google.com",
		"https://ai.google",
		"https://gemini.google.com",
	];

	console.log(`🚀 Starting massive audit of ${seeds.length} seeds (Target: 1000 pages)...`);
	const startTime = Bun.nanoseconds();

	const results = await scanner.scan(seeds);

	const elapsed = (Bun.nanoseconds() - startTime) / 1e9;
	console.log(`\n✅ Audit complete! Scanned ${results.length} pages in ${elapsed.toFixed(1)}s.`);

	// Generate Sitemap
	const sitemap = scanner.generateSitemap();
	await Bun.write("google-audit-sitemap.xml", sitemap);
	console.log(`📁 Sitemap saved to google-audit-sitemap.xml`);

	// Real-time comparison summary
	const cdnStats: Record<string, number> = {};
	for (const r of results) {
		const cdn = r.cdn ?? "Direct / Unknown";
		cdnStats[cdn] = (cdnStats[cdn] ?? 0) + 1;
	}

	console.log("\n📊 Infrastructure Distribution:");
	console.table(Object.entries(cdnStats).map(([cdn, count]) => ({ CDN: cdn, Count: count })));

	// Export results to JSON for deeper analysis
	await Bun.write("google-audit-results.json", JSON.stringify(results, null, 2));
	console.log(`📁 Detailed results saved to google-audit-results.json`);
}

main().catch(console.error);
