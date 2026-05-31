async function main() {
	const snapshotUrl =
		"http://web.archive.org/web/20251105085224/https://worldbeyblade.org/rankings";
	console.log(`Fetching archived rankings page: ${snapshotUrl}`);

	try {
		const res = await fetch(snapshotUrl);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const html = await res.text();

		console.log(`Rankings page fetched. HTML length: ${html.length}`);
		await Bun.write("/home/ubuntu/bxc/data/rankings_archive.html", html);
		console.log("Saved archive HTML to data/rankings_archive.html");

		// Let's print out what elements are present in the HTML to understand layout
		const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "No Title";
		console.log(`Page Title: ${title}`);

		// Look for tables or lists
		const hasTable = html.includes("<table");
		console.log(`Has table element: ${hasTable}`);

		// Print a small sample around the first occurrence of '<table'
		const tableIdx = html.indexOf("<table");
		if (tableIdx !== -1) {
			console.log("Table structure snippet:");
			console.log(html.slice(tableIdx, tableIdx + 2000));
		} else {
			console.log("No table found. First 1000 characters of body:");
			const bodyIdx = html.indexOf("<body");
			if (bodyIdx !== -1) {
				console.log(html.slice(bodyIdx, bodyIdx + 1000));
			}
		}
	} catch (e) {
		console.error("Error fetching rankings page:", e);
	}
}

main();
