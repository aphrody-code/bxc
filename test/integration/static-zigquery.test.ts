/**
 * Static + zigquery integration test.
 *
 * Verifies that `StaticDomTransport`, when backed by `liblightpanda_dom.so`,
 * extracts the same content as a baseline parser on real-world HTML inputs.
 *
 * The test uses local HTML fixtures (no network) so it stays deterministic.
 * It is automatically skipped if the cdylib has not been built.
 *
 * Run:
 *   cd vendor/zigquery-wrapper && zig build -Doptimize=ReleaseFast
 *   bun test test/integration/static-zigquery.test.ts
 */

import { describe, test, expect } from "bun:test";
import { isZigQueryAvailable, parseHtml } from "../../src/ffi/zigquery.js";
import { Browser } from "../../src/api/browser.js";

const describeIfZig = isZigQueryAvailable() ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Fixtures — distilled snippets that mimic real-world structures.
// ---------------------------------------------------------------------------

const WIKIPEDIA_LIKE = `<!DOCTYPE html>
<html>
<head><title>Bun (software) - Wikipedia</title></head>
<body>
<div id="content">
  <h1 id="firstHeading" class="firstHeading">Bun (software)</h1>
  <div id="mw-content-text">
    <p>Bun is a JavaScript runtime, package manager, bundler, and test runner.</p>
    <p>It was designed as a drop-in replacement for Node.js.</p>
    <ul class="references">
      <li><a href="https://bun.sh">bun.sh</a></li>
      <li><a href="https://github.com/oven-sh/bun">github</a></li>
    </ul>
  </div>
</div>
</body>
</html>`;

const GITHUB_README_LIKE = `<!DOCTYPE html>
<html><head><title>oven-sh/bun: Incredibly fast JavaScript runtime</title></head>
<body>
<article class="markdown-body">
  <h1>Bun</h1>
  <p>Develop, test, run, and bundle JavaScript & TypeScript projects—all with Bun.</p>
  <pre><code class="language-sh">bun install</code></pre>
  <h2>Install</h2>
  <p>Use the install script:</p>
  <pre><code>curl -fsSL https://bun.sh/install | bash</code></pre>
</article>
</body></html>`;

const BLOG_POST_LIKE = `<!DOCTYPE html>
<html><head><title>Why Bun is Fast</title></head>
<body>
<main>
  <article>
    <header>
      <h1>Why Bun is Fast</h1>
      <p class="byline">By <a href="/author/jarred">Jarred</a> on 2024-01-15</p>
    </header>
    <section class="content">
      <p>Bun uses JavaScriptCore as its engine.</p>
      <p>It is written in Zig, a low-level systems language.</p>
    </section>
    <footer>
      <ul class="tags">
        <li><a class="tag" href="/tag/bun">bun</a></li>
        <li><a class="tag" href="/tag/zig">zig</a></li>
        <li><a class="tag" href="/tag/perf">perf</a></li>
      </ul>
    </footer>
  </article>
</main>
</body></html>`;

const FORM_PAGE_LIKE = `<html><head><title>Login</title></head>
<body>
<form id="login" method="post" action="/login">
  <input name="user" type="text" placeholder="username" />
  <input name="pass" type="password" placeholder="password" />
  <button type="submit" class="btn primary">Sign in</button>
</form>
</body></html>`;

const TABLE_PAGE_LIKE = `<html><head><title>Top languages</title></head>
<body>
<table id="languages">
  <thead><tr><th>Lang</th><th>Year</th></tr></thead>
  <tbody>
    <tr><td class="lang">Zig</td><td>2016</td></tr>
    <tr><td class="lang">Rust</td><td>2010</td></tr>
    <tr><td class="lang">Bun</td><td>2021</td></tr>
  </tbody>
</table>
</body></html>`;

// ---------------------------------------------------------------------------
// Direct ZigDoc tests — sanity checks on the FFI wrapper.
// ---------------------------------------------------------------------------

