/**
 * Example 07 — Profile "max": Camoufox + CapSolver for Cloudflare Turnstile bypass.
 *
 * Stack 2026:
 *   - Camoufox v135 stable (Firefox fork avec patches C++ navigator/WebGL/Canvas)
 *   - Coherent fingerprint injection
 *   - CapSolver for Turnstile (~$0.8/1k, 85-90% success rate)
 *   - Residential proxy with sticky session
 *
 * Run:
 *   CAPSOLVER_API_KEY=... PROXY_URL=http://user:pass@proxy:port \
 *   bun examples/07-max-turnstile-solver.ts
 */

import { openMaxBrowser } from "../src/profiles/max/index.ts";

await using maxPage = await openMaxBrowser({
	fingerprint: {
		os: "linux",
		browser: "firefox",
		version: 135,
	},
	capsolverApiKey: process.env.CAPSOLVER_API_KEY,
	proxy: process.env.PROXY_URL,
	blockResources: ["image", "font", "media"],
	fallbackToPlaywrightFirefox: true,
	headless: true,
	timeoutMs: 60_000,
});

// Sites typically protected by interactive Turnstile
const targets = ["https://2captcha.com/demo/cloudflare-turnstile", "https://nowsecure.nl"];

for (const url of targets) {
	console.log(`→ ${url}`);
	const start = performance.now();
	const captcha = await maxPage.goto(url, { waitUntil: "domcontentloaded" });
	const ms = performance.now() - start;
	const title = await maxPage.title();
	console.log(`  title="${title}" loaded in ${ms.toFixed(0)}ms`);
	console.log(`  captcha detected=${captcha.detected} provider=${captcha.provider}`);
	if (captcha.result) {
		console.log(`  token=${captcha.result.token.slice(0, 30)}... mocked=${captcha.result.mocked}`);
	}
	console.log();
}
