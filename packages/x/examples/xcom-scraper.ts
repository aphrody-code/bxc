import { XComScraper } from "@aphrody/bxc/scrapers/xcom";
import { write } from "bun";

async function main() {
	const scraper = new XComScraper();

	try {
		console.log("Initializing XComScraper...");
		await scraper.init();

		const username = "x"; // Official X account
		console.log(`Extracting profile for @${username}...`);
		const data = await scraper.extractProfile(username, true);

		// Save the Markdown output
		const mdPath = `./${username}-profile.md`;
		await write(mdPath, data.markdownSnapshot);
		console.log(`Saved Markdown snapshot to ${mdPath}`);

		// Save the screenshot if available
		if (data.screenshot) {
			const imgPath = `./${username}-profile.png`;
			await write(imgPath, data.screenshot);
			console.log(`Saved screenshot to ${imgPath}`);
		}

		// Extract AI structured data
		console.log(`\nExtracting structured JSON using AI...`);
		const profileJson = await scraper.aiExtractProfileInfo();
		console.log("Profile Data (JSON):", JSON.stringify(profileJson, null, 2));

		console.log("\nDone!");
	} catch (err) {
		console.error("Error during scraping:", err);
	} finally {
		await scraper.close();
	}
}

if (import.meta.main) {
	main().catch(console.error);
}
