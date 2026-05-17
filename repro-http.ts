import { launchGhostBrowser } from "./src/profiles/ghost/index.ts";
import { Browser } from "./src/api/browser.ts";

async function run() {
	console.log("Trying HTTP profile (curl-impersonate)...");
	const page = await Browser.newPage({
		profile: "http",
		httpOpts: { profile: "chrome131" }
	}) as any;
	
	try {
		const url = "https://www.google.com/search?q=Bunlight+engine&udm=14";
		console.log(`Navigating to ${url}...`);
		const resp = await page.goto(url);
		console.log(`Status: ${resp.status}`);
		const html = await page.content();
		console.log(`HTML size: ${html.length}`);
		if (html.includes("captcha")) {
			console.log("Still got CAPTCHA on HTTP profile.");
		} else {
			console.log("SUCCESS! No CAPTCHA on HTTP profile.");
			// console.log(html.slice(0, 500));
		}
	} finally {
		await page.close();
	}
}

run();
