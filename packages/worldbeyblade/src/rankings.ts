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

import { join } from "node:path";
import type { WBOPlayerRanking } from "./types.ts";

const rankingsPages = [
	{
		name: "main",
		category: "General/Top",
		url: "http://web.archive.org/web/20251105085224/https://worldbeyblade.org/rankings",
	},
	{
		name: "burst",
		category: "Burst",
		url: "http://web.archive.org/web/20260217210849/https://worldbeyblade.org/rankings/burst",
	},
	{
		name: "metal",
		category: "Metal",
		url: "http://web.archive.org/web/20260105220438/https://worldbeyblade.org/rankings/metal",
	},
];

function cleanText(text: string): string {
	return text
		.replace(/<[^>]+>/g, "")
		.replace(/&mdash;/g, "-")
		.replace(/&middot;/g, "·")
		.replace(/[\s\n\r\t]+/g, " ")
		.trim();
}

/**
 * Downloads the latest rankings HTML from Wayback snapshots.
 */
export async function downloadRankingsHtml(
	dataDir: string,
	log?: (msg: string) => void,
): Promise<void> {
	const logger = log ?? console.log;
	for (const p of rankingsPages) {
		logger(`Fetching ${p.name} rankings from ${p.url}...`);
		try {
			const res = await fetch(p.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const html = await res.text();
			const filePath = join(dataDir, `rankings_${p.name}.html`);
			await Bun.write(filePath, html);
			logger(`Saved WBO ${p.name} rankings to ${filePath}`);
		} catch (e) {
			logger(`Error fetching ${p.name} WBO rankings: ${(e as Error).message}`);
		}
	}
}

/**
 * Parses raw HTML string from a rankings snapshot.
 */
export function parseRankingsHtml(
	html: string,
	categoryName: string,
): WBOPlayerRanking[] {
	// Let's find each <div class="list-group-item user ...">
	const userBlocks = html.split(
		/<div class="[^"]*list-group-item[^"]*user[^"]*"[^>]*>/gi,
	);
	userBlocks.shift(); // remove prefix before the first user block

	const results: WBOPlayerRanking[] = [];
	for (const block of userBlocks) {
		const endIdx = block.indexOf("<!-- end: rankings_user -->");
		const content =
			endIdx !== -1
				? block.slice(0, endIdx)
				: block.split(/<div class="[^"]*list-group-item[^"]*user[^"]*"/i)[0];

		// 1. Username and Profile URL
		const profileMatch = content.match(
			/<h4 class="media-heading">\s*<a href="([^"]+)">([^<]+)<\/a>/i,
		);
		if (!profileMatch) continue;

		const waybackProfileUrl = profileMatch[1];
		const username = profileMatch[2].trim();
		const cleanProfileUrl = waybackProfileUrl.includes(
			"/https://worldbeyblade.org/",
		)
			? "https://worldbeyblade.org/" +
				waybackProfileUrl.split("/https://worldbeyblade.org/")[1]
			: waybackProfileUrl;

		// 2. Rank
		const rankMatch = content.match(
			/class="[^"]*rank-(\d+)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
		);
		const rank = rankMatch ? parseInt(rankMatch[1], 10) : null;

		// 3. Points and Win/Loss
		const statsMatch = content.match(
			/<span class="text-muted">([\s\S]*?)<\/span>/i,
		);
		let points: number | null = null;
		let pointsType = "";
		let wins = 0;
		let losses = 0;

		if (statsMatch) {
			const statsText = cleanText(statsMatch[1]);
			const pointsMatch = statsText.match(/([A-Z\s]+)\s*([\d,]+)\s*([A-Z]+)/i);
			if (pointsMatch) {
				pointsType = pointsMatch[3];
				points = parseInt(pointsMatch[2].replace(/,/g, ""), 10);
			}

			const wonMatch = statsText.match(/Won:\s*(\d+)/i);
			if (wonMatch) wins = parseInt(wonMatch[1], 10);

			const lostMatch = statsText.match(/Lost:\s*(\d+)/i);
			if (lostMatch) losses = parseInt(lostMatch[1], 10);
		}

		results.push({
			rank,
			username,
			profileUrl: cleanProfileUrl,
			points,
			pointsType,
			wins,
			losses,
			category: categoryName,
		});
	}

	return results;
}

/**
 * Scrapes, parses WBO rankings, and writes the output JSON file.
 */
export async function syncAndParseAllRankings(
	dataDir: string,
	log?: (msg: string) => void,
): Promise<WBOPlayerRanking[]> {
	const logger = log ?? console.log;

	// Download files if they do not exist
	const mainPath = join(dataDir, "rankings_main.html");
	const burstPath = join(dataDir, "rankings_burst.html");
	const metalPath = join(dataDir, "rankings_metal.html");

	const mainFile = Bun.file(mainPath);
	const burstFile = Bun.file(burstPath);
	const metalFile = Bun.file(metalPath);

	if (
		!(await mainFile.exists()) ||
		!(await burstFile.exists()) ||
		!(await metalFile.exists())
	) {
		logger("Rankings HTML files missing, downloading from archives...");
		await downloadRankingsHtml(dataDir, logger);
	}

	const allRankings: WBOPlayerRanking[] = [];

	if (await mainFile.exists()) {
		const html = await mainFile.text();
		allRankings.push(...parseRankingsHtml(html, "General/Top"));
	}
	if (await burstFile.exists()) {
		const html = await burstFile.text();
		allRankings.push(...parseRankingsHtml(html, "Burst"));
	}
	if (await metalFile.exists()) {
		const html = await metalFile.text();
		allRankings.push(...parseRankingsHtml(html, "Metal"));
	}

	const outputPath = join(dataDir, "wbo_rankings_parsed.json");
	await Bun.write(outputPath, JSON.stringify(allRankings, null, 2));
	logger(
		`Successfully parsed WBO rankings and saved database to ${outputPath}`,
	);
	return allRankings;
}
