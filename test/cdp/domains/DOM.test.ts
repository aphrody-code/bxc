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
 * DOM domain handler tests — Phase 1 additions.
 *
 * Tests cover:
 *   - DOM.enable (no-op stub)
 *   - DOM.getBoxModel (inline style + width/height attrs + defaults)
 *   - DOM.resolveNode (synthetic RemoteObject)
 *   - DOM.setFileInputFiles (throws CDPError in static profile)
 *   - Regression: all existing DOM.* methods still work
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CDPError } from "../../../src/transport/InProcessTransport.js";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// Helper: send a CDP call and await the structured response.
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
			let msg: {
				id?: number;
				result?: unknown;
				error?: { code: number; message: string };
			};
			try {
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			if (msg.id !== id) return;
			transport.onmessage = prev;
			if (msg.error) {
				const err = new CDPError(msg.error.message, msg.error.code);
				reject(err);
			} else {
				resolve(msg.result);
			}
		};

		transport.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

// ---------------------------------------------------------------------------
// Setup: open transport + navigate to a page with known HTML.
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

// ---------------------------------------------------------------------------
// DOM.enable
// ---------------------------------------------------------------------------

describe("DOM.enable", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns empty object (no-op stub)", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		const result = await cdpCall(transport, "DOM.enable", {}, sessionId);
		expect(result).toEqual({});
	});

	test("can be called multiple times without error", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		await cdpCall(transport, "DOM.enable", {}, sessionId);
		const result = await cdpCall(transport, "DOM.enable", {}, sessionId);
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// DOM.getBoxModel
// ---------------------------------------------------------------------------

describe("DOM.getBoxModel", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns zero-dimension model when no layout info is available", async () => {
		const { sessionId } = await setupPage(
			transport,
			"<div id='box'>content</div>",
		);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#box" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.getBoxModel",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as { model: { width: number; height: number; content: number[] } };

		expect(result.model).toBeDefined();
		expect(result.model.width).toBe(0);
		expect(result.model.height).toBe(0);
		expect(Array.isArray(result.model.content)).toBe(true);
		expect(result.model.content.length).toBe(8);
	});

	test("reads width and height from inline style", async () => {
		const html = `<div id="styled" style="width:300px;height:150px">box</div>`;
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#styled" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.getBoxModel",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as { model: { width: number; height: number } };

		expect(result.model.width).toBe(300);
		expect(result.model.height).toBe(150);
	});

	test("reads width and height from HTML attributes (img)", async () => {
		const html = `<img id="img" src="x.png" width="640" height="480" alt="pic">`;
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#img" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.getBoxModel",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as { model: { width: number; height: number } };

		expect(result.model.width).toBe(640);
		expect(result.model.height).toBe(480);
	});

	test("throws CDPError when nodeId not found", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		await expect(
			cdpCall(transport, "DOM.getBoxModel", { nodeId: 99999 }, sessionId),
		).rejects.toBeInstanceOf(CDPError);
	});

	test("quad has 8 elements representing the 4 corners", async () => {
		const html = `<div id="q" style="width:100px;height:50px;left:10px;top:20px">q</div>`;
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#q" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.getBoxModel",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as {
			model: {
				content: number[];
				padding: number[];
				border: number[];
				margin: number[];
			};
		};

		expect(result.model.content.length).toBe(8);
		expect(result.model.padding.length).toBe(8);
		expect(result.model.border.length).toBe(8);
		expect(result.model.margin.length).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// DOM.resolveNode
// ---------------------------------------------------------------------------

describe("DOM.resolveNode", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns a RemoteObject with type=object subtype=node", async () => {
		const { sessionId } = await setupPage(transport, "<p id='para'>text</p>");
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#para" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.resolveNode",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as { object: { type: string; subtype: string; objectId: string } };

		expect(result.object.type).toBe("object");
		expect(result.object.subtype).toBe("node");
		expect(typeof result.object.objectId).toBe("string");
	});

	test("objectId is JSON-encoded and contains the nodeId", async () => {
		const { sessionId } = await setupPage(transport, "<span id='sp'>x</span>");
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#sp" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"DOM.resolveNode",
			{ nodeId: nodeResult.nodeId },
			sessionId,
		)) as { object: { objectId: string } };

		const decoded = JSON.parse(result.object.objectId) as { id: number };
		expect(decoded.id).toBe(nodeResult.nodeId);
	});

	test("throws CDPError for non-existent nodeId", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		await expect(
			cdpCall(transport, "DOM.resolveNode", { nodeId: 99999 }, sessionId),
		).rejects.toBeInstanceOf(CDPError);
	});
});

// ---------------------------------------------------------------------------
// DOM.setFileInputFiles
// ---------------------------------------------------------------------------

describe("DOM.setFileInputFiles", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("throws CDPError with a clear message about static profile", async () => {
		const { sessionId } = await setupPage(
			transport,
			`<input type="file" id="fi">`,
		);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const nodeResult = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#fi" },
			sessionId,
		)) as { nodeId: number };

		await expect(
			cdpCall(
				transport,
				"DOM.setFileInputFiles",
				{ nodeId: nodeResult.nodeId, files: ["/tmp/test.txt"] },
				sessionId,
			),
		).rejects.toBeInstanceOf(CDPError);
	});
});

// ---------------------------------------------------------------------------
// Regression: previously working DOM methods still function.
// ---------------------------------------------------------------------------

describe("DOM regression: existing methods", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("DOM.getDocument still returns root node", async () => {
		const { sessionId } = await setupPage(transport, "<h1>hi</h1>");
		const result = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number; nodeName: string };
		};
		expect(result.root.nodeId).toBeGreaterThan(0);
		expect(result.root.nodeName).toBe("#document");
	});

	test("DOM.querySelectorAll still works", async () => {
		const { sessionId } = await setupPage(
			transport,
			"<ul><li>a</li><li>b</li></ul>",
		);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const result = (await cdpCall(
			transport,
			"DOM.querySelectorAll",
			{ nodeId: doc.root.nodeId, selector: "li" },
			sessionId,
		)) as { nodeIds: number[] };
		expect(result.nodeIds.length).toBe(2);
	});

	test("DOM.describeNode still returns node info", async () => {
		const { sessionId } = await setupPage(
			transport,
			"<button id='btn'>click</button>",
		);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const { nodeId } = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#btn" },
			sessionId,
		)) as { nodeId: number };
		const result = (await cdpCall(
			transport,
			"DOM.describeNode",
			{ nodeId },
			sessionId,
		)) as {
			node: { localName: string };
		};
		expect(result.node.localName.toLowerCase()).toBe("button");
	});
});
