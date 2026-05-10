/**
 * Unit tests for enqueueLinks helper.
 *
 * These tests use an in-process mock Page (no real browser, no network)
 * so they run offline and deterministically.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { enqueueLinks } from "../../src/helpers/enqueueLinks.ts";
import type { EnqueueLinksOptions } from "../../src/helpers/enqueueLinks.ts";
import { RequestQueue } from "../../src/queue/RequestQueue.ts";

// ---------------------------------------------------------------------------
// Mock Page factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock Page object.
 * `links` is an array of href strings that `$$("a[href]")` will return.
 * `pageUrl` is what `page.url()` returns.
 */
function makeMockPage(
	links: Array<string | null>,
	pageUrl = "https://example.com/page",
): EnqueueLinksOptions["page"] {
	const handles = links.map((href) => ({
		async getAttribute(name: string): Promise<string | null> {
			if (name === "href") return href;
			return null;
		},
	}));

	return {
		url() {
			return pageUrl;
		},
		async $$(selector: string) {
			void selector;
			return handles as unknown[];
		},
		// Minimal stubs for the full Page interface (not used by enqueueLinks)
		async goto() {
			return { url: pageUrl, status: 200, statusText: "OK", ok: true };
		},
		async title() {
			return "";
		},
		async content() {
			return "";
		},
		async evaluate<T>(fn: () => T) {
			return fn();
		},
		async $() {
			return null;
		},
		async route() {
			return;
		},
		async unroute() {
			return;
		},
		async blockResources() {
			return;
		},
		async close() {
			return;
		},
		async [Symbol.asyncDispose]() {
			return;
		},
	} as unknown as EnqueueLinksOptions["page"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openQueue(): RequestQueue {
	return RequestQueue.open(":memory:");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enqueueLinks", () => {
	let queue: RequestQueue;

	beforeEach(() => {
		queue = openQueue();
	});

	// 1. Basic: same hostname — accepts matching, rejects foreign
	it("enqueues links on the same hostname", async () => {
		const page = makeMockPage([
			"https://example.com/about",
			"https://example.com/contact",
			"https://other.com/page",
		]);
		const { added, skipped } = await enqueueLinks({ page, queue });
		expect(added).toBe(2);
		expect(skipped).toBe(1);
	});

	// 2. strategy: "all" accepts any HTTP/HTTPS URL
	it('strategy "all" accepts links from any domain', async () => {
		const page = makeMockPage([
			"https://example.com/a",
			"https://totally-different.io/b",
			"http://another.net/c",
		]);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
		});
		expect(added).toBe(3);
		expect(skipped).toBe(0);
	});

	// 3. strategy: "same-domain" accepts subdomains
	it('strategy "same-domain" accepts sub-domains', async () => {
		const page = makeMockPage(
			["https://sub.example.com/x", "https://example.com/y", "https://evil.com/z"],
			"https://example.com/",
		);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "same-domain",
		});
		expect(added).toBe(2); // sub.example.com + example.com
		expect(skipped).toBe(1); // evil.com
	});

	// 4. strategy: "same-hostname" rejects subdomains
	it('strategy "same-hostname" rejects sub-domains', async () => {
		const page = makeMockPage(
			["https://sub.example.com/x", "https://example.com/y"],
			"https://example.com/",
		);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "same-hostname",
		});
		expect(added).toBe(1); // only example.com/y
		expect(skipped).toBe(1); // sub.example.com/x
	});

	// 5. Glob patterns filter links
	it("glob patterns filter links", async () => {
		const page = makeMockPage(
			[
				"https://example.com/blog/post-1",
				"https://example.com/shop/product",
				"https://example.com/blog/post-2",
			],
			"https://example.com/",
		);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			globs: ["https://example.com/blog/**"],
		});
		expect(added).toBe(2);
		expect(skipped).toBe(1);
	});

	// 6. Regexp patterns filter links
	it("regexp patterns filter links", async () => {
		const page = makeMockPage(
			[
				"https://example.com/products/123",
				"https://example.com/about",
				"https://example.com/products/456",
			],
			"https://example.com/",
		);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			regexps: [/\/products\/\d+/],
		});
		expect(added).toBe(2);
		expect(skipped).toBe(1);
	});

	// 7. regexps take precedence over globs
	it("regexp takes precedence over glob when both provided", async () => {
		const page = makeMockPage(
			["https://example.com/blog/1", "https://example.com/shop/2"],
			"https://example.com/",
		);
		const { added } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			globs: ["https://example.com/shop/**"], // would match shop/2 only
			regexps: [/\/blog\//], // overrides: only blog/1
		});
		expect(added).toBe(1); // blog/1 via regexp, shop/2 excluded
	});

	// 8. limit caps the number of enqueued links
	it("limit caps enqueued links", async () => {
		const page = makeMockPage([
			"https://example.com/1",
			"https://example.com/2",
			"https://example.com/3",
			"https://example.com/4",
		]);
		const { added, skipped } = await enqueueLinks({ page, queue, limit: 2 });
		expect(added).toBe(2);
		expect(skipped).toBe(2);
	});

	// 9. Deduplication: same URL extracted twice is only added once
	it("deduplicates links extracted from the same page", async () => {
		const page = makeMockPage([
			"https://example.com/dup",
			"https://example.com/dup", // same URL twice
			"https://example.com/unique",
		]);
		const { added, skipped } = await enqueueLinks({ page, queue, strategy: "all" });
		expect(added).toBe(2);
		expect(skipped).toBe(1); // duplicate
	});

	// 10. transform function can rewrite or discard URLs
	it("transform can discard URLs by returning null", async () => {
		const page = makeMockPage([
			"https://example.com/keep-this",
			"https://example.com/discard-this",
		]);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			transform: (url) => (url.includes("discard") ? null : url),
		});
		expect(added).toBe(1);
		expect(skipped).toBe(1);
	});

	// 11. transform can rewrite URLs
	it("transform can rewrite URLs before enqueueing", async () => {
		const page = makeMockPage(["https://example.com/path?session=abc123"]);
		const { added } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			transform: (url) => {
				const u = new URL(url);
				u.searchParams.delete("session");
				return u.href;
			},
		});
		expect(added).toBe(1);
		// The URL stored in queue should be without session param
		const queued = queue.fetchBatch(10);
		expect(queued[0].url).toBe("https://example.com/path");
	});

	// 12. Edge case: relative hrefs are resolved against baseUrl
	it("resolves relative hrefs correctly", async () => {
		const page = makeMockPage(["/about", "../contact", "help.html"], "https://example.com/sub/");
		const { added } = await enqueueLinks({ page, queue, strategy: "all" });
		const queued = queue.fetchBatch(10);
		const urls = queued.map((r) => r.url).sort();
		expect(urls).toContain("https://example.com/about");
		expect(urls).toContain("https://example.com/contact");
		expect(urls).toContain("https://example.com/sub/help.html");
		expect(added).toBe(3);
	});

	// 13. Edge case: mailto:, javascript:, data:, # links are discarded
	it("discards non-HTTP hrefs (mailto, javascript, data, hash)", async () => {
		const page = makeMockPage([
			"mailto:user@example.com",
			"javascript:void(0)",
			"data:text/html,<h1>x</h1>",
			"#anchor",
			"https://example.com/valid",
		]);
		const { added, skipped } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
		});
		expect(added).toBe(1);
		expect(skipped).toBe(4);
	});

	// 14. Fragments are stripped from URLs
	it("strips fragments from URLs before enqueueing", async () => {
		const page = makeMockPage(["https://example.com/page#section1"]);
		const { added } = await enqueueLinks({ page, queue, strategy: "all" });
		expect(added).toBe(1);
		const queued = queue.fetchBatch(10);
		expect(queued[0].url).toBe("https://example.com/page");
	});

	// 15. Empty link list returns 0,0
	it("handles empty link list gracefully", async () => {
		const page = makeMockPage([]);
		const { added, skipped } = await enqueueLinks({ page, queue });
		expect(added).toBe(0);
		expect(skipped).toBe(0);
	});

	// 16. Null href attributes are skipped
	it("skips elements with null href attribute", async () => {
		const page = makeMockPage([null, "https://example.com/real"]);
		const { added, skipped } = await enqueueLinks({ page, queue, strategy: "all" });
		expect(added).toBe(1);
		expect(skipped).toBe(1);
	});

	// 17. Cross-session dedup via queue's SQLite unique constraint
	it("skips URLs already present in the queue from a previous call", async () => {
		const page = makeMockPage(["https://example.com/existing"]);
		// Pre-populate the queue with the same URL
		queue.addRequest("https://example.com/existing");
		const { added, skipped } = await enqueueLinks({ page, queue, strategy: "all" });
		expect(added).toBe(0);
		expect(skipped).toBe(1);
	});

	// 18. baseUrl override
	it("uses explicit baseUrl option when provided", async () => {
		// Page url is about:blank but we override baseUrl
		const page = makeMockPage(["/relative"], "about:blank");
		const { added } = await enqueueLinks({
			page,
			queue,
			strategy: "all",
			baseUrl: "https://override.com/",
		});
		expect(added).toBe(1);
		const queued = queue.fetchBatch(10);
		expect(queued[0].url).toBe("https://override.com/relative");
	});
});
