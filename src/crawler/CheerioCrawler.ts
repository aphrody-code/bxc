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
 * @module bxc/crawler/CheerioCrawler
 *
 * Parallel web crawler that loads raw HTML/JSON with the fingerprinted curl-impersonate client
 * and parses HTML with cheerio.
 */

import * as cheerio from "cheerio";
import {
	BasicCrawler,
	type CrawlContext,
	type BasicCrawlerOptions,
} from "./Crawler.ts";

export interface CheerioCrawlingContext extends CrawlContext {
	$: cheerio.CheerioAPI;
	body: string;
	response: {
		status: number;
		headers: Record<string, string>;
	};
}

export interface CheerioCrawlerOptions
	extends BasicCrawlerOptions<CheerioCrawlingContext> {
	httpProfile?: string;
	proxy?: string;
	proxyAuth?: string;
	headers?: Record<string, string>;
	cookies?: string | any[];
	insecure?: boolean;
	timeoutMs?: number;
	userAgent?: string;
}

export class CheerioCrawler extends BasicCrawler<CheerioCrawlingContext> {
	protected declare options: CheerioCrawlerOptions;

	constructor(options: CheerioCrawlerOptions) {
		super(options);
	}

	async processRequest(req: any): Promise<void> {
		this.log(`CheerioCrawler crawling: ${req.url}`);

		let body: string;
		let status = 200;
		let headers: Record<string, string> = {};

		const isLocal =
			req.url.startsWith("http://localhost") ||
			req.url.startsWith("http://127.0.0.1") ||
			req.url.startsWith("http://[::1]");

		if (isLocal) {
			const res = await fetch(req.url);
			body = await res.text();
			status = res.status;
			res.headers.forEach((v, k) => {
				headers[k] = v;
			});
		} else {
			const { Browser } = require("../api/browser.ts");
			const page = await Browser.newPage({
				profile: "http",
				cookies: this.options.cookies,
				userAgent: this.options.userAgent,
				insecure: this.options.insecure,
				httpOpts: {
					profile: this.options.httpProfile ?? "chrome131",
					proxy: this.options.proxy,
					proxyAuth: this.options.proxyAuth,
					timeoutMs: this.options.timeoutMs ?? 30_000,
					headers: this.options.headers,
				},
			});
			try {
				const response = await page.goto(req.url);
				body = await page.content();
				status = response?.status() ?? 200;
				headers = response?.headers() ?? {};
			} finally {
				await page.close();
			}
		}

		const $ = cheerio.load(body);

		const context: CheerioCrawlingContext = {
			request: req,
			$,
			body,
			response: {
				status,
				headers,
			},
			enqueueLinks: async (opts) => {
				const selector = opts?.selector ?? "a[href]";
				const allowedDomains = opts?.allowedDomains;
				const links: Array<{ url: string; opts?: any }> = [];
				const base = new URL(req.url);
				$(selector).each((_, el) => {
					const href = $(el).attr("href");
					if (
						href &&
						!href.startsWith("javascript:") &&
						!href.startsWith("#") &&
						!href.startsWith("mailto:")
					) {
						try {
							const absUrl = new URL(href, base).href;
							if (allowedDomains) {
								const hostname = new URL(absUrl).hostname;
								if (
									allowedDomains.some(
										(d) => hostname === d || hostname.endsWith("." + d),
									)
								) {
									links.push({
										url: absUrl,
										opts: opts?.userData ? { userData: opts.userData } : {},
									});
								}
							} else {
								links.push({
									url: absUrl,
									opts: opts?.userData ? { userData: opts.userData } : {},
								});
							}
						} catch {
							// Ignore invalid URLs
						}
					}
				});
				if (links.length > 0) {
					this.requestQueue.addRequests(links);
				}
			},
			pushData: async (data) => {
				if (this.dataset) {
					await this.dataset.pushData(data);
				}
			},
			log: (msg) => this.log(msg),
		};

		await this.requestHandler(context);
	}
}
