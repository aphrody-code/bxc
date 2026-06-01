import "reflect-metadata";
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { logger } from "@bogeychan/elysia-logger";
import { createYoga } from "graphql-yoga";
import { buildSchema } from "type-graphql";
import { ScrapeResolver } from "./graphql/resolvers/ScrapeResolver.ts";
import { FutResolver } from "@aphrody-code/bxc/scrapers/fut";
import { Browser } from "../api/browser.ts";
import { AutonomousCrawler } from "../crawler/AutonomousCrawler.ts";
import { BxcDB } from "../db/BxcDB.ts";
import { RequestQueue } from "../queue/RequestQueue.ts";
import { redis } from "bun";

function classifyPlayer(player: any) {
	const tags: string[] = [];
	if (!player) return tags;

	// Pace Classification
	if (player.pac >= 90) tags.push("Speedster");
	else if (player.pac >= 80) tags.push("Fast");

	// Shooting Classification
	if (player.sho >= 85) tags.push("Clinical Finisher");

	// Playmaker Classification
	if (player.pas >= 85 && player.dri >= 85) tags.push("Elite Playmaker");

	// Defensive Classification
	if (player.def >= 85 && player.phy >= 85) tags.push("Defensive Wall");

	// Goalkeeper Classification
	if (player.div >= 85 && player.ref >= 85) tags.push("Wall GK");

	// Playstyles Classification
	let psPlus = player.playstylesPlus;
	if (typeof psPlus === "string") {
		try {
			psPlus = JSON.parse(psPlus);
		} catch {}
	}
	if (Array.isArray(psPlus) && psPlus.length > 0) {
		tags.push("Playstyles+ Star");
	}

	return tags;
}

