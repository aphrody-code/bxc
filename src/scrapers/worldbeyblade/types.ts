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

import type { Cookie } from "../../cookies/cookie-loader.ts";

export interface WorldBeybladeProfile {
	uid: number | null;
	username: string;
	userGroup: string | null;
	postCount: number | null;
	joinedDate: string | null;
	lastVisit: string | null;
	reputation: number | null;
	avatarUrl: string | null;
}

export interface WorldBeybladePost {
	pid: number;
	authorName: string;
	authorUid: number | null;
	postDate: string | null;
	contentMarkdown: string;
	contentHtml: string;
}

export interface WorldBeybladeThread {
	tid: number;
	title: string;
	forumCategory: string[];
	posts: WorldBeybladePost[];
	currentPage: number;
	totalPages: number;
}

export interface WorldBeybladeForumThread {
	tid: number;
	title: string;
	slug: string | null;
	authorName: string;
	authorUid: number | null;
	replies: number;
	views: number;
	lastPostDate: string | null;
	lastPostAuthor: string | null;
}

export interface WorldBeybladeForum {
	fid: number;
	title: string;
	threads: WorldBeybladeForumThread[];
	currentPage: number;
	totalPages: number;
}

export interface WorldBeybladePM {
	pmid: number;
	title: string;
	senderName: string;
	senderUid: number | null;
	date: string | null;
	isRead: boolean;
}

export interface WorldBeybladeSearchResult {
	tid: number;
	title: string;
	authorName: string;
	forumName: string;
	replies: number;
	views: number;
}

export interface WorldBeybladeScraperOptions {
	/** bxCs transport profile. `ghost` (default) is stealth browser. `http` is pure HTTP/FFI. */
	profile?: "ghost" | "http";
	/** Custom User-Agent to override generated fingerprint. Useful for matching imported cookies. */
	userAgent?: string;
	/** Pre-validated cookie jar path or `Cookie[]` array. */
	cookies?: string | Cookie[];
	/** Logger callback. */
	log?: (msg: string) => void;
}

// Player rankings types
export interface WBOPlayerRanking {
	rank: number | null;
	username: string;
	profileUrl: string;
	points: number | null;
	pointsType: string;
	wins: number;
	losses: number;
	category: string;
}

// Metagame analytics types
export interface WBOCombo {
	blade: string;
	ratchet: string;
	bit: string;
}

export interface WBOPodium {
	first_place: WBOCombo[];
	second_place: WBOCombo[];
	third_place: WBOCombo[];
}

export interface WBOTournament {
	tournament_id: string;
	date: string;
	podium: WBOPodium;
}

export interface WBOAnomaly {
	post_id: number | string;
	date: string;
	type: string;
	text: string;
}

export interface WBOPartRanking {
	part: string;
	average_score: number;
	placements: number;
	total_score: number;
}

export interface WBOComboSynergy {
	part_a: string;
	part_b: string;
	co_occurrences: number;
	average_success: number;
	synergy_score: number;
}

export interface WBOMetagameData {
	metadata: {
		total_tournaments: number;
		scraped_at: string;
	};
	part_rankings: WBOPartRanking[];
	combo_synergy: WBOComboSynergy[];
	anomalies: WBOAnomaly[];
}
