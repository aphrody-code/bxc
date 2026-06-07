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
 * @module bxc/crawler/BrowserCrawler
 *
 * Crawler that loads pages using bxc's native Browser (supporting static, fast, stealth, or max profiles)
 * and evaluates interactions on them.
 */

import * as cheerio from "cheerio";
import {
	BasicCrawler,
	type CrawlContext,
	type BasicCrawlerOptions,
} from "./Crawler.ts";

export interface BrowserCrawlingContext extends CrawlContext {
	page: any;
	response: any;
	$: cheerio.CheerioAPI;
}

export interface BrowserCrawlerOptions
	extends BasicCrawlerOptions<BrowserCrawlingContext> {
	profile?: "static" | "fast" | "stealth" | "max";
	headless?: boolean;
	cookies?: string | any[];
	userAgent?: string;
	viewport?: { width: number; height: number };
	insecure?: boolean;
	proxy?: string;
	proxyPool?: string[];
	proxyAuth?: string;
	spawnOpts?: any;
	useWorkers?: boolean;
	requestHandlerPath?: string;
}

export class BrowserCrawler extends BasicCrawler<BrowserCrawlingContext> {
	private profile: "static" | "fast" | "stealth" | "max";
	private headless: boolean;
	protected declare options: BrowserCrawlerOptions;

	constructor(options: BrowserCrawlerOptions) {
		super(options);
		this.profile = options.profile ?? "stealth";
		this.headless = options.headless ?? true;
	}

	async processRequest(req: any): Promise<void> {
		if (this.options.useWorkers) {
			await this.processRequestWithWorker(req);
		} else {
			await this.processRequestDirect(req);
		}
	}

	private async processRequestDirect(req: any): Promise<void> {
		const { isCrawlFailure, profilesOrder } = require("./crawl-utils.ts");
		const startProfile = this.profile;
		const idx = profilesOrder.indexOf(startProfile);
		const escalationPath = idx === -1 ? [startProfile] : profilesOrder.slice(idx);

		let lastError: Error | null = null;
		let success = false;

		for (const profile of escalationPath) {
			let selectedProxy = this.options.proxy;
			if (this.options.proxyPool && this.options.proxyPool.length > 0) {
				const proxyIdx = Math.floor(Math.random() * this.options.proxyPool.length);
				selectedProxy = this.options.proxyPool[proxyIdx];
			}

			this.log(`BrowserCrawler (${profile}) crawling: ${req.url} (proxy: ${selectedProxy || "none"})`);
			const { Browser } = require("../api/browser.ts");
			let page: any = null;
			try {
				page = await Browser.newPage({
					profile: profile,
					headless: this.headless,
					cookies: this.options.cookies,
					userAgent: this.options.userAgent,
					viewport: this.options.viewport,
					insecure: this.options.insecure,
					proxy: selectedProxy,
					proxyAuth: this.options.proxyAuth,
					spawnOpts: this.options.spawnOpts,
				});

				const response = await page.goto(req.url);
				const body = await page.content();
				const title = await page.title();
				const status = response?.status;

				if (isCrawlFailure(status, body, title)) {
					throw new Error(
						`Crawl failure detected (status: ${status}, title: "${title}", content length: ${body.length})`
					);
				}

				let cachedCheerio: cheerio.CheerioAPI | null = null;
				const getCheerio = () => {
					if (!cachedCheerio) {
						cachedCheerio = cheerio.load(body);
					}
					return cachedCheerio;
				};

				const context: BrowserCrawlingContext = {
					request: req,
					page,
					response,
					get $() {
						return getCheerio();
					},
					enqueueLinks: async (opts) => {
						const selector = opts?.selector ?? "a[href]";
						const allowedDomains = opts?.allowedDomains;
						const $ = getCheerio();
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
									// Ignore
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
				success = true;
				break;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.log(`BrowserCrawler profile ${profile} failed for ${req.url}: ${msg}. Escalating...`);
				lastError = err instanceof Error ? err : new Error(msg);
			} finally {
				if (page) {
					try {
						await page.close();
					} catch {}
				}
			}
		}

		if (!success) {
			throw lastError ?? new Error(`Failed to crawl ${req.url} with all profiles in escalation path.`);
		}
	}

	private async processRequestWithWorker(req: any): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const workerUrl = new URL("./BrowserWorker.ts", import.meta.url).href;
			const worker = new Worker(workerUrl);
			(worker as any).unref();

			worker.onmessage = async (event: MessageEvent) => {
				const { type, data, urls, message, error } = event.data;
				if (type === "pushData") {
					if (this.dataset) {
						await this.dataset.pushData(data);
					}
				} else if (type === "addRequests") {
					this.requestQueue.addRequests(urls);
				} else if (type === "log") {
					this.log(message);
				} else if (type === "done") {
					worker.terminate();
					resolve();
				} else if (type === "error") {
					worker.terminate();
					reject(new Error(error));
				}
			};

			worker.onerror = (err) => {
				worker.terminate();
				reject(err);
			};

			let handlerCode: string | undefined;
			if (!this.options.requestHandlerPath) {
				handlerCode = this.requestHandler.toString();
			}

			let selectedProxy = this.options.proxy;
			if (this.options.proxyPool && this.options.proxyPool.length > 0) {
				const idx = Math.floor(Math.random() * this.options.proxyPool.length);
				selectedProxy = this.options.proxyPool[idx];
			}

			worker.postMessage({
				type: "crawl",
				id: req.id,
				url: req.url,
				method: req.method,
				payload: req.payload,
				headers: req.headers,
				userData: req.userData,
				options: {
					profile: this.profile,
					headless: this.headless,
					cookies: this.options.cookies,
					userAgent: this.options.userAgent,
					viewport: this.options.viewport,
					insecure: this.options.insecure,
					proxy: selectedProxy,
					proxyAuth: this.options.proxyAuth,
					spawnOpts: this.options.spawnOpts,
				},
				handlerCode,
				handlerPath: this.options.requestHandlerPath,
			});
		});
	}
}
