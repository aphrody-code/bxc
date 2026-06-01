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

import { describe, it, expect } from "bun:test";
import {
	parseHtml,
	destroyTree,
	querySelector,
	querySelectorAll,
	htmlToMarkdown,
	getChromiumCookies,
	dnsRecon,
	geminiWebAsk,
} from "../src/rust/bridge.ts";

describe("rust-bridge integration — DOM & Markdown", () => {
	it("should parse HTML and query selectors", () => {
		const html = "<div><span class='target'>Hello</span></div>";
		const tree = parseHtml(html);
		try {
			expect(tree).toBeGreaterThan(0);
			const span = querySelector(tree, "span.target");
			expect(span).toBe('<span class="target">Hello</span>');

			const all = querySelectorAll(tree, "div");
			expect(all).toHaveLength(1);
			expect(all[0]).toContain("div");
		} finally {
			destroyTree(tree);
		}
	});

	it("should convert HTML to Markdown", () => {
		const html = "<h1>Title</h1><p>Body with <b>bold</b></p>";
		const md = htmlToMarkdown(html);
		expect(md.toLowerCase()).toContain("title");
		expect(md).toContain("**bold**");
	});

	it("should run DNS OSINT (via FFI)", () => {
		const results = dnsRecon("google.com");
		expect(Array.isArray(results)).toBe(true);
	});

	it("should support getChromiumCookies FFI signature", () => {
		const cookies = getChromiumCookies("/tmp", "Default", "google.com");
		expect(cookies).toBeDefined();
	});
});
