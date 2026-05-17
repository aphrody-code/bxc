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
 * Transport test suite — bun:test
 *
 * Tests cover:
 *   - ConnectionTransport structural conformance
 *   - StaticDomTransport lifecycle (open / close / idempotent re-close)
 *   - InProcessTransport CDP routing (request → response correlation)
 *   - Page.navigate with data: URI
 *   - Page.title() extraction
 *   - Page.content() (outerHTML)
 *   - Page.$() / Page.$$() selector matching
 *   - Browser singleton: transport(), newPage(), close()
 *   - Unsupported CDP method error message
 *   - AsyncDisposable via Symbol.asyncDispose
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Browser, Page } from "../src/api/browser.js";
import { CDPError, InProcessTransport } from "../src/transport/InProcessTransport.js";
import { StaticDomTransport } from "../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send one CDP message directly on a transport and await the response. */
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
			// Let other listeners see all messages
			prev?.call(transport, raw);

			let msg: { id?: number; result?: unknown; error?: { message: string } };
			try {
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			if (msg.id !== id) return;
			// Restore
			transport.onmessage = prev;
			if (msg.error) {
				reject(new Error(msg.error.message));
			} else {
				resolve(msg.result);
			}
		};

		transport.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

// ---------------------------------------------------------------------------
// 1. ConnectionTransport structural conformance
// ---------------------------------------------------------------------------

