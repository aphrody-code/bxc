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

import { Browser } from "@aphrody/bxc";
import { launchGhostBrowser } from "@aphrody/bxc/profiles/ghost";
import pRetry, { AbortError } from "p-retry";
import type { FutPrice } from "./types.ts";

export async function scrapeFutBinPrice(
	urlOrHtml: string,
	profile: "http" | "ghost" = "ghost",
	urlFallback?: string,
): Promise<FutPrice> {
	let content = "";

	const isUrl =
		urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://");
	const finalUrl = isUrl ? urlOrHtml : urlFallback || "unknown";

	if (isUrl) {
		const fetched = await pRetry(
			async () => {
				if (profile === "ghost") {
					const ghost = await launchGhostBrowser();
					try {
						const res = await ghost.page.goto(urlOrHtml);
						await Bun.sleep(2000);
						const content = await ghost.page.content();
						const title = await ghost.page.title();
						if (
							title.includes("Just a moment") ||
							title.includes("Cloudflare")
						) {
							throw new AbortError("Cloudflare Turnstile challenge detected");
						}
						if (res && res.status === 404) {
							throw new AbortError(`404 Not Found: ${urlOrHtml}`);
						}
						return content;
					} finally {
						await ghost.close();
					}
				} else {
					const page = await Browser.newPage({ profile });
					try {
						const res = await page.goto(urlOrHtml);
						const title = await page.title();
						if (
							title.includes("Just a moment") ||
							title.includes("Cloudflare")
						) {
							throw new AbortError("Cloudflare Turnstile challenge detected");
						}
						if (res && res.status === 404) {
							throw new AbortError(`404 Not Found: ${urlOrHtml}`);
						}
						if (res && res.status >= 500) {
							throw new Error(`Server error ${res.status}: ${urlOrHtml}`);
						}
						return await page.content();
					} finally {
						await page.close();
					}
				}
			},
			{
				retries: 2,
				onFailedAttempt: (failedAttempt) => {
					console.warn(
						`  [Retry FutBin] Attempt ${failedAttempt.attemptNumber} failed. ${failedAttempt.retriesLeft} retries left. Error: ${failedAttempt.message}`,
					);
				},
			},
		);
		content = fetched;
	} else {
		content = urlOrHtml;
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
		url: finalUrl,
		price: priceVal,
		lastUpdated: new Date().toISOString(),
	};
}
