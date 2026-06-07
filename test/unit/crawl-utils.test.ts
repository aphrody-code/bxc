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
});
