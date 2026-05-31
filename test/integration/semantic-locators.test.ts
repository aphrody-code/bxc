/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from "bun:test";
import { Browser } from "../../src/api/browser.ts";

test("Semantic Locators > resolves @semantic query via native AI extractor", async () => {
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
