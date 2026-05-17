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
 * Unit tests for src/cdp/domains/Page.ts
 *
 * Tests cover (Phase 1 additions):
 *  1.  No-op stubs return {}
 *  2.  Page.addScriptToEvaluateOnNewDocument returns identifier + tracks script
 *  3.  Page.removeScriptToEvaluateOnNewDocument removes tracked script
 *  4.  Page.removeScriptToEvaluateOnNewDocument silently no-ops on unknown id
 *  5.  Page.getFrameTree returns correct frame shape
 *  6.  Page.navigate emits domContentEventFired
 *  7.  Page.navigate emits loadEventFired
 *  8.  Page.reload re-emits lifecycle events (about:blank, no re-fetch)
 *  9.  Page.reload emits domContentEventFired + loadEventFired
 * 10.  Page.setDocumentContent replaces doc + emits lifecycle events
 * 11.  Page.setDocumentContent preserves original URL
 * 12.  Page.captureScreenshot throws error code -32000 in static profile
 * 13.  Page.printToPDF throws error code -32000 in static profile
 * 14.  Page.startScreencast sets screencastActive = true
 * 15.  Page.stopScreencast clears screencastActive
 * 16.  Page.screencastFrameAck is a no-op
 * 17.  Page.getLayoutMetrics returns synthetic viewport metrics
 * 18.  emitDownloadWillBegin helper emits correct event shape
 * 19.  emitDownloadProgress helper emits correct event shape
 */

import { describe, expect, it } from "bun:test";
import {
	emitDownloadProgress,
	emitDownloadWillBegin,
	PageHandler,
} from "../../../src/cdp/domains/Page.ts";
import type { CDPHandlerResult, DispatchContext, PageState } from "../../../src/cdp/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ParsedDocumentLike stub that records the HTML it was created with. */
function makeDoc(html: string) {
	return {
		rawHtml: html,
		url: "about:blank",
		title: "",
		rootId: 1,
		querySelectorAll: async () => [],
		querySelector: async () => undefined,
		getNodeById: () => undefined,
		toCDPNode: () => ({
			nodeId: 1,
			backendNodeId: 1,
			nodeType: 9,
			nodeName: "#document",
			localName: "",
			nodeValue: "",
			childNodeCount: 0,
		}),
		destroy: () => undefined,
	};
}

/** Creates a fresh PageState for testing. */
function makePageState(overrides: Partial<PageState> = {}): PageState {
	return {
		targetId: "target-1",
		sessionId: "session-1",
		frameId: "frame-1",
		url: "about:blank",
		title: "",
		doc: null,
		loaderId: "frame-1-loader-0",
		loaderCounter: 0,
		emulation: {},
		security: { ignoreCertificateErrors: false },
		scripts: new Map(),
		scriptCounter: 0,
		screencastActive: false,
		utilityWorldName: "utility_world",
		...overrides,
	};
}

/** Builds a minimal DispatchContext that does not hit any transport or FFI. */
function makeCtx(page: PageState, emittedEvents: Array<{ method: string; params: unknown }> = []) {
	const ctx: DispatchContext = {
		pageBySession: (_sid) => page,
		pageBySessionSoft: (_sid) => page,
		createPage: () => page,
		emitEvent: (evt) => {
			emittedEvents.push({ method: evt.method, params: evt.params });
		},
		emitExecutionContexts: (_p) => undefined,
		pageTargetInfo: (p) => ({
			targetId: p.targetId,
			type: "page",
			title: p.title,
			url: p.url,
			attached: true,
			canAccessOpener: false,
			browserContextId: "default",
		}),
		transport: null,
		navigate: async (p, url) => {
			// Minimal navigate stub: parse data: URIs inline, ignore HTTP.
			p.url = url;
			const html = url.startsWith("data:text/html,")
				? decodeURIComponent(url.slice("data:text/html,".length))
				: "";
			p.doc = makeDoc(html);
			p.title = "";
		},
		pages: new Map([["target-1", page]]) as ReadonlyMap<string, PageState>,
		autoAttachSessions: new Set(),
		networkCtx: {
			cookies: new Map(),
			requestRegistry: new Map(),
			extraHeaders: {},
			networkConditions: null,
			fetchSessions: new Map(),
			ioStreams: new Map(),
		},
	};
	return ctx;
}

/** Calls PageHandler and asserts it does not return null. */
async function call(
	method: string,
	params: Record<string, unknown>,
	page?: PageState,
	events?: Array<{ method: string; params: unknown }>,
): Promise<CDPHandlerResult> {
	const p = page ?? makePageState();
	const evts = events ?? [];
	const ctx = makeCtx(p, evts);
	return PageHandler(method, params, ctx, "session-1");
}

