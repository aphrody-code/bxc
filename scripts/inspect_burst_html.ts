import * as fs from "node:fs";

function main() {
	const html = fs.readFileSync(
		"/home/ubuntu/bxc/data/rankings_burst.html",
		"utf-8",
	);

	console.log("HTML length:", html.length);
	const panelTitles =
		html.match(/<h3 class="panel-title">([\s\S]*?)<\/h3>/gi) || [];
	console.log(`Found ${panelTitles.length} panel titles:`);
	for (const title of panelTitles) {
		console.log("-", title.replace(/<[^>]+>/g, "").trim());
	}

	// Let's find any tables or user items
	const userCount = (html.match(/class="list-group-item/gi) || []).length;
	console.log("list-group-item occurrences:", userCount);

	// Print a small sample around list-group
	const lgIdx = html.indexOf("list-group");
	if (lgIdx !== -1) {
		console.log("Snippet around list-group:");
		console.log(html.slice(lgIdx - 200, lgIdx + 1000));
	} else {
		console.log("First 1000 chars of body:");
		const bodyIdx = html.indexOf("<body");
		if (bodyIdx !== -1) {
			console.log(html.slice(bodyIdx, bodyIdx + 1000));
		}
	}
}

main();