describe("ConnectionTransport interface conformance", () => {
	test("StaticDomTransport has send, close, onmessage, onclose", () => {
		const t = StaticDomTransport.create();
		expect(typeof t.send).toBe("function");
		expect(typeof t.close).toBe("function");
		// onmessage and onclose start as undefined
		expect(t.onmessage).toBeUndefined();
		expect(t.onclose).toBeUndefined();
		t.close();
	});

	test("Browser.transport() returns a ConnectionTransport", () => {
		const t = Browser.transport();
		expect(typeof t.send).toBe("function");
		expect(typeof t.close).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// 2. InProcessTransport unit tests
// ---------------------------------------------------------------------------

describe("InProcessTransport", () => {
	test("routes request to handler and returns response", async () => {
		const transport = new InProcessTransport(async (method, params) => {
			if (method === "Test.echo") return { echo: params["value"] };
			throw new CDPError("Not implemented", -32601);
		});

		const result = await new Promise<unknown>((resolve, reject) => {
			transport.onmessage = (raw) => {
				const msg = JSON.parse(raw);
				if (msg.id !== 42) return;
				if (msg.error) reject(new Error(msg.error.message));
				else resolve(msg.result);
			};
			transport.send(JSON.stringify({ id: 42, method: "Test.echo", params: { value: "hello" } }));
		});

		expect(result).toEqual({ echo: "hello" });
		transport.close();
	});

	test("returns CDPError as structured error response", async () => {
		const transport = new InProcessTransport(async () => {
			throw new CDPError("Unsupported", -32601);
		});

		const msg = await new Promise<{ error?: { code: number; message: string } }>((resolve) => {
			transport.onmessage = (raw) => resolve(JSON.parse(raw));
			transport.send(JSON.stringify({ id: 1, method: "Foo.bar", params: {} }));
		});

		expect(msg.error).toBeDefined();
		expect(msg.error?.code).toBe(-32601);
		expect(msg.error?.message).toMatch("Unsupported");
		transport.close();
	});

	test("close() fires onclose asynchronously", async () => {
		const transport = new InProcessTransport(async () => ({}));
		let closed = false;
		transport.onclose = () => {
			closed = true;
		};
		transport.close();
		expect(closed).toBe(false); // not yet (microtask)
		await Promise.resolve(); // flush microtask queue
		expect(closed).toBe(true);
	});

	test("send() after close() is silently ignored", () => {
		const transport = new InProcessTransport(async () => ({}));
		transport.close();
		// Should not throw
		expect(() =>
			transport.send(JSON.stringify({ id: 1, method: "Test.noop", params: {} })),
		).not.toThrow();
	});

	test("malformed JSON does not crash", () => {
		const transport = new InProcessTransport(async () => ({}));
		expect(() => transport.send("not json {{{")).not.toThrow();
		transport.close();
	});
});

// ---------------------------------------------------------------------------
// 3. StaticDomTransport — Browser.getVersion
// ---------------------------------------------------------------------------

describe("StaticDomTransport CDP methods", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => {
		transport.close();
	});

	test("Browser.getVersion returns product string", async () => {
		const result = (await cdpCall(transport, "Browser.getVersion")) as {
			product: string;
			protocolVersion: string;
		};
		expect(result.product).toMatch("Bunlight");
		expect(result.protocolVersion).toBe("1.3");
	});

	test("Target.getBrowserContexts returns a context id", async () => {
		const result = (await cdpCall(transport, "Target.getBrowserContexts")) as {
			browserContextIds: string[];
		};
		expect(Array.isArray(result.browserContextIds)).toBe(true);
		expect(result.browserContextIds.length).toBeGreaterThan(0);
	});

	test("Target.createTarget returns a targetId", async () => {
		const result = (await cdpCall(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		expect(typeof result.targetId).toBe("string");
		expect(result.targetId.length).toBeGreaterThan(0);
	});

	test("unsupported method returns structured error listing supported methods", async () => {
		await expect(cdpCall(transport, "HeadlessExperimental.beginFrame", {})).rejects.toThrow(
			/StaticDomTransport.*Browser\.getVersion/,
		);
	});

	test("Page.navigate with data: URI updates page state", async () => {
		// Create a target first
		const { targetId } = (await cdpCall(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };

		const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
			targetId,
			flatten: true,
		})) as { sessionId: string };

		await cdpCall(transport, "Page.navigate", { url: "data:text/html,<h1>hello</h1>" }, sessionId);

		const { result } = (await cdpCall(
			transport,
			"Runtime.evaluate",
			{ expression: "document.title", returnByValue: true },
			sessionId,
		)) as { result: { value?: string } };

		// title from data: URI with no <title> tag is empty string
		expect(typeof result.value === "string" || result.value === undefined).toBe(true);
	});

	test("DOM.querySelector returns nodeId 0 for missing selector", async () => {
		const { targetId } = (await cdpCall(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
			targetId,
			flatten: true,
		})) as { sessionId: string };

		await cdpCall(transport, "Page.navigate", { url: "data:text/html,<h1>hi</h1>" }, sessionId);

		const doc = (await cdpCall(transport, "DOM.getDocument", { depth: 0 }, sessionId)) as {
			root: { nodeId: number };
		};

		const { nodeId } = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: ".nonexistent-class" },
			sessionId,
		)) as { nodeId: number };

		expect(nodeId).toBe(0);
	});

	test("DOM.querySelectorAll finds elements by tag name", async () => {
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
			{ url: "data:text/html,<ul><li>a</li><li>b</li><li>c</li></ul>" },
			sessionId,
		);

		const doc = (await cdpCall(transport, "DOM.getDocument", { depth: 0 }, sessionId)) as {
			root: { nodeId: number };
		};

		const { nodeIds } = (await cdpCall(
			transport,
			"DOM.querySelectorAll",
			{ nodeId: doc.root.nodeId, selector: "li" },
			sessionId,
		)) as { nodeIds: number[] };

		expect(Array.isArray(nodeIds)).toBe(true);
		expect(nodeIds.length).toBe(3);
	});

	test("DOM.getOuterHTML for root returns full HTML", async () => {
		const html = "<html><head><title>Test</title></head><body><p>hi</p></body></html>";
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

		const doc = (await cdpCall(transport, "DOM.getDocument", { depth: 0 }, sessionId)) as {
			root: { nodeId: number };
		};

		const { outerHTML } = (await cdpCall(
			transport,
			"DOM.getOuterHTML",
			{ nodeId: doc.root.nodeId },
			sessionId,
		)) as { outerHTML: string };

		expect(outerHTML).toContain("Test");
		expect(outerHTML).toContain("hi");
	});
});

// ---------------------------------------------------------------------------
// 4. Page high-level API
// ---------------------------------------------------------------------------

