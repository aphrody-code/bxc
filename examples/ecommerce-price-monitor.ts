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
 * Example — E-Commerce Price Monitor (profile: auto-detected via suggestStrategy)
 *
 * Demonstrates Bxc's profile escalation pipeline:
 *   1. detectFromPage / detectFrameworks (wappalyzergo) runs on each URL
 *   2. suggestStrategy maps detected technologies onto the right Bxc profile
 *   3. Browser.newPage is opened with the suggested profile
 *   4. ".price" selector is extracted from the rendered page
 *   5. A baseline Map (persisted to /tmp/prices-baseline.json) is compared
 *      and price changes are logged
 *
 * Note: This demo uses hardcoded data: URIs for the product pages so no real
 * network request is made to an actual e-commerce site. The inline HTML is
 * structured like common e-commerce pages so the static profile handles it
 * correctly. The detect step is also short-circuited for data: URIs (no
 * wappalyzergo binary call) and defaults to "static" profile.
 *
 * Usage:
 *   bun run examples/ecommerce-price-monitor.ts
 *
 * On first run: creates /tmp/prices-baseline.json with current prices.
 * On subsequent runs: compares and logs any price changes.
 */

import type { Page } from "../src/api/browser.ts";
import { Browser } from "../src/api/browser.ts";
import type { DetectedTech } from "../src/detect.ts";
import { suggestStrategy } from "../src/router/framework-strategy.ts";

// ---------------------------------------------------------------------------
// Simulated e-commerce product pages (data: URIs)
// ---------------------------------------------------------------------------

interface ProductPage {
	name: string;
	url: string;
	/** Underlying framework hint for suggestStrategy demo (normally wappalyzergo output) */
	simulatedTech: DetectedTech[];
}

const PRODUCT_PAGES: ProductPage[] = [
	{
		name: "Widget Pro 3000",
		url: "data:text/html,<html><head><title>Widget Pro 3000 - ShopMock</title></head><body><h1>Widget Pro 3000</h1><span class='price'>$29.99</span></body></html>",
		simulatedTech: [{ name: "WordPress", categories: ["CMS"], version: "6.4" }],
	},
	{
		name: "Turbo Gadget X",
		url: "data:text/html,<html><head><title>Turbo Gadget X</title></head><body><h1>Turbo Gadget X</h1><span class='price'>$149.00</span></body></html>",
		simulatedTech: [
			{ name: "Shopify", categories: ["Ecommerce"], version: "2.0" },
		],
	},
	{
		name: "Eco Gizmo Plus",
		url: "data:text/html,<html><head><title>Eco Gizmo Plus</title></head><body><h1>Eco Gizmo Plus</h1><span class='price'>$74.50</span></body></html>",
		simulatedTech: [
			{ name: "Next.js", categories: ["JavaScript frameworks"], version: "14" },
		],
	},
	{
		name: "Smart Doohickey",
		url: "data:text/html,<html><head><title>Smart Doohickey</title></head><body><h1>Smart Doohickey</h1><span class='price'>$9.99</span></body></html>",
		simulatedTech: [], // no tech detected — defaults to "static"
	},
	{
		name: "Ultra Thingamajig",
		url: "data:text/html,<html><head><title>Ultra Thingamajig</title></head><body><h1>Ultra Thingamajig</h1><span class='price'>$299.00</span></body></html>",
		simulatedTech: [
			{ name: "React", categories: ["JavaScript frameworks"], version: "18" },
		],
	},
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PriceBaseline = Record<string, string>;

// Element handle shape — duck-type matching Page#makeHandle
interface ElementHandle {
	nodeId: number;
	textContent(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Baseline persistence (Bun-native: Bun.file, Bun.write)
// ---------------------------------------------------------------------------

const BASELINE_PATH = "/tmp/prices-baseline.json";

async function loadBaseline(): Promise<PriceBaseline> {
	const f = Bun.file(BASELINE_PATH);
	if (!(await f.exists())) return {};
	try {
		const text = await f.text();
		return JSON.parse(text) as PriceBaseline;
	} catch {
		return {};
	}
}

async function saveBaseline(baseline: PriceBaseline): Promise<void> {
	await Bun.write(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

// ---------------------------------------------------------------------------
// Price extraction
// ---------------------------------------------------------------------------

async function extractPrice(page: Page): Promise<string | null> {
	try {
		const handles = await page.$$<ElementHandle>(".price");
		if (handles.length === 0) return null;
		const text = await handles[0].textContent();
		return text.trim() || null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const baseline = await loadBaseline();
const isFirstRun = Object.keys(baseline).length === 0;
const updatedBaseline: PriceBaseline = { ...baseline };
let changesFound = 0;

console.log(`E-Commerce Price Monitor — ${PRODUCT_PAGES.length} products`);
console.log(
	isFirstRun
		? "First run: establishing baseline prices."
		: "Comparing against baseline...",
);
console.log();

for (const product of PRODUCT_PAGES) {
	// Step 1: Determine strategy from simulated framework detection
	const strategy = suggestStrategy(product.simulatedTech);
	const finalProfile = strategy.profile;

	console.log(
		`  "${product.name}"`,
		`| detected: ${product.simulatedTech.map((t) => t.name).join(", ") || "none"}`,
		`| suggested: ${strategy.profile}`,
	);

	// Step 2: Open page with resolved profile
	const page = (await Browser.newPage({ profile: finalProfile })) as any;
	let currentPrice: string | null = null;

	try {
		await page.goto(product.url);
		currentPrice = await extractPrice(page);
	} catch (err) {
		console.error(`    ERROR fetching page: ${String(err)}`);
	} finally {
		await page.close();
	}

	if (!currentPrice) {
		console.log(`    WARNING: no .price element found`);
		continue;
	}

	// Step 3: Compare with baseline
	const key = product.name;
	const lastPrice = baseline[key];

	if (isFirstRun || lastPrice === undefined) {
		console.log(`    baseline: ${currentPrice} (recorded)`);
		updatedBaseline[key] = currentPrice;
	} else if (lastPrice !== currentPrice) {
		changesFound++;
		const direction = currentPrice < lastPrice ? "DOWN" : "UP";
		console.log(
			`    PRICE CHANGE ${direction}: ${lastPrice} => ${currentPrice}`,
		);
		updatedBaseline[key] = currentPrice;
	} else {
		console.log(`    unchanged: ${currentPrice}`);
	}
}

await saveBaseline(updatedBaseline);

console.log();
if (isFirstRun) {
	console.log(`Baseline created at ${BASELINE_PATH}`);
} else {
	console.log(
		`${changesFound} price change(s) detected. Baseline updated at ${BASELINE_PATH}`,
	);
}
