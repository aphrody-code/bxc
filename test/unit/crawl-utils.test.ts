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

import { describe, expect, it, mock } from "bun:test";
import { isCrawlFailure } from "../../src/crawler/crawl-utils.ts";

describe("crawl-utils: isCrawlFailure", () => {
	it("should return true for status >= 400", () => {
		expect(isCrawlFailure(403, "Forbidden", "Error")).toBe(true);
		expect(isCrawlFailure(503, "Service Unavailable", "Error")).toBe(true);
	});

	it("should return true for Cloudflare patterns", () => {
		expect(isCrawlFailure(200, "Just a moment while we check your browser...", "Checking")).toBe(true);
		expect(isCrawlFailure(200, "cf-challenge is here", "Checking")).toBe(true);
		expect(isCrawlFailure(200, "hcaptcha widget", "Solve Captcha")).toBe(true);
		expect(isCrawlFailure(200, "Valid page", "Just a moment...")).toBe(true);
	});

	it("should return true for very short body", () => {
		expect(isCrawlFailure(200, "short", "Short Page")).toBe(true);
	});

	it("should return false for valid page", () => {
		const html = "<html><body><h1>Hello World</h1><p>This is a valid test page with enough content to pass the length check.</p></body></html>";
		expect(isCrawlFailure(200, html, "Hello World")).toBe(false);
	});

	it("should not flag an ordinary page merely served by Cloudflare", () => {
		// email-decode / rocket-loader / beacon are injected into plain 200s across
		// a large share of the web. Matching the bare word "cloudflare" flagged
		// every CF-fronted page as blocked and burned the escalation chain on a
		// body that had already been fetched in full.
		const html = `<html><head><title>Real page</title>
			<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js"></script>
			<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>
			<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6"></script>
			</head><body><h1>Catalogue</h1><p>${"content ".repeat(30)}</p>
			<a href="/cdn-cgi/l/email-protection">contact</a></body></html>`;
		expect(isCrawlFailure(200, html, "Real page")).toBe(false);
	});

	it("should still flag a genuine Cloudflare challenge", () => {
		const html = `<html><head><title>Just a moment...</title></head><body>
			<div id="challenge-form"></div>
			<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
			<p>${"verifying ".repeat(40)}</p></body></html>`;
		expect(isCrawlFailure(200, html, "Just a moment...")).toBe(true);
		// ...and on the body alone, when the title is missing.
		expect(isCrawlFailure(200, html, "")).toBe(true);
	});

	it("should not flag a real page that merely embeds a CAPTCHA widget", () => {
		const html = `<html><body><h1>Contact</h1><p>${"text ".repeat(600)}</p>
			<div class="g-recaptcha"></div></body></html>`;
		expect(isCrawlFailure(200, html, "Contact")).toBe(false);
	});
});
