/**
 * Example 06 — Bypass Cloudflare via profile "stealth" (patchright + coherent fingerprints).
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

import { openStealthBrowser } from "../src/profiles/stealth/index.ts";

await using stealth = await openStealthBrowser({
	fingerprint: {
		os: "linux",
		browser: "chrome",
		version: 130,
	},
	proxy: process.env.PROXY_URL,
	cookieJar: "./profiles/cloudflare-cookies.json",
	blockResources: ["image", "font", "media"],
	humanize: { mouse: true, scroll: true },
	headless: true,
});

await stealth.goto("https://www.fingerprint.com/products/bot-detection/", {
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
console.log("Page title:", await stealth.title());