async function bootstrap() {
	// 1. Build Type-GraphQL Schema
	const schema = await buildSchema({
		resolvers: [ScrapeResolver, FutResolver],
		validate: false,
	});

	const yoga = createYoga({ schema });

	// 2. Initialize Elysia
	const app = new Elysia()
		.use(cors())
		.use(logger())
		.use(
			swagger({
				path: "/swagger",
				documentation: {
					info: {
						title: "Bxc API",
						description:
							"High-performance browser automation (REST + Type-GraphQL + Drizzle)",
						version: "0.2.0",
					},
				},
			}),
		)

		// --- Static Routes & WBO Analytics ---
		.get("/", () => Bun.file("src/server/dashboard.html"))
		.get("/health", () => "OK")
		.get("/api/v1/rankings", () => Bun.file("data/wbo_rankings_parsed.json"))
		.get("/api/v1/metagame", () => Bun.file("data/bbx_metagame_data.json"))

		// --- REST API ---
		.group("/api/v1", (app) =>
			app
				.post(
					"/scrape",
					async ({ body }) => {
						const { url, profile } = body as { url: string; profile?: string };
						const page = await Browser.newPage({
							profile: (profile || "static") as any,
						});
						try {
							const res = await page.goto(url);
							return {
								url,
								status: res.status,
								title: await page.title(),
								content: await page.content(),
							};
						} finally {
							await page.close();
						}
					},
					{
						body: t.Object({
							url: t.String(),
							profile: t.Optional(t.String()),
						}),
					},
				)
				.post(
					"/crawl",
					async ({ body }) => {
						const { urls, allowedDomains, maxDepth, maxRequests, profile } = body as {
							urls: string[];
							allowedDomains?: string[];
							maxDepth?: number;
							maxRequests?: number;
							profile?: "static" | "fast" | "stealth" | "max";
						};
						
						const crawler = new AutonomousCrawler({
							allowedDomains,
							maxDepth,
							maxRequests,
							profile,
						});

						crawler.run(urls).catch((err) => {
							console.error("[background-crawler] Error running crawl:", err);
						});

						return {
							success: true,
							message: "Recursive crawl started in the background",
							stats: crawler.stats(),
						};
					},
					{
						body: t.Object({
							urls: t.Array(t.String()),
							allowedDomains: t.Optional(t.Array(t.String())),
							maxDepth: t.Optional(t.Number()),
							maxRequests: t.Optional(t.Number()),
							profile: t.Optional(t.String()),
						}),
					},
				)
				.get("/crawl/stats", async () => {
					const queue = RequestQueue.open("bxc-autonomous-crawler");
					const stats = queue.stats();
					queue.close();
					return { success: true, stats };
				})
				.get(
					"/page",
					async ({ query }) => {
						const url = query.url;
						const force = query.force === "true";
						
						if (!force) {
							const cached = await redis.get(`bxc:cache:url:${url}`);
							if (cached) {
								return { success: true, source: "redis", data: JSON.parse(cached) };
							}

							const db = new BxcDB();
							try {
								const row = db.getScrapeByUrl(url);
								if (row) {
									const data = {
										url: row.url,
										title: row.metadata ? JSON.parse(row.metadata).title || "" : "",
										status: row.status,
										markdown: row.markdown || "",
										structured: row.json_data ? JSON.parse(row.json_data) : null,
										openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
										timestamp: row.timestamp,
									};
									await redis.set(`bxc:cache:url:${url}`, JSON.stringify(data), "EX", 86400);
									return { success: true, source: "sqlite", data };
								}
							} finally {
								db.close();
							}
						}

						const crawler = new AutonomousCrawler({ maxRequests: 1 });
						await crawler.run([url]);
						
						const db = new BxcDB();
						try {
							const row = db.getScrapeByUrl(url);
							if (row) {
								return {
									success: true,
									source: "live-crawl",
									data: {
										url: row.url,
										title: row.metadata ? JSON.parse(row.metadata).title || "" : "",
										status: row.status,
										markdown: row.markdown || "",
										structured: row.json_data ? JSON.parse(row.json_data) : null,
										openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
										timestamp: row.timestamp,
									}
								};
							}
						} finally {
							db.close();
						}

						return { success: false, error: "Failed to scrape page" };
					},
					{
						query: t.Object({
							url: t.String(),
							force: t.Optional(t.String()),
						}),
					},
				)
				.get(
					"/page/openapi",
					async ({ query }) => {
						const url = query.url;
						const res = await redis.get(`bxc:cache:url:${url}`);
						if (res) {
							return JSON.parse(res).openapi;
						}
						
						const db = new BxcDB();
						try {
							const row = db.getScrapeByUrl(url);
							if (row && row.openapi_spec) {
								return JSON.parse(row.openapi_spec);
							}
						} finally {
							db.close();
						}

						const crawler = new AutonomousCrawler({ maxRequests: 1 });
						await crawler.run([url]);
						
						const db2 = new BxcDB();
						try {
							const row = db2.getScrapeByUrl(url);
							if (row && row.openapi_spec) {
								return JSON.parse(row.openapi_spec);
							}
						} finally {
							db2.close();
						}
						
						return { error: "OpenAPI schema not available for this URL" };
					},
					{
						query: t.Object({
							url: t.String(),
						}),
					},
				)
				.get(
					"/page/markdown",
					async ({ query }) => {
						const url = query.url;
						const res = await redis.get(`bxc:cache:url:${url}`);
						if (res) {
							return JSON.parse(res).markdown;
						}
						
						const db = new BxcDB();
						try {
							const row = db.getScrapeByUrl(url);
							if (row && row.markdown) {
								return row.markdown;
							}
						} finally {
							db.close();
						}

						const crawler = new AutonomousCrawler({ maxRequests: 1 });
						await crawler.run([url]);
						
						const db2 = new BxcDB();
						try {
							const row = db2.getScrapeByUrl(url);
							if (row && row.markdown) {
								return row.markdown;
							}
						} finally {
							db2.close();
						}
						
						return "Markdown not available for this URL";
					},
					{
						query: t.Object({
							url: t.String(),
						}),
					},
				)
				.get(
					"/fut/player",
					async ({ query }) => {
						const { url, profile } = query as { url: string; profile?: string };
						const { scrapeFutGgPlayer } = await import(
							"@aphrody-code/bxc/scrapers/fut"
						);
						try {
							const data = await scrapeFutGgPlayer(
								url,
								(profile || "static") as any,
							);
							return {
								success: true,
								data: {
									...data,
									classifications: classifyPlayer(data),
								},
							};
						} catch (e: any) {
							return { success: false, error: e.message };
						}
					},
					{
						query: t.Object({
							url: t.String(),
							profile: t.Optional(t.String()),
						}),
					},
				)
				.get(
					"/fut/price",
					async ({ query }) => {
						const { url, profile } = query as { url: string; profile?: string };
						const { scrapeFutBinPrice } = await import(
							"@aphrody-code/bxc/scrapers/fut"
						);
						try {
							const data = await scrapeFutBinPrice(
								url,
								(profile || "ghost") as any,
							);
							return { success: true, data };
						} catch (e: any) {
							return { success: false, error: e.message };
						}
					},
					{
						query: t.Object({
							url: t.String(),
							profile: t.Optional(t.String()),
						}),
					},
				)
				.get(
					"/fut/players",
					async ({ query }) => {
						const { Database } = await import("bun:sqlite");
						const { join } = await import("node:path");
						const dbPath = join(
							import.meta.dir,
							"../../packages/fut/src/data/fut_extracted_database.sqlite",
						);
						const db = new Database(dbPath);

						let sql = "SELECT * FROM players WHERE 1=1";
						const params: Record<string, any> = {};

						if (query.rating_min) {
							sql += " AND rating >= $rating_min";
							params["$rating_min"] = parseInt(query.rating_min, 10);
						}
						if (query.rating_max) {
							sql += " AND rating <= $rating_max";
							params["$rating_max"] = parseInt(query.rating_max, 10);
						}
						if (query.position) {
							sql += " AND position = $position";
							params["$position"] = query.position;
						}
						if (query.club) {
							sql += " AND club LIKE $club";
							params["$club"] = `%${query.club}%`;
						}
						if (query.nation) {
							sql += " AND nation LIKE $nation";
							params["$nation"] = `%${query.nation}%`;
						}
						if (query.league) {
							sql += " AND league LIKE $league";
							params["$league"] = `%${query.league}%`;
						}
						if (query.rarity) {
							sql += " AND rarity LIKE $rarity";
							params["$rarity"] = `%${query.rarity}%`;
						}
						if (query.gender) {
							sql += " AND gender = $gender";
							params["$gender"] = query.gender;
						}
						if (query.foot) {
							sql += " AND foot = $foot";
							params["$foot"] = query.foot;
						}

						const allowedSorts = [
							"overall_rating",
							"rating",
							"pac",
							"sho",
							"pas",
							"dri",
							"def",
							"phy",
						];
						const sortBy = allowedSorts.includes(query.sort_by || "")
							? query.sort_by
							: "rating";
						const sortOrder =
							(query.sort_order || "").toLowerCase() === "asc" ? "ASC" : "DESC";
						sql += ` ORDER BY ${sortBy} ${sortOrder}`;

						const limit = parseInt(query.limit || "50", 10);
						const offset = parseInt(query.offset || "0", 10);
						sql += " LIMIT $limit OFFSET $offset";
						params["$limit"] = limit;
						params["$offset"] = offset;

						try {
							const rows = db.query(sql).all(params) as any[];
							const enrichedRows = rows.map((row) => ({
								...row,
								classifications: classifyPlayer(row),
							}));
							return { success: true, count: rows.length, data: enrichedRows };
						} catch (e: any) {
							return { success: false, error: e.message };
						}
					},
					{
						query: t.Object({
							rating_min: t.Optional(t.String()),
							rating_max: t.Optional(t.String()),
							position: t.Optional(t.String()),
							club: t.Optional(t.String()),
							nation: t.Optional(t.String()),
							league: t.Optional(t.String()),
							rarity: t.Optional(t.String()),
							gender: t.Optional(t.String()),
							foot: t.Optional(t.String()),
							sort_by: t.Optional(t.String()),
							sort_order: t.Optional(t.String()),
							limit: t.Optional(t.String()),
							offset: t.Optional(t.String()),
						}),
					},
				)
				.get("/fut/stats/summary", async () => {
					const { Database } = await import("bun:sqlite");
					const { join } = await import("node:path");
					const dbPath = join(
						import.meta.dir,
						"../../packages/fut/src/data/fut_extracted_database.sqlite",
					);
					try {
						const db = new Database(dbPath);
						const totalPlayers = db
							.query("SELECT COUNT(*) as count FROM players")
							.get() as any;
						const totalPrices = db
							.query("SELECT COUNT(*) as count FROM prices")
							.get() as any;
						const avgOverall = db
							.query(
								"SELECT AVG(overall_rating) as avg FROM players WHERE overall_rating IS NOT NULL",
							)
							.get() as any;

						const positionCounts = db
							.query(
								"SELECT position, COUNT(*) as count FROM players GROUP BY position ORDER BY count DESC",
							)
							.all() as any[];
						const rarityCounts = db
							.query(
								"SELECT rarity, COUNT(*) as count FROM players WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY count DESC LIMIT 10",
							)
							.all() as any[];
						const genderCounts = db
							.query(
								"SELECT gender, COUNT(*) as count FROM players WHERE gender IS NOT NULL GROUP BY gender",
							)
							.all() as any[];

						return {
							success: true,
							summary: {
								total_players_crawled: totalPlayers?.count || 0,
								total_prices_tracked: totalPrices?.count || 0,
								average_overall_rating:
									Math.round((avgOverall?.avg || 0) * 10) / 10,
								positions: positionCounts,
								rarities: rarityCounts,
								genders: genderCounts,
							},
						};
					} catch (e: any) {
						return { success: false, error: e.message };
					}
				}),
		)

		// --- GraphQL API ---
		.all("/graphql", async ({ request }) => yoga.handle(request))

		.listen(process.env.PORT || 3000);

	console.log(
		"🚀 Bxc API (Production Ready) running at " +
			app.server?.hostname +
			":" +
			app.server?.port,
	);
}

bootstrap();
