/**
 * Exemple avancé: Utiliser le cache SQLite directement
 *
 * Pour des cas d'usage comme:
 * - Offline app (lecture depuis SQLite)
 * - Batch search/analysis
 * - Custom queries
 * - Cache management
 */

import { IETVCache, type CacheSearchQuery } from "@aphrody/ietv/cache";
import IETVScraper from "@aphrody/ietv";

// ============================================================================
// 1. Populate cache avec données fraîches
// ============================================================================

async function populateCache() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");
	const scraper = new IETVScraper();

	console.log("📥 Scraping toutes les sources...");
	const channels = await scraper.getAllChannelEpisodes();

	for (const channel of channels) {
		console.log(`  Saving ${channel.channel}: ${channel.totalEpisodes} episodes`);
		cache.saveChannel(channel);
	}

	const stats = cache.getStats();
	console.log("✅ Cache populated:", stats);
	cache.close();
}

// ============================================================================
// 2. Recherche sophistiquée en SQL
// ============================================================================

async function advancedSearch() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	// Cas 1: Tous les VF de la saison 1
	const season1VF = cache.search({
		season: 1,
		language: "vf",
		limit: 50,
	});
	console.log("✅ Season 1 VF:", season1VF.length, "episodes");

	// Cas 2: Recherche par titre
	const mythResults = cache.search({
		q: "myth",
		language: "vostfr",
		limit: 20,
	});
	console.log("✅ Myth VOSTFR:", mythResults.length, "episodes");

	// Cas 3: Épisode spécifique
	const specific = cache.search({
		season: 3,
		episode: 5,
	});
	console.log("✅ S3E5:", specific.length, "sources");

	// Cas 4: Multi-critère
	const advanced = cache.search({
		q: "power",
		season: 2,
		language: "vf",
		limit: 100,
	});
	console.log("✅ Advanced search:", advanced.length, "results");

	cache.close();
}

// ============================================================================
// 3. Analytics + reporting
// ============================================================================

async function analyzeCache() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	const stats = cache.getStats();

	console.log("\n📊 IETV Cache Analytics");
	console.log("─".repeat(40));
	console.log(`📺 Channels:    ${stats.channels}`);
	console.log(`🎬 Seasons:     ${stats.seasons}`);
	console.log(`📹 Episodes:    ${stats.episodes}`);
	console.log(`🌍 Last update: ${new Date(stats.lastUpdate).toISOString()}`);
	console.log("\n🗣️  Language breakdown:");
	for (const [lang, count] of Object.entries(stats.byLanguage)) {
		const pct = ((count / stats.episodes) * 100).toFixed(1);
		console.log(`   ${lang.toUpperCase()}: ${count} (${pct}%)`);
	}

	cache.close();
}

// ============================================================================
// 4. Cache invalidation strategies
// ============================================================================

async function cacheRefresh() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	// Strategy 1: Partial refresh (one channel)
	async function refreshChannel(channel: string) {
		const scraper = new IETVScraper();
		console.log(`🔄 Refreshing ${channel}...`);

		const data =
			channel === "official"
				? await scraper.scrapeOfficialSite()
				: await scraper.getChannelEpisodes(channel);

		cache.saveChannel(data);
		console.log(`✅ ${channel} refreshed`);
	}

	// Strategy 2: Full refresh
	async function refreshAll() {
		const scraper = new IETVScraper();
		console.log("🔄 Full cache refresh...");
		cache.clear();

		const channels = await scraper.getAllChannelEpisodes();
		for (const channel of channels) {
			cache.saveChannel(channel);
		}
		console.log("✅ Full refresh complete");
	}

	// Strategy 3: Check staleness + refresh old
	async function refreshStale(maxAge = 24 * 3600 * 1000) {
		const stats = cache.getStats();
		const age = Date.now() - stats.lastUpdate;

		if (age > maxAge) {
			console.log(`⚠️ Cache stale (${(age / 3600000).toFixed(1)}h old)`);
			await refreshAll();
		} else {
			console.log(`✅ Cache fresh (${(age / 3600000).toFixed(1)}h old)`);
		}
	}

	// Usage
	// await refreshChannel("inazumaelevenfrance1");
	// await refreshAll();
	// await refreshStale();

	cache.close();
}

// ============================================================================
// 5. Offline mode (no internet, use local cache)
// ============================================================================

async function offlineMode() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	console.log("\n🔌 Offline Mode Demo");
	console.log("─".repeat(40));

	// User searches while offline
	const queries: CacheSearchQuery[] = [
		{ q: "power", limit: 10 },
		{ season: 1, language: "vf", limit: 20 },
		{ q: "victory", season: 5, limit: 5 },
	];

	for (const query of queries) {
		const results = cache.search(query);
		console.log(`Query:`, query, `→ ${results.length} results`);

		if (results.length > 0) {
			const first = results[0];
			console.log(`  - ${first.title} (S${first.season}E${first.episode})`);
		}
	}

	console.log("✅ All searches work without internet!");

	cache.close();
}

// ============================================================================
// 6. Export data for backup/sync
// ============================================================================

async function exportCache() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	const allChannels = cache.getAllChannels();

	const exportData = {
		version: "1.0",
		exported: new Date().toISOString(),
		stats: cache.getStats(),
		channels: allChannels.map((ch) => ({
			channel: ch.channel,
			title: ch.title,
			episodes: allChannels.length,
		})),
		// Could export full JSON for backup
		// data: allChannels
	};

	console.log("\n📤 Cache Export");
	console.log("─".repeat(40));
	console.log(JSON.stringify(exportData, null, 2));

	cache.close();
}

// ============================================================================
// 7. Real-time monitoring
// ============================================================================

function monitorCache() {
	const cache = new IETVCache("~/.cache/ietv/episodes.db");

	// Monitor in loop
	console.log("\n📡 Cache Monitor (hit Ctrl+C to stop)");
	console.log("─".repeat(40));

	let lastStats = cache.getStats();

	const interval = setInterval(() => {
		const stats = cache.getStats();

		// Check for changes
		if (stats.episodes !== lastStats.episodes) {
			console.log(`📊 Episodes updated: ${lastStats.episodes} → ${stats.episodes}`);
		}

		console.log(`[${new Date().toLocaleTimeString()}] Episodes: ${stats.episodes}`);
		lastStats = stats;
	}, 5000);

	process.on("SIGINT", () => {
		clearInterval(interval);
		console.log("\n✅ Monitor stopped");
		cache.close();
		process.exit(0);
	});
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const cmd = process.argv[2];

	switch (cmd) {
		case "populate":
			await populateCache();
			break;
		case "search":
			await advancedSearch();
			break;
		case "analytics":
			await analyzeCache();
			break;
		case "refresh":
			await cacheRefresh();
			break;
		case "offline":
			await offlineMode();
			break;
		case "export":
			await exportCache();
			break;
		case "monitor":
			monitorCache();
			break;
		default:
			console.log(`Usage:
  bun examples/ietv-cache-advanced.ts populate   # Scrape & populate cache
  bun examples/ietv-cache-advanced.ts search     # Advanced SQL searches
  bun examples/ietv-cache-advanced.ts analytics  # Cache stats + breakdown
  bun examples/ietv-cache-advanced.ts refresh    # Cache refresh strategies
  bun examples/ietv-cache-advanced.ts offline    # Offline mode demo
  bun examples/ietv-cache-advanced.ts export     # Export cache data
  bun examples/ietv-cache-advanced.ts monitor    # Real-time monitor
`);
			break;
	}
}

await main();
