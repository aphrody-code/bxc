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

/**
 * @module bxc/scrapers/worldbeyblade
 *
 * Dedicated scraper and automation module for **worldbeyblade.org** (MyBB forum engine).
 * Supports profile extraction, thread/post scraping, PM (private messages) listing,
 * and sending private messages using Bxc's Ghost/HTTP transports.
 *
 * @example
 * ```ts
 * import { WorldBeybladeScraper } from "bxc/scrapers/worldbeyblade";
 *
 * const wb = new WorldBeybladeScraper();
 * await wb.init({
 *   cookies: "./data/worldbeyblade_cookies.json"
 * });
 *
 * const isLoggedIn = await wb.checkLoginStatus();
 * console.log("Logged in:", isLoggedIn);
 *
 * const profile = await wb.getProfileByUsername("aphrody");
 * console.log("Profile joined date:", profile.joinedDate);
 *
 * await wb.close();
 * ```
 */

import {
	launchGhostBrowser,
	type GhostBrowser,
} from "../profiles/ghost/index.ts";
import { Browser } from "../api/browser.ts";
import { randomWait, typeNatural } from "../profiles/humanize.ts";
import type { Cookie } from "../cookies/cookie-loader.ts";
import type { AnyPage } from "../api/types.ts";

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

export class WorldBeybladeScraper {
	private ghost: GhostBrowser | null = null;
	private httpPage: AnyPage | null = null;
	private options: WorldBeybladeScraperOptions = {};
	private log: (msg: string) => void = () => {};

	/**
	 * Initializes the scraper session.
	 */
	async init(options: WorldBeybladeScraperOptions = {}) {
		this.options = options;
		this.log =
			options.log ?? ((msg) => console.log(`[WorldBeybladeScraper] ${msg}`));
		const profile = options.profile ?? "ghost";

		if (profile === "ghost") {
			this.log("Launching Ghost Browser...");
			this.ghost = await launchGhostBrowser({
				cookies:
					typeof options.cookies === "string" ? options.cookies : undefined,
				fingerprint: options.userAgent
					? { customUserAgent: options.userAgent }
					: undefined,
				log: this.log,
			});
			if (Array.isArray(options.cookies) && options.cookies.length > 0) {
				await this.ghost.page.addCookies(options.cookies);
			}
		} else {
			this.log("Initializing HTTP transport page...");
			this.httpPage = await Browser.newPage({
				profile: "http",
				userAgent: options.userAgent,
				cookies: options.cookies,
			});
		}
	}

	private get page(): AnyPage {
		if (this.ghost) return this.ghost.page;
		if (this.httpPage) return this.httpPage;
		throw new Error("Scraper not initialized. Call init() first.");
	}

	/**
	 * Verifies whether the session is currently authenticated on the forum.
	 */
	async checkLoginStatus(): Promise<boolean> {
		this.log("Checking login status...");
		await this.page.goto("https://worldbeyblade.org/index.php", {
			timeoutMs: 30_000,
		});
		if (this.ghost) {
			await randomWait(1500, 3000);
		}
		const html = await this.page.content();
		// MyBB logout link is member.php?action=logout
		const isLoggedIn =
			html.includes("action=logout") || html.includes("usercp.php");
		this.log(`Login status verified: ${isLoggedIn}`);
		return isLoggedIn;
	}

	/**
	 * Scrapes a member's profile by their Username.
	 */
	async getProfileByUsername(username: string): Promise<WorldBeybladeProfile> {
		this.log(`Fetching profile for username: ${username}`);
		const url = `https://worldbeyblade.org/member.php?action=profile&username=${encodeURIComponent(username)}`;
		await this.page.goto(url, { timeoutMs: 30_000 });
		if (this.ghost) await randomWait(1000, 2000);

		const html = await this.page.content();
		return this.parseProfileHtml(html, username);
	}

	/**
	 * Scrapes a member's profile by their User ID (UID).
	 */
	async getProfileByUid(uid: number): Promise<WorldBeybladeProfile> {
		this.log(`Fetching profile for UID: ${uid}`);
		const url = `https://worldbeyblade.org/member.php?action=profile&uid=${uid}`;
		await this.page.goto(url, { timeoutMs: 30_000 });
		if (this.ghost) await randomWait(1000, 2000);

		const html = await this.page.content();
		return this.parseProfileHtml(html, "", uid);
	}

