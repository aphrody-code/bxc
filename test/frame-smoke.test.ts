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

test("Frame management smoke test", async () => {
	const page = await Browser.newPage({ profile: "static" });

	const mainFrame = page.mainFrame();
	expect(mainFrame).toBeDefined();
	expect(page.frames()).toContain(mainFrame);
	expect(mainFrame.parentFrame()).toBeNull();

	// Test content extraction from frame
	await page.setContent("<h1>Frame Test</h1>");
	expect(await mainFrame.content()).toContain("<h1>Frame Test</h1>");
	expect(await mainFrame.title()).toBe("");

	await page.close();
	await Browser.close();
});
