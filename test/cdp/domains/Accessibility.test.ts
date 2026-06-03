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
 * Accessibility domain handler tests — Phase 1.
 *
 * Tests cover:
 *   - Accessibility.enable (no-op)
 *   - Accessibility.getFullAXTree (AX tree builder)
 *   - Accessibility.getPartialAXTree (scoped subtree)
 *
 * Fixtures used (in test/fixtures/):
 *   - hn-style.html     — HN-style page with links and nav
 *   - login-form.html   — login form with inputs and labels
 *   - headings.html     — multiple heading levels
 *   - hidden-checkbox.html — visibility/aria-hidden edge cases
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CDPError } from "../../../src/transport/InProcessTransport.ts";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.ts";

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
				reject(new CDPError(msg.error.message, msg.error.code));
			} else {
				resolve(msg.result);
			}
		};

		transport.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

// ---------------------------------------------------------------------------
// Setup: load HTML into a page session.
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

/** Reads an HTML fixture file (Bun-native). */
async function readFixture(name: string): Promise<string> {
	const p = join(import.meta.dir, "..", "..", "fixtures", name);
	return Bun.file(p).text();
}

// AXNode type mirror for test assertions.
interface AXNode {
	nodeId: string;
	ignored: boolean;
	ignoredReasons?: Array<{ name: string; value: unknown }>;
	role?: { type: string; value: string };
	name?: { type: string; value: string };
	properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
	childIds?: string[];
	backendDOMNodeId?: number;
}

// ---------------------------------------------------------------------------
// Accessibility.enable
// ---------------------------------------------------------------------------

describe("Accessibility.enable", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns empty object (no-op)", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		const result = await cdpCall(
			transport,
			"Accessibility.enable",
			{},
			sessionId,
		);
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getFullAXTree — basic structure
// ---------------------------------------------------------------------------