	/**
	 * Parses MyBB profile page HTML.
	 */
	private parseProfileHtml(
		html: string,
		fallbackUsername = "",
		expectedUid?: number,
	): WorldBeybladeProfile {
		// Clean entities
		const clean = (s: string) =>
			s
				.replace(/&amp;/g, "&")
				.replace(/&quot;/g, '"')
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.trim();

		// Extract Username
		// Typically inside <span class="largetext"><strong>Username</strong></span> or <h2>Username</h2>
		let username = fallbackUsername;
		const nameMatch =
			html.match(/<span class="largetext"><strong>([^<]+)<\/strong>/i) ??
			html.match(/<h2>([^<]+)<\/h2>/i);
		if (nameMatch?.[1]) {
			username = clean(nameMatch[1]);
		}

		// Extract Uid
		let uid = expectedUid ?? null;
		if (!uid) {
			const uidMatch =
				html.match(/member\.php\?action=profile&amp;uid=(\d+)/i) ??
				html.match(/uid=(\d+)/i);
			if (uidMatch?.[1]) {
				uid = parseInt(uidMatch[1], 10);
			}
		}

		// Extract user details
		const userGroupMatch = html.match(
			/User Group:<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
		);
		const userGroup = userGroupMatch?.[1] ? clean(userGroupMatch[1]) : null;

		const postCountMatch = html.match(
			/Total Posts:<\/td>\s*<td[^>]*>([\d,]+)/i,
		);
		const postCount = postCountMatch?.[1]
			? parseInt(postCountMatch[1].replace(/,/g, ""), 10)
			: null;

		const joinedMatch = html.match(/Joined:<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
		const joinedDate = joinedMatch?.[1] ? clean(joinedMatch[1]) : null;

		const lastVisitMatch = html.match(
			/Last Visit:<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
		);
		const lastVisit = lastVisitMatch?.[1] ? clean(lastVisitMatch[1]) : null;

		const reputationMatch = html.match(
			/Reputation:<\/td>\s*<td[^>]*>[^<]*<a[^>]*>([\d,+-]+)<\/a>/i,
		);
		const reputation = reputationMatch?.[1]
			? parseInt(reputationMatch[1].replace(/,/g, ""), 10)
			: null;

		// Extract avatar URL
		const avatarMatch =
			html.match(/<img[^>]+src="([^"]+)"[^>]+alt="[^"]*Avatar/i) ??
			html.match(/class="avatar"[^>]+src="([^"]+)"/i);
		const avatarUrl = avatarMatch?.[1] ? clean(avatarMatch[1]) : null;

		return {
			uid,
			username,
			userGroup,
			postCount,
			joinedDate,
			lastVisit,
			reputation,
			avatarUrl:
				avatarUrl && !avatarUrl.startsWith("http")
					? `https://worldbeyblade.org/${avatarUrl}`
					: avatarUrl,
		};
	}

	/**
	 * Scrapes a forum thread.
	 */
	async getThread(tid: number, pageNum = 1): Promise<WorldBeybladeThread> {
		this.log(`Fetching thread tid: ${tid}, page: ${pageNum}`);
		const url = `https://worldbeyblade.org/showthread.php?tid=${tid}&page=${pageNum}`;
		await this.page.goto(url, { timeoutMs: 30_000 });
		if (this.ghost) await randomWait(1500, 2500);

		const html = await this.page.content();

		// Extract title
		const titleMatch =
			html.match(/<span class="thread_title">([^<]+)<\/span>/i) ??
			html.match(/<h1>([^<]+)<\/h1>/i) ??
			html.match(/<title>([^<]+)<\/title>/i);
		let title = titleMatch?.[1] ? titleMatch[1].trim() : "Unknown Thread";
		if (title.endsWith(" - worldbeyblade.org")) {
			title = title.slice(0, -" - worldbeyblade.org".length);
		}

		// Extract categories navigation path
		const categoryMatches = [
			...html.matchAll(/<div class="navigation">([\s\S]*?)<\/div>/gi),
		];
		const forumCategory: string[] = [];
		if (categoryMatches.length > 0) {
			const catList = [
				...categoryMatches[0][1].matchAll(/<a[^>]*>([^<]+)<\/a>/g),
			];
			for (const m of catList) {
				if (m[1] && m[1] !== "worldbeyblade.org") {
					forumCategory.push(m[1].trim());
				}
			}
		}

		// Pagination extraction
		let totalPages = 1;
		const pagesMatch = html.match(/Pages \((\d+)\)/i);
		if (pagesMatch?.[1]) {
			totalPages = parseInt(pagesMatch[1], 10);
		}

		// Extract posts
		// In MyBB, each post has a container like id="post_12345"
		const posts: WorldBeybladePost[] = [];
		const postBlocks = html.split(/<table[^>]+id="post_\d+"[^>]*>/i);
		if (postBlocks.length > 1) {
			// Skip first segment since it's prior to the first post table block
			for (let i = 1; i < postBlocks.length; i++) {
				const block = postBlocks[i];
				// Wait, let's extract post details using regex on this block segment
				const pidMatch = block.match(/id="pid_(\d+)"/i);
				if (!pidMatch) continue;
				const pid = parseInt(pidMatch[1], 10);

				// Author details
				const authorMatch = block.match(
					/<a[^>]+href="member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
				);
				const authorUid = authorMatch?.[1]
					? parseInt(authorMatch[1], 10)
					: null;
				const authorName = authorMatch?.[2] ? authorMatch[2].trim() : "Guest";

				// Post Date
				const dateMatch =
					block.match(/<span class="post_date">([^<]+)<\/span>/i) ??
					block.match(/class="smalltext"[^>]*>([^<]+)<\/span>/i);
				const postDate = dateMatch?.[1]
					? dateMatch[1].replace(/&nbsp;/g, " ").trim()
					: null;

				// Post Body
				// Find body content between id="pid_XXXX" ... </div>
				const bodyMatch =
					block.match(
						/<div class="post_body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<!--/i,
					) ?? block.match(/id="pid_\d+"[^>]*>([\s\S]*?)<\/div>/i);
				const contentHtml = bodyMatch?.[1] ? bodyMatch[1].trim() : "";

				// Standard Markdown conversion
				const { htmlToMarkdown } = await import("../internal/html-utils.ts");
				const contentMarkdown = htmlToMarkdown(contentHtml);

				posts.push({
					pid,
					authorName,
					authorUid,
					postDate,
					contentMarkdown,
					contentHtml,
				});
			}
		}

		return {
			tid,
			title,
			forumCategory,
			posts,
			currentPage: pageNum,
			totalPages,
		};
	}

