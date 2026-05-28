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
 * Unit tests for the dependency-free HTML → Markdown fallback converter
 * (`src/internal/html-to-markdown.ts`). This is the portable path used when the
 * native rust-bridge cdylib is unavailable, so it must run with nothing but the
 * Bun standard library.
 */

import { describe, expect, test } from "bun:test";
import { htmlToMarkdownJS } from "../../src/internal/html-to-markdown.ts";

describe("htmlToMarkdownJS — portable fallback converter", () => {
	test("drops script/style/noscript noise", () => {
		const md = htmlToMarkdownJS(
			"<style>body{color:red}</style><p>hello</p><script>alert(1)</script>",
		);
		expect(md).toContain("hello");
		expect(md).not.toContain("color:red");
		expect(md).not.toContain("alert");
	});

	test("converts headings to ATX", () => {
		expect(htmlToMarkdownJS("<h1>Title</h1>")).toContain("# Title");
		expect(htmlToMarkdownJS("<h3>Sub</h3>")).toContain("### Sub");
	});

	test("converts links and images", () => {
		expect(htmlToMarkdownJS('<a href="https://x.com">go</a>')).toContain(
			"[go](https://x.com)",
		);
		expect(htmlToMarkdownJS('<img src="/a.png" alt="pic">')).toContain(
			"![pic](/a.png)",
		);
	});

	test("drops javascript: links but keeps their text", () => {
		const md = htmlToMarkdownJS('<a href="javascript:void(0)">click</a>');
		expect(md).toContain("click");
		expect(md).not.toContain("javascript:");
	});

	test("converts emphasis and inline code", () => {
		expect(htmlToMarkdownJS("<strong>b</strong>")).toContain("**b**");
		expect(htmlToMarkdownJS("<em>i</em>")).toContain("*i*");
		expect(htmlToMarkdownJS("<code>x</code>")).toContain("`x`");
	});

	test("converts unordered lists", () => {
		const md = htmlToMarkdownJS("<ul><li>one</li><li>two</li></ul>");
		expect(md).toContain("- one");
		expect(md).toContain("- two");
	});

	test("preserves code block indentation and newlines", () => {
		const md = htmlToMarkdownJS(
			"<pre><code>function f() {\n    return 42;\n}</code></pre>",
		);
		expect(md).toContain("```");
		expect(md).toContain("    return 42;");
		// The fence opens at column 0 for CommonMark recognition.
		expect(md).toMatch(/(^|\n)```\n/);
	});

	test("decodes HTML entities", () => {
		const md = htmlToMarkdownJS("<p>a &amp; b &copy; &#39;c&#39;</p>");
		expect(md).toContain("a & b © 'c'");
	});

	test("collapses excessive whitespace and blank lines", () => {
		const md = htmlToMarkdownJS(
			"<p>a</p>\n\n\n\n   \n<p>b</p>",
		);
		expect(md).not.toMatch(/\n{3,}/);
	});

	test("empty input yields a trailing newline only", () => {
		expect(htmlToMarkdownJS("").trim()).toBe("");
	});
});