// ---------------------------------------------------------------------------
// 1. No-op stubs
// ---------------------------------------------------------------------------

describe("no-op stubs", () => {
	const stubs = [
		"Page.enable",
		"Page.setLifecycleEventsEnabled",
		"Page.setBypassCSP",
		"Page.setCacheEnabled",
		"Page.bringToFront",
		"Page.resetNavigationHistory",
	];

	for (const method of stubs) {
		it(`${method} returns {}`, async () => {
			const result = await call(method, {});
			expect(result).toEqual({});
		});
	}

	it("Page.createIsolatedWorld returns executionContextId", async () => {
		const result = await call("Page.createIsolatedWorld", { worldName: "test" });
		expect(result).toEqual({ executionContextId: expect.any(Number) });
	});
});

// ---------------------------------------------------------------------------
// 2. Page.addScriptToEvaluateOnNewDocument
// ---------------------------------------------------------------------------

describe("Page.addScriptToEvaluateOnNewDocument", () => {
	it("returns an identifier string", async () => {
		const result = await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.x=1" });
		expect(result).toHaveProperty("identifier");
		expect(typeof (result as Record<string, unknown>).identifier).toBe("string");
	});

	it("tracks the script on the page state", async () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		const result = (await PageHandler(
			"Page.addScriptToEvaluateOnNewDocument",
			{ source: "document.body.style.display='none'" },
			ctx,
			"session-1",
		)) as Record<string, unknown>;
		expect(page.scripts.size).toBe(1);
		const script = page.scripts.get(result.identifier as string);
		expect(script?.source).toBe("document.body.style.display='none'");
	});

	it("each call returns a unique identifier", async () => {
		const page = makePageState();
		const ctx = makeCtx(page);
		const r1 = (await PageHandler(
			"Page.addScriptToEvaluateOnNewDocument",
			{ source: "a" },
			ctx,
			"s",
		)) as Record<string, unknown>;
		const r2 = (await PageHandler(
			"Page.addScriptToEvaluateOnNewDocument",
			{ source: "b" },
			ctx,
			"s",
		)) as Record<string, unknown>;
		expect(r1.identifier).not.toBe(r2.identifier);
	});
});

// ---------------------------------------------------------------------------
// 3 & 4. Page.removeScriptToEvaluateOnNewDocument
// ---------------------------------------------------------------------------

