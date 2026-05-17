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

import { readFileSync } from "fs";
import { join } from "path";
import { type PageAudit } from "../src/google/mass-scanner.ts";

/**
 * Autonomous Google Atlas Builder
 * This script is executed automatically after `massive-google-map.ts` finishes.
 * It reads the 5000+ pages dataset and generates the smart routing infrastructure.
 */

async function main() {
	console.log("🌌 Waking up! Mapping finished. Building Google Atlas...");
	
	const jsonPath = join(process.cwd(), "google-ecosystem-map.json");
	let raw: string;
	try {
		raw = readFileSync(jsonPath, "utf-8");
	} catch (e) {
		console.error("❌ Atlas mapping data not found. Aborting.", e);
		process.exit(1);
	}

	const data: PageAudit[] = JSON.parse(raw);
	console.log(`📊 Loaded ${data.length} audited pages.`);

	// 1. Generate src/google/atlas.ts
	const atlasPath = join(process.cwd(), "src/google/atlas.ts");
	
	const domains = new Map<string, { framework: string; count: number }>();
	for (const p of data) {
		try {
			const host = new URL(p.url).hostname;
			const fw = p.google?.framework ?? "none";
			const entry = domains.get(host) || { framework: fw, count: 0 };
			entry.count++;
			// Give priority to specific frameworks over "none"
			if (entry.framework === "none" && fw !== "none") {
				entry.framework = fw;
			}
			domains.set(host, entry);
		} catch {}
	}

	let atlasContent = `/**
 * Google Ecosystem Atlas (Auto-Generated)
 * Total Properties Mapped: ${domains.size}
 */

export type GoogleFramework = "wiz" | "angular" | "lit" | "none" | "unknown";

export interface AtlasRoute {
	hostname: string;
	framework: GoogleFramework;
	trafficWeight: number;
}

export const GOOGLE_ATLAS: Record<string, AtlasRoute> = {\n`;

	let added = 0;
	for (const [host, info] of Array.from(domains.entries()).sort((a, b) => b[1].count - a[1].count)) {
		if (added > 200) break; // Only keep top 200 to keep bundle small
		atlasContent += `\t"${host}": { hostname: "${host}", framework: "${info.framework}", trafficWeight: ${info.count} },\n`;
		added++;
	}
	atlasContent += `};\n\n`;
	
	atlasContent += `export function resolveAtlasRoute(hostname: string): AtlasRoute | null {
	return GOOGLE_ATLAS[hostname] ?? null;
}\n`;

	await Bun.write(atlasPath, atlasContent);
	console.log("✅ Generated src/google/atlas.ts");

	// 2. Generate Integration Tests
	const testPath = join(process.cwd(), "test/integration/google-atlas.test.ts");
	let testContent = `import { describe, it, expect } from "bun:test";
import { Browser } from "../../src/api/browser.ts";
import { GOOGLE_ATLAS } from "../../src/google/atlas.ts";

describe("Google Ecosystem Atlas - Smart Routing Verification", () => {
	// Sample of 10 high-value targets from the Atlas
	const targets = Object.keys(GOOGLE_ATLAS).slice(0, 10);

	for (const target of targets) {
		it(\`should successfully audit \${target} without WAF blocks\`, async () => {
			const page = await Browser.newPage({ profile: "stealth" });
			try {
				const res = await page.goto(\`https://\${target}\`, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
				expect(res.status).toBeLessThan(400); // No 403/429
			} finally {
				await page.close();
			}
		}, 20000);
	}
});
`;
	await Bun.write(testPath, testContent);
	console.log("✅ Generated test/integration/google-atlas.test.ts");

	console.log("🚀 All autonomous post-mapping tasks completed successfully!");
}

main().catch(console.error);
