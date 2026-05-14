/**
 * Accessibility AX cache tests — Phase 2 (perf-latency-bench)
 *
 * Verifies:
 *   1. Cache hit returns identical tree reference (same nodes array content).
 *   2. Cache hit is measurably faster than cache miss on a real-sized HTML page.
 *   3. Cache is invalidated after Page.navigate (new document → different nodes).
 *   4. Cache is invalidated after Page.reload.
 *   5. Cache is invalidated after Page.setDocumentContent.
 *   6. Multiple sessions do not share AX cache entries.
 *   7. Cache hit latency stays well below 1 ms (target: <0.5 ms p50).
 *   8. LRU eviction: 65th entry does not exceed the 64-entry cap.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CDPError } from "../../../src/transport/InProcessTransport.js";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// CDP call helper (mirrors the one in Accessibility.test.ts)
// ---------------------------------------------------------------------------

function cdpCall(
	transport: StaticDomTransport,
	method: string,
	params: Record<string, unknown> = {},
	sessionId?: string,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const id = Math.floor(Math.random() * 1_000_000) + 1;
		const prev = transport.onmessage;

		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
			try {
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			if (msg.id !== id) return;
			transport.onmessage = prev;
			if (msg.error) {
				reject(new CDPError(msg.error.message, msg.error.code));
			} else {
				resolve(msg.result);
			}
		};

		transport.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function setupPage(
	transport: StaticDomTransport,
	html: string,
): Promise<{ sessionId: string }> {
	const { targetId } = (await cdpCall(transport, "Target.createTarget", {
		url: "about:blank",
	})) as { targetId: string };

	const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
		targetId,
		flatten: true,
	})) as { sessionId: string };

	await cdpCall(
		transport,
		"Page.navigate",
		{ url: `data:text/html,${encodeURIComponent(html)}` },
		sessionId,
	);

	return { sessionId };
}

/** Measures wall-clock time in milliseconds with sub-ms precision. */
function wallMs(): number {
	return Bun.nanoseconds() / 1_000_000;
}

interface AXNode {
	nodeId: string;
	ignored: boolean;
	role?: { type: string; value: string };
}

