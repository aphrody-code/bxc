/**
 * Exemple: App Mobile React Native / Expo
 *
 * Usage:
 *   npx create-expo-app ietv-app
 *   npm install @aphrody/ietv-client
 */

import React, { useState, useEffect } from "react";
import {
	View,
	Text,
	ScrollView,
	TouchableOpacity,
	TextInput,
	StyleSheet,
	FlatList,
	Image,
	Linking,
	ActivityIndicator,
} from "react-native";
import IETVClient, { type VideoRef, type ChannelInfo } from "@aphrody/ietv-client";

// ============================================================================
// API Client Setup
// ============================================================================

const client = new IETVClient({
	baseUrl: "http://192.168.1.100:3000", // Point vers serveur local
});

// ============================================================================
// App principale
// ============================================================================

export default function IETVApp() {
	const [tab, setTab] = useState<"browse" | "search">("browse");
	const [channels, setChannels] = useState<ChannelInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		loadChannels();
	}, []);

	const loadChannels = async () => {
		try {
			setLoading(true);
			const data = await client.all();
			setChannels(data.channels);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	return (
		<View style={styles.container}>
			<HeaderBar />

			{error && <ErrorBanner message={error} />}
			{loading && <LoadingSpinner />}

			{!loading && (
				<ScrollView style={styles.content}>
					{tab === "browse" && <BrowseTab channels={channels} />}
					{tab === "search" && <SearchTab client={client} />}
				</ScrollView>
			)}

			<TabBar tab={tab} setTab={setTab} />
		</View>
	);
}

// ============================================================================
// Components
// ============================================================================

function HeaderBar() {
	return (
		<View style={styles.header}>
			<Text style={styles.title}>📺 Inazuma Eleven</Text>
			<Text style={styles.subtitle}>Streaming illimité</Text>
		</View>
	);
}

function ErrorBanner({ message }: { message: string }) {
	return (
		<View style={styles.errorBanner}>
			<Text style={styles.errorText}>{message}</Text>
		</View>
	);
}

function LoadingSpinner() {
	return (
		<View style={styles.loadingContainer}>
			<ActivityIndicator size="large" color="#2196f3" />
			<Text style={styles.loadingText}>Chargement des épisodes...</Text>
		</View>
	);
}

function BrowseTab({ channels }: { channels: ChannelInfo[] }) {
	return (
		<View>
			{channels.map((ch, i) => (
				<ChannelCard key={i} channel={ch} />
			))}
		</View>
	);
}

function SearchTab({ client }: { client: IETVClient }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<VideoRef[]>([]);
	const [searching, setSearching] = useState(false);

	const handleSearch = async (text: string) => {
		setQuery(text);
		if (text.length < 2) {
			setResults([]);
			return;
		}

		setSearching(true);
		try {
			const data = await client.search({ q: text, limit: 20 });
			setResults(data.results);
		} catch (err) {
			console.error("Search failed:", err);
		} finally {
			setSearching(false);
		}
	};

	return (
		<View style={styles.searchTab}>
			<TextInput
				style={styles.searchInput}
				placeholder="Chercher un épisode..."
				value={query}
				onChangeText={handleSearch}
				placeholderTextColor="#999"
			/>

			{searching && <ActivityIndicator size="small" color="#2196f3" style={{ marginTop: 10 }} />}

			<FlatList
				data={results}
				keyExtractor={(ep) => ep.videoId}
				scrollEnabled={false}
				renderItem={({ item: ep }) => (
					<TouchableOpacity
						style={styles.episodeItem}
						onPress={() => Linking.openURL(ep.url)}
					>
						{ep.thumbnail && (
							<Image
								source={{ uri: ep.thumbnail }}
								style={styles.episodeThumbnail}
							/>
						)}
						<View style={styles.episodeInfo}>
							<Text style={styles.episodeTitle}>{ep.title}</Text>
							<View style={styles.episodeMeta}>
								<Text style={styles.episodeNumber}>
									S{ep.season}E{ep.episode}
								</Text>
								<Text
									style={[
										styles.episodeLang,
										ep.language === "vf"
											? styles.vfBadge
											: styles.vostfrBadge,
									]}
								>
									{ep.language.toUpperCase()}
								</Text>
							</View>
						</View>
						<Text style={styles.playIcon}>▶</Text>
					</TouchableOpacity>
				)}
			/>
		</View>
	);
}

function ChannelCard({ channel }: { channel: ChannelInfo }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<View style={styles.channelCard}>
			<TouchableOpacity onPress={() => setExpanded(!expanded)}>
				<View style={styles.channelHeader}>
					<View style={styles.channelInfo}>
						<Text style={styles.channelTitle}>{channel.title}</Text>
						<Text style={styles.channelCount}>
							{channel.totalEpisodes} épisodes
						</Text>
					</View>
					<Text style={styles.expandIcon}>
						{expanded ? "▼" : "▶"}
					</Text>
				</View>
			</TouchableOpacity>

			{expanded && (
				<View style={styles.channelSeasons}>
					{channel.seasons.slice(0, 5).map((s, si) => (
						<View key={si} style={styles.seasonRow}>
							<Text style={styles.seasonLabel}>
								Saison {s.season}
							</Text>
							<Text style={styles.seasonCount}>
								{s.totalEpisodes} épisodes
							</Text>
						</View>
					))}
					{channel.seasons.length > 5 && (
						<Text style={styles.moreSeasons}>
							+{channel.seasons.length - 5} saisons
						</Text>
					)}
				</View>
			)}
		</View>
	);
}