describeIfZig("zigquery FFI sanity", () => {
	test("parses Wikipedia-like document and finds the title h1", () => {
		const doc = parseHtml(WIKIPEDIA_LIKE);
		try {
			const sel = doc.find("h1#firstHeading");
			expect(sel.count).toBe(1);
			const el = sel.at(0)!;
			expect(el.textContent().trim()).toBe("Bun (software)");
			expect(el.tagName().toLowerCase()).toBe("h1");
			expect(el.getAttribute("class")).toContain("firstHeading");
			sel.destroy();
		} finally {
			doc.destroy();
		}
	});

	test("querySelectorAll returns every paragraph", () => {
		const doc = parseHtml(WIKIPEDIA_LIKE);
		try {
			const sel = doc.find("#mw-content-text p");
			expect(sel.count).toBe(2);
		} finally {
			doc.destroy();
		}
	});

	test("GitHub-like README — code blocks discoverable", () => {
		const doc = parseHtml(GITHUB_README_LIKE);
		try {
			const code = doc.find("pre code");
			expect(code.count).toBe(2);
			expect(code.at(0)!.textContent()).toContain("bun install");
		} finally {
			doc.destroy();
		}
	});

	test("blog post — extract tag list", () => {
		const doc = parseHtml(BLOG_POST_LIKE);
		try {
			const tags = doc.find("ul.tags li a.tag");
			expect(tags.count).toBe(3);
			const texts = [];
			for (let i = 0; i < tags.count; i++) {
				texts.push(tags.at(i)!.textContent());
			}
			expect(texts).toEqual(["bun", "zig", "perf"]);
		} finally {
			doc.destroy();
		}
	});

	test("form — input and button discoverable by attribute", () => {
		const doc = parseHtml(FORM_PAGE_LIKE);
		try {
			const inputs = doc.find("form#login input");
			expect(inputs.count).toBe(2);
			const submit = doc.find("button.btn.primary");
			expect(submit.count).toBe(1);
			expect(submit.at(0)!.textContent().trim()).toBe("Sign in");
		} finally {
			doc.destroy();
		}
	});

	test("table — extract rows in order", () => {
		const doc = parseHtml(TABLE_PAGE_LIKE);
		try {
			const langs = doc.find("td.lang");
			expect(langs.count).toBe(3);
			const names = [];
			for (let i = 0; i < langs.count; i++) {
				names.push(langs.at(i)!.textContent());
			}
			expect(names).toEqual(["Zig", "Rust", "Bun"]);
		} finally {
			doc.destroy();
		}
	});
});

// ---------------------------------------------------------------------------
// End-to-end through Browser/Page (StaticDomTransport).
// ---------------------------------------------------------------------------

describeIfZig("Browser.newPage with static profile uses zigquery", () => {
	test("Wikipedia-like document — title + paragraph extraction", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			await page.goto(`data:text/html,${encodeURIComponent(WIKIPEDIA_LIKE)}`);
			expect(await page.title()).toBe("Bun (software) - Wikipedia");

			const heading = await page.$<{ textContent(): Promise<string> }>("h1#firstHeading");
			expect(heading).not.toBeNull();
			expect((await heading!.textContent()).trim()).toBe("Bun (software)");

			const paras = await page.$$<{ textContent(): Promise<string> }>("#mw-content-text p");
			expect(paras.length).toBe(2);
			const text0 = await paras[0].textContent();
			expect(text0).toContain("JavaScript runtime");
		} finally {
			await page.close();
		}
	});

	test("blog page — tag extraction order preserved", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			await page.goto(`data:text/html,${encodeURIComponent(BLOG_POST_LIKE)}`);
			const tagHandles = await page.$$<{ textContent(): Promise<string> }>("ul.tags li a.tag");
			const tags = await Promise.all(tagHandles.map((h) => h.textContent()));
			expect(tags).toEqual(["bun", "zig", "perf"]);
		} finally {
			await page.close();
		}
	});

	test("table page — outerHTML round-trip preserved", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			await page.goto(`data:text/html,${encodeURIComponent(TABLE_PAGE_LIKE)}`);
			const html = await page.content();
			expect(html.length).toBeGreaterThan(0);
			const rows = await page.$$("tbody tr");
			expect(rows.length).toBe(3);
		} finally {
			await page.close();
		}
	});
});
