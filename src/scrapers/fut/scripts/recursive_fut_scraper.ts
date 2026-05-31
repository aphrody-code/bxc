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

import { scrapeFutGgPlayer } from "../futgg.ts";
import { scrapeFutBinPrice } from "../futbin.ts";
import { Browser } from "../../../api/browser.ts";
import { launchGhostBrowser } from "../../../profiles/ghost/index.ts";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import Bottleneck from "bottleneck";
import PQueue from "p-queue";
import pRetry, { AbortError } from "p-retry";
import { LRUCache } from "lru-cache";
import { FutPlayerSchema, FutPriceSchema } from "../types.ts";

const dnsCache = new LRUCache<string, string>({
	max: 100,
	ttl: 1000 * 60 * 10, // 10 minutes cache
});

const futggCookies = join(import.meta.dir, "../cookies/futgg.json");
const hasFutggCookies = existsSync(futggCookies);

const futbinCookies = join(import.meta.dir, "../cookies/futbin.json");
const hasFutbinCookies = existsSync(futbinCookies);

const eaCookies = join(import.meta.dir, "../cookies/ea.json");
const hasEaCookies = existsSync(eaCookies);

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
	visitedHashes: Set<bigint>;
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

function getUrlPriority(url: string): number {
	// Player endpoints get highest priority
	if (
		url.includes("/players/") &&
		!url.endsWith("/players/") &&
		!url.includes("?")
	) {
		return 2;
	}
	if (url.includes("/player/") && !url.endsWith("/player/")) {
		return 2;
	}
	// Normal pages (listings, clubs, etc.)
	if (
		url.includes("/clubs/") ||
		url.includes("/nations/") ||
		url.includes("/leagues/")
	) {
		return 1;
	}
	// Default/other URLs
	return 0;
}

