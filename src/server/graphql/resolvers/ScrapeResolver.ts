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

import "reflect-metadata";
import {
	Resolver,
	Query,
	Mutation,
	Arg,
	ObjectType,
	Field,
	ID,
	Int,
} from "type-graphql";
import { Browser } from "../../../api/browser.ts";
import { BxcDB } from "../../db/BxcDB.ts";
import { AutonomousCrawler } from "../../../crawler/AutonomousCrawler.ts";
import { RequestQueue } from "../../../queue/RequestQueue.ts";
import { redis } from "bun";
import { generateTypeScriptTypes } from "../../../utils/typegen.ts";
import { getEmbedding, cosineSimilarity } from "../../../utils/vector.ts";

const db = new BxcDB();

@ObjectType()
export class Scrape {
	@Field(() => ID)
	id!: number;

	@Field()
	url!: string;

	@Field()
	profile!: string;

	@Field(() => Int, { nullable: true })
	status?: number;

	@Field({ nullable: true })
	content?: string;

	@Field({ nullable: true })
	markdown?: string;

	@Field({ nullable: true })
	jsonData?: string;

	@Field({ nullable: true })
	openapiSpec?: string;

	@Field({ nullable: true })
	vector?: string; // JSON float array

	@Field()
	createdAt!: string;
}

@ObjectType()
export class QueueStats {
	@Field(() => Int)
	pending!: number;

	@Field(() => Int)
	locked!: number;

	@Field(() => Int)
	done!: number;

	@Field(() => Int)
	failed!: number;

	@Field(() => Int)
	total!: number;
}

@ObjectType()
export class CrawlResult {
	@Field()
	success!: boolean;

	@Field()
	message!: string;

	@Field(() => QueueStats)
	stats!: QueueStats;
}

@ObjectType()
export class SemanticSearchResult {
	@Field()
	url!: string;

	@Field({ nullable: true })
	metadata?: string; // JSON string

	@Field()
	markdown!: string;

	@Field()
	similarity!: number;
}

@ObjectType()
export class KeywordSearchResult {
	@Field()
	url!: string;

	@Field()
	profile!: string;

	@Field(() => Int, { nullable: true })
	status?: number;

	@Field({ nullable: true })
	metadata?: string; // JSON string

	@Field()
	markdown!: string;

	@Field()
	createdAt!: string;

	@Field()
	rank!: number;
}

@ObjectType()
export class FailedCrawl {
	@Field(() => ID)
	id!: number;

	@Field()
	url!: string;

	@Field()
	method!: string;

	@Field(() => Int)
	retries!: number;

	@Field({ nullable: true })
	errorMessage?: string;

	@Field()
	createdAt!: string;

	@Field({ nullable: true })
	handledAt?: string;
}

interface ScrapeRow {
	id: number;
	url: string;
	profile: string;
	status: number | null;
	content: string | null;
	metadata: string | null;
	markdown: string | null;
	json_data: string | null;
	openapi_spec: string | null;
	vector: string | null;
	timestamp: string | null;
}

@Resolver(Scrape)
export class ScrapeResolver {
	@Query(() => [Scrape])
	async recentScrapes(
		@Arg("limit", () => Int, { defaultValue: 10 }) limit: number,
	): Promise<Scrape[]> {
		const results = db.getRecentScrapes(limit) as ScrapeRow[];
		return results.map((r) => ({
			id: r.id,
			url: r.url,
			profile: r.profile,
			status: r.status ?? undefined,
			content: r.content ?? undefined,
			markdown: r.markdown ?? undefined,
			jsonData: r.json_data ?? undefined,
			openapiSpec: r.openapi_spec ?? undefined,
			vector: r.vector ?? undefined,
			createdAt: r.timestamp ?? new Date().toISOString(),
		}));
	}