describe("Accessibility.getFullAXTree — basic", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns nodes array for a simple page", async () => {
		const { sessionId } = await setupPage(transport, "<p>Hello World</p>");
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		expect(Array.isArray(result.nodes)).toBe(true);
	});

	test("returns empty nodes when no document loaded", async () => {
		// Create a page without navigating.
		const { targetId } = (await cdpCall(transport, "Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
			targetId,
			flatten: true,
		})) as { sessionId: string };

		// Navigate to about:blank to clear the doc
		await cdpCall(
			transport,
			"Page.navigate",
			{ url: "about:blank" },
			sessionId,
		);

		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		expect(Array.isArray(result.nodes)).toBe(true);
	});

	test("each AXNode has nodeId, ignored, and role", async () => {
		const { sessionId } = await setupPage(
			transport,
			"<button>Click me</button>",
		);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		for (const node of result.nodes) {
			expect(typeof node.nodeId).toBe("string");
			expect(typeof node.ignored).toBe("boolean");
			if (!node.ignored) {
				expect(node.role).toBeDefined();
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getFullAXTree — HN-style page (link roles with names)
// ---------------------------------------------------------------------------

describe("Accessibility.getFullAXTree — HN-style page", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("AX tree contains nodes with role=link", async () => {
		const html = await readFixture("hn-style.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const links = result.nodes.filter(
			(n) => !n.ignored && n.role?.value === "link",
		);
		expect(links.length).toBeGreaterThan(0);
	});

	test("link nodes have an accessible name", async () => {
		const html = await readFixture("hn-style.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const links = result.nodes.filter(
			(n) => !n.ignored && n.role?.value === "link",
		);
		// At least one link should have a non-empty name.
		const namedLinks = links.filter(
			(n) => n.name && n.name.value.trim() !== "",
		);
		expect(namedLinks.length).toBeGreaterThan(0);
	});

	test("nav element has role=navigation", async () => {
		const html = await readFixture("hn-style.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const navNode = result.nodes.find(
			(n) => !n.ignored && n.role?.value === "navigation",
		);
		expect(navNode).toBeDefined();
	});

	test("nav has accessible name from aria-label", async () => {
		const html = await readFixture("hn-style.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const navNode = result.nodes.find(
			(n) => !n.ignored && n.role?.value === "navigation",
		);
		expect(navNode?.name?.value).toBe("Main navigation");
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getFullAXTree — Login form (textbox, label association)
// ---------------------------------------------------------------------------

describe("Accessibility.getFullAXTree — login form", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("input[type=email] has role=textbox", async () => {
		const html = await readFixture("login-form.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const textboxes = result.nodes.filter(
			(n) => !n.ignored && n.role?.value === "textbox",
		);
		expect(textboxes.length).toBeGreaterThan(0);
	});

	test("email textbox has accessible name 'Email' via <label for>", async () => {
		const html = await readFixture("login-form.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		// Find the email input by its role (textbox) and name (Email or placeholder)
		const emailNode = result.nodes.find(
			(n) =>
				!n.ignored &&
				n.role?.value === "textbox" &&
				(n.name?.value === "Email" || n.name?.value === "you@google.com"),
		);
		expect(emailNode).toBeDefined();
	});

	test("submit button has role=button", async () => {
		const html = await readFixture("login-form.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const buttons = result.nodes.filter(
			(n) => !n.ignored && n.role?.value === "button",
		);
		expect(buttons.length).toBeGreaterThan(0);
	});

	test("password input has role=textbox (password type maps to textbox)", async () => {
		const html = await readFixture("login-form.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		// password type input maps to textbox role (standard ARIA)
		const passNode = result.nodes.find(
			(n) =>
				!n.ignored &&
				n.role?.value === "textbox" &&
				(n.name?.value === "Password" || n.name?.value === "Your password"),
		);
		expect(passNode).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getFullAXTree — Headings
// ---------------------------------------------------------------------------

describe("Accessibility.getFullAXTree — headings", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("h1 and h2 nodes have role=heading", async () => {
		const html = await readFixture("headings.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const headings = result.nodes.filter(
			(n) => !n.ignored && n.role?.value === "heading",
		);
		expect(headings.length).toBeGreaterThanOrEqual(2);
	});

	test("h1 has level property = 1", async () => {
		const html = await readFixture("headings.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const h1 = result.nodes.find(
			(n) =>
				!n.ignored &&
				n.role?.value === "heading" &&
				n.properties?.some((p) => p.name === "level" && p.value.value === 1),
		);
		expect(h1).toBeDefined();
	});

	test("h2 has level property = 2", async () => {
		const html = await readFixture("headings.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const h2Nodes = result.nodes.filter(
			(n) =>
				!n.ignored &&
				n.role?.value === "heading" &&
				n.properties?.some((p) => p.name === "level" && p.value.value === 2),
		);
		expect(h2Nodes.length).toBeGreaterThanOrEqual(2);
	});

	test("h1 has accessible name from text content", async () => {
		const html = await readFixture("headings.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const h1 = result.nodes.find(
			(n) =>
				!n.ignored &&
				n.role?.value === "heading" &&
				n.properties?.some((p) => p.name === "level" && p.value.value === 1),
		);
		expect(h1?.name?.value).toBeTruthy();
		expect(h1?.name?.value).toContain("Main Title");
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getFullAXTree — Hidden/aria-hidden edge cases
// ---------------------------------------------------------------------------

describe("Accessibility.getFullAXTree — hidden elements", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("aria-hidden=true node is marked ignored", async () => {
		const html = `<div aria-hidden="true"><button>Hidden btn</button></div><button>Visible btn</button>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const ariaHiddenNode = result.nodes.find(
			(n) => n.ignored && n.role?.value !== "none",
		);
		// At least one node should be ignored due to aria-hidden or style.
		expect(ariaHiddenNode).toBeDefined();
	});

	test("checkbox in hidden checkbox fixture has role=checkbox", async () => {
		const html = await readFixture("hidden-checkbox.html");
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const checkboxes = result.nodes.filter((n) => n.role?.value === "checkbox");
		// Should have at least one checkbox node (the visible ones).
		expect(checkboxes.length).toBeGreaterThan(0);
	});

	test("display:none element is marked ignored", async () => {
		const html = `<div style="display:none"><p>hidden</p></div><p>visible</p>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const hiddenNode = result.nodes.find(
			(n) =>
				n.ignored &&
				n.ignoredReasons?.some((r: any) => r.value === "ariaHiddenElement"),
		);
		// display:none sets isHidden which adds ariaHiddenElement reason.
		expect(hiddenNode).toBeDefined();
	});

	test("role=none makes node ignored with presentationalRole reason", async () => {
		const html = `<div role="none"><span>decorative</span></div>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		const noneNode = result.nodes.find(
			(n) =>
				n.ignored &&
				n.ignoredReasons?.some((r: any) => r.value === "presentationalRole"),
		);
		expect(noneNode).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Accessibility.getPartialAXTree
// ---------------------------------------------------------------------------

describe("Accessibility.getPartialAXTree", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("returns a subtree scoped to the given nodeId", async () => {
		const html = `
			<div id="outside"><a href="#">Outside link</a></div>
			<nav id="scope">
				<a href="/home">Home</a>
				<a href="/about">About</a>
			</nav>
		`;
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const navNode = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#scope" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"Accessibility.getPartialAXTree",
			{ nodeId: navNode.nodeId },
			sessionId,
		)) as { nodes: AXNode[] };

		expect(Array.isArray(result.nodes)).toBe(true);
		// The subtree should contain the nav element itself.
		const navAXNode = result.nodes.find((n) => n.role?.value === "navigation");
		expect(navAXNode).toBeDefined();
	});

	test("partial tree does not contain elements outside the scope", async () => {
		const html = `
			<h1>Outside heading</h1>
			<section id="scope">
				<h2>Inside heading</h2>
			</section>
		`;
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const sectionNode = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "#scope" },
			sessionId,
		)) as { nodeId: number };

		const partial = (await cdpCall(
			transport,
			"Accessibility.getPartialAXTree",
			{ nodeId: sectionNode.nodeId },
			sessionId,
		)) as { nodes: AXNode[] };

		const full = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};

		// Partial tree should have fewer nodes than full tree.
		expect(partial.nodes.length).toBeLessThan(full.nodes.length);
	});

	test("throws CDPError for non-existent nodeId", async () => {
		const { sessionId } = await setupPage(transport, "<p>hi</p>");
		await expect(
			cdpCall(
				transport,
				"Accessibility.getPartialAXTree",
				{ nodeId: 99999 },
				sessionId,
			),
		).rejects.toBeInstanceOf(CDPError);
	});

	test("partial tree links, nav from login form (scoped to form element)", async () => {
		const html = await readFixture("login-form.html");
		const { sessionId } = await setupPage(transport, html);
		const doc = (await cdpCall(
			transport,
			"DOM.getDocument",
			{ depth: 0 },
			sessionId,
		)) as {
			root: { nodeId: number };
		};
		const formNode = (await cdpCall(
			transport,
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: "form" },
			sessionId,
		)) as { nodeId: number };

		const result = (await cdpCall(
			transport,
			"Accessibility.getPartialAXTree",
			{ nodeId: formNode.nodeId },
			sessionId,
		)) as { nodes: AXNode[] };

		// Should contain textbox roles from the form inputs.
		const textboxes = result.nodes.filter((n) => n.role?.value === "textbox");
		expect(textboxes.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// AX role derivation — unit-style tests using inline HTML snippets
// ---------------------------------------------------------------------------

describe("AX role derivation", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => transport.close());

	test("explicit role attribute overrides tag mapping", async () => {
		const html = `<div role="button" id="d">click</div>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		const btnNode = result.nodes.find((n) => n.role?.value === "button");
		expect(btnNode).toBeDefined();
	});

	test("input[type=checkbox] has role=checkbox with checked property", async () => {
		const html = `<input type="checkbox" id="c" checked>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		const checkbox = result.nodes.find((n) => n.role?.value === "checkbox");
		expect(checkbox).toBeDefined();
		const checkedProp = checkbox?.properties?.find((p) => p.name === "checked");
		expect(checkedProp?.value.value).toBe(true);
	});

	test("input[type=radio] has role=radio", async () => {
		const html = `<input type="radio" name="opt" value="a">`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		const radio = result.nodes.find((n) => n.role?.value === "radio");
		expect(radio).toBeDefined();
	});

	test("disabled button has disabled property", async () => {
		const html = `<button disabled>Can't click</button>`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		const btn = result.nodes.find((n) => n.role?.value === "button");
		const disabledProp = btn?.properties?.find((p) => p.name === "disabled");
		expect(disabledProp?.value.value).toBe(true);
	});

	test("img with alt has role=img and name from alt", async () => {
		const html = `<img src="logo.png" alt="Company Logo">`;
		const { sessionId } = await setupPage(transport, html);
		const result = (await cdpCall(
			transport,
			"Accessibility.getFullAXTree",
			{},
			sessionId,
		)) as {
			nodes: AXNode[];
		};
		const imgNode = result.nodes.find((n) => n.role?.value === "img");
		expect(imgNode).toBeDefined();
		expect(imgNode?.name?.value).toBe("Company Logo");
	});
});
