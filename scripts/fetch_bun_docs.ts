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

import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const INDEX_FILE_PATH =
	"/home/ubuntu/.gemini/antigravity-cli/brain/23dff8cc-da0b-43fd-86df-15d53e4d4095/.system_generated/steps/504/content.md";
const OUTPUT_DIR = "/home/ubuntu/bxc/docs/bun";
const CONCURRENCY_LIMIT = 8; // polite concurrency
const RETRIES = 3;

async function run() {
	const file = Bun.file(INDEX_FILE_PATH);
	if (!(await file.exists())) {
		console.error("Index file content.md not found!");
		process.exit(1);
	}

	const content = await file.text();

	// Extract all URLs matching https://bun.com/docs/...
	const urlRegex = /https:\/\/bun\.com\/docs\/[^\s\)]+/g;
	const matches = [...content.matchAll(urlRegex)].map((m) => m[0]);

	// Deduplicate URLs
	const urls = [...new Set(matches)];
	console.log(
		`Found ${urls.length} unique Bun documentation URLs in the index.`,
	);

	const queue = [...urls];
	let successCount = 0;
	let failCount = 0;

	async function worker() {
		while (queue.length > 0) {
			const url = queue.shift();
			if (!url) continue;

			// Determine output path
			const urlObj = new URL(url);
			let relativePath = urlObj.pathname.replace(/^\/docs\//, "");
			if (!relativePath.endsWith(".md")) {
				relativePath += ".md";
			}
			const outputPath = join(OUTPUT_DIR, relativePath);

			console.log(`Downloading: ${url} -> ${outputPath}`);

			let downloaded = false;
			for (let attempt = 1; attempt <= RETRIES; attempt++) {
				try {
					const res = await fetch(url);
					if (res.status === 200) {
						const mdText = await res.text();
						const parentDir = dirname(outputPath);
						await mkdir(parentDir, { recursive: true });
						await Bun.write(outputPath, mdText);
						successCount++;
						downloaded = true;
						break;
					} else {
						console.warn(
							`[Attempt ${attempt}/${RETRIES}] HTTP ${res.status} for ${url}`,
						);
					}
				} catch (err: any) {
					console.warn(
						`[Attempt ${attempt}/${RETRIES}] Error fetching ${url}: ${err.message}`,
					);
				}
				await Bun.sleep(1000 * attempt);
			}

			if (!downloaded) {
				console.error(`Failed to download ${url} after ${RETRIES} attempts.`);
				failCount++;
			}

			// Modest sleep to avoid hitting Cloudflare rate limits
			await Bun.sleep(500);
		}
	}

	// Launch workers in parallel
	const workers = Array.from({ length: CONCURRENCY_LIMIT }, () => worker());
	await Promise.all(workers);

	console.log(`\n=== Bun Documentation Fetch Finished ===`);
	console.log(`Successfully Downloaded: ${successCount}`);
	console.log(`Failed: ${failCount}`);
}

run().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