	@Query(() => Scrape, { nullable: true })
	async page(
		@Arg("url") url: string,
		@Arg("force", { defaultValue: false }) force: boolean,
	): Promise<Scrape | null> {
		if (!force) {
			const cached = await redis.get(`bxc:cache:url:${url}`);
			if (cached) {
				const parsed = JSON.parse(cached);
				return {
					id: 0,
					url: parsed.url,
					profile: "cache",
					status: parsed.status,
					markdown: parsed.markdown,
					jsonData: JSON.stringify(parsed.structured),
					openapiSpec: JSON.stringify(parsed.openapi),
					vector: parsed.vector ? JSON.stringify(parsed.vector) : undefined,
					createdAt: parsed.timestamp || new Date().toISOString()
				};
			}

			const row = db.getScrapeByUrl(url) as ScrapeRow;
			if (row) {
				return {
					id: row.id,
					url: row.url,
					profile: row.profile,
					status: row.status ?? undefined,
					content: row.content ?? undefined,
					markdown: row.markdown ?? undefined,
					jsonData: row.json_data ?? undefined,
					openapiSpec: row.openapi_spec ?? undefined,
					vector: row.vector ?? undefined,
					createdAt: row.timestamp ?? new Date().toISOString(),
				};
			}
		}

		// Scrape live if not cached or forced
		const crawler = new AutonomousCrawler({ maxRequests: 1 });
		await crawler.run([url]);

		const row = db.getScrapeByUrl(url) as ScrapeRow;
		if (row) {
			return {
				id: row.id,
				url: row.url,
				profile: row.profile,
				status: row.status ?? undefined,
				content: row.content ?? undefined,
				markdown: row.markdown ?? undefined,
				jsonData: row.json_data ?? undefined,
				openapiSpec: row.openapi_spec ?? undefined,
				vector: row.vector ?? undefined,
				createdAt: row.timestamp ?? new Date().toISOString(),
			};
		}
		return null;
	}

	@Query(() => QueueStats)
	async crawlStats(): Promise<QueueStats> {
		const queue = RequestQueue.open("bxc-autonomous-crawler");
		const stats = queue.stats();
		queue.close();
		return {
			pending: stats.pending || 0,
			locked: stats.locked || 0,
			done: stats.done || 0,
			failed: stats.failed || 0,
			total: stats.total || 0,
		};
	}

	@Query(() => String)
	async types(@Arg("url") url: string): Promise<string> {
		const res = await redis.get(`bxc:cache:url:${url}`);
		let openapi: any = null;
		let title = "PageData";
		if (res) {
			const parsed = JSON.parse(res);
			openapi = parsed.openapi;
			title = parsed.title || title;
		} else {
			const row = db.getScrapeByUrl(url) as ScrapeRow;
			if (row && row.openapi_spec) {
				openapi = JSON.parse(row.openapi_spec);
				title = row.metadata ? JSON.parse(row.metadata).title || title : title;
			}
		}

		if (!openapi) {
			const crawler = new AutonomousCrawler({ maxRequests: 1 });
			await crawler.run([url]);
			const row = db.getScrapeByUrl(url) as ScrapeRow;
			if (row && row.openapi_spec) {
				openapi = JSON.parse(row.openapi_spec);
				title = row.metadata ? JSON.parse(row.metadata).title || title : title;
			}
		}

		if (!openapi) {
			throw new Error(`OpenAPI schema not available for ${url}`);
		}

		const safeInterfaceName = title.replace(/[^a-zA-Z0-9]/g, "") || "ScrapedData";
		return generateTypeScriptTypes(openapi, safeInterfaceName);
	}

	@Query(() => [SemanticSearchResult])
	async semanticSearch(
		@Arg("q") q: string,
		@Arg("limit", () => Int, { defaultValue: 5 }) limit: number,
	): Promise<SemanticSearchResult[]> {
		const queryVector = await getEmbedding(q);
		const rows = db.getAllScrapesWithVectors();
		
		const results = rows.map((r) => {
			let vectorParsed: number[] = [];
			try { vectorParsed = JSON.parse(r.vector); } catch {}

			const similarity = cosineSimilarity(queryVector, vectorParsed);
			return {
				url: r.url,
				metadata: r.metadata ?? undefined,
				markdown: r.markdown ? r.markdown.slice(0, 300) + "..." : "",
				similarity
			};
		});

		// Sort by similarity descending
		results.sort((a, b) => b.similarity - a.similarity);
		return results.slice(0, limit);
	}

