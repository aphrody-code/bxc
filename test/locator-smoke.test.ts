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
import { Browser } from "../src/api/browser.ts";

test("Locator auto-waiting smoke test (static mode)", async () => {
	const page = await Browser.newPage({ profile: "static" });

	// Test 1: Simple count and visibility
	await page.setContent("<button id='btn'>Click Me</button>");
	const locator = page.locator("#btn");

	expect(await locator.count()).toBe(1);
	expect(await locator.isVisible({ timeout: 1000 })).toBe(true);

	// Test 2: Auto-waiting for element to appear
	let finished = false;
	setTimeout(async () => {
		await page.setContent("<button id='late-btn'>Late Click</button>");
		finished = true;
	}, 500);

	const lateLocator = page.locator("#late-btn");
	// isVisible() with timeout should wait
	const isVisible = await lateLocator.isVisible({ timeout: 2000 });
	expect(isVisible).toBe(true);
	expect(finished).toBe(true);

	// Test 3: Filter by text
	await page.setContent(`
    <ul>
      <li>Item 1</li>
      <li>Item 2</li>
      <li>Item 3</li>
    </ul>
  `);
	const listItems = page.locator("li");
	expect(await listItems.count()).toBe(3);

	const item2 = listItems.filter({ hasText: "Item 2" });
	expect(await item2.count()).toBe(1);
	expect(await item2.isVisible({ timeout: 1000 })).toBe(true);

	await page.close();
}, 5000);
