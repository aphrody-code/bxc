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

/**
 * Example 06 — Bypass Cloudflare via profile "ghost" (patchright + coherent fingerprints).
 *
 * Stack 2026:
 *   - patchright (fork Playwright avec Runtime.Enable patches)
 *   - Coherent fingerprint generation (UA, WebGL, navigator, screen)
 *   - Cookie jar persistence for cf_clearance reuse
 *   - Residential proxy (optional)
 *
 * Run:
 *   PROXY_URL=http://user:pass@proxy.smartproxy.com:1234 \
 *   bun examples/06-stealth-cloudflare.ts
 */

import { launchGhostBrowser } from "../src/profiles/ghost/index.ts";

await using stealth = await launchGhostBrowser({
	fingerprint: {
		os: "linux",
		browser: "chrome",
		version: 130,
	},
	cookies: "./profiles/cloudflare-cookies.json",
});

await stealth.page.goto("https://www.fingerprint.com/products/bot-detection/", {
	waitUntil: "domcontentloaded",
});

const detection = await stealth.page.evaluate(() => {
	const w = window as Window & { fpVisitor?: { isBot?: boolean } };
	return {
		isBot: w.fpVisitor?.isBot,
		webdriver: (navigator as Navigator & { webdriver?: boolean }).webdriver,
		ua: navigator.userAgent,
	};
});

console.log("Bot detection result:", detection);
console.log("Page title:", await stealth.page.title());
