/**
 * Integration test for enqueueLinks helper with a real StaticDomTransport.
 *
 * Uses inline data: HTML to avoid network dependency while exercising the
 * full Page.$$(selector) -> getAttribute("href") path through StaticDomTransport.
 *
 * Automatically skipped if zigquery cdylib is unavailable.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { Browser } from "../../src/api/browser.js";
import { isZigQueryAvailable } from "../../src/ffi/zigquery.js";
import { enqueueLinks } from "../../src/helpers/enqueueLinks.ts";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";

const describeIfZig = isZigQueryAvailable() ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A simple site map page with 5 internal + 2 external + some noise links */
const SITE_HTML = `<!DOCTYPE html>
<html>
<head><title>Example Site Map</title></head>
<body>
  <nav>
    <a href="https://example.com/">Home</a>
    <a href="https://example.com/about">About</a>
    <a href="https://example.com/blog">Blog</a>
    <a href="https://example.com/contact">Contact</a>
    <a href="https://example.com/products">Products</a>
  </nav>
  <section>
    <a href="https://external.io/partner">External Partner</a>
    <a href="https://ads.example.net/banner">Ad Network</a>
    <a href="mailto:info@example.com">Email Us</a>
    <a href="javascript:void(0)">JS link</a>
    <a href="#footer">Anchor</a>
  </section>
</body>
</html>`;

/** Blog index with 3 posts + duplicated home link */
const BLOG_HTML = `<!DOCTYPE html>
<html>
<head><title>Blog</title></head>
<body>
  <a href="/blog/post-1">Post 1</a>
  <a href="/blog/post-2">Post 2</a>
  <a href="/blog/post-3">Post 3</a>
  <a href="/">Home</a>
  <a href="/">Home (duplicate)</a>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describeIfZig("enqueueLinks integration (StaticDomTransport)", () => {
	afterAll(async () => {
		await Browser.close();
	});

	test("extracts 5 same-hostname links from inline site map (data: URL)", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			const queue = RequestQueue.open(":memory:");
			// Navigate to inline HTML via data: URI
			await page.goto(`data:text/html,${encodeURIComponent(SITE_HTML)}`);

			const { added, skipped } = await enqueueLinks({
				page,
				queue,
				strategy: "all", // data: base URL has no useful hostname; accept everything
			});

			// 5 valid http/https links (example.com × 5, external.io × 1, ads × 1 = 7 total valid)
			// mailto:, javascript:, # are discarded (3 skipped)
			expect(added).toBe(7);
			expect(skipped).toBe(3);
			queue.close();
		} finally {
			await page.close();
		}
	});

	test("same-hostname strategy from a real base URL", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			const queue = RequestQueue.open(":memory:");
			// Navigate using baseUrl override to simulate a real page context
			await page.goto(`data:text/html,${encodeURIComponent(SITE_HTML)}`);

			const { added } = await enqueueLinks({
				page,
				queue,
				strategy: "same-hostname",
				baseUrl: "https://example.com/sitemap",
			});

			// Only 5 links match example.com; external.io and ads.example.net do not
			expect(added).toBe(5);
			queue.close();
		} finally {
			await page.close();
		}
	});

	test("resolves relative hrefs from blog page with baseUrl", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			const queue = RequestQueue.open(":memory:");
			await page.goto(`data:text/html,${encodeURIComponent(BLOG_HTML)}`);

			const { added, skipped } = await enqueueLinks({
				page,
				queue,
				strategy: "all",
				baseUrl: "https://example.com/blog",
			});

			// /blog/post-1, /blog/post-2, /blog/post-3, / = 4 unique resolved URLs
			// Duplicate / link is skipped (session-level dedup)
			expect(added).toBe(4);
			expect(skipped).toBe(1);

			const queued = queue.fetchBatch(10);
			const urls = queued.map((r) => r.url).sort();
			expect(urls).toContain("https://example.com/blog/post-1");
			expect(urls).toContain("https://example.com/blog/post-2");
			expect(urls).toContain("https://example.com/blog/post-3");
			expect(urls).toContain("https://example.com/");
			queue.close();
		} finally {
			await page.close();
		}
	});

	test("glob filter restricts to /blog/** paths", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			const queue = RequestQueue.open(":memory:");
			await page.goto(`data:text/html,${encodeURIComponent(BLOG_HTML)}`);

			const { added, skipped } = await enqueueLinks({
				page,
				queue,
				strategy: "all",
				baseUrl: "https://example.com/blog",
				globs: ["https://example.com/blog/**"],
			});

			// Only post-1, post-2, post-3 match; home "/" does not
			expect(added).toBe(3);
			expect(skipped).toBeGreaterThanOrEqual(1); // / + duplicate /
			queue.close();
		} finally {
			await page.close();
		}
	});

	test("limit=2 enqueues only first 2 qualifying links", async () => {
		const page = await Browser.newPage({ profile: "static" });
		try {
			const queue = RequestQueue.open(":memory:");
			await page.goto(`data:text/html,${encodeURIComponent(SITE_HTML)}`);

			const { added, skipped } = await enqueueLinks({
				page,
				queue,
				strategy: "all",
				limit: 2,
			});

			expect(added).toBe(2);
			expect(skipped).toBeGreaterThanOrEqual(1);
			queue.close();
		} finally {
			await page.close();
		}
	});
});
