import * as fs from "node:fs";

function main() {
	const html = fs.readFileSync(
		"/home/ubuntu/bxc/data/rankings_archive.html",
		"utf-8",
	);

	const panelTitles =
		html.match(/<h3 class="panel-title">([\s\S]*?)<\/h3>/gi) || [];
	console.log(`Found ${panelTitles.length} panel titles:`);
	for (const title of panelTitles) {
		console.log("-", title.replace(/<[^>]+>/g, "").trim());
	}
}

main();
