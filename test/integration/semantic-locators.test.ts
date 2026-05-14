import { test, expect } from "bun:test";
import { Browser } from "../../src/api/browser.ts";

test("Semantic Locators > resolves @semantic query via python bridge", async () => {
	const page = await Browser.newPage({ profile: "static" });
	await page.setContent(`
		<html>
		<body>
			<button id="login">Log in to your account</button>
			<a href="/signup">Create account</a>
		</body>
		</html>
	`);
	
	const buttonLocator = page.locator("@semantic:the blue login button");
	// Our mock semantic_resolver maps "button" keyword to "button" selector
	const count = await buttonLocator.count();
	expect(count).toBe(1);
	
	const linkLocator = page.locator("@semantic:the signup link");
	// Maps "link" keyword to "a" selector
	const aCount = await linkLocator.count();
	expect(aCount).toBe(1);

	await page.close();
});
