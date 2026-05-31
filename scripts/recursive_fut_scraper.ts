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

import { scrapeFutGgPlayer } from "../src/scrapers/fut/futgg.ts";
import { scrapeFutBinPrice } from "../src/scrapers/fut/futbin.ts";
import { Browser } from "../src/api/browser.ts";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const RUN_LIVE = !process.env.SKIP_NETWORK_TESTS;
const MAX_DEPTH = process.env.MAX_DEPTH
	? parseInt(process.env.MAX_DEPTH, 10)
	: Infinity;
const MAX_PAGES = process.env.MAX_PAGES
	? parseInt(process.env.MAX_PAGES, 10)
	: Infinity;
const DELAY_MS = process.env.DELAY_MS
	? parseInt(process.env.DELAY_MS, 10)
	: 1000;

interface CrawlState {
	visitedHashes: Set<number>;
	players: any[];
	prices: any[];
	errors: number;
	success: number;
}

// Helper to extract player ID from URL
function getPlayerIdFromUrl(url: string): string {
	const match = /\/players\/(\d+)/.exec(url);
	if (match && match[1]) {
		return match[1];
	}
	const matchBin = /\/player\/(\d+)/.exec(url);
	if (matchBin && matchBin[1]) {
		return matchBin[1];
	}
	return Bun.hash.wyhash(url).toString();
}

