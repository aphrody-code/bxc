async function main() {
	const url = "https://worldbeyblade.org/rankings";
	console.log(`Checking Wayback Machine for archives of: ${url}`);

	const waybackApiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
	try {
		const res = await fetch(waybackApiUrl);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as any;

		console.log("Wayback API response:", JSON.stringify(data, null, 2));
		if (data.archived_snapshots?.closest?.available) {
			const snapshotUrl = data.archived_snapshots.closest.url;
			console.log(`SUCCESS! Found archived snapshot at: ${snapshotUrl}`);

			console.log("Fetching archived rankings page...");
			const pageRes = await fetch(snapshotUrl);
			if (pageRes.ok) {
				const html = await pageRes.text();
				console.log(`Rankings page fetched. HTML length: ${html.length}`);
				await Bun.write("/home/ubuntu/bxc/data/rankings_archive.html", html);
				console.log("Saved archive HTML to data/rankings_archive.html");

				// Quick analysis of contents
				const hasRankTable =
					html.includes("rank") ||
					html.includes("leaderboard") ||
					html.includes("table");
				console.log(`Contains table or rankings references? ${hasRankTable}`);

				// Let's print out text that looks like ranking data to see if we can parse it
				const title =
					html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "No Title";
				console.log(`Page Title: ${title}`);
			} else {
				console.error(`Failed to fetch snapshot page: HTTP ${pageRes.status}`);
			}
		} else {
			console.log("No archived snapshot found for rankings URL.");
		}
	} catch (err) {
		console.error("Error querying Wayback Machine:", err);
	}
}

main();
