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
import { sharedCache } from "../src/google/cache.ts";

/**
 * Massive Google Ecosystem Mapping (24/5656 Target)
 *
 * This script maps the entire Google ecosystem, discovering links,
 * auditing DNS/CDN infrastructure, and extracting metadata.
 */

async function main() {
	console.log("🚀 Kicking off Massive Google Ecosystem Mapping...");
	console.log("Target: 5656 pages | Concurrency: 24 workers");
	console.log(`Cache: ${sharedCache().size()} existing entries found.`);

	const scanner = new GoogleMassScanner({
		concurrency: 24,
		maxPages: 5656,
		onProgress: (audit, current, total) => {
			const progress = ((current / total) * 100).toFixed(1);
			console.log(
				`[${progress}%] ${current}/${total} | ${audit.url} | ${audit.cdn ?? "GFE"}`,
			);
		},
	});

	// Expanded seeds for global coverage
	const seeds = [
		"https://www.google.com/",
		"https://about.google/",
		"https://developers.google.com/",
		"https://cloud.google.com/",
		"https://workspace.google.com/",
		"https://firebase.google.com/",
		"https://material.io/",
		"https://design.google/",
		"https://web.dev/",
		"https://angular.dev/",
		"https://flutter.dev/",
		"https://tensorflow.org/",
		"https://go.dev/",
		"https://android.com/",
		"https://chrome.com/",
		"https://youtube.com/",
		"https://deepmind.google/",
		"https://health.google/",
		"https://ai.google/",
	];

	const start = Bun.nanoseconds();
	const results = await scanner.scan(seeds);
	const end = Bun.nanoseconds();

	const tookSec = ((end - start) / 1e9).toFixed(2);
	console.log(`\n✨ Mapping Complete in ${tookSec}s!`);
	console.log(`Total Pages Audited: ${results.length}`);

	// Detailed breakdown
	const cdnStats: Record<string, number> = {};
	const frameworkStats: Record<string, number> = {};
	const uniqueHostnames = new Set<string>();

	for (const r of results) {
		const host = new URL(r.url).hostname;
		uniqueHostnames.add(host);

		cdnStats[r.cdn ?? "Other"] = (cdnStats[r.cdn ?? "Other"] || 0) + 1;
		if (r.google?.framework !== "none") {
			const fw = r.google?.framework ?? "unknown";
			frameworkStats[fw] = (frameworkStats[fw] || 0) + 1;
		}
	}

	console.log("\n📊 Infrastructure Stats:");
	Object.entries(cdnStats)
		.sort((a, b) => b[1] - a[1])
		.forEach(([name, count]) => {
			console.log(`  - ${name}: ${count}`);
		});

	console.log("\n🛠️ Framework Usage:");
	Object.entries(frameworkStats)
		.sort((a, b) => b[1] - a[1])
		.forEach(([name, count]) => {
			console.log(`  - ${name}: ${count}`);
		});

	console.log(`\n🌐 Unique Official Hostnames: ${uniqueHostnames.size}`);

	// Save the massive dataset
	const outputPath = "google-ecosystem-map.json";
	await Bun.write(outputPath, JSON.stringify(results, null, 2));
	console.log(`\n💾 Full dataset saved to: ${outputPath}`);
}

main().catch(console.error);