	@Query(() => [KeywordSearchResult])
	async keywordSearch(
		@Arg("q") q: string,
		@Arg("limit", () => Int, { defaultValue: 10 }) limit: number,
	): Promise<KeywordSearchResult[]> {
		const rows = db.searchFullText(q, limit);
		return rows.map((r) => ({
			url: r.url,
			profile: r.profile,
			status: r.status ?? undefined,
			metadata: r.metadata ?? undefined,
			markdown: r.markdown ? r.markdown.slice(0, 300) + "..." : "",
			createdAt: r.timestamp ?? new Date().toISOString(),
			rank: r.rank
		}));
	}

	@Query(() => [FailedCrawl])
	async failedCrawls(): Promise<FailedCrawl[]> {
		const crawler = new AutonomousCrawler();
		const failed = crawler.deadLetterQueue();
		return failed.map((req) => ({
			id: req.id,
			url: req.url,
			method: req.method,
			retries: req.retries,
			errorMessage: req.errorMessage ?? undefined,
			createdAt: new Date(req.createdAt).toISOString(),
			handledAt: req.handledAt ? new Date(req.handledAt).toISOString() : undefined,
		}));
	}

	@Query(() => String)
	health(): string {
		return "⚡️ Bxc API (Autonomous Crawler GraphQL) is healthy";
	}

	@Mutation(() => Scrape)
	async scrape(
		@Arg("url") url: string,
		@Arg("profile", { nullable: true }) profile?: string,
	): Promise<Scrape> {
		const resolvedProfile = profile || "static";
		const page = await Browser.newPage({ profile: resolvedProfile as any });
		try {
			const res = await page.goto(url);
			const content = await page.content();
			const title = await page.title();

			const changes = db.saveScrape(url, resolvedProfile, res.status, content, {
				title,
			});
			const id = Number(changes.lastInsertRowid);

			return {
				id,
				url,
				profile: resolvedProfile,
				status: res.status,
				content,
				createdAt: new Date().toISOString(),
			};
		} finally {
			await page.close();
		}
	}

	@Mutation(() => CrawlResult)
	async startCrawl(
		@Arg("urls", () => [String]) urls: string[],
		@Arg("allowedDomains", () => [String], { nullable: true }) allowedDomains?: string[],
		@Arg("maxDepth", () => Int, { nullable: true }) maxDepth?: number,
		@Arg("maxRequests", () => Int, { nullable: true }) maxRequests?: number,
		@Arg("profile", { nullable: true }) profile?: string,
	): Promise<CrawlResult> {
		const crawler = new AutonomousCrawler({
			allowedDomains: allowedDomains || undefined,
			maxDepth: maxDepth || undefined,
			maxRequests: maxRequests || undefined,
			profile: (profile || "stealth") as any,
		});

		crawler.run(urls).catch((err) => {
			console.error("[background-crawler] Error running crawl from GraphQL:", err);
		});

		const stats = crawler.stats();

		return {
			success: true,
			message: "Autonomous crawler started in background",
			stats: {
				pending: stats.pending || 0,
				locked: stats.locked || 0,
				done: stats.done || 0,
				failed: stats.failed || 0,
				total: stats.total || 0,
			}
		};
	}

	@Mutation(() => CrawlResult)
	async replayFailedCrawls(): Promise<CrawlResult> {
		const crawler = new AutonomousCrawler();
		const count = crawler.replayFailed();
		const stats = crawler.stats();
		return {
			success: true,
			message: `Requeued ${count} failed requests from the dead-letter queue.`,
			stats: {
				pending: stats.pending || 0,
				locked: stats.locked || 0,
				done: stats.done || 0,
				failed: stats.failed || 0,
				total: stats.total || 0,
			}
		};
	}
}
