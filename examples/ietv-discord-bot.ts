/**
 * Exemple: Bot Discord pour IETV API
 *
 * Utilisation:
 *   /ietv search <titre>
 *   /ietv episode <saison> <épisode>
 *   /ietv channel <source>
 */

import IETVClient from "@aphrody/ietv-client";

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.IETV_API || "http://localhost:3000";

const client = new IETVClient({ baseUrl: API_URL });

// ============================================================================
// Discord Bot Commands (avec discord.js ou autre)
// ============================================================================

/**
 * /ietv search <titre>
 */
async function handleSearch(title: string): Promise<string> {
	try {
		const results = await client.search({ q: title, limit: 5 });

		if (results.count === 0) {
			return `Aucun épisode trouvé pour "${title}"`;
		}

		let response = `**Résultats pour "${title}"** (${results.count} trouvés)\n\n`;

		for (const ep of results.results.slice(0, 5)) {
			response += `• **${ep.title}**\n`;
			response += `  Saison ${ep.season}, Épisode ${ep.episode}\n`;
			response += `  Langue: ${ep.language === "vf" ? "VF (doublage)" : "VOSTFR (VO+subs)"}\n`;
			response += `  [Lien](${ep.url})\n\n`;
		}

		return response;
	} catch (err) {
		return `Erreur: ${String(err)}`;
	}
}

/**
 * /ietv episode <saison> <épisode>
 */
async function handleEpisode(season: number, episode: number): Promise<string> {
	try {
		const results = await client.search({ season, episode, limit: 10 });

		if (results.count === 0) {
			return `Épisode S${season}E${episode} non trouvé`;
		}

		let response = `**Saison ${season}, Épisode ${episode}**\n\n`;

		// Group by source
		const bySource = new Map<string, any>();
		for (const ep of results.results) {
			if (!bySource.has(ep.channel)) {
				bySource.set(ep.channel, []);
			}
			bySource.get(ep.channel)!.push(ep);
		}

		for (const [source, eps] of bySource) {
			response += `**${source}**\n`;
			for (const ep of eps) {
				response += `• [${ep.language.toUpperCase()}] ${ep.title}\n`;
				response += `  [Regarder](${ep.url})\n`;
			}
			response += "\n";
		}

		return response;
	} catch (err) {
		return `Erreur: ${String(err)}`;
	}
}

/**
 * /ietv channel <source>
 */
async function handleChannel(source: string): Promise<string> {
	try {
		const ch = await client.channel(source);

		let response = `**${ch.title}**\n`;
		if (ch.description) response += `${ch.description}\n\n`;

		response += `**${ch.totalEpisodes}** épisodes en ${ch.seasons.length} saison(s)\n\n`;

		// Afficher les saisons
		for (const s of ch.seasons.slice(0, 3)) {
			response += `**Saison ${s.season}**: ${s.totalEpisodes} épisodes\n`;
		}

		if (ch.seasons.length > 3) {
			response += `... et ${ch.seasons.length - 3} saison(s) de plus`;
		}

		return response;
	} catch (err) {
		return `Erreur: ${String(err)}`;
	}
}

/**
 * /ietv all
 */
async function handleAll(): Promise<string> {
	try {
		const data = await client.all();

		let response = `**Toutes les sources IETV**\n\n`;
		response += `📺 **${data.totalChannels}** sources\n`;
		response += `🎬 **${data.totalEpisodes}** épisodes total\n`;
		response += `⏱️ Scraping en ${data.elapsedMs}ms\n\n`;

		for (const ch of data.channels.slice(0, 5)) {
			response += `• ${ch.channel}: ${ch.totalEpisodes} ep\n`;
		}

		return response;
	} catch (err) {
		return `Erreur: ${String(err)}`;
	}
}

// ============================================================================
// Export for bot integration
// ============================================================================

export const commands = {
	search: handleSearch,
	episode: handleEpisode,
	channel: handleChannel,
	all: handleAll,
};
