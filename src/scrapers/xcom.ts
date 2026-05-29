/**
 * Copyright 2026 aphrody-code
 *
 * Dedicated scraper module for x.com (Twitter).
 * Utilizes Bxc's Ghost profile for advanced anti-detection,
 * network interception to block unnecessary assets, and
 * structured data extraction.
 */

import {
	launchGhostBrowser,
	type GhostBrowser,
} from "../profiles/ghost/index.ts";
import { randomWait, scrollHuman } from "../profiles/humanize.ts";

export interface XComProfileData {
	username: string;
	markdownSnapshot: string;
	screenshot?: Uint8Array;
}

export class XComScraper {
	private ghost: GhostBrowser | null = null;

	/**
	 * Initializes the Ghost browser with stealth patches.
	 */
	async init(options?: { headless?: boolean }) {
		if (this.ghost) return;
		// Launch Ghost with a coherent fingerprint
		this.ghost = await launchGhostBrowser({
			locale: "en-US",
			timezone: "America/New_York",
			log: (msg) => console.log(msg),
		});

		// Setup network interception to speed up loading and save bandwidth
		// Blocking images, media, and fonts
		if (this.ghost.page.blockResources) {
			await this.ghost.page.blockResources(["image", "media", "font"]);
		}
	}

	/**
	 * Extracts public information from an X.com profile.
	 *
	 * @param username The Twitter username without the @
	 * @param withScreenshot Whether to capture a screenshot of the profile
	 */
	async extractProfile(
		username: string,
		withScreenshot = false,
	): Promise<XComProfileData> {
		if (!this.ghost) {
			throw new Error("Scraper not initialized. Call init() first.");
		}

		const url = `https://x.com/${username}`;
		console.log(`[XComScraper] Navigating to ${url}...`);

		const response = await this.ghost.page.goto(url, { timeoutMs: 30_000 });
		if (!response.ok && response.status !== 0) {
			// status 0 is common for single-page app navigations
			console.warn(
				`[XComScraper] Navigation might have failed with status ${response.status}`,
			);
		}

		// Wait for the page to render (React hydration)
		// We use randomWait to simulate human behavior
		await randomWait(3000, 5000);

		// Attempt to wait for the primary react-root to be visible
		try {
			await this.ghost.page.waitForSelector("#react-root", 15_000);
			console.log(`[XComScraper] #react-root found.`);
		} catch (err) {
			console.warn(`[XComScraper] #react-root not found in time.`);
		}

		// Simulate human scrolling to load dynamic content
		await scrollHuman(this.ghost.page, 300);
		await randomWait(1000, 2000);

		// Extract content as Markdown
		console.log(`[XComScraper] Extracting Markdown...`);
		const markdownSnapshot = await this.ghost.page.markdown();

		// Optional: Take a screenshot
		let screenshot: Uint8Array | undefined;
		if (withScreenshot) {
			console.log(`[XComScraper] Capturing screenshot...`);
			screenshot = await this.ghost.page.screenshot({ format: "png" });
		}

		return {
			username,
			markdownSnapshot,
			screenshot,
		};
	}

	/**
	 * Performs structured extraction using local AI.
	 */
	async aiExtractProfileInfo(): Promise<any> {
		if (!this.ghost) throw new Error("Not initialized");

		if ((this.ghost.page as any).aiExtract) {
			console.log(`[XComScraper] Running AI extraction...`);
			const result = await (this.ghost.page as any).aiExtract(
				"Extract the user's display name, handle, bio description, number of following, and number of followers.",
			);
			return result.data;
		}

		throw new Error("aiExtract is not available on this page object.");
	}

	/**
	 * Closes the browser and cleans up resources.
	 */
	async close() {
		if (this.ghost) {
			await this.ghost.close();
			this.ghost = null;
		}
	}
}
