import * as fs from "node:fs";

function main() {
	const html = fs.readFileSync(
		"/home/ubuntu/bxc/data/rankings_archive.html",
		"utf-8",
	);

	console.log("Analyzing WBO rankings HTML structure...");

	// Let's look for headings or main divs
	const mainMatch =
		html.match(/<main[\s\S]*?<\/main>/i) ??
		html.match(/<div class="content"[\s\S]*?/i) ??
		html.match(/<div class="container"[\s\S]*?/i);
	if (mainMatch) {
		console.log("Found main/container element content. Snippet:");
		console.log(mainMatch[0].slice(0, 2000));
	}

	// Let's search for some typical ranking terms or list items
	const ranks = [];
	const divClasses = new Set<string>();
	const regex = /class="([^"]+)"/g;
	let m;
	while ((m = regex.exec(html)) !== null) {
		if (m[1]) divClasses.add(m[1]);
	}

	console.log("\nSome classes found in the page:");
	console.log(Array.from(divClasses).slice(0, 20));

	// Let's look for member profile links (which would list players)
	const memberLinks =
		html.match(/member\.php\?action=profile&amp;uid=\d+/gi) || [];
	console.log(
		`\nFound ${memberLinks.length} member profile links in the page.`,
	);
	if (memberLinks.length > 0) {
		console.log("Sample profile links:", memberLinks.slice(0, 5));
	}

	// Search for numbers that look like ranking points or ranks (e.g. 1, 2, 3, etc.)
	const rankingsList = html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
	console.log(`Found ${rankingsList.length} list items.`);
}

main();
