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

function cleanText(text: string): string {
	return text
		.replace(/<[^>]+>/g, "")
		.replace(/&mdash;/g, "-")
		.replace(/&middot;/g, "·")
		.replace(/[\s\n\r\t]+/g, " ")
		.trim();
}

async function parseRankingsFile(filePath: string, categoryName: string) {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		console.log(`File not found: ${filePath}`);
		return [];
	}
	const html = await file.text();

	// Let's find each <div class="list-group-item user">
	// Let's find each <div class="list-group-item user ...">
	const userBlocks = html.split(
		/<div class="[^"]*list-group-item[^"]*user[^"]*"[^>]*>/gi,
	);
	userBlocks.shift(); // remove the prefix before the first user block

	const results = [];
	for (const block of userBlocks) {
		// Clean / truncate the block if we find the end comment or a closing list-group div
		const endIdx = block.indexOf("<!-- end: rankings_user -->");
		const content =
			endIdx !== -1
				? block.slice(0, endIdx)
				: block.split(/<div class="[^"]*list-group-item[^"]*user[^"]*"/i)[0];

		// 1. Username and Profile URL
		// Example: <h4 class="media-heading"><a href=".../User-Kei">Kei</a></h4>
		const profileMatch = content.match(
			/<h4 class="media-heading">\s*<a href="([^"]+)">([^<]+)<\/a>/i,
		);
		if (!profileMatch) continue;

		const waybackProfileUrl = profileMatch[1];
		const username = profileMatch[2].trim();
		// Extract clean WBO profile URL
		const cleanProfileUrl = waybackProfileUrl.includes(
			"/https://worldbeyblade.org/",
		)
			? "https://worldbeyblade.org/" +
				waybackProfileUrl.split("/https://worldbeyblade.org/")[1]
			: waybackProfileUrl;

		// 2. Rank
		// Example: <span class="label label-primary rank-1"><i class="fa fa-globe"></i> 1</span>
		const rankMatch = content.match(
			/class="[^"]*rank-(\d+)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
		);
		const rank = rankMatch ? parseInt(rankMatch[1], 10) : null;

		// 3. Points and Win/Loss
		// Example: <span class="text-muted"><strong>BURST</strong> 1,800 BR &mdash; Won: 480 &middot; Lost: 172</span>
		const statsMatch = content.match(
			/<span class="text-muted">([\s\S]*?)<\/span>/i,
		);
		let points = null;
		let pointsType = "";
		let wins = 0;
		let losses = 0;

		if (statsMatch) {
			const statsText = cleanText(statsMatch[1]);
			// Example: "BURST 1,800 BR - Won: 480 · Lost: 172"
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

	console.log(
		`Parsed ${results.length} players from ${filePath} (Category: ${categoryName})`,
	);
	return results;
}

async function main() {
	const allRankings = [];

	const mainRanks = await parseRankingsFile(
		"/home/ubuntu/bxc/data/rankings_main.html",
		"General/Top",
	);
	const burstRanks = await parseRankingsFile(
		"/home/ubuntu/bxc/data/rankings_burst.html",
		"Burst",
	);
	const metalRanks = await parseRankingsFile(
		"/home/ubuntu/bxc/data/rankings_metal.html",
		"Metal",
	);

	allRankings.push(...mainRanks, ...burstRanks, ...metalRanks);

	// Save to JSON
	const outputPath = "/home/ubuntu/bxc/data/wbo_rankings_parsed.json";
	await Bun.write(outputPath, JSON.stringify(allRankings, null, 2));
	console.log(`Successfully parsed and saved all rankings to ${outputPath}`);
}

await main();