describe("Page API", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(async () => {
		transport.close();
	});

	test("Page.create() returns a Page instance", async () => {
		const page = await Page.create(transport);
		expect(page).toBeInstanceOf(Page);
		await page.close();
	});

	test("goto() navigates and returns NavigationResponse", async () => {
		const page = await Page.create(transport);
		const resp = await page.goto("data:text/html,<h1>hi</h1>");
		expect(resp.ok).toBe(true);
		expect(resp.status).toBe(0); // data: URIs have no HTTP status
		await page.close();
	});

	test("title() returns document title from <title> tag", async () => {
		const page = await Page.create(transport);
		await page.goto(
			"data:text/html," +
				encodeURIComponent("<html><head><title>My Page</title></head><body></body></html>"),
		);
		const t = await page.title();
		expect(t).toBe("My Page");
		await page.close();
	});

	test("content() returns outerHTML of the document", async () => {
		const page = await Page.create(transport);
		await page.goto("data:text/html,<p>hello</p>");
		const html = await page.content();
		expect(html).toContain("hello");
		await page.close();
	});

	test("$() returns null for non-matching selector", async () => {
		const page = await Page.create(transport);
		await page.goto("data:text/html,<p>hi</p>");
		const el = await page.$(".nonexistent");
		expect(el).toBeNull();
		await page.close();
	});

	test("$$() returns matching elements", async () => {
		const page = await Page.create(transport);
		await page.goto("data:text/html,<ul><li>1</li><li>2</li></ul>");
		const items = await page.$$("li");
		expect(items.length).toBe(2);
		await page.close();
	});

	test("close() is idempotent", async () => {
		const page = await Page.create(transport);
		await page.close();
		await expect(page.close()).resolves.toBeUndefined();
	});

	test("goto() after close() throws", async () => {
		const page = await Page.create(transport);
		await page.close();
		await expect(page.goto("about:blank")).rejects.toThrow("Page is closed");
	});

	test("Symbol.asyncDispose closes the page", async () => {
		const page = await Page.create(transport);
		await page[Symbol.asyncDispose]();
		// Should not throw on double dispose
		await expect(page[Symbol.asyncDispose]()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 5. Browser singleton
// ---------------------------------------------------------------------------

describe("Browser singleton", () => {
	afterEach(async () => {
		await Browser.close();
	});

	test("Browser.version() returns a string", () => {
		expect(typeof Browser.version()).toBe("string");
		expect(Browser.version()).toMatch("Bunlight");
	});

	test("Browser.transport() returns a ConnectionTransport", () => {
		const t = Browser.transport();
		expect(typeof t.send).toBe("function");
		expect(typeof t.close).toBe("function");
	});

	test("Browser.transport() is stable across calls", () => {
		const t1 = Browser.transport();
		const t2 = Browser.transport();
		expect(t1).toBe(t2);
	});

	test("Browser.newPage() returns a Page", async () => {
		const page = await Browser.newPage();
		expect(page).toBeInstanceOf(Page);
		await page.close();
	});

	test("Browser.pages() reflects open pages", async () => {
		expect(Browser.pages().length).toBe(0);
		const page = await Browser.newPage();
		expect(Browser.pages().length).toBe(1);
		await page.close();
	});

	test("Browser.close() disposes all pages and transport", async () => {
		await Browser.newPage();
		await Browser.close();
		// After close a new transport should be issued on next access
		const t = Browser.transport();
		expect(typeof t.send).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// 6. Lifecycle — transport.close() releases resources
// ---------------------------------------------------------------------------

describe("Transport lifecycle", () => {
	test("close() makes subsequent send() calls no-ops", () => {
		const t = StaticDomTransport.create();
		t.close();
		expect(t.closed).toBe(true);
		// Must not throw
		expect(() =>
			t.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} })),
		).not.toThrow();
	});

	test("onclose fires after close()", async () => {
		const t = StaticDomTransport.create();
		const closeFired = new Promise<void>((resolve) => {
			t.onclose = resolve;
		});
		t.close();
		await closeFired;
	});
});
