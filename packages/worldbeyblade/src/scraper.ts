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

import {
	launchGhostBrowser,
	type GhostBrowser,
} from "@aphrody/bxc/profiles/ghost";
import { Browser } from "@aphrody/bxc";
import { randomWait, typeNatural } from "@aphrody/bxc/profiles/humanize";
import type { Cookie } from "@aphrody/bxc/cookies/cookie-loader";
import type { AnyPage } from "@aphrody/bxc/api/types";
import type {
	WorldBeybladeProfile,
	WorldBeybladePost,
	WorldBeybladeThread,
	WorldBeybladeForumThread,
	WorldBeybladeForum,
	WorldBeybladePM,
	WorldBeybladeSearchResult,
	WorldBeybladeScraperOptions,
} from "./types.ts";

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

	get page(): AnyPage {
		if (this.ghost) return this.ghost.page;
		if (this.httpPage) return this.httpPage;
		throw new Error("Scraper not initialized. Call init() first.");
	}

	private extractMatchingDiv(block: string, pid: number): string {
		const pidStr = `id="pid_${pid}"`;
		const pidIdx = block.indexOf(pidStr);
		if (pidIdx === -1) return "";
		const startIdx = block.indexOf(">", pidIdx);
		if (startIdx === -1) return "";

		let depth = 1;
		let currentIdx = startIdx + 1;
		const len = block.length;

		while (currentIdx < len) {
			const nextOpen = block.indexOf("<div", currentIdx);
			const nextClose = block.indexOf("</div", currentIdx);

			if (nextClose === -1) {
				return block.slice(startIdx + 1).trim();
			}

			if (nextOpen !== -1 && nextOpen < nextClose) {
				const charAfter = block[nextOpen + 4];
				if (
					charAfter === " " ||
					charAfter === ">" ||
					charAfter === "\r" ||
					charAfter === "\n" ||
					charAfter === "\t"
				) {
					depth++;
				}
				currentIdx = nextOpen + 4;
			} else {
				depth--;
				if (depth === 0) {
					return block.slice(startIdx + 1, nextClose).trim();
				}
				currentIdx = nextClose + 5;
			}
		}

		return block.slice(startIdx + 1).trim();
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
	 * General profile scraper supporting UID, Username, or friendly URL.
	 */
	async getProfile(identifier: string | number): Promise<WorldBeybladeProfile> {
		if (typeof identifier === "number") {
			return this.getProfileByUid(identifier);
		}
		if (identifier.startsWith("http://") || identifier.startsWith("https://")) {
			await this.page.goto(identifier, { timeoutMs: 30_000 });
			if (this.ghost) await randomWait(1000, 2000);
			const html = await this.page.content();
			return this.parseProfileHtml(html);
		}
		if (identifier.includes("User-")) {
			const url = `https://worldbeyblade.org/${identifier}`;
			await this.page.goto(url, { timeoutMs: 30_000 });
			if (this.ghost) await randomWait(1000, 2000);
			const html = await this.page.content();
			return this.parseProfileHtml(html);
		}
		return this.getProfileByUsername(identifier);
	}

	/**
	 * Parses MyBB profile page HTML.
	 */
	private parseProfileHtml(
		html: string,
		fallbackUsername = "",
		expectedUid?: number,
	): WorldBeybladeProfile {
		const clean = (s: string) =>
			s
				.replace(/&amp;/g, "&")
				.replace(/&quot;/g, '"')
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.trim();

		let username = fallbackUsername;
		const nameMatch =
			html.match(/<span class="largetext"><strong>([\s\S]*?)<\/strong>/i) ??
			html.match(/<h2>([\s\S]*?)<\/h2>/i);
		if (nameMatch?.[1]) {
			username = clean(nameMatch[1].replace(/<[^>]+>/g, ""));
		}

		let uid = expectedUid ?? null;
		if (!uid) {
			const uidMatch =
				html.match(/member\.php\?action=profile&amp;uid=(\d+)/i) ??
				html.match(/uid=(\d+)/i);
			if (uidMatch?.[1]) {
				uid = parseInt(uidMatch[1], 10);
			}
		}

		const userGroupMatch = html.match(
			/User Group:<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
		);
		const userGroup = userGroupMatch?.[1]
			? clean(userGroupMatch[1].replace(/<[^>]+>/g, ""))
			: null;

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
			/Reputation:<\/td>\s*<td[^>]*>[^<]*<a[^>]*>([\s\S]*?)<\/a>/i,
		);
		const reputation = reputationMatch?.[1]
			? parseInt(
					reputationMatch[1].replace(/<[^>]+>/g, "").replace(/,/g, ""),
					10,
				)
			: null;

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
	 * Scrapes a forum thread. Supports numeric tid, friendly URL slug, or full URL.
	 */
	async getThread(
		threadIdentifier: number | string,
		pageNum = 1,
	): Promise<WorldBeybladeThread> {
		let url = "";
		if (typeof threadIdentifier === "number") {
			url = `https://worldbeyblade.org/showthread.php?tid=${threadIdentifier}&page=${pageNum}`;
		} else if (
			threadIdentifier.startsWith("http://") ||
			threadIdentifier.startsWith("https://")
		) {
			url = threadIdentifier;
			if (pageNum > 1) {
				url += url.includes("?") ? `&page=${pageNum}` : `?page=${pageNum}`;
			}
		} else {
			const slug = threadIdentifier.startsWith("Thread-")
				? threadIdentifier
				: `Thread-${threadIdentifier}`;
			url = `https://worldbeyblade.org/${slug}`;
			if (pageNum > 1) {
				url += `?page=${pageNum}`;
			}
		}

		this.log(`Fetching thread from URL: ${url}`);
		await this.page.goto(url, { timeoutMs: 30_000 });
		if (this.ghost) await randomWait(1500, 2500);

		const html = await this.page.content();

		let tid = typeof threadIdentifier === "number" ? threadIdentifier : 0;
		if (tid === 0) {
			const tidMatch =
				html.match(/var\s+tid\s*=\s*(\d+);/i) ??
				html.match(/tid=(\d+)/i) ??
				html.match(/thread_(\d+)/i);
			if (tidMatch?.[1]) {
				tid = parseInt(tidMatch[1], 10);
			}
		}

		const titleMatch =
			html.match(/<span class="thread_title">([^<]+)<\/span>/i) ??
			html.match(/<h1>([^<]+)<\/h1>/i) ??
			html.match(/<title>([^<]+)<\/title>/i);
		let title = titleMatch?.[1] ? titleMatch[1].trim() : "Unknown Thread";
		if (title.endsWith(" - worldbeyblade.org")) {
			title = title.slice(0, -" - worldbeyblade.org".length);
		}

		const forumCategory: string[] = [];
		const navStart = html.indexOf('<div class="navigation">');
		if (navStart !== -1) {
			const navEnd = html.indexOf("</div>", navStart);
			if (navEnd !== -1) {
				const navContent = html.slice(
					navStart + '<div class="navigation">'.length,
					navEnd,
				);
				const catList = [...navContent.matchAll(/<a[^>]*>([^<]+)<\/a>/g)];
				for (const m of catList) {
					if (m[1] && m[1] !== "worldbeyblade.org") {
						forumCategory.push(m[1].trim());
					}
				}
			}
		}

		let totalPages = 1;
		const pagesMatch = html.match(/Pages \((\d+)\)/i);
		if (pagesMatch?.[1]) {
			totalPages = parseInt(pagesMatch[1], 10);
		}

		const posts: WorldBeybladePost[] = [];
		const postBlocks = html.split(/<table[^>]+id="post_\d+"[^>]*>/i);
		if (postBlocks.length > 1) {
			for (let i = 1; i < postBlocks.length; i++) {
				const block = postBlocks[i];
				const pidMatch = block.match(/id="pid_(\d+)"/i);
				if (!pidMatch) continue;
				const pid = parseInt(pidMatch[1], 10);

				const authorMatch = block.match(
					/<a[^>]+href="member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
				);
				const authorUid = authorMatch?.[1]
					? parseInt(authorMatch[1], 10)
					: null;
				const authorName = authorMatch?.[2] ? authorMatch[2].trim() : "Guest";

				const dateMatch =
					block.match(/<span class="post_date">([^<]+)<\/span>/i) ??
					block.match(/class="smalltext"[^>]*>([^<]+)<\/span>/i);
				const postDate = dateMatch?.[1]
					? dateMatch[1].replace(/&nbsp;/g, " ").trim()
					: null;

				const contentHtml = this.extractMatchingDiv(block, pid);
				const { htmlToMarkdown } = await import("@aphrody/bxc/internal/html-utils");
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
	 * Scrapes a forum page (list of threads). Supports numeric fid, friendly slug or full URL.
	 */
	async getForum(
		forumIdentifier: number | string,
		pageNum = 1,
	): Promise<WorldBeybladeForum> {
		let url = "";
		if (typeof forumIdentifier === "number") {
			url = `https://worldbeyblade.org/forumdisplay.php?fid=${forumIdentifier}&page=${pageNum}`;
		} else if (
			forumIdentifier.startsWith("http://") ||
			forumIdentifier.startsWith("https://")
		) {
			url = forumIdentifier;
			if (pageNum > 1) {
				url += url.includes("?") ? `&page=${pageNum}` : `?page=${pageNum}`;
			}
		} else {
			const slug = forumIdentifier.startsWith("Forum-")
				? forumIdentifier
				: `Forum-${forumIdentifier}`;
			url = `https://worldbeyblade.org/${slug}`;
			if (pageNum > 1) {
				url += `?page=${pageNum}`;
			}
		}

		this.log(`Fetching forum from URL: ${url}`);
		await this.page.goto(url, { timeoutMs: 30_000 });
		if (this.ghost) await randomWait(1500, 2500);

		const html = await this.page.content();

		let fid = typeof forumIdentifier === "number" ? forumIdentifier : 0;
		if (fid === 0) {
			const fidMatch =
				html.match(/var\s+fid\s*=\s*(\d+);/i) ??
				html.match(/fid=(\d+)/i) ??
				html.match(/forum_(\d+)/i);
			if (fidMatch?.[1]) {
				fid = parseInt(fidMatch[1], 10);
			}
		}

		const titleMatch =
			html.match(/<h1>([^<]+)<\/h1>/i) ??
			html.match(/<title>([^<]+)<\/title>/i);
		let title = titleMatch?.[1] ? titleMatch[1].trim() : "Unknown Forum";
		if (title.endsWith(" - worldbeyblade.org")) {
			title = title.slice(0, -" - worldbeyblade.org".length);
		}

		const threads: WorldBeybladeForumThread[] = [];
		const threadBlocks = html.split(/id="thread_/i);
		if (threadBlocks.length > 1) {
			for (let i = 1; i < threadBlocks.length; i++) {
				const fullBlock = threadBlocks[i];
				const trEnd = fullBlock.search(/<\/tr>/i);
				const block = trEnd !== -1 ? fullBlock.slice(0, trEnd) : fullBlock;
				const idMatch = block.match(/^(\d+)/);
				if (!idMatch) continue;
				const tid = parseInt(idMatch[1], 10);

				const cells = block.split(/<\/td>/i);

				let subIdx = -1;
				for (let c = 0; c < cells.length; c++) {
					if (
						cells[c].includes("Thread-") ||
						cells[c].includes("showthread.php")
					) {
						subIdx = c;
						break;
					}
				}

				if (subIdx === -1) continue;

				const titleMatch = cells[subIdx].match(
					/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
				);
				const threadUrl = titleMatch?.[1] ? titleMatch[1].trim() : "";
				const threadTitle = titleMatch?.[2]
					? titleMatch[2].replace(/<[^>]+>/g, "").trim()
					: "Unknown Title";

				let slug = null;
				if (threadUrl.includes("Thread-")) {
					slug = threadUrl.split("/").pop() ?? null;
				}

				let authorIdx = -1;
				for (let c = subIdx + 1; c < cells.length; c++) {
					if (
						cells[c].includes("member.php?action=profile") ||
						cells[c].includes("uid=")
					) {
						authorIdx = c;
						break;
					}
				}

				let authorUid: number | null = null;
				let authorName = "Guest";

				if (authorIdx !== -1) {
					const authorMatch = cells[authorIdx].match(
						/href="member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
					);
					authorUid = authorMatch?.[1] ? parseInt(authorMatch[1], 10) : null;
					authorName = authorMatch?.[2]
						? authorMatch[2].replace(/<[^>]+>/g, "").trim()
						: "Guest";
				}

				let replies = 0;
				let views = 0;

				const repliesCell = cells[authorIdx + 1];
				if (repliesCell) {
					const cleanVal = repliesCell.replace(/<[^>]+>/g, "").trim();
					replies = parseInt(cleanVal.replace(/,/g, ""), 10) || 0;
				}

				const viewsCell = cells[authorIdx + 2];
				if (viewsCell) {
					const cleanVal = viewsCell.replace(/<[^>]+>/g, "").trim();
					views = parseInt(cleanVal.replace(/,/g, ""), 10) || 0;
				}

				const lastPostCell = cells[authorIdx + 3];
				let lastPostDate = null;
				let lastPostAuthor = null;
				if (lastPostCell) {
					const lastPostMatch =
						lastPostCell.match(/<span class="lastpost">([\s\S]*?)<\/span>/i) ??
						lastPostCell.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
					if (lastPostMatch) {
						const lpText = lastPostMatch[1].trim();
						const lpParts = lpText.split(/\s+by\s+/i);
						if (lpParts[0]) {
							lastPostDate = lpParts[0].replace(/<[^>]+>/g, "").trim();
						}
						if (lpParts[1]) {
							lastPostAuthor = lpParts[1].replace(/<[^>]+>/g, "").trim();
						}
					}
				}

				threads.push({
					tid,
					title: threadTitle,
					slug,
					authorName,
					authorUid,
					replies,
					views,
					lastPostDate,
					lastPostAuthor,
				});
			}
		}

		let totalPages = 1;
		const pagesMatch = html.match(/Pages \((\d+)\)/i);
		if (pagesMatch?.[1]) {
			totalPages = parseInt(pagesMatch[1], 10);
		}

		return {
			fid,
			title,
			threads,
			currentPage: pageNum,
			totalPages,
		};
	}

	/**
	 * Performs a search query on the forum.
	 */
	async search(query: string): Promise<WorldBeybladeSearchResult[]> {
		this.log(`Searching for query: "${query}"...`);
		const profile = this.options.profile ?? "ghost";
		if (profile === "http") {
			return this.searchHeadless(query);
		}

		if (!this.ghost) {
			throw new Error(
				"search requires the 'ghost' profile (full browser automation) or 'http' profile.",
			);
		}

		const fullPage = this.ghost.page;
		await fullPage.goto("https://worldbeyblade.org/search.php", {
			timeoutMs: 30_000,
		});
		await randomWait(1500, 2500);

		await fullPage.waitForSelector("input[name='keywords']");
		await typeNatural(fullPage, "input[name='keywords']", query);

		await fullPage.click("input[name='submit']");
		await randomWait(4000, 6000);

		const html = await fullPage.content();
		return this.parseSearchResultsHtml(html);
	}

	/**
	 * Headless search version using direct HTTP POST.
	 */
	async searchHeadless(query: string): Promise<WorldBeybladeSearchResult[]> {
		this.log(`Performing headless search for query: "${query}"...`);
		const { ImpersonatedClient } = await import(
			"@aphrody/bxc/ffi/curl-impersonate"
		);
		const { buildCookieHeader } = await import(
			"@aphrody/bxc/cookies/cookie-injector"
		);

		const client = new ImpersonatedClient({ profile: "chrome131" });
		const url = "https://worldbeyblade.org/search.php";
		const body = `action=do_search&keywords=${encodeURIComponent(query)}&postthread=1&matchusername=1&postdate=0&pddir=1&findthreadst=1&numwords=&forums%5B%5D=all&submit=Search`;

		const headers: Record<string, string> = {
			"content-type": "application/x-www-form-urlencoded",
			"user-agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		};

		let cookiesArray: Cookie[] = [];
		if (typeof this.options.cookies === "string") {
			const { loadCookieJar } = await import("@aphrody/bxc/cookies/cookie-loader");
			cookiesArray = await loadCookieJar(this.options.cookies);
		} else if (Array.isArray(this.options.cookies)) {
			cookiesArray = this.options.cookies;
		}

		const cookieHeader = buildCookieHeader(cookiesArray, url);
		if (cookieHeader) {
			headers.cookie = cookieHeader;
		}

		try {
			const res = await client.fetch(url, {
				method: "POST",
				headers,
				body,
				followRedirects: true,
			});
			if (!res.ok) {
				throw new Error(`Headless search failed: HTTP ${res.status}`);
			}
			const html = await res.text();
			return this.parseSearchResultsHtml(html);
		} finally {
			client.close();
		}
	}

	private parseSearchResultsHtml(html: string): WorldBeybladeSearchResult[] {
		const results: WorldBeybladeSearchResult[] = [];
		const rows = html.split(/<tr[^>]*class="[^"]*inline_row[^"]*"/gi);
		if (rows.length > 1) {
			for (let i = 1; i < rows.length; i++) {
				const fullBlock = rows[i];
				const trEnd = fullBlock.search(/<\/tr>/i);
				const block = trEnd !== -1 ? fullBlock.slice(0, trEnd) : fullBlock;
				const tidMatch =
					block.match(/showthread\.php\?tid=(\d+)/i) ??
					block.match(/Thread-([a-zA-Z0-9_-]+)/i);
				if (!tidMatch) continue;
				let tid = 0;
				if (tidMatch[1].match(/^\d+$/)) {
					tid = parseInt(tidMatch[1], 10);
				}

				const titleMatch =
					block.match(
						/<a[^>]+class="[^"]*subject[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
					) ??
					block.match(
						/href="[^"]*showthread\.php\?tid=\d+"[^>]*>([\s\S]*?)<\/a>/i,
					);
				const title = titleMatch?.[1]
					? titleMatch[1].replace(/<[^>]+>/g, "").trim()
					: "Unknown";

				const authorMatch = block.match(
					/member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
				);
				const authorName = authorMatch?.[2] ? authorMatch[2].trim() : "Guest";

				const forumMatch = block.match(
					/forumdisplay\.php\?fid=(\d+)"[^>]*>([^<]+)<\/a>/i,
				);
				const forumName = forumMatch?.[2]
					? forumMatch[2].trim()
					: "Unknown Forum";

				const repliesMatch =
					block.match(/replies[^>]*>([\d,]+)/i) ??
					block.match(/MyBB\.whoPosted\(\d+\);"[^>]*>([\d,]+)/i);
				const replies = repliesMatch?.[1]
					? parseInt(repliesMatch[1].replace(/,/g, ""), 10)
					: 0;

				const viewsMatch = block.match(/views[^>]*>([\d,]+)/i);
				const views = viewsMatch?.[1]
					? parseInt(viewsMatch[1].replace(/,/g, ""), 10)
					: 0;

				results.push({
					tid,
					title,
					authorName,
					forumName,
					replies,
					views,
				});
			}
		}
		return results;
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

		const rows = html.split(/<tr[^>]*>/gi);
		for (const fullRowHtml of rows) {
			const trEnd = fullRowHtml.search(/<\/tr>/i);
			const rowHtml = trEnd !== -1 ? fullRowHtml.slice(0, trEnd) : fullRowHtml;
			const pmidMatch = rowHtml.match(
				/private\.php\?action=read&amp;pmid=(\d+)/i,
			);
			if (!pmidMatch) continue;
			const pmid = parseInt(pmidMatch[1], 10);

			const titleMatch = rowHtml.match(
				/private\.php\?action=read&amp;pmid=\d+"[^>]*>([\s\S]*?)<\/a>/i,
			);
			const title = titleMatch?.[1]
				? titleMatch[1].replace(/<[^>]+>/g, "").trim()
				: "No Subject";

			const senderMatch = rowHtml.match(
				/member\.php\?action=profile&amp;uid=(\d+)"[^>]*>([^<]+)<\/a>/i,
			);
			const senderUid = senderMatch?.[1] ? parseInt(senderMatch[1], 10) : null;
			const senderName = senderMatch?.[2]
				? senderMatch[2].replace(/<[^>]+>/g, "").trim()
				: "System";

			const dateMatch = rowHtml.match(
				/<span class="smalltext">([^<]+)<\/span>/i,
			);
			const date = dateMatch?.[1] ? dateMatch[1].trim() : null;

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

		this.log("Filling recipient field...");
		await fullPage.waitForSelector("#to");
		await typeNatural(fullPage, "#to", toUsername);

		this.log("Filling subject field...");
		await typeNatural(fullPage, "input[name='subject']", subject);

		this.log("Filling message body...");
		await typeNatural(fullPage, "textarea[name='message']", message);

		this.log("Submitting the message...");
		await fullPage.click("input[name='submit']");
		await randomWait(4000, 6000);

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