	/**
	 * Lists Private Messages (PMs) from the User Inbox.
	 */
	async getInbox(): Promise<WorldBeybladePM[]> {
		this.log("Fetching private message inbox...");
		await this.page.goto("https://worldbeyblade.org/private.php", {
			timeoutMs: 30_000,
		});
		if (this.ghost) await randomWait(1500, 2500);

		const html = await this.page.content();
		const pms: WorldBeybladePM[] = [];

		// Match rows in PM table by splitting on tr tags
		const rows = html.split(/<tr[^>]*>/gi);
		for (const rowHtml of rows) {
			const pmidMatch = rowHtml.match(
				/private\.php\?action=read&amp;pmid=(\d+)/i,
			);
			if (!pmidMatch) continue;
			const pmid = parseInt(pmidMatch[1], 10);

			// Subject / Title
			const titleMatch = rowHtml.match(
				/private\.php\?action=read&amp;pmid=\d+"[^>]*>([\s\S]*?)<\/a>/i,
			);
			const title = titleMatch?.[1]
				? titleMatch[1].replace(/<[^>]+>/g, "").trim()
				: "No Subject";

			// Sender
			const senderMatch = rowHtml.match(
				/member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
			);
			const senderUid = senderMatch?.[1] ? parseInt(senderMatch[1], 10) : null;
			const senderName = senderMatch?.[2]
				? senderMatch[2].replace(/<[^>]+>/g, "").trim()
				: "System";

			// Date
			const dateMatch = rowHtml.match(
				/<span class="smalltext">([^<]+)<\/span>/i,
			);
			const date = dateMatch?.[1] ? dateMatch[1].trim() : null;

			// Is Read?
			// Check if the icon contains 'unread' or if the text is bolded
			const isRead =
				!rowHtml.includes("unread") && !rowHtml.includes("<strong>");

			pms.push({
				pmid,
				title,
				senderName,
				senderUid,
				date,
				isRead,
			});
		}

		return pms;
	}

	/**
	 * Sends a private message to a specific user.
	 * Returns true if the message was sent successfully.
	 */
	async sendPM(
		toUsername: string,
		subject: string,
		message: string,
	): Promise<boolean> {
		this.log(`Attempting to send PM to ${toUsername}...`);
		if (!this.ghost) {
			throw new Error(
				"sendPM requires the 'ghost' profile (full browser automation) to submit forms securely.",
			);
		}

		const fullPage = this.ghost.page;
		await fullPage.goto("https://worldbeyblade.org/private.php?action=send", {
			timeoutMs: 30_000,
		});
		await randomWait(2000, 3000);

		// Fill to field
		this.log("Filling recipient field...");
		await fullPage.waitForSelector("#to");
		await typeNatural(fullPage, "#to", toUsername);

		// Fill subject
		this.log("Filling subject field...");
		await typeNatural(fullPage, "input[name='subject']", subject);

		// Fill message body
		this.log("Filling message body...");
		await typeNatural(fullPage, "textarea[name='message']", message);

		// Click send button
		this.log("Submitting the message...");
		await fullPage.click("input[name='submit']");
		await randomWait(4000, 6000);

		// Verify success by checking if page redirected or shows a success alert
		const afterHtml = await fullPage.content();
		const isSuccess =
			afterHtml.includes("The private message has been sent successfully") ||
			afterHtml.includes("Message Sent") ||
			!(await fullPage.title()).includes("Compose");

		this.log(`PM delivery result: ${isSuccess}`);
		return isSuccess;
	}

	/**
	 * Closes the scraper session and releases browser resources.
	 */
	async close() {
		if (this.ghost) {
			await this.ghost.close();
			this.ghost = null;
		}
		if (this.httpPage) {
			await this.httpPage.close();
			this.httpPage = null;
		}
	}
}
