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

declare var self: Worker;

import { Browser } from "../api/browser.ts";
import * as cheerio from "cheerio";

self.onmessage = async (event: MessageEvent) => {
	const {
		type,
		id,
		url,
		method,
		payload,
		headers,
		userData,
		options,
		handlerCode,
		handlerPath,
	} = event.data;

	if (type === "crawl") {
		try {
			// Initialize browser page
			const page = await Browser.newPage({
				profile: options.profile ?? "stealth",
				headless: options.headless ?? true,
				cookies: options.cookies,
				userAgent: options.userAgent,
				viewport: options.viewport,
				insecure: options.insecure,
				proxy: options.proxy,
				proxyAuth: options.proxyAuth,
				spawnOpts: options.spawnOpts,
			} as any);

			try {
				const response = await page.goto(url);
				const body = await page.content();

				let cachedCheerio: cheerio.CheerioAPI | null = null;
				const getCheerio = () => {
					if (!cachedCheerio) {
						cachedCheerio = cheerio.load(body);
					}
					return cachedCheerio;
				};

				// Resolve the requestHandler
				let handler: any;
				if (handlerPath) {
					const mod = await import(handlerPath);
					handler = mod.default || mod.requestHandler;
				} else if (handlerCode) {
					// Compile function from string representation
					handler = eval(`(${handlerCode})`);
				}

				if (!handler) {
					throw new Error("No request handler provided or found");
				}

				// Build local context that communicates with main thread
				const context = {
					request: { id, url, method, payload, headers, userData },
					page,
					response,
					get $() {
						return getCheerio();
					},
					enqueueLinks: async (enqueueOpts: any) => {
						const selector = enqueueOpts?.selector ?? "a[href]";
						const allowedDomains = enqueueOpts?.allowedDomains;
						const $ = getCheerio();
						const links: Array<{ url: string; opts?: any }> = [];
						const base = new URL(url);
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
												(d: string) =>
													hostname === d || hostname.endsWith("." + d),
											)
										) {
											links.push({
												url: absUrl,
												opts: enqueueOpts?.userData
													? { userData: enqueueOpts.userData }
													: {},
											});
										}
									} else {
										links.push({
											url: absUrl,
											opts: enqueueOpts?.userData
												? { userData: enqueueOpts.userData }
												: {},
										});
									}
								} catch {
									// Ignore
								}
							}
						});
						if (links.length > 0) {
							self.postMessage({ type: "addRequests", id, urls: links });
						}
					},
					pushData: async (data: any) => {
						self.postMessage({ type: "pushData", id, data });
					},
					log: (msg: string) => {
						self.postMessage({ type: "log", id, message: msg });
					},
				};

				await handler(context);

				self.postMessage({ type: "done", id });
			} catch (err) {
				self.postMessage({ type: "error", id, error: String(err) });
			} finally {
				await page.close();
			}
		} catch (err) {
			self.postMessage({ type: "error", id, error: String(err) });
		}
	}
};
