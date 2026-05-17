import { googleSearchRich } from "./src/google/search.ts";
import { writeFileSync } from "fs";

async function run() {
	console.log("Searching for 'Bunlight engine' (rich)...");
	try {
		const rich = await googleSearchRich("Bunlight engine", { hl: "en", gl: "US" });
		console.log(`Profile: ${rich.profileUsed}, Results: ${rich.organic.length}`);
		
		// Let's modify search.ts temporarily to export the HTML or just re-run with a hack
	} catch (e) {
		console.error("Search failed:", e);
	}
}

run();