async function fetchPageContentWithRetry(
	url: string,
	profile: "static" | "http" | "stealth" | "ghost" | "fast",
	cookies?: string,
): Promise<{ content: string; status: string }> {
	return pRetry(
		async () => {
			if (profile === "ghost") {
				const ghost = await launchGhostBrowser();
				try {
					const res = await ghost.page.goto(url);
					await Bun.sleep(2000);
					const content = await ghost.page.content();
					const title = await ghost.page.title();
					if (title.includes("Just a moment") || title.includes("Cloudflare")) {
						throw new AbortError("Cloudflare Turnstile challenge detected");
					}
					if (res && res.status === 404) {
						throw new AbortError(`404 Not Found: ${url}`);
					}
					return { content, status: "success" };
				} finally {
					await ghost.close();
				}
			} else {
				const page = await Browser.newPage({
					profile,
					cookies,
				});
				try {
					const res = await page.goto(url);
					const title = await page.title();
					if (title.includes("Just a moment") || title.includes("Cloudflare")) {
						throw new AbortError("Cloudflare Turnstile challenge detected");
					}
					if (res && res.status === 404) {
						throw new AbortError(`404 Not Found: ${url}`);
					}
					if (res && res.status >= 500) {
						throw new Error(`Server error ${res.status}: ${url}`);
					}
					const content = await page.content();
					return { content, status: "success" };
				} finally {
					await page.close();
				}
			}
		},
		{
			retries: 2,
			onFailedAttempt: (failedAttempt) => {
				console.warn(
					`  [Retry] Attempt ${failedAttempt.attemptNumber} failed for ${url}. ${failedAttempt.retriesLeft} retries left. Error: ${failedAttempt.error.message}`,
				);
			},
		},
	);
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
	const seedsToEnqueue: string[] = [];

	for (const key of Object.keys(mapping)) {
		const config = mapping[key];
		if (config.domains) {
			allowedDomains.push(...config.domains);
		}
		const seeds = config.seed_urls || [];
		for (const s of seeds) {
			seedsToEnqueue.push(s);
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
			url TEXT NOT NULL,

			-- Biological / Card attributes
			overall_rating INTEGER,
			date_of_birth TEXT,
			height INTEGER,
			weight INTEGER,
			foot TEXT,
			age INTEGER,
			rarity TEXT,
			accelerate_type TEXT,
			gender TEXT,
			alternative_positions TEXT,

			-- Detailed Stats
			acceleration INTEGER,
			sprint_speed INTEGER,
			agility INTEGER,
			balance INTEGER,
			reactions INTEGER,
			ball_control INTEGER,
			dribbling INTEGER,
			composure INTEGER,
			jumping INTEGER,
			stamina INTEGER,
			strength INTEGER,
			aggression INTEGER,
			interceptions INTEGER,
			heading_accuracy INTEGER,
			defensive_awareness INTEGER,
			standing_tackle INTEGER,
			sliding_tackle INTEGER,
			vision INTEGER,
			crossing INTEGER,
			fk_accuracy INTEGER,
			short_passing INTEGER,
			long_passing INTEGER,
			curve INTEGER,
			positioning INTEGER,
			finishing INTEGER,
			shot_power INTEGER,
			long_shots INTEGER,
			volleys INTEGER,
			penalties INTEGER,
			gk_diving INTEGER,
			gk_handling INTEGER,
			gk_kicking INTEGER,
			gk_reflexes INTEGER,
			gk_positioning INTEGER,
			gk_speed INTEGER
		);
		
		CREATE TABLE IF NOT EXISTS prices (
			url TEXT PRIMARY KEY,
			price TEXT NOT NULL,
			last_updated TEXT NOT NULL
		);
	`);

	const state: CrawlState = {
		visitedHashes: new Set<bigint>(),
		players: [],
		prices: [],
		errors: 0,
		success: 0,
	};

	// Load previously visited hashes from database to enable resumeability
	const visitedRows = db.query("SELECT url_hash FROM visited_urls").all() as {
		url_hash: number | bigint;
	}[];
	for (const row of visitedRows) {
		state.visitedHashes.add(BigInt(row.url_hash));
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

			overallRating: p.overall_rating,
			dateOfBirth: p.date_of_birth,
			height: p.height,
			weight: p.weight,
			foot: p.foot,
			age: p.age,
			rarity: p.rarity,
			accelerateType: p.accelerate_type,
			gender: p.gender,
			alternativePositions: p.alternative_positions
				? JSON.parse(p.alternative_positions)
				: [],

			acceleration: p.acceleration,
			sprintSpeed: p.sprint_speed,
			agility: p.agility,
			balance: p.balance,
			reactions: p.reactions,
			ballControl: p.ball_control,
			dribbling: p.dribbling,
			composure: p.composure,
			jumping: p.jumping,
			stamina: p.stamina,
			strength: p.strength,
			aggression: p.aggression,
			interceptions: p.interceptions,
			headingAccuracy: p.heading_accuracy,
			defensiveAwareness: p.defensive_awareness,
			standingTackle: p.standing_tackle,
			slidingTackle: p.sliding_tackle,
			vision: p.vision,
			crossing: p.crossing,
			fkAccuracy: p.fk_accuracy,
			shortPassing: p.short_passing,
			longPassing: p.long_passing,
			curve: p.curve,
			positioning: p.positioning,
			finishing: p.finishing,
			shotPower: p.shot_power,
			longShots: p.long_shots,
			volleys: p.volleys,
			penalties: p.penalties,
			gkDiving: p.gk_diving,
			gkHandling: p.gk_handling,
			gkKicking: p.gk_kicking,
			gkReflexes: p.gk_reflexes,
			gkPositioning: p.gk_positioning,
			gkSpeed: p.gk_speed,
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
		`INSERT OR REPLACE INTO players (
			id, name, rating, position, club, nation, league, playstyles, playstyles_plus,
			pac, sho, pas, dri, def, phy, div, han, kic, ref, spd, pos, skill_moves, weak_foot, workrate_attack, workrate_defense, url,
			overall_rating, date_of_birth, height, weight, foot, age, rarity, accelerate_type, gender, alternative_positions,
			acceleration, sprint_speed, agility, balance, reactions, ball_control, dribbling, composure, jumping, stamina, strength, aggression,
			interceptions, heading_accuracy, defensive_awareness, standing_tackle, sliding_tackle, vision, crossing, fk_accuracy, short_passing, long_passing,
			curve, positioning, finishing, shot_power, long_shots, volleys, penalties, gk_diving, gk_handling, gk_kicking, gk_reflexes, gk_positioning, gk_speed
		) VALUES (
			$id, $name, $rating, $position, $club, $nation, $league, $playstyles, $playstyles_plus,
			$pac, $sho, $pas, $dri, $def, $phy, $div, $han, $kic, $ref, $spd, $pos, $skill_moves, $weak_foot, $workrate_attack, $workrate_defense, $url,
			$overall_rating, $date_of_birth, $height, $weight, $foot, $age, $rarity, $accelerate_type, $gender, $alternative_positions,
			$acceleration, $sprint_speed, $agility, $balance, $reactions, $ball_control, $dribbling, $composure, $jumping, $stamina, $strength, $aggression,
			$interceptions, $heading_accuracy, $defensive_awareness, $standing_tackle, $sliding_tackle, $vision, $crossing, $fk_accuracy, $short_passing, $long_passing,
			$curve, $positioning, $finishing, $shot_power, $long_shots, $volleys, $penalties, $gk_diving, $gk_handling, $gk_kicking, $gk_reflexes, $gk_positioning, $gk_speed
		)`,
	);
	const insertPrice = db.prepare(
		"INSERT OR REPLACE INTO prices (url, price, last_updated) VALUES ($url, $price, $last_updated)",
	);

	let pagesCrawled = 0;

	const limiter = new Bottleneck({
		maxConcurrent: 3,
		minTime: DELAY_MS,
	});

	const pQueue = new PQueue({
		concurrency: 3,
	});

	async function processUrl(current: { url: string; depth: number }) {
		if (pagesCrawled >= MAX_PAGES) return;
		// Visited lookup using Bun's native wyhash
		const urlHash = Bun.hash.wyhash(current.url);
		if (state.visitedHashes.has(urlHash)) return;
		state.visitedHashes.add(urlHash);
		pagesCrawled++;
		if (pagesCrawled >= MAX_PAGES) {
			pQueue.clear();
		}

		console.log(
			`\n[${pagesCrawled}/${MAX_PAGES === Infinity ? "Unlimited" : MAX_PAGES}] Crawling Depth ${current.depth} (Priority: ${getUrlPriority(current.url)}): ${current.url}`,
		);

		// DNS lookup with LRU Cache
		try {
			const hostname = new URL(current.url).hostname;
			let resolvedIp = dnsCache.get(hostname);
			if (!resolvedIp) {
				const dnsResult = await Bun.dns.lookup(hostname);
				resolvedIp = dnsResult[0]?.address || "unknown";
				dnsCache.set(hostname, resolvedIp);
				console.log(
					`  [DNS] Resolved hostname '${hostname}' to IP: ${resolvedIp}`,
				);
			} else {
				console.log(
					`  [DNS Cache Hit] Hostname '${hostname}' resolved to IP: ${resolvedIp}`,
				);
			}
		} catch (dnsErr: any) {
			console.warn(
				`  [DNS Warning] Failed to resolve hostname: ${dnsErr.message}`,
			);
		}

		try {
			let content = "";
			const status = "success";

			if (current.url.includes("fut.gg")) {
				if (
					current.url.includes("/players/") &&
					!current.url.endsWith("/players/")
				) {
					const fetched = await fetchPageContentWithRetry(
						current.url,
						"static",
						hasFutggCookies ? futggCookies : undefined,
					);
					content = fetched.content;
					state.success++;

					const player = await scrapeFutGgPlayer(content, "static");
					if (player.isGeneric) {
						console.log(
							`  -> Skipping generic hub/listing page: ${player.name}`,
						);
					} else {
						// Schema validation with Zod
						const validatedPlayer = FutPlayerSchema.parse(player);
						state.players.push(validatedPlayer);
						console.log(
							`  -> Extracted Player details:\n${Bun.inspect(validatedPlayer)}`,
						);

						// Persist to SQLite
						(
							insertPlayer as unknown as {
								run: (
									params: Record<
										string,
										string | number | bigint | boolean | null | undefined
									>,
								) => void;
							}
						).run({
							$id: getPlayerIdFromUrl(current.url),
							$name: validatedPlayer.name,
							$rating: validatedPlayer.rating,
							$position: validatedPlayer.position,
							$club: validatedPlayer.club,
							$nation: validatedPlayer.nation,
							$league: validatedPlayer.league,
							$playstyles: JSON.stringify(validatedPlayer.playstyles),
							$playstyles_plus: JSON.stringify(
								validatedPlayer.playstylesPlus || [],
							),
							$pac: validatedPlayer.pac,
							$sho: validatedPlayer.sho,
							$pas: validatedPlayer.pas,
							$dri: validatedPlayer.dri,
							$def: validatedPlayer.def,
							$phy: validatedPlayer.phy,
							$div: validatedPlayer.div,
							$han: validatedPlayer.han,
							$kic: validatedPlayer.kic,
							$ref: validatedPlayer.ref,
							$spd: validatedPlayer.spd,
							$pos: validatedPlayer.pos,
							$skill_moves: validatedPlayer.skillMoves,
							$weak_foot: validatedPlayer.weakFoot,
							$workrate_attack: validatedPlayer.workrateAttack,
							$workrate_defense: validatedPlayer.workrateDefense,
							$url: current.url,

							$overall_rating: validatedPlayer.overallRating,
							$date_of_birth: validatedPlayer.dateOfBirth,
							$height: validatedPlayer.height,
							$weight: validatedPlayer.weight,
							$foot: validatedPlayer.foot,
							$age: validatedPlayer.age,
							$rarity: validatedPlayer.rarity,
							$accelerate_type: validatedPlayer.accelerateType,
							$gender: validatedPlayer.gender,
							$alternative_positions: JSON.stringify(
								validatedPlayer.alternativePositions || [],
							),

							$acceleration: validatedPlayer.acceleration,
							$sprint_speed: validatedPlayer.sprintSpeed,
							$agility: validatedPlayer.agility,
							$balance: validatedPlayer.balance,
							$reactions: validatedPlayer.reactions,
							$ball_control: validatedPlayer.ballControl,
							$dribbling: validatedPlayer.dribbling,
							$composure: validatedPlayer.composure,
							$jumping: validatedPlayer.jumping,
							$stamina: validatedPlayer.stamina,
							$strength: validatedPlayer.strength,
							$aggression: validatedPlayer.aggression,
							$interceptions: validatedPlayer.interceptions,
							$heading_accuracy: validatedPlayer.headingAccuracy,
							$defensive_awareness: validatedPlayer.defensiveAwareness,
							$standing_tackle: validatedPlayer.standingTackle,
							$sliding_tackle: validatedPlayer.slidingTackle,
							$vision: validatedPlayer.vision,
							$crossing: validatedPlayer.crossing,
							$fk_accuracy: validatedPlayer.fkAccuracy,
							$short_passing: validatedPlayer.shortPassing,
							$long_passing: validatedPlayer.longPassing,
							$curve: validatedPlayer.curve,
							$positioning: validatedPlayer.positioning,
							$finishing: validatedPlayer.finishing,
							$shot_power: validatedPlayer.shotPower,
							$long_shots: validatedPlayer.longShots,
							$volleys: validatedPlayer.volleys,
							$penalties: validatedPlayer.penalties,
							$gk_diving: validatedPlayer.gkDiving,
							$gk_handling: validatedPlayer.gkHandling,
							$gk_kicking: validatedPlayer.gkKicking,
							$gk_reflexes: validatedPlayer.gkReflexes,
							$gk_positioning: validatedPlayer.gkPositioning,
							$gk_speed: validatedPlayer.gkSpeed,
						});
					}
				} else {
					const fetched = await fetchPageContentWithRetry(
						current.url,
						"static",
						hasFutggCookies ? futggCookies : undefined,
					);
					content = fetched.content;
					state.success++;
				}
			} else if (current.url.includes("futbin.com")) {
				if (current.url.includes("/player/")) {
					const fetched = await fetchPageContentWithRetry(
						current.url,
						"stealth",
						hasFutbinCookies ? futbinCookies : undefined,
					);
					content = fetched.content;
					state.success++;

					const price = await scrapeFutBinPrice(content, "ghost", current.url);
					// Schema validation with Zod
					const validatedPrice = FutPriceSchema.parse(price);
					state.prices.push(validatedPrice);
					console.log(
						`  -> Extracted Price details:\n${Bun.inspect(validatedPrice)}`,
					);

					// Persist to SQLite
					insertPrice.run({
						$url: current.url,
						$price: validatedPrice.price,
						$last_updated: validatedPrice.lastUpdated,
					});
				} else {
					const fetched = await fetchPageContentWithRetry(
						current.url,
						"http",
						hasFutbinCookies ? futbinCookies : undefined,
					);
					content = fetched.content;
					state.success++;
				}
			} else if (current.url.includes("ea.com")) {
				const fetched = await fetchPageContentWithRetry(
					current.url,
					"http",
					hasEaCookies ? eaCookies : undefined,
				);
				content = fetched.content;
				state.success++;
				console.log(`  -> EA UT page successfully fetched.`);
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
					if (!state.visitedHashes.has(linkHash)) {
						enqueueUrl(link, current.depth + 1);
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

	function enqueueUrl(url: string, depth: number) {
		if (pagesCrawled >= MAX_PAGES || depth > MAX_DEPTH) {
			return;
		}
		const urlHash = Bun.hash.wyhash(url);
		if (state.visitedHashes.has(urlHash)) return;

		pQueue
			.add(() => limiter.schedule(() => processUrl({ url, depth })), {
				priority: getUrlPriority(url),
			})
			.catch((err) => {
				console.error(`Queue task failed for URL ${url}: ${err.message}`);
			});
	}

	// Enqueue all seed URLs
	for (const s of seedsToEnqueue) {
		enqueueUrl(s, 1);
	}

	// Wait for the queue to become idle
	await pQueue.onIdle();

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
