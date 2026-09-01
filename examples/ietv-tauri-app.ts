/**
 * Exemple: Intégration IETV dans une app Tauri (Desktop)
 *
 * Usage:
 *   import { invoke } from '@tauri-apps/api/tauri'
 *   const episodes = await invoke('search_ietv', { query: 'Inazuma' })
 */

import IETVClient from "@aphrody/ietv-client";

// ============================================================================
// Backend Tauri (src-tauri/src/main.rs avec tauri invoke)
// ============================================================================

// Rust side (pseudo-code):
/*
#[tauri::command]
async fn search_ietv(query: String) -> Result<SearchResult, String> {
    let client = IETVClient::new();
    client.search(&query).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_channel(source: String) -> Result<ChannelInfo, String> {
    let client = IETVClient::new();
    client.channel(&source).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_all_episodes() -> Result<AllEpisodes, String> {
    let client = IETVClient::new();
    client.all().await
        .map_err(|e| e.to_string())
}
*/

// ============================================================================
// Frontend Tauri (src/App.tsx)
// ============================================================================

import { invoke } from "@tauri-apps/api/tauri";
import { useState, useEffect } from "react";

export function IETVTauriApp() {
	const [search, setSearch] = useState("");
	const [results, setResults] = useState<any[]>([]);
	const [loading, setLoading] = useState(false);
	const [all, setAll] = useState<any>(null);

	// Charger tous les épisodes au démarrage
	useEffect(() => {
		handleGetAll();
	}, []);

	const handleSearch = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!search.trim()) return;

		setLoading(true);
		try {
			const res = await invoke("search_ietv", { query: search });
			setResults((res as any).results || []);
		} catch (err) {
			console.error("Search failed:", err);
		} finally {
			setLoading(false);
		}
	};

	const handleGetAll = async () => {
		setLoading(true);
		try {
			const data = await invoke("get_all_episodes");
			setAll(data);
		} catch (err) {
			console.error("Failed to load episodes:", err);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="tauri-app">
			<header>
				<h1>📺 Inazuma Eleven Streaming Desktop</h1>
				<p>Accès local à tous les épisodes</p>
			</header>

			<main>
				{/* Search */}
				<div className="search-box">
					<form onSubmit={handleSearch}>
						<input
							type="text"
							placeholder="Chercher un épisode..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							disabled={loading}
						/>
						<button type="submit" disabled={loading}>
							{loading ? "Recherche..." : "Chercher"}
						</button>
					</form>
				</div>

				{/* Results */}
				{results.length > 0 && (
					<section className="results">
						<h2>Résultats ({results.length})</h2>
						<div className="list">
							{results.slice(0, 20).map((ep, i) => (
								<div key={i} className="result-item">
									<span className="title">{ep.title}</span>
									<span className="meta">
										S{ep.season}E{ep.episode} · {ep.language}
									</span>
									<a href={ep.url} className="link">
										Ouvrir
									</a>
								</div>
							))}
						</div>
					</section>
				)}

				{/* All Episodes */}
				{!search && all && (
					<section className="all-episodes">
						<h2>Tous les épisodes</h2>
						<div className="sources-grid">
							{all.channels?.map((ch: any, i: number) => (
								<div key={i} className="source-card">
									<h3>{ch.title || ch.channel}</h3>
									<p className="count">{ch.totalEpisodes} épisodes</p>
									<div className="seasons">
										{ch.seasons.slice(0, 3).map((s: any, si: number) => (
											<button
												key={si}
												className="season-btn"
												onClick={() => {
													// Navigate to season detail
													console.log(`View season ${s.season}`);
												}}
											>
												Saison {s.season}
											</button>
										))}
										{ch.seasons.length > 3 && (
											<span className="more">+{ch.seasons.length - 3}</span>
										)}
									</div>
								</div>
							))}
						</div>
					</section>
				)}
			</main>

			<style>{`
				:root {
					--bg: #f5f5f5;
					--surface: white;
					--text: #333;
					--primary: #2196f3;
					--border: #e0e0e0;
				}

				* {
					margin: 0;
					padding: 0;
					box-sizing: border-box;
				}

				body {
					background: var(--bg);
					color: var(--text);
					font-family: system-ui, -apple-system, sans-serif;
				}

				.tauri-app {
					padding: 2rem;
					max-width: 1200px;
					margin: 0 auto;
				}

				header {
					text-align: center;
					margin-bottom: 3rem;
					padding: 2rem;
					background: var(--surface);
					border-radius: 8px;
					box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
				}

				header h1 {
					font-size: 2rem;
					margin-bottom: 0.5rem;
				}

				main {
					display: grid;
					gap: 2rem;
				}

				.search-box {
					background: var(--surface);
					padding: 1.5rem;
					border-radius: 8px;
					box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
				}

				.search-box form {
					display: flex;
					gap: 1rem;
				}

				.search-box input {
					flex: 1;
					padding: 0.75rem;
					border: 1px solid var(--border);
					border-radius: 4px;
					font-size: 1rem;
				}

				.search-box button {
					padding: 0.75rem 1.5rem;
					background: var(--primary);
					color: white;
					border: none;
					border-radius: 4px;
					cursor: pointer;
					font-weight: 500;
				}

				.search-box button:hover {
					background: #1976d2;
				}

				.results {
					background: var(--surface);
					padding: 1.5rem;
					border-radius: 8px;
					box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
				}

				.results .list {
					display: flex;
					flex-direction: column;
					gap: 0.75rem;
				}

				.result-item {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 1rem;
					background: #f9f9f9;
					border-radius: 4px;
					border-left: 4px solid var(--primary);
				}

				.result-item .title {
					font-weight: 500;
					flex: 1;
				}

				.result-item .meta {
					font-size: 0.85rem;
					color: #666;
					margin: 0 1rem;
				}

				.result-item .link {
					color: var(--primary);
					text-decoration: none;
					font-weight: 500;
				}

				.all-episodes {
					background: var(--surface);
					padding: 1.5rem;
					border-radius: 8px;
					box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
				}

				.sources-grid {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
					gap: 1.5rem;
					margin-top: 1rem;
				}

				.source-card {
					padding: 1.5rem;
					border: 1px solid var(--border);
					border-radius: 8px;
					background: #fafafa;
				}

				.source-card h3 {
					margin-bottom: 0.5rem;
				}

				.source-card .count {
					font-size: 0.9rem;
					color: #666;
					display: block;
					margin-bottom: 1rem;
				}

				.source-card .seasons {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
				}

				.season-btn {
					padding: 0.5rem;
					background: white;
					border: 1px solid var(--border);
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.9rem;
					transition: all 0.2s;
				}

				.season-btn:hover {
					background: var(--primary);
					color: white;
					border-color: var(--primary);
				}

				.more {
					padding: 0.5rem;
					text-align: center;
					color: #666;
					font-size: 0.9rem;
				}
			`}</style>
		</div>
	);
}

export default IETVTauriApp;
