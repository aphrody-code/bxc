import * as fs from "node:fs";

const pages = [
	{
		name: "main",
		url: "http://web.archive.org/web/20251105085224/https://worldbeyblade.org/rankings",
	},
	{
		name: "burst",
		url: "http://web.archive.org/web/20260217210849/https://worldbeyblade.org/rankings/burst",
	},
	{
		name: "metal",
		url: "http://web.archive.org/web/20260105220438/https://worldbeyblade.org/rankings/metal",
	},
];

async function main() {
	for (const p of pages) {
		console.log(`Fetching ${p.name} rankings from ${p.url}...`);
		try {
			const res = await fetch(p.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const html = await res.text();
			const filePath = `/home/ubuntu/bxc/data/rankings_${p.name}.html`;
			await Bun.write(filePath, html);
			console.log(`Saved to ${filePath}. Length: ${html.length}`);
		} catch (e) {
			console.error(`Error fetching ${p.name}:`, e);
		}
	}
}

main();
