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
 * Targeted Discovery: Google Design & UI Ecosystem
 * 
 * Starts from Material Design and Google Design to map the ecosystem.
 */

async function main() {
	const scanner = new GoogleMassScanner({
		concurrency: 5,
		maxPages: 50 // Limit for this discovery task
	});

	const seeds = [
		"https://m3.material.io/",
		"https://design.google/",
		"https://developers.google.com/",
		"https://firebase.google.com/",
		"https://angular.io/",
		"https://flutter.dev/",
		"https://web.dev/",
		"https://tensorflow.org/",
		"https://go.dev/",
	];

	console.log(`🔍 Mapping Google Design & UI Ecosystem starting from ${seeds.length} seeds...`);
	
	const results = await scanner.scan(seeds);

	console.log("\n✨ Discovery Complete!");
	
	// Filter and group by domain to find unique official properties
	const uniqueDomains = new Set<string>();
	for (const r of results) {
		try {
			const hostname = new URL(r.url).hostname;
			uniqueDomains.add(hostname);
		} catch {}
	}

	console.log("\n🌐 Official Google Design/UI/Framework Hostnames Found:");
	Array.from(uniqueDomains).sort().forEach(domain => {
		console.log(`  - ${domain}`);
	});

	// Save results
	await Bun.write("discovery-design-results.json", JSON.stringify(results, null, 2));
}

main().catch(console.error);
