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
 * @module bunlight/google/mass-scanner
 * 
 * Massive Google Stealth Crawler: 5656+ pages audit with real-time DNS/CDN analysis.
 * Optimized for high-concurrency and resilience.
 */

import { Browser, Page } from "../api/browser.ts";
import { auditNetwork, identifyInfraFromHeaders, type NetworkAuditResult } from "../utils/network-auditor.ts";
import { detectGoogleSpecifics, type GoogleDetection } from "./detector.ts";
import { sharedCache } from "./cache.ts";

export interface PageAudit {
	url: string;
	title: string;
	status: number;
	dns: NetworkAuditResult;
	cdn?: string;
	server?: string;
	google?: GoogleDetection;
	timestamp: string;
	links?: string[];
}

export class GoogleMassScanner {
	#concurrency: number;
	#results: Map<string, PageAudit> = new Map();
	#queue: string[] = [];
	#visited: Set<string> = new Set();
	#maxPages: number;
	#onProgress?: (audit: PageAudit, current: number, total: number) => void;

	constructor(opts: { 
		concurrency?: number; 
		maxPages?: number; 
		onProgress?: (audit: PageAudit, current: number, total: number) => void 
	} = {}) {
		this.#concurrency = opts.concurrency ?? 24;
		this.#maxPages = opts.maxPages ?? 5656;
		this.#onProgress = opts.onProgress;
	}

	async scan(seeds: string[]): Promise<PageAudit[]> {
		this.#queue = [...seeds];
		const workers = Array.from({ length: this.#concurrency }).map(() => this.#worker());
		await Promise.all(workers);
		return Array.from(this.#results.values());
	}

	async #worker() {
		while (this.#queue.length > 0 && this.#results.size < this.#maxPages) {
			const url = this.#queue.shift();
			if (!url || this.#visited.has(url)) continue;
			this.#visited.add(url);

			try {
				// 1. Check cache first
				const cached = sharedCache().get<PageAudit>(url);
				if (cached) {
					this.#results.set(url, cached);
					this.#onProgress?.(cached, this.#results.size, this.#maxPages);
					// Add cached links to queue
					if (this.#results.size < this.#maxPages && cached.links) {
						for (const link of cached.links) {
							if (!this.#visited.has(link) && this.#queue.length < 10000) {
								this.#queue.push(link);
							}
						}
					}
					continue;
				}

				const audit = await this.#auditPageWithRetry(url);
				if (audit) {
					this.#results.set(url, audit);
					sharedCache().set(url, audit); // Cache result
					this.#onProgress?.(audit, this.#results.size, this.#maxPages);
					
					// Discover more links
					if (this.#results.size < this.#maxPages && audit.links) {
						for (const link of audit.links) {
							if (!this.#visited.has(link) && this.#queue.length < 10000) {
								this.#queue.push(link);
							}
						}
					}
				}
			} catch {
				// Skip individual page error without crashing worker
			}
		}
	}

	async #auditPageWithRetry(url: string, attempts = 3): Promise<PageAudit | null> {
		let lastError: any;
		for (let i = 0; i < attempts; i++) {
			try {
				return await this.#auditPage(url);
			} catch (e) {
				lastError = e;
				if (i < attempts - 1) {
					await Bun.sleep(1000 * Math.pow(2, i)); // Exponential backoff
				}
			}
		}
		console.error(`[error] Failed to audit ${url} after ${attempts} attempts:`, lastError?.message || lastError);
		return null;
	}

	async #auditPage(url: string): Promise<PageAudit> {
		const page = (await Browser.newPage({ 
			profile: "stealth",
			spawnOpts: {
				readyTimeoutMs: 15000,
			}
		})) as Page;
		
		try {
			const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
			const title = await page.title();
			const content = await page.content();
			const hostname = new URL(url).hostname;
			
			const dnsResult = await auditNetwork(hostname);
			const infra = identifyInfraFromHeaders((resp as any).headers ?? {});
			const googleDet = detectGoogleSpecifics(url, new Headers((resp as any).headers), content);

			// Extract links for discovery
			const links = await page.evaluate(() => {
				const googleSubstrings = [
					'google', 'material.io', 'web.dev', 'angular', 'flutter', 'dart.dev', 
					'firebase', 'tensorflow', 'go.dev', 'chrome', 'android', 'lit.dev',
					'gwtproject.org', 'polymer-project.org'
				];
				return Array.from(document.querySelectorAll('a[href]'))
					.map(a => (a as HTMLAnchorElement).href)
					.filter(href => {
						const l = href.toLowerCase();
						return l.startsWith('http') && googleSubstrings.some(s => l.includes(s));
					});
			}) as string[];

			return {
				url,
				title,
				status: resp.status,
				dns: dnsResult,
				cdn: infra.cdn ?? dnsResult.cdn,
				server: infra.server ?? dnsResult.server,
				google: googleDet,
				timestamp: new Date().toISOString(),
				links,
			};
		} finally {
			await page.close().catch(() => {});
		}
	}

	get results() {
		return Array.from(this.#results.values());
	}

	generateSitemap(): string {
		let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
		for (const audit of this.#results.values()) {
			xml += `  <url>\n    <loc>${Bun.escapeHTML(audit.url)}</loc>\n    <lastmod>${audit.timestamp.split('T')[0]}</lastmod>\n  </url>\n`;
		}
		xml += '</urlset>';
		return xml;
	}
}