describe("Page.removeScriptToEvaluateOnNewDocument", () => {
	it("removes a previously registered script", async () => {
		const page = makePageState();
		const ctx = makeCtx(page);

		const { identifier } = (await PageHandler(
			"Page.addScriptToEvaluateOnNewDocument",
			{ source: "x=1" },
			ctx,
			"s",
		)) as { identifier: string };

		expect(page.scripts.has(identifier)).toBe(true);

		const result = await PageHandler(
			"Page.removeScriptToEvaluateOnNewDocument",
			{ identifier },
			ctx,
			"s",
		);

		expect(result).toEqual({});
		expect(page.scripts.has(identifier)).toBe(false);
	});

	it("silently succeeds for an unknown identifier", async () => {
		const result = await call("Page.removeScriptToEvaluateOnNewDocument", {
			identifier: "unknown-xyz",
		});
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// 5. Page.getFrameTree
// ---------------------------------------------------------------------------

describe("Page.getFrameTree", () => {
	it("returns a frameTree with correct id and loaderId", async () => {
		const page = makePageState({ url: "https://google.com/" });
		const result = (await call("Page.getFrameTree", {}, page)) as Record<string, unknown>;
		const tree = result.frameTree as Record<string, unknown>;
		const frame = tree.frame as Record<string, unknown>;
		expect(frame.id).toBe("frame-1");
		expect(frame.url).toBe("https://google.com/");
		expect(frame.loaderId).toBe("frame-1-loader-0");
	});

	it("sets securityOrigin to null for about:blank", async () => {
		const page = makePageState({ url: "about:blank" });
		const result = (await call("Page.getFrameTree", {}, page)) as Record<string, unknown>;
		const frame = (result.frameTree as Record<string, unknown>).frame as Record<string, unknown>;
		expect(frame.securityOrigin).toBe("null");
	});
});

// ---------------------------------------------------------------------------
// 6 & 7. Page.navigate — domContentEventFired + loadEventFired
// ---------------------------------------------------------------------------

describe("Page.navigate lifecycle events", () => {
	it("emits Page.domContentEventFired", async () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		await PageHandler("Page.navigate", { url: "about:blank" }, ctx, "session-1");
		const methods = events.map((e) => e.method);
		expect(methods).toContain("Page.domContentEventFired");
	});

	it("emits Page.loadEventFired", async () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		await PageHandler("Page.navigate", { url: "about:blank" }, ctx, "session-1");
		const methods = events.map((e) => e.method);
		expect(methods).toContain("Page.loadEventFired");
	});

	it("emits domContentEventFired before loadEventFired", async () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		await PageHandler("Page.navigate", { url: "about:blank" }, ctx, "session-1");
		const methods = events.map((e) => e.method);
		const dcIdx = methods.indexOf("Page.domContentEventFired");
		const loadIdx = methods.indexOf("Page.loadEventFired");
		expect(dcIdx).toBeGreaterThanOrEqual(0);
		expect(loadIdx).toBeGreaterThan(dcIdx);
	});
});

// ---------------------------------------------------------------------------
// 8 & 9. Page.reload
// ---------------------------------------------------------------------------

describe("Page.reload", () => {
	it("returns {} and emits lifecycle events for about:blank (no re-fetch)", async () => {
		const page = makePageState({ url: "about:blank" });
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		const result = await PageHandler("Page.reload", {}, ctx, "session-1");
		expect(result).toEqual({});
		const methods = events.map((e) => e.method);
		expect(methods).toContain("Page.domContentEventFired");
		expect(methods).toContain("Page.loadEventFired");
	});

	it("increments loaderCounter on each reload", async () => {
		const page = makePageState({ url: "about:blank" });
		const ctx = makeCtx(page);
		expect(page.loaderCounter).toBe(0);
		await PageHandler("Page.reload", {}, ctx, "session-1");
		expect(page.loaderCounter).toBe(1);
		await PageHandler("Page.reload", {}, ctx, "session-1");
		expect(page.loaderCounter).toBe(2);
	});

	it("emits frameNavigated with type Reload", async () => {
		const page = makePageState({ url: "about:blank" });
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);
		await PageHandler("Page.reload", {}, ctx, "session-1");
		const nav = events.find((e) => e.method === "Page.frameNavigated");
		expect(nav).toBeDefined();
		expect((nav!.params as Record<string, unknown>).type).toBe("Reload");
	});
});

// ---------------------------------------------------------------------------
// 10 & 11. Page.setDocumentContent
// ---------------------------------------------------------------------------

describe("Page.setDocumentContent", () => {
	it("replaces the page doc and emits lifecycle events", async () => {
		const page = makePageState({
			url: "https://google.com/",
			doc: makeDoc("<html><body>old</body></html>"),
		});
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);

		const result = await PageHandler(
			"Page.setDocumentContent",
			{ frameId: "frame-1", html: "<html><body>new content</body></html>" },
			ctx,
			"session-1",
		);

		expect(result).toEqual({});
		// Doc should now contain the new HTML
		expect(page.doc?.rawHtml).toContain("new content");
		// Lifecycle events must be emitted
		const methods = events.map((e) => e.method);
		expect(methods).toContain("Page.domContentEventFired");
		expect(methods).toContain("Page.loadEventFired");
	});

	it("preserves the original page URL after setDocumentContent", async () => {
		const page = makePageState({ url: "https://google.com/page" });
		const ctx = makeCtx(page);
		await PageHandler(
			"Page.setDocumentContent",
			{ frameId: "frame-1", html: "<html><body>replaced</body></html>" },
			ctx,
			"session-1",
		);
		// URL must not become the data: URI used internally
		expect(page.url).toBe("https://google.com/page");
	});
});

// ---------------------------------------------------------------------------
// 12 & 13. Page.captureScreenshot / printToPDF errors in static profile
// ---------------------------------------------------------------------------

describe("Page.captureScreenshot", () => {
	it("throws an error with code -32000 in static profile", async () => {
		let threw = false;
		let code: number | undefined;
		try {
			await call("Page.captureScreenshot", {});
		} catch (err) {
			threw = true;
			code = (err as { code?: number }).code;
		}
		expect(threw).toBe(true);
		expect(code).toBe(-32000);
	});

	it("error message mentions static profile", async () => {
		let message = "";
		try {
			await call("Page.captureScreenshot", {});
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message.toLowerCase()).toContain("static");
	});
});

