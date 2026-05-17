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
 * Integration tests for `bunlight/detect` and `bunlight/router/framework-strategy`.
 *
 * These tests require :
 *   - The wappalyzergo-cli binary at `vendor/wappalyzergo/wappalyzergo-cli`
 *     (build with `cd vendor/wappalyzergo/cli && go build -o ../wappalyzergo-cli`)
 *   - Network access to public sites.
 *
 * Run with :
 *   bun test test/integration/detect.test.ts
 *
 * Skip with :
 *   SKIP_NETWORK_TESTS=1 bun test ...
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	type DetectedTech,
	detectFrameworks,
	detectFromPage,
	hasAnyCategory,
	hasAnyTech,
	type PageLike,
	resolveBinary,
} from "../../src/detect.ts";
import { shouldReDetectAfter, suggestStrategy } from "../../src/router/framework-strategy.ts";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const BIN_PATH = join(import.meta.dir, "../../vendor/wappalyzergo/wappalyzergo-cli");
const BIN_PRESENT = (await Bun.file(BIN_PATH).exists()) || !!Bun.env.BUNLIGHT_WAPPALYZERGO_BIN;
const NETWORK_OK = !Bun.env.SKIP_NETWORK_TESTS;

function logSkip(reason: string): void {
	console.warn(`[SKIP] ${reason}`);
}

// ---------------------------------------------------------------------------
// Pure tests : suggestStrategy with hand-crafted detection results
// ---------------------------------------------------------------------------

describe("suggestStrategy", () => {
	test("Next.js → fast + domcontentloaded", () => {
		const detected: DetectedTech[] = [
			{ name: "Next.js", categories: ["JavaScript frameworks"] },
			{ name: "React", categories: ["JavaScript frameworks"] },
		];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("fast");
		expect(["domcontentloaded", "wait-hydration"]).toContain(s.waitFor);
		expect(s.hints.shape).toBe("ssr-react");
	});

	test("Plain React (SPA) → fast + wait-hydration", () => {
		const detected: DetectedTech[] = [{ name: "React", categories: ["JavaScript frameworks"] }];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("fast");
		expect(s.waitFor).toBe("wait-hydration");
		expect(s.hints.isSPA).toBe(true);
	});

	test("WordPress → static", () => {
		const detected: DetectedTech[] = [
			{ name: "WordPress", categories: ["CMS", "Blogs"] },
			{ name: "PHP", categories: ["Programming languages"] },
		];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("static");
		expect(s.hints.shape).toBe("wordpress");
	});

	test("Cloudflare → stealth", () => {
		const detected: DetectedTech[] = [{ name: "Cloudflare", categories: ["CDN"] }];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("stealth");
		expect(s.hints.hasAntiBot).toBe(true);
	});

	test("DataDome → max", () => {
		const detected: DetectedTech[] = [
			{ name: "DataDome", categories: ["Security"] },
			{ name: "React", categories: ["JavaScript frameworks"] },
		];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("max");
		expect(s.hints.hasAntiBot).toBe(true);
	});

	test("Empty detection → static + reDetect", () => {
		const s = suggestStrategy([]);
		expect(s.profile).toBe("static");
		expect(s.hints.reDetectAfterHydration).toBe(true);
		expect(shouldReDetectAfter([])).toBe(true);
	});

	test("Astro → fast + domcontentloaded (SSR)", () => {
		const detected: DetectedTech[] = [{ name: "Astro", categories: ["Static site generator"] }];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("fast");
	});

	test("Shopify → static", () => {
		const detected: DetectedTech[] = [{ name: "Shopify", categories: ["Ecommerce"] }];
		const s = suggestStrategy(detected);
		expect(s.profile).toBe("static");
		expect(s.hints.shape).toBe("shopify");
	});
});

// ---------------------------------------------------------------------------
// Pure tests : helpers
// ---------------------------------------------------------------------------

