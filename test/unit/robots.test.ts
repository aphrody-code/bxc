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

import { describe, expect, test } from "bun:test";
import { RobotsFile } from "../../src/utils/robots.ts";

describe("RobotsFile Parser (Unified)", () => {
	test("parses basic Allow/Disallow rules", () => {
		const content = `
User-agent: *
Disallow: /private
Allow: /public
`;
		const robots = RobotsFile.parse("https://example.com/robots.txt", content);
		expect(robots.isAllowed("https://example.com/public")).toBe(true);
		expect(robots.isAllowed("https://example.com/private")).toBe(false);
	});

	test("respects user-agent specificity", () => {
		const content = `
User-agent: *
Disallow: /

User-agent: MyBot
Allow: /
`;
		const robots = RobotsFile.parse("https://example.com/robots.txt", content);
		expect(robots.isAllowed("https://example.com/any", "OtherBot")).toBe(false);
		expect(robots.isAllowed("https://example.com/any", "MyBot")).toBe(true);
	});

	test("parses Crawl-delay", () => {
		const content = `
User-agent: *
Crawl-delay: 5
`;
		const robots = RobotsFile.parse("https://example.com/robots.txt", content);
		expect(robots.crawlDelay("*")).toBe(5);
	});

	test("parses Sitemaps", () => {
		const content = `
Sitemap: https://example.com/sitemap1.xml
Sitemap: https://example.com/sitemap2.xml
`;
		const robots = RobotsFile.parse("https://example.com/robots.txt", content);
		expect(robots.sitemaps).toContain("https://example.com/sitemap1.xml");
		expect(robots.sitemaps).toContain("https://example.com/sitemap2.xml");
	});
});