async function runRecursiveScraper() {
	if (!RUN_LIVE) {
		console.log(
			"[SKIP] SKIP_NETWORK_TESTS=1 is set, skipping recursive scrape loop.",
		);
		return;
	}

	const mappingPath = join(import.meta.dir, "../data/fut_domains_mapping.json");
	const mappingFile = Bun.file(mappingPath);
	if (!(await mappingFile.exists())) {
		console.error("Mapping file fut_domains_mapping.json not found!");
		process.exit(1);
	}

	const mapping = await mappingFile.json();

	// Collect allowed domains and seed URLs
	const allowedDomains: string[] = [];
	const queue: Array<{ url: string; depth: number }> = [];

	for (const key of Object.keys(mapping)) {
		const config = mapping[key];
		if (config.domains) {
			allowedDomains.push(...config.domains);
		}
		const seeds = config.seed_urls || [];
		for (const s of seeds) {
			queue.push({ url: s, depth: 1 });
		}
	}

	// 1. Initialize native SQLite Database
	const dbDir = join(import.meta.dir, "../data");
	const dbPath = join(dbDir, "fut_extracted_database.sqlite");
	const db = new Database(dbPath);

	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		
		CREATE TABLE IF NOT EXISTS visited_urls (
			url_hash INTEGER PRIMARY KEY,
			url TEXT NOT NULL,
			crawled_at TEXT NOT NULL,
			status TEXT NOT NULL
		);
		
		CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			rating INTEGER NOT NULL,
			position TEXT NOT NULL,
			club TEXT,
			nation TEXT,
			league TEXT,
			playstyles TEXT NOT NULL,
			playstyles_plus TEXT,
			pac INTEGER,
			sho INTEGER,
			pas INTEGER,
			dri INTEGER,
			def INTEGER,
			phy INTEGER,
			div INTEGER,
			han INTEGER,
			kic INTEGER,
			ref INTEGER,
			spd INTEGER,
			pos INTEGER,
			skill_moves INTEGER,
			weak_foot INTEGER,
			workrate_attack TEXT,
			workrate_defense TEXT,
			url TEXT NOT NULL
		);
		
		CREATE TABLE IF NOT EXISTS prices (
			url TEXT PRIMARY KEY,
			price TEXT NOT NULL,
			last_updated TEXT NOT NULL
		);
	`);

	const state: CrawlState = {
		visitedHashes: new Set<number>(),
		players: [],
		prices: [],
		errors: 0,
		success: 0,
	};

	// Load previously visited hashes from database to enable resumeability
	const visitedRows = db.query("SELECT url_hash FROM visited_urls").all() as {
		url_hash: number;
	}[];
	for (const row of visitedRows) {
		state.visitedHashes.add(Number(row.url_hash));
	}
	console.log(
		`Loaded ${state.visitedHashes.size} previously visited URLs from SQLite database.`,
	);

	// Load existing player & price records into memory state for JSON export
	const playerRows = db.query("SELECT * FROM players").all() as any[];
	for (const p of playerRows) {
		state.players.push({
			name: p.name,
			rating: p.rating,
			position: p.position,
			club: p.club,
			nation: p.nation,
			league: p.league,
			playstyles: JSON.parse(p.playstyles),
			playstylesPlus: p.playstyles_plus ? JSON.parse(p.playstyles_plus) : [],
			pac: p.pac,
			sho: p.sho,
			pas: p.pas,
			dri: p.dri,
			def: p.def,
			phy: p.phy,
			div: p.div,
			han: p.han,
			kic: p.kic,
			ref: p.ref,
			spd: p.spd,
			pos: p.pos,
			skillMoves: p.skill_moves,
			weakFoot: p.weak_foot,
			workrateAttack: p.workrate_attack,
			workrateDefense: p.workrate_defense,
			url: p.url,
		});
	}

	const priceRows = db.query("SELECT * FROM prices").all() as any[];
	for (const pr of priceRows) {
		state.prices.push({
			url: pr.url,
			price: pr.price,
			lastUpdated: pr.last_updated,
		});
	}

	console.log(
		`=== Launching Bxc Recursive FUT Crawler & Optimization Loop ===\n` +
			`Configuration: MAX_DEPTH=${MAX_DEPTH}, MAX_PAGES=${MAX_PAGES}, DELAY_MS=${DELAY_MS}\n` +
			`Allowed Domains: ${allowedDomains.join(", ")}`,
	);

	// Statements for fast prepared inserts
	const insertVisited = db.prepare(
		"INSERT OR REPLACE INTO visited_urls (url_hash, url, crawled_at, status) VALUES ($hash, $url, $crawled_at, $status)",
	);
	const insertPlayer = db.prepare(
		"INSERT OR REPLACE INTO players (id, name, rating, position, club, nation, league, playstyles, playstyles_plus, pac, sho, pas, dri, def, phy, div, han, kic, ref, spd, pos, skill_moves, weak_foot, workrate_attack, workrate_defense, url) VALUES ($id, $name, $rating, $position, $club, $nation, $league, $playstyles, $playstyles_plus, $pac, $sho, $pas, $dri, $def, $phy, $div, $han, $kic, $ref, $spd, $pos, $skill_moves, $weak_foot, $workrate_attack, $workrate_defense, $url)",
	);
	const insertPrice = db.prepare(
		"INSERT OR REPLACE INTO prices (url, price, last_updated) VALUES ($url, $price, $last_updated)",
	);

	let pagesCrawled = 0;

	while (queue.length > 0 && pagesCrawled < MAX_PAGES) {
		const current = queue.shift();
		if (!current) continue;

		// Visited lookup using Bun's native wyhash
		const urlHash = Bun.hash.wyhash(current.url);
		if (state.visitedHashes.has(urlHash)) continue;
		state.visitedHashes.add(urlHash);
		pagesCrawled++;

		console.log(
			`\n[${pagesCrawled}/${MAX_PAGES === Infinity ? "Unlimited" : MAX_PAGES}] Crawling Depth ${current.depth}: ${current.url}`,
		);

		// DNS lookup
		try {
			const hostname = new URL(current.url).hostname;
			const dnsResult = await Bun.dns.lookup(hostname);
			console.log(
				`  [DNS] Resolved hostname '${hostname}' to IP: ${dnsResult[0]?.address || "unknown"}`,
			);
		} catch (dnsErr: any) {
			console.warn(
				`  [DNS Warning] Failed to resolve hostname: ${dnsErr.message}`,
			);
		}

		try {
			await Bun.sleep(DELAY_MS);

			let content = "";
			let status = "success";

			if (current.url.includes("fut.gg")) {
				if (
					current.url.includes("/players/") &&
					!current.url.endsWith("/players/")
				) {
					const page = await Browser.newPage({ profile: "static" });
					try {
						await page.goto(current.url);
						content = await page.content();
						state.success++;

						const player = await scrapeFutGgPlayer(content, "static");
						if (player.isGeneric) {
							console.log(
								`  -> Skipping generic hub/listing page: ${player.name}`,
							);
						} else {
							state.players.push(player);
							console.log(
								`  -> Extracted Player details:\n${Bun.inspect(player)}`,
							);

							// Persist to SQLite
							insertPlayer.run({
								$id: getPlayerIdFromUrl(current.url),
								$name: player.name,
								$rating: player.rating,
								$position: player.position,
								$club: player.club,
								$nation: player.nation,
								$league: player.league,
								$playstyles: JSON.stringify(player.playstyles),
								$playstyles_plus: JSON.stringify(player.playstylesPlus || []),
								$pac: player.pac,
								$sho: player.sho,
								$pas: player.pas,
								$dri: player.dri,
								$def: player.def,
								$phy: player.phy,
								$div: player.div,
								$han: player.han,
								$kic: player.kic,
								$ref: player.ref,
								$spd: player.spd,
								$pos: player.pos,
								$skill_moves: player.skillMoves,
								$weak_foot: player.weakFoot,
								$workrate_attack: player.workrateAttack,
								$workrate_defense: player.workrateDefense,
								$url: current.url,
							});
						}
					} finally {
						await page.close();
					}
				} else {
					const page = await Browser.newPage({ profile: "static" });
					try {
						await page.goto(current.url);
						content = await page.content();
						state.success++;
					} finally {
						await page.close();
					}
				}
			} else if (current.url.includes("futbin.com")) {
				if (current.url.includes("/player/")) {
					const page = await Browser.newPage({ profile: "ghost" });
					try {
						await page.goto(current.url);
						content = await page.content();
						state.success++;

						const price = await scrapeFutBinPrice(
							content,
							"ghost",
							current.url,
						);
						state.prices.push(price);
						console.log(`  -> Extracted Price details:\n${Bun.inspect(price)}`);

						// Persist to SQLite
						insertPrice.run({
							$url: current.url,
							$price: price.price,
							$last_updated: price.lastUpdated,
						});
					} finally {
						await page.close();
					}
				} else {
					const page = await Browser.newPage({ profile: "http" });
					try {
						await page.goto(current.url);
						content = await page.content();
						state.success++;
					} finally {
						await page.close();
					}
				}
			} else if (current.url.includes("ea.com")) {
				const page = await Browser.newPage({ profile: "http" });
				try {
					const res = await page.goto(current.url);
					state.success++;
					content = await page.content();
					console.log(`  -> EA UT HTTP Status: ${res.status}`);
				} finally {
					await page.close();
				}
			}

			// Save visited URL state
			insertVisited.run({
				$hash: urlHash,
				$url: current.url,
				$crawled_at: new Date().toISOString(),
				$status: status,
			});

			// If we retrieved HTML content, extract links recursively using HTMLRewriter
			if (content && current.depth < MAX_DEPTH) {
				const links = await extractLinksWithHTMLRewriter(
					content,
					current.url,
					allowedDomains,
				);
				let newLinksCount = 0;
				for (const link of links) {
					const linkHash = Bun.hash.wyhash(link);
					if (
						!state.visitedHashes.has(linkHash) &&
						queue.every((q) => q.url !== link)
					) {
						queue.push({ url: link, depth: current.depth + 1 });
						newLinksCount++;
					}
				}
				if (newLinksCount > 0) {
					console.log(
						`  -> Discovered ${newLinksCount} new links for crawl queue.`,
					);
				}
			}

			// Periodically sync back to JSON database to maintain file compatibility
			if (pagesCrawled % 50 === 0) {
				await saveJsonDatabase(state);
			}
		} catch (err: any) {
			state.errors++;
			console.error(`  -> Failed: ${err.message}`);

			// Persist error status to visited_urls to avoid retrying this URL
			try {
				insertVisited.run({
					$hash: urlHash,
					$url: current.url,
					$crawled_at: new Date().toISOString(),
					$status: "error",
				});
			} catch (dbErr) {
				// Ignore DB logging errors
			}
		}
	}

	// Final save to JSON database
	await saveJsonDatabase(state);

	console.log(`\n=== Crawler Execution Finished ===`);
	console.log(`Total Pages Processed: ${pagesCrawled}`);
	console.log(`Successfully Extracted: ${state.success}`);
	console.log(`Failures: ${state.errors}`);
	console.log(`SQLite Database: ${dbPath}`);
	console.log(
		`JSON Database: ${join(import.meta.dir, "../data/fut_extracted_database.json")}`,
	);
}

async function saveJsonDatabase(state: CrawlState) {
	const outputPath = join(
		import.meta.dir,
		"../data/fut_extracted_database.json",
	);
	await Bun.write(
		outputPath,
		JSON.stringify(
			{
				extracted_at: new Date().toISOString(),
				state: {
					success: state.success,
					errors: state.errors,
				},
				players: state.players,
				prices: state.prices,
			},
			null,
			2,
		),
	);
	console.log(`  [Sync] JSON database successfully written.`);
}

// Extends HTMLRewriter to find and parse links from anchor elements natively
async function extractLinksWithHTMLRewriter(
	html: string,
	base: string,
	allowedDomains: string[],
): Promise<string[]> {
	const links = new Set<string>();
	const rewriter = new HTMLRewriter().on("a[href]", {
		element(el) {
			const href = el.getAttribute("href");
			if (!href) return;
			try {
				const resolvedUrl = new URL(href, base);
				// Clean URL parameters/hashes for crawling consistency
				resolvedUrl.hash = "";

				// Verify hostname belongs to allowed domains
				const matchesDomain = allowedDomains.some((d) =>
					resolvedUrl.hostname.includes(d),
				);
				if (matchesDomain) {
					const pathname = resolvedUrl.pathname.toLowerCase();
					// Exclude resource links (images, styles, media, scripts, etc.)
					const isResource =
						pathname.endsWith(".png") ||
						pathname.endsWith(".jpg") ||
						pathname.endsWith(".jpeg") ||
						pathname.endsWith(".gif") ||
						pathname.endsWith(".svg") ||
						pathname.endsWith(".webp") ||
						pathname.endsWith(".css") ||
						pathname.endsWith(".js") ||
						pathname.endsWith(".pdf") ||
						pathname.endsWith(".json") ||
						pathname.endsWith(".ico");

					if (!isResource) {
						links.add(resolvedUrl.href);
					}
				}
			} catch {
				// Ignore malformed URLs
			}
		},
	});

	const response = new Response(html);
	await rewriter.transform(response).text();
	return [...links];
}

runRecursiveScraper().then(() => process.exit(0));