function TabBar({
	tab,
	setTab,
}: {
	tab: "browse" | "search";
	setTab: (t: "browse" | "search") => void;
}) {
	return (
		<View style={styles.tabBar}>
			<TouchableOpacity
				style={[styles.tab, tab === "browse" && styles.activeTab]}
				onPress={() => setTab("browse")}
			>
				<Text
					style={[
						styles.tabLabel,
						tab === "browse" && styles.activeTabLabel,
					]}
				>
					📺 Parcourir
				</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={[styles.tab, tab === "search" && styles.activeTab]}
				onPress={() => setTab("search")}
			>
				<Text
					style={[
						styles.tabLabel,
						tab === "search" && styles.activeTabLabel,
					]}
				>
					🔍 Chercher
				</Text>
			</TouchableOpacity>
		</View>
	);
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#f5f5f5",
	},
	header: {
		backgroundColor: "white",
		paddingTop: 50,
		paddingHorizontal: 16,
		paddingBottom: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	title: {
		fontSize: 24,
		fontWeight: "bold",
		color: "#333",
	},
	subtitle: {
		fontSize: 12,
		color: "#999",
		marginTop: 4,
	},
	content: {
		flex: 1,
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	errorBanner: {
		backgroundColor: "#ffebee",
		padding: 12,
		marginBottom: 12,
		borderRadius: 4,
	},
	errorText: {
		color: "#c62828",
		fontSize: 14,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	loadingText: {
		marginTop: 12,
		color: "#666",
	},
	searchTab: {
		paddingVertical: 8,
	},
	searchInput: {
		backgroundColor: "white",
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#e0e0e0",
		marginBottom: 12,
		fontSize: 16,
		color: "#333",
	},
	channelCard: {
		backgroundColor: "white",
		borderRadius: 8,
		marginBottom: 12,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.1,
		shadowRadius: 2,
		elevation: 2,
	},
	channelHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	channelInfo: {
		flex: 1,
	},
	channelTitle: {
		fontSize: 16,
		fontWeight: "600",
		color: "#333",
	},
	channelCount: {
		fontSize: 12,
		color: "#999",
		marginTop: 4,
	},
	expandIcon: {
		fontSize: 18,
		color: "#2196f3",
	},
	channelSeasons: {
		backgroundColor: "#f9f9f9",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: "#e0e0e0",
	},
	seasonRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		paddingVertical: 8,
		borderBottomWidth: 1,
		borderBottomColor: "#e0e0e0",
	},
	seasonLabel: {
		fontSize: 14,
		fontWeight: "500",
		color: "#333",
	},
	seasonCount: {
		fontSize: 12,
		color: "#999",
	},
	moreSeasons: {
		fontSize: 12,
		color: "#2196f3",
		fontWeight: "500",
		marginTop: 8,
	},
	episodeItem: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "white",
		borderRadius: 8,
		marginBottom: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	episodeThumbnail: {
		width: 60,
		height: 40,
		borderRadius: 4,
		marginRight: 10,
		backgroundColor: "#e0e0e0",
	},
	episodeInfo: {
		flex: 1,
	},
	episodeTitle: {
		fontSize: 13,
		fontWeight: "500",
		color: "#333",
		marginBottom: 4,
	},
	episodeMeta: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	episodeNumber: {
		fontSize: 11,
		color: "#666",
	},
	episodeLang: {
		fontSize: 10,
		fontWeight: "600",
		paddingHorizontal: 4,
		paddingVertical: 2,
		borderRadius: 3,
	},
	vfBadge: {
		backgroundColor: "#e3f2fd",
		color: "#1565c0",
	},
	vostfrBadge: {
		backgroundColor: "#f3e5f5",
		color: "#7b1fa2",
	},
	playIcon: {
		fontSize: 16,
		color: "#2196f3",
		marginLeft: 10,
	},
	tabBar: {
		flexDirection: "row",
		backgroundColor: "white",
		borderTopWidth: 1,
		borderTopColor: "#e0e0e0",
	},
	tab: {
		flex: 1,
		paddingVertical: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	activeTab: {
		borderTopWidth: 3,
		borderTopColor: "#2196f3",
	},
	tabLabel: {
		fontSize: 13,
		fontWeight: "500",
		color: "#999",
	},
	activeTabLabel: {
		color: "#2196f3",
	},
});
