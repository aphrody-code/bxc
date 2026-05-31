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

test("BrowserContext isolation smoke test", async () => {
	const context1 = await Browser.newContext();
	const context2 = await Browser.newContext();

	const page1 = await context1.newPage();
	const page2 = await context2.newPage();

	expect(page1.context()).toBe(context1);
	expect(page2.context()).toBe(context2);
	expect(context1.pages()).toContain(page1);
	expect(context2.pages()).toContain(page2);
	expect(context1.pages()).not.toContain(page2);

	// Cookie isolation test
	const cookie = {
		name: "test",
		value: "context1",
		domain: "google.com",
		path: "/",
		expires: 0,
		secure: false,
		httpOnly: false,
		sameSite: "Lax" as const,
	};
	await context1.addCookies([cookie as any]);

	expect(await context1.cookies()).toHaveLength(1);
	expect(await context2.cookies()).toHaveLength(0);

	await context1.close();
	await context2.close();
	await Browser.close();
});