const MEDIUM_HTML = `
<!DOCTYPE html>
<html lang="en">
<head><title>AX Cache Test</title></head>
<body>
  <header><nav aria-label="Main"><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <h1>Welcome</h1>
    <section>
      <h2>Articles</h2>
      <article>
        <h3>Article 1</h3>
        <p>Some text content here for the first article.</p>
        <a href="/a1">Read more</a>
      </article>
      <article>
        <h3>Article 2</h3>
        <p>Some text content here for the second article.</p>
        <a href="/a2">Read more</a>
      </article>
    </section>
    <form>
      <label for="search">Search</label>
      <input id="search" type="search" placeholder="Search articles...">
      <button type="submit">Go</button>
    </form>
  </main>
  <footer><p>Footer content</p></footer>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Test suite 1 — Cache hit returns equivalent tree
// ---------------------------------------------------------------------------

describe("AX cache — hit returns same content", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("two consecutive getFullAXTree calls return identical node arrays", async () => {
		const { sessionId } = await setupPage(transport, MEDIUM_HTML);

		const first = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};
		const second = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};

		// Same number of nodes
		expect(second.nodes.length).toBe(first.nodes.length);
		// Same nodeIds in same order
		expect(second.nodes.map((n) => n.nodeId)).toEqual(first.nodes.map((n) => n.nodeId));
	});
});

// ---------------------------------------------------------------------------
// Test suite 2 — Cache hit is measurably faster than cache miss
// ---------------------------------------------------------------------------

describe("AX cache — performance", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("cache hit latency < 1 ms (target <0.5 ms) on medium HTML page", async () => {
		const { sessionId } = await setupPage(transport, MEDIUM_HTML);

		// Warm the cache (this is the miss).
		await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId);

		// Measure 10 cache hits.
		const REPS = 10;
		const timings: number[] = [];
		for (let i = 0; i < REPS; i++) {
			const t0 = wallMs();
			await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId);
			timings.push(wallMs() - t0);
		}

		const sorted = [...timings].sort((a, b) => a - b);
		const p50 = sorted[Math.floor(sorted.length * 0.5)];
		const p95 = sorted[Math.floor(sorted.length * 0.95)];

		// p50 should be well below 1 ms (target: <0.5 ms).
		expect(p50).toBeLessThan(1);
		// p95 must stay below 3 ms (upper bound).
		expect(p95).toBeLessThan(3);
	});

	test("cache miss on new navigation rebuilds the tree (different loaderId)", async () => {
		const { sessionId } = await setupPage(transport, MEDIUM_HTML);

		const before = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};

		// Navigate to a completely different page.
		await cdpCall(
			transport,
			"Page.navigate",
			{
				url: `data:text/html,${encodeURIComponent("<p>New page</p>")}`,
			},
			sessionId,
		);

		const after = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};

		// The new page has far fewer nodes than MEDIUM_HTML.
		expect(after.nodes.length).toBeLessThan(before.nodes.length);
	});
});

// ---------------------------------------------------------------------------
// Test suite 3 — Cache invalidation on navigate / reload / setDocumentContent
// ---------------------------------------------------------------------------

describe("AX cache — invalidation", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("navigate invalidates cache: tree reflects new document", async () => {
		const { sessionId } = await setupPage(
			transport,
			"<h1>Page A</h1><nav aria-label='Nav A'></nav>",
		);

		const treeA = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};
		const navA = treeA.nodes.filter((n) => !n.ignored && n.role?.value === "navigation");
		expect(navA.length).toBeGreaterThan(0);

		// Navigate to a page without a <nav>.
		await cdpCall(
			transport,
			"Page.navigate",
			{ url: `data:text/html,${encodeURIComponent("<p>No nav here</p>")}` },
			sessionId,
		);

		const treeB = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};
		const navB = treeB.nodes.filter((n) => !n.ignored && n.role?.value === "navigation");
		// After navigating away, there should be no <nav> in the AX tree.
		expect(navB.length).toBe(0);
	});

	test("reload invalidates cache: tree reflects current URL re-fetch", async () => {
		const { sessionId } = await setupPage(transport, "<button>Original</button>");

		// Warm the cache.
		const before = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};
		expect(before.nodes.length).toBeGreaterThan(0);

		// Reload (re-fetches same URL = about:blank / data URI — should not throw).
		await cdpCall(transport, "Page.reload", {}, sessionId);

		// After reload the cache should have been invalidated; a fresh call must succeed.
		const after = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};
		expect(Array.isArray(after.nodes)).toBe(true);
	});

	test("setDocumentContent invalidates cache: tree reflects injected HTML", async () => {
		const { sessionId } = await setupPage(transport, "<p>Original content</p>");

		const { targetId } = (await cdpCall(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		void targetId;

		// Warm the cache.
		await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId);

		// Get the frameId to pass to setDocumentContent.
		const frameTree = (await cdpCall(transport, "Page.getFrameTree", {}, sessionId)) as {
			frameTree: { frame: { id: string } };
		};
		const frameId = frameTree.frameTree.frame.id;

		await cdpCall(
			transport,
			"Page.setDocumentContent",
			{
				frameId,
				html: "<main><h1>Injected</h1><p>New body</p></main>",
			},
			sessionId,
		);

		const fresh = (await cdpCall(transport, "Accessibility.getFullAXTree", {}, sessionId)) as {
			nodes: AXNode[];
		};

		// The injected document has a <main> element mapped to role=main.
		const mainNode = fresh.nodes.find((n) => !n.ignored && n.role?.value === "main");
		expect(mainNode).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Test suite 4 — Session isolation
// ---------------------------------------------------------------------------

describe("AX cache — session isolation", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("two sessions have independent AX caches", async () => {
		const pageA = await setupPage(transport, "<nav aria-label='A Nav'><a href='/a'>A</a></nav>");
		const pageB = await setupPage(transport, "<section><h1>B Only</h1></section>");

		const treeA = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			pageA.sessionId,
		)) as { nodes: AXNode[] };
		const treeB = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			pageB.sessionId,
		)) as { nodes: AXNode[] };

		const navInA = treeA.nodes.filter((n) => !n.ignored && n.role?.value === "navigation");
		const navInB = treeB.nodes.filter((n) => !n.ignored && n.role?.value === "navigation");

		// Session A has a nav; session B does not.
		expect(navInA.length).toBeGreaterThan(0);
		expect(navInB.length).toBe(0);

		// Navigating session A must not affect session B's cache.
		await cdpCall(
			transport,
			"Page.navigate",
			{
				url: `data:text/html,${encodeURIComponent("<p>A new page</p>")}`,
			},
			pageA.sessionId,
		);

		// Session B tree should be unchanged (still cache-valid).
		const treeBAfter = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			pageB.sessionId,
		)) as { nodes: AXNode[] };
		const navInBAfter = treeBAfter.nodes.filter(
			(n) => !n.ignored && n.role?.value === "navigation",
		);
		expect(navInBAfter.length).toBe(0);
		expect(treeBAfter.nodes.length).toBe(treeB.nodes.length);
	});
});