describe("helpers", () => {
	const sample: DetectedTech[] = [
		{ name: "Next.js", categories: ["JavaScript frameworks"] },
		{ name: "Cloudflare", categories: ["CDN"] },
	];

	test("hasAnyTech is case-insensitive", () => {
		expect(hasAnyTech(sample, ["next.js"])).toBe(true);
		expect(hasAnyTech(sample, ["NEXT.JS"])).toBe(true);
		expect(hasAnyTech(sample, ["Vue.js"])).toBe(false);
	});

	test("hasAnyCategory matches by category name", () => {
		expect(hasAnyCategory(sample, ["CDN"])).toBe(true);
		expect(hasAnyCategory(sample, ["JavaScript frameworks"])).toBe(true);
		expect(hasAnyCategory(sample, ["CMS"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Pure test : stdin mode (no network) — uses synthetic HTML
// ---------------------------------------------------------------------------

describe("detectFrameworks (stdin mode, offline)", () => {
	test("synthetic WordPress HTML", async () => {
		if (!BIN_PRESENT) {
			logSkip("wappalyzergo-cli not present");
			return;
		}
		const html = `<!doctype html>
<html><head>
<meta name="generator" content="WordPress 6.5.2" />
<link rel="stylesheet" href="/wp-content/themes/foo/style.css" />
</head><body><h1>Hi</h1></body></html>`;
		const tech = await detectFrameworks({ html, headers: {} });
		expect(Array.isArray(tech)).toBe(true);
		expect(hasAnyTech(tech, ["WordPress"])).toBe(true);
	}, 30_000);

	test("synthetic Cloudflare via response headers", async () => {
		if (!BIN_PRESENT) {
			logSkip("wappalyzergo-cli not present");
			return;
		}
		const tech = await detectFrameworks({
			html: "<!doctype html><html><head></head><body></body></html>",
			headers: { server: "cloudflare", "cf-ray": "abcdef-FRA" },
		});
		expect(hasAnyTech(tech, ["Cloudflare"])).toBe(true);
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Network tests : real sites
// ---------------------------------------------------------------------------

describe.each([
	{
		site: "https://nextjs.org",
		expected: ["Next.js", "React"],
		expectedShape: "ssr-react",
	},
	{
		site: "https://wordpress.org",
		expected: ["WordPress"],
		expectedShape: "wordpress",
	},
	{
		site: "https://react.dev",
		// react.dev is on Vercel (Next.js). Bare Go fetch may only see Vercel
		// in headers; React markers are inside hydrated bundles. Accept either.
		expected: ["React", "Vercel", "Next.js"],
		expectedShape: undefined,
	},
	{
		site: "https://www.cloudflare.com",
		expected: ["Cloudflare"],
		expectedShape: undefined,
	},
	{
		site: "https://gemini.google.com",
		// Real-world Next.js prod fronted by a custom CDN. Headers are stripped
		// of `x-powered-by`, so detection relies on `_next/` asset paths.
		expected: ["Next.js", "React", "Vercel", "Nginx"],
		expectedShape: undefined,
	},
	{
		site: "https://workspace.google.com/",
		// Same prod stack, different subdomain. Custom CDN path
		// (cdn.gemini.google.com/static/azalee/_next/) hides Next.js from Wappalyzer
		// pattern `/_next/`. Accept Nginx as the realistic detected layer.
		expected: ["Next.js", "React", "Vercel", "Nginx"],
		expectedShape: undefined,
	},
])("network: $site", ({ site, expected, expectedShape }) => {
	test(`detects ${expected.join(", ")}`, async () => {
		if (!BIN_PRESENT) {
			logSkip("wappalyzergo-cli not present");
			return;
		}
		if (!NETWORK_OK) {
			logSkip("SKIP_NETWORK_TESTS=1");
			return;
		}
		let tech: DetectedTech[];
		try {
			tech = await detectFrameworks(site, { timeoutMs: 20_000 });
		} catch (err) {
			logSkip(`network failure for ${site}: ${(err as Error).message}`);
			return;
		}
		expect(Array.isArray(tech)).toBe(true);
		expect(tech.length).toBeGreaterThan(0);
		// At least one of the expected techs must be present.
		const hit = expected.some((name) =>
			tech.some((t) => t.name.toLowerCase() === name.toLowerCase()),
		);
		expect(hit).toBe(true);

		const strat = suggestStrategy(tech);
		expect(["static", "fast", "stealth", "max", "http"]).toContain(strat.profile);
		if (expectedShape !== undefined) {
			expect(strat.hints.shape).toBe(expectedShape as never);
		}
	}, 45_000);
});

// ---------------------------------------------------------------------------
// detectFromPage with a stub PageLike
// ---------------------------------------------------------------------------

describe("detectFromPage", () => {
	test("works with a stub PageLike", async () => {
		if (!BIN_PRESENT) {
			logSkip("wappalyzergo-cli not present");
			return;
		}
		const stub: PageLike = {
			url: () => "https://example.test/",
			content: async () => `<!doctype html><html><head>
				<meta name="generator" content="WordPress 6.4" />
				</head><body></body></html>`,
		};
		const tech = await detectFromPage(stub);
		expect(hasAnyTech(tech, ["WordPress"])).toBe(true);
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

describe("resolveBinary", () => {
	test("finds the vendored binary or throws cleanly", async () => {
		if (!BIN_PRESENT) {
			await expect(resolveBinary()).rejects.toThrow(/wappalyzergo-cli binary not found/);
			return;
		}
		const resolvedPath = await resolveBinary();
		expect(await Bun.file(resolvedPath).exists()).toBe(true);
	});
});
