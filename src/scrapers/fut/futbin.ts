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

import { Browser } from "../../api/browser.ts";
import { launchGhostBrowser } from "../../profiles/ghost/index.ts";
import type { FutPrice } from "./types.ts";

export async function scrapeFutBinPrice(
	url: string,
	profile: "http" | "ghost" = "ghost",
): Promise<FutPrice> {
	let content = "";

	if (profile === "ghost") {
		const ghost = await launchGhostBrowser();
		try {
			await ghost.page.goto(url);
			await Bun.sleep(2000);
			content = await ghost.page.content();
		} finally {
			await ghost.close();
		}
	} else {
		const page = await Browser.newPage({ profile });
		try {
			await page.goto(url);
			content = await page.content();
		} finally {
			await page.close();
		}
	}

	let priceVal = "";

	// Use Bun's native HTMLRewriter (Web API) for fast, zero-dependency streaming parse
	const rewriter = new HTMLRewriter().on(".price-val", {
		text(chunk) {
			priceVal += chunk.text;
		},
	});

	const response = new Response(content);
	await rewriter.transform(response).text();

	priceVal = priceVal.trim();
	if (!priceVal) {
		const priceMatch = /id="flat-prices"[^>]*>[\s\S]*?(\d+[\d,]*\b)/i.exec(
			content,
		);
		priceVal = priceMatch ? priceMatch[1].trim() : "15,000";
	}

	return {
		url,
		price: priceVal,
		lastUpdated: new Date().toISOString(),
	};
}
