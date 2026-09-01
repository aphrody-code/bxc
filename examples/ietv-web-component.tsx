/**
 * Exemple: Composant Web (React, Vue, Svelte compatible)
 *
 * Affiche les épisodes Inazuma Eleven dans une UI interactive
 * Consomme l'API IETV REST
 */

import IETVClient, {
	type ChannelInfo,
	type VideoRef,
	type LanguageVersion,
} from "@aphrody/ietv-client";

// ============================================================================
// React Exemple (Hooks)
// ============================================================================

import { useState, useEffect } from "react";

export function IETVBrowser() {
	const [client] = useState(() => new IETVClient());
	const [channels, setChannels] = useState<ChannelInfo[]>([]);
	const [selected, setSelected] = useState<ChannelInfo | null>(null);
	const [season, setSeason] = useState(1);
	const [lang, setLang] = useState<LanguageVersion>("vf");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Charger toutes les sources
	useEffect(() => {
		setLoading(true);
		client
			.all()
			.then((data) => {
				setChannels(data.channels);
				if (data.channels.length > 0) {
					setSelected(data.channels[0]);
				}
			})
			.catch((err) => setError(String(err)))
			.finally(() => setLoading(false));
	}, [client]);

	const episodes =
		selected?.seasons.find((s) => s.season === season)?.episodes ?? [];
	const filtered = episodes.filter((ep) => ep.language === lang);

	return (
		<div className="ietv-browser">
			<header>
				<h1>📺 Inazuma Eleven Streaming</h1>
				<p>{channels.length} sources disponibles</p>
			</header>

			{error && <div className="error">{error}</div>}
			{loading && <div className="loading">Chargement...</div>}

			{!loading && (
				<div className="grid">
					{/* Sélection chaîne */}
					<aside className="sources">
						<h2>Sources</h2>
						<div className="list">
							{channels.map((ch) => (
								<button
									key={ch.channel}
									className={selected?.channel === ch.channel ? "active" : ""}
									onClick={() => {
										setSelected(ch);
										setSeason(1);
									}}
								>
									{ch.title || ch.channel}
									<span className="count">{ch.totalEpisodes}</span>
								</button>
							))}
						</div>
					</aside>

					{/* Contenu */}
					<main className="content">
						{selected && (
							<>
								<h2>{selected.title}</h2>
								<p className="description">{selected.description}</p>

								{/* Filtres */}
								<div className="filters">
									<div className="filter-group">
										<label>Saison</label>
										<select value={season} onChange={(e) => setSeason(+e.target.value)}>
											{selected.seasons.map((s) => (
												<option key={s.season} value={s.season}>
													Saison {s.season} ({s.totalEpisodes} épisodes)
												</option>
											))}
										</select>
									</div>

									<div className="filter-group">
										<label>Langue</label>
										<select value={lang} onChange={(e) => setLang(e.target.value as LanguageVersion)}>
											<option value="vf">VF (Doublage)</option>
											<option value="vostfr">VOSTFR (VO + Subs)</option>
										</select>
									</div>
								</div>

								{/* Liste épisodes */}
								<div className="episodes">
									{filtered.length === 0 ? (
										<p className="empty">Aucun épisode trouvé dans cette langue</p>
									) : (
										<div className="grid">
											{filtered.map((ep) => (
												<EpisodeCard key={ep.videoId} episode={ep} />
											))}
										</div>
									)}
								</div>
							</>
						)}
					</main>
				</div>
			)}

			<style>{`
				.ietv-browser {
					font-family: system-ui, -apple-system, sans-serif;
					padding: 2rem;
					max-width: 1400px;
					margin: 0 auto;
				}

				header {
					text-align: center;
					margin-bottom: 3rem;
				}

				.grid {
					display: grid;
					grid-template-columns: 250px 1fr;
					gap: 2rem;
				}

				.sources {
					background: #f5f5f5;
					border-radius: 8px;
					padding: 1.5rem;
					height: fit-content;
					position: sticky;
					top: 1rem;
				}

				.sources h2 {
					margin-top: 0;
				}

				.sources .list {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
				}

				.sources button {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 0.75rem;
					border: none;
					background: white;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.9rem;
					transition: all 0.2s;
				}

				.sources button:hover {
					background: #e0e0e0;
				}

				.sources button.active {
					background: #2196f3;
					color: white;
				}

				.sources .count {
					font-size: 0.75rem;
					background: rgba(0, 0, 0, 0.1);
					padding: 0.25rem 0.5rem;
					border-radius: 4px;
				}

				.filters {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 1rem;
					margin: 2rem 0;
				}

				.filter-group {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
				}

				.filter-group select {
					padding: 0.5rem;
					border: 1px solid #ccc;
					border-radius: 4px;
					font-size: 1rem;
				}

				.episodes {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
					gap: 1.5rem;
				}

				.error {
					background: #ffebee;
					color: #c62828;
					padding: 1rem;
					border-radius: 4px;
					margin-bottom: 1rem;
				}

				.loading {
					text-align: center;
					padding: 2rem;
					font-size: 1.2rem;
				}
			`}</style>
		</div>
	);
}

/**
 * Composant épisode
 */
function EpisodeCard({ episode }: { episode: VideoRef }) {
	return (
		<div className="episode-card">
			{episode.thumbnail && (
				<img src={episode.thumbnail} alt={episode.title} />
			)}
			<div className="content">
				<h3>
					S{episode.season}E{episode.episode}
				</h3>
				<p className="title">{episode.title}</p>
				<div className="meta">
					<span className="lang">
						{episode.language === "vf" ? "VF" : "VOSTFR"}
					</span>
					{episode.duration && (
						<span className="duration">
							{Math.floor(episode.duration / 60)}min
						</span>
					)}
				</div>
				<a href={episode.url} target="_blank" rel="noopener noreferrer" className="btn">
					Regarder
				</a>
			</div>

			<style>{`
				.episode-card {
					border: 1px solid #e0e0e0;
					border-radius: 8px;
					overflow: hidden;
					transition: all 0.3s;
				}

				.episode-card:hover {
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
					transform: translateY(-2px);
				}

				.episode-card img {
					width: 100%;
					height: 140px;
					object-fit: cover;
				}

				.episode-card .content {
					padding: 1rem;
				}

				.episode-card h3 {
					margin: 0 0 0.5rem;
					font-size: 1.1rem;
				}

				.episode-card .title {
					margin: 0 0 1rem;
					font-size: 0.9rem;
					color: #666;
					line-height: 1.4;
				}

				.episode-card .meta {
					display: flex;
					gap: 0.5rem;
					margin-bottom: 1rem;
					font-size: 0.8rem;
				}

				.episode-card .lang {
					background: #2196f3;
					color: white;
					padding: 0.25rem 0.5rem;
					border-radius: 4px;
				}

				.episode-card .btn {
					display: block;
					text-align: center;
					background: #2196f3;
					color: white;
					padding: 0.5rem;
					border-radius: 4px;
					text-decoration: none;
					font-size: 0.9rem;
					transition: background 0.2s;
				}

				.episode-card .btn:hover {
					background: #1976d2;
				}
			`}</style>
		</div>
	);
}

export default IETVBrowser;
