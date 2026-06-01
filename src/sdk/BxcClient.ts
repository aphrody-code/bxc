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

export interface CrawlOptions {
	allowedDomains?: string[];
	maxDepth?: number;
	maxRequests?: number;
	profile?: "static" | "fast" | "stealth" | "max";
}

export interface CrawlStats {
	pending: number;
	locked: number;
	done: number;
	failed: number;
	total: number;
}

export interface PageResponse {
	url: string;
	title: string;
	status: number;
	markdown: string;
	structured: any;
	openapi: any;
	vector?: number[];
	timestamp: string;
}

export interface SemanticSearchResult {
	url: string;
	metadata: any;
	markdown: string;
	similarity: number;
}

export interface KeywordSearchResult {
	url: string;
	profile: string;
	status: number;
	metadata: any;
	markdown: string;
	timestamp: string;
	rank: number;
}

export interface BxcClientConfig {
	endpoint?: string;
	apiKey?: string;
}

export class BxcClient {
	private endpoint: string;
	private apiKey?: string;

	constructor(config: BxcClientConfig = {}) {
		this.endpoint = config.endpoint ?? process.env.BXC_API_ENDPOINT ?? "http://localhost:3000";
		this.apiKey = config.apiKey ?? process.env.BXC_API_KEY;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.endpoint}${path}`;
		const headers = new Headers(options.headers);
		if (this.apiKey) {
			headers.set("Authorization", `Bearer ${this.apiKey}`);
		}
		headers.set("Content-Type", "application/json");

		const response = await fetch(url, {
			...options,
			headers
		});

		if (!response.ok) {
			throw new Error(`Bxc SDK Error [${response.status}]: ${await response.text()}`);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Enqueue a list of URLs for recursive crawling.
	 * Executes asynchronously in the background.
	 */
	async crawl(urls: string[], options: CrawlOptions = {}): Promise<{ success: boolean; message: string; stats: CrawlStats }> {
		return this.request("/api/v1/crawl", {
			method: "POST",
			body: JSON.stringify({
				urls,
				...options
			})
		});
	}

	/**
	 * Retrieve stats for the active background crawler.
	 */
	async getCrawlStats(): Promise<{ success: boolean; stats: CrawlStats }> {
		return this.request("/api/v1/crawl/stats");
	}

	/**
	 * Retrieve the structured page data for a URL. If not cached, triggers on-demand crawl.
	 */
	async getPage(url: string, options: { force?: boolean } = {}): Promise<PageResponse> {
		const query = new URLSearchParams({
			url,
			force: options.force ? "true" : "false"
		}).toString();
		
		const res = await this.request<{ success: boolean; data: PageResponse }>(`/api/v1/page?${query}`);
		if (!res.success) {
			throw new Error(`Failed to retrieve page data for ${url}`);
		}
		return res.data;
	}

	/**
	 * Retrieve GFM Markdown content of a crawled URL.
	 */
	async getMarkdown(url: string): Promise<string> {
		const query = new URLSearchParams({ url }).toString();
		return this.request<string>(`/api/v1/page/markdown?${query}`);
	}

	/**
	 * Retrieve the well-typed OpenAPI schema generated for a crawled URL.
	 */
	async getOpenApi(url: string): Promise<any> {
		const query = new URLSearchParams({ url }).toString();
		return this.request<any>(`/api/v1/page/openapi?${query}`);
	}

	/**
	 * Retrieve the TypeScript interface definitions representing the schema of a crawled URL.
	 */
	async getTypes(url: string): Promise<string> {
		const query = new URLSearchParams({ url }).toString();
		return this.request<string>(`/api/v1/page/types?${query}`);
	}

	/**
	 * Run a semantic vector similarity search across all crawled pages.
	 */
	async searchSemantic(queryText: string, limit = 5): Promise<{ success: boolean; query: string; results: SemanticSearchResult[] }> {
		const query = new URLSearchParams({
			q: queryText,
			limit: String(limit)
		}).toString();
		return this.request<{ success: boolean; query: string; results: SemanticSearchResult[] }>(`/api/v1/search/semantic?${query}`);
	}

	/**
	 * Run a full-text keyword search across all crawled pages using FTS5.
	 */
	async searchKeyword(queryText: string, limit = 10): Promise<{ success: boolean; query: string; results: KeywordSearchResult[] }> {
		const query = new URLSearchParams({
			q: queryText,
			limit: String(limit)
		}).toString();
		return this.request<{ success: boolean; query: string; results: KeywordSearchResult[] }>(`/api/v1/search/keyword?${query}`);
	}

	/**
	 * Get a list of failed crawler requests from the dead-letter queue.
	 */
	async getFailedCrawls(): Promise<{ success: boolean; count: number; failed: any[] }> {
		return this.request("/api/v1/crawl/failed");
	}

	/**
	 * Replay/retry all failed crawler requests in the dead-letter queue.
	 */
	async replayFailedCrawls(): Promise<{ success: boolean; message: string; stats: CrawlStats }> {
		return this.request("/api/v1/crawl/replay", {
			method: "POST"
		});
	}

	/**
	 * Query Bxc using GraphQL instead of REST.
	 */
	async graphql<T>(query: string, variables?: Record<string, any>): Promise<T> {
		const res = await this.request<{ data: T; errors?: any[] }>("/graphql", {
			method: "POST",
			body: JSON.stringify({ query, variables })
		});

		if (res.errors && res.errors.length > 0) {
			throw new Error(`GraphQL Error: ${JSON.stringify(res.errors)}`);
		}

		return res.data;
	}
}
