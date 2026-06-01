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

import { BrowserCrawler } from "./BrowserCrawler.ts";
import { RequestQueue } from "../queue/RequestQueue.ts";
import { BxcDB } from "../db/BxcDB.ts";
import { redis } from "bun";
import { extractStructuredData } from "../google/fetch.ts";
import { generateOpenApiSchema } from "../utils/openapi.ts";

export interface AutonomousCrawlerOptions {
	requestQueueName?: string;
	allowedDomains?: string[];
	maxDepth?: number;
	maxRequests?: number;
	redisTtl?: number; // In seconds, default: 86400 (24h)
	profile?: "static" | "fast" | "stealth" | "max";
}

export class AutonomousCrawler {
	private requestQueue: RequestQueue;
	private db: BxcDB;
	private allowedDomains?: string[];
	private maxDepth: number;
	private maxRequests: number;
	private redisTtl: number;
	private profile: "static" | "fast" | "stealth" | "max";
	private activeCrawler?: BrowserCrawler;
	private isRunning = false;

	constructor(opts: AutonomousCrawlerOptions = {}) {
		this.requestQueue = RequestQueue.open(opts.requestQueueName ?? "bxc-autonomous-crawler");
		this.db = new BxcDB();
		this.allowedDomains = opts.allowedDomains;
		this.maxDepth = opts.maxDepth ?? 5;
		this.maxRequests = opts.maxRequests ?? Infinity;
		this.redisTtl = opts.redisTtl ?? 86400; // 24h
		this.profile = opts.profile ?? "stealth";
	}

	/**
	 * Run the crawler. If URLs are specified, enqueue them.
	 */
	async run(initialUrls?: string[]): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;

		if (initialUrls && initialUrls.length > 0) {
			const prepared = initialUrls.map((url) => {
				return {
					url,
					opts: {
						userData: { depth: 0 }
					}
				};
			});
			this.requestQueue.addRequests(prepared);
		}

		this.activeCrawler = new BrowserCrawler({
			requestQueue: this.requestQueue,
			profile: this.profile,
			maxRequestsPerCrawl: this.maxRequests,
			requestHandler: async (context) => {
				const { request, page, response, enqueueLinks, pushData, log } = context;
				const depth = (request.userData?.depth as number) ?? 0;
				log(`Crawling url: ${request.url} at depth ${depth}`);

				const url = request.url;

				// Check Redis Cache first to bypass heavy crawling if possible
				const cached = await redis.get(`bxc:cache:url:${url}`);
				if (cached) {
					log(`Cache hit for: ${url}. Skipping scrape.`);
					try {
						const parsed = JSON.parse(cached);
						// Push cached data
						await pushData({
							url,
							title: parsed.title,
							depth,
							status: parsed.status,
							openapi: parsed.openapi,
							cached: true
						});
					} catch {}
					return;
				}

				// 1. Get raw HTML and convert to Markdown
				const html = await page.content();
				const markdown = await page.markdown();
				const title = await page.title();

				// 2. Extract structured data
				const structured = await extractStructuredData(html);

				// 3. Generate OpenAPI Schema
				const openapi = generateOpenApiSchema({
					url,
					title,
					description: structured.description || undefined,
					markdown,
					structuredData: structured,
					timestamp: new Date().toISOString()
				});

				// 4. Save to SQLite database
				const metadata = {
					title,
					depth,
					canonical: structured.canonical,
					openGraph: structured.openGraph,
					twitter: structured.twitter
				};
				this.db.saveScrape(url, this.profile, response.status, html, metadata, markdown, structured, openapi);

				// 5. Cache in Redis
				const redisKey = `bxc:cache:url:${url}`;
				const redisValue = JSON.stringify({
					url,
					title,
					status: response.status,
					markdown,
					structured,
					openapi,
					timestamp: new Date().toISOString()
				});
				await redis.set(redisKey, redisValue, "EX", this.redisTtl);
				log(`Cached url in Redis: ${url}`);

				// 6. Recursively enqueue links if depth < this.maxDepth
				if (depth < this.maxDepth) {
					await enqueueLinks({
						selector: "a[href]",
						allowedDomains: this.allowedDomains,
						userData: { depth: depth + 1 }
					});
				}

				// Push to Crawlee-like dataset
				await pushData({
					url,
					title,
					depth,
					status: response.status,
					openapi
				});
			}
		});

		try {
			await this.activeCrawler.run();
		} finally {
			this.isRunning = false;
		}
	}

	stop(): void {
		this.isRunning = false;
	}

	stats() {
		return this.requestQueue.stats();
	}
}