describe("Page.printToPDF", () => {
	it("throws an error with code -32000 in static profile", async () => {
		let threw = false;
		let code: number | undefined;
		try {
			await call("Page.printToPDF", {});
		} catch (err) {
			threw = true;
			code = (err as { code?: number }).code;
		}
		expect(threw).toBe(true);
		expect(code).toBe(-32000);
	});
});

// ---------------------------------------------------------------------------
// 14 & 15. Page.startScreencast / stopScreencast
// ---------------------------------------------------------------------------

describe("Page.startScreencast / stopScreencast", () => {
	it("startScreencast sets screencastActive = true", async () => {
		const page = makePageState();
		const ctx = makeCtx(page);
		const result = await PageHandler(
			"Page.startScreencast",
			{ format: "jpeg", quality: 80 },
			ctx,
			"session-1",
		);
		expect(result).toEqual({});
		expect(page.screencastActive).toBe(true);
	});

	it("stopScreencast clears screencastActive", async () => {
		const page = makePageState({ screencastActive: true });
		const ctx = makeCtx(page);
		const result = await PageHandler("Page.stopScreencast", {}, ctx, "session-1");
		expect(result).toEqual({});
		expect(page.screencastActive).toBe(false);
	});

	it("stopScreencast is a no-op when not active", async () => {
		const page = makePageState({ screencastActive: false });
		const ctx = makeCtx(page);
		const result = await PageHandler("Page.stopScreencast", {}, ctx, "session-1");
		expect(result).toEqual({});
		expect(page.screencastActive).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 16. Page.screencastFrameAck
// ---------------------------------------------------------------------------

describe("Page.screencastFrameAck", () => {
	it("is always a no-op", async () => {
		const result = await call("Page.screencastFrameAck", { sessionId: 42 });
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// 17. Page.getLayoutMetrics
// ---------------------------------------------------------------------------

describe("Page.getLayoutMetrics", () => {
	it("returns synthetic viewport and content size metrics", async () => {
		const result = (await call("Page.getLayoutMetrics", {})) as Record<string, unknown>;
		expect(result).toHaveProperty("layoutViewport");
		expect(result).toHaveProperty("visualViewport");
		expect(result).toHaveProperty("contentSize");
		const lv = result.layoutViewport as Record<string, unknown>;
		expect(lv.clientWidth).toBe(1280);
		expect(lv.clientHeight).toBe(720);
	});
});

// ---------------------------------------------------------------------------
// 18 & 19. Event helper: emitDownloadWillBegin / emitDownloadProgress
// ---------------------------------------------------------------------------

describe("emitDownloadWillBegin helper", () => {
	it("emits Page.downloadWillBegin with correct shape", () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);

		emitDownloadWillBegin(ctx, page, {
			guid: "dl-001",
			url: "https://google.com/file.pdf",
			suggestedFilename: "file.pdf",
		});

		expect(events).toHaveLength(1);
		expect(events[0].method).toBe("Page.downloadWillBegin");
		const p = events[0].params as Record<string, unknown>;
		expect(p.guid).toBe("dl-001");
		expect(p.suggestedFilename).toBe("file.pdf");
		expect(p.frameId).toBe("frame-1");
	});
});

describe("emitDownloadProgress helper", () => {
	it("emits Page.downloadProgress with inProgress state", () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);

		emitDownloadProgress(ctx, page, {
			guid: "dl-001",
			totalBytes: 1000,
			receivedBytes: 500,
			state: "inProgress",
		});

		expect(events).toHaveLength(1);
		expect(events[0].method).toBe("Page.downloadProgress");
		const p = events[0].params as Record<string, unknown>;
		expect(p.state).toBe("inProgress");
		expect(p.receivedBytes).toBe(500);
		expect(p.totalBytes).toBe(1000);
	});

	it("emits Page.downloadProgress with completed state", () => {
		const page = makePageState();
		const events: Array<{ method: string; params: unknown }> = [];
		const ctx = makeCtx(page, events);

		emitDownloadProgress(ctx, page, {
			guid: "dl-002",
			totalBytes: 2000,
			receivedBytes: 2000,
			state: "completed",
		});

		const p = events[0].params as Record<string, unknown>;
		expect(p.state).toBe("completed");
	});
});

// ---------------------------------------------------------------------------
// Unrecognised method returns null (not owned by Page domain)
// ---------------------------------------------------------------------------

describe("unknown method passthrough", () => {
	it("returns null for methods not in the Page domain", async () => {
		const result = await call("Runtime.evaluate", { expression: "1+1" });
		expect(result).toBeNull();
	});
});
