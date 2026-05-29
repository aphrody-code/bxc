async function main() {
	const urlPattern = "worldbeyblade.org/rankings*";
	console.log(`Querying CDX API for: ${urlPattern}`);

	const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(urlPattern)}&output=json`;
	try {
		const res = await fetch(cdxUrl);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as any;

		console.log(`Found ${data.length - 1} snapshot records.`);

		const urls = new Map<string, string>();

		for (let i = 1; i < data.length; i++) {
			const [
				urlkey,
				timestamp,
				original,
				mimetype,
				statuscode,
				digest,
				length,
			] = data[i];
			if (statuscode === "200") {
				const waybackUrl = `http://web.archive.org/web/${timestamp}/${original}`;
				urls.set(original, waybackUrl);
			}
		}

		console.log("\n--- Unique WBO Rankings URLs and their Wayback links ---");
		for (const [orig, wayback] of urls.entries()) {
			console.log(`Original: ${orig}`);
			console.log(`Wayback:  ${wayback}\n`);
		}

		const list = Array.from(urls.entries()).map(([original, wayback]) => ({
			original,
			wayback,
		}));
		await Bun.write(
			"/home/ubuntu/bxc/data/rankings_wayback_urls.json",
			JSON.stringify(list, null, 2),
		);
		console.log("Saved URLs to data/rankings_wayback_urls.json");
	} catch (err) {
		console.error("Error querying CDX:", err);
	}
}

main();
