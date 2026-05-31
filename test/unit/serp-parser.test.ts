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
 * Unit tests for the layout-agnostic SERP parser (`src/google/serp-parser.ts`).
 * Uses synthetic HTML mirroring the modern `div.MjjYud` (udm=14) and legacy
 * `div.g` markups so the parser is guarded without shipping a 300 KB fixture.
 */

import { describe, expect, test } from "bun:test";
import { parseSerp } from "../../src/google/serp-parser.ts";

const MODERN = `
<div id="rso">
  <div class="MjjYud"><div class="kb0PBd" data-snhf="0"><div class="yuRUbf">
    <a href="https://bun.com/"><h3 class="LC20lb">Bun &amp; the fast runtime</h3></a>
    <cite>bun.com</cite></div>
    <div class="VwiC3b">A drop-in replacement for Node.js using JSC &lt;3.Read more</div>
  </div></div>
  <div class="MjjYud"><div class="yuRUbf">
    <a href="https://github.com/oven-sh/bun"><h3 class="LC20lb">oven-sh/bun</h3></a></div>
    <div class="VwiC3b">All-in-one toolkit.</div>
  </div>
  <div class="MjjYud"><div class="yuRUbf">
    <a href="/search?q=related"><h3>Internal nav (should be skipped)</h3></a></div>
  </div>
</div>`;

const CLASSIC = `
<div class="g">
  <a href="/url?q=https://example.org/page&sa=U"><h3>Example via redirect</h3></a>
  <div class="VwiC3b">Snippet text.</div>
</div>
<div class="g">
  <a href="https://bun.com/"><h3>Bun duplicate</h3></a>
  <div class="VwiC3b">dup.</div>
</div>`;

describe("parseSerp — organic extraction", () => {
	test("extracts modern udm=14 (div.MjjYud) results", async () => {
		const r = await parseSerp(MODERN, "bun");
		expect(r.organic.length).toBe(2);
		expect(r.organic[0]?.title).toBe("Bun & the fast runtime");
		expect(r.organic[0]?.url).toBe("https://bun.com/");
		expect(r.organic[1]?.url).toBe("https://github.com/oven-sh/bun");
	});

	test("strips 'Read more' and decodes entities in snippets", async () => {
		const r = await parseSerp(MODERN, "bun");
		expect(r.organic[0]?.snippet).toBe(
			"A drop-in replacement for Node.js using JSC <3.",
		);
		expect(r.organic[0]?.snippet).not.toContain("Read more");
	});

	test("skips Google-internal navigation links", async () => {
		const r = await parseSerp(MODERN, "bun");
		expect(r.organic.some((o) => o.title.includes("Internal nav"))).toBe(false);
	});

	test("derives a clean displayedUrl host", async () => {
		const r = await parseSerp(MODERN, "bun");
		expect(r.organic[0]?.displayedUrl).toBe("bun.com");
	});

	test("decodes /url?q= redirect wrappers (classic layout)", async () => {
		const r = await parseSerp(CLASSIC, "x");
		const ex = r.organic.find((o) => o.title.includes("Example"));
		expect(ex?.url).toBe("https://example.org/page");
	});

	test("dedupes the same URL across block types", async () => {
		const r = await parseSerp(MODERN + CLASSIC, "bun");
		const bunHits = r.organic.filter((o) => o.url === "https://bun.com/");
		expect(bunHits.length).toBe(1);
	});

	test("assigns sequential positions", async () => {
		const r = await parseSerp(MODERN, "bun");
		expect(r.organic.map((o) => o.position)).toEqual([1, 2]);
	});
});
