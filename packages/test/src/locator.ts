// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody-code/bxc-test/locator
 *
 * `BxcLocator` — a Playwright-shaped Locator resolved over bxc's native CDP DOM
 * domain (`src/cdp/domains/DOM.ts`). Like Playwright's Locator
 * (`packages/playwright-core/src/client/locator.ts:41`) it is *lazy*: the query
 * is re-resolved before every action, so it survives re-navigation and content
 * mutation. No element handle is cached.
 */

import {
	type ResolvedQuery,
	type TextMatcher,
	matchesText,
} from "./selectors.ts";

/**
 * The narrow CDP surface a {@link BxcLocator} needs from a bxc page. The
 * concrete `Page` class (`src/api/browser.ts`) exposes `_send` (its public CDP
 * dispatch). We depend only on that, so any CDP-backed page works.
 */
export interface CdpPage {
	_send(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Default per-action timeout, matching Playwright's 30s default. */
const DEFAULT_TIMEOUT = 30_000;
/** Poll interval for auto-waiting, matching `src/api/Locator.ts`. */
const POLL_MS = 50;

/** Options accepted by {@link BxcLocator.filter}. */
export interface FilterOptions {
	/** Keep only elements whose stripped text matches. */
	hasText?: string | RegExp;
}

/**
 * Resolves a CSS selector to nodeIds and applies an optional text predicate,
 * all via bxc's CDP DOM domain. Shared by the locator and the web-first
 * matchers in `expect.ts`.
 */
export async function resolveNodes(
	page: CdpPage,
	query: ResolvedQuery,
	extraText?: TextMatcher,
): Promise<number[]> {
	const doc = (await page._send("DOM.getDocument", { depth: 0 })) as {
		root: { nodeId: number };
	};
	const { nodeIds } = (await page._send("DOM.querySelectorAll", {
		nodeId: doc.root.nodeId,
		selector: query.css,
	})) as { nodeIds: number[] };

	const predicates: TextMatcher[] = [];
	if (query.text) predicates.push(query.text);
	if (extraText) predicates.push(extraText);
	if (predicates.length === 0) return nodeIds ?? [];

	const kept: number[] = [];
	for (const id of nodeIds ?? []) {
		const text = await nodeText(page, id);
		if (predicates.every((p) => matchesText(p, text))) kept.push(id);
	}
	return kept;
}

/** Returns an element's stripped text content via `DOM.getOuterHTML`. */
export async function nodeText(page: CdpPage, nodeId: number): Promise<string> {
	const { outerHTML } = (await page._send("DOM.getOuterHTML", { nodeId })) as {
		outerHTML: string;
	};
	return outerHTML.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Returns the value of an attribute via `DOM.describeNode`, or `null`. */
export async function nodeAttribute(
	page: CdpPage,
	nodeId: number,
	name: string,
): Promise<string | null> {
	const { node } = (await page._send("DOM.describeNode", { nodeId })) as {
		node: { attributes?: string[] };
	};
	const attrs = node.attributes ?? [];
	for (let i = 0; i + 1 < attrs.length; i += 2) {
		if (attrs[i] === name) return attrs[i + 1] ?? null;
	}
	return null;
}

/**
 * Decides whether an element counts as "visible". With no layout engine in the
 * `static` profile (`DOM.getBoxModel` returns a zero box), visibility is
 * Playwright's definition minus layout: attached and not explicitly hidden.
 */
export async function nodeVisible(
	page: CdpPage,
	nodeId: number,
): Promise<boolean> {
	if ((await nodeAttribute(page, nodeId, "hidden")) !== null) return false;
	if ((await nodeAttribute(page, nodeId, "aria-hidden")) === "true")
		return false;
	const style = (await nodeAttribute(page, nodeId, "style")) ?? "";
	if (/display\s*:\s*none/i.test(style)) return false;
	if (/visibility\s*:\s*hidden/i.test(style)) return false;
	return true;
}

/**
 * A lazy, auto-waiting locator backed by bxc's CDP DOM domain.
 *
 * Mirrors the Playwright Locator action surface
 * (`packages/playwright-core/src/client/locator.ts`): `click`, `fill`,
 * `textContent`, `getAttribute`, `isVisible`, `count`, `waitFor`, `filter`,
 * `first`/`last`/`nth`.
 */
export class BxcLocator {
	readonly #page: CdpPage;
	readonly #query: ResolvedQuery;
	/** Index into the resolved set, or `null` for "all / first". */
	readonly #index: number | null;
	/** Extra text predicate from `.filter({ hasText })`. */
	readonly #extraText?: TextMatcher;

	constructor(
		page: CdpPage,
		query: ResolvedQuery,
		index: number | null = null,
		extraText?: TextMatcher,
	) {
		this.#page = page;
		this.#query = query;
		this.#index = index;
		this.#extraText = extraText;
	}

	/** @internal — exposes the CDP page for the matcher layer. */
	get _page(): CdpPage {
		return this.#page;
	}

	/** @internal — re-resolves to the current nodeId set. */
	async _resolve(): Promise<number[]> {
		return resolveNodes(this.#page, this.#query, this.#extraText);
	}

	/**
	 * @internal — resolves to the single node this locator targets, honouring
	 * `nth`/`first`/`last`. Returns `null` when nothing matches. Used by the
	 * web-first matchers so `expect(loc.nth(1)).toHaveText(...)` asserts on the
	 * indexed element, not the first match.
	 */
	async _resolveTargeted(): Promise<number | null> {
		return this.#resolveOne();
	}

	/** @internal — human description for error messages. */
	get _description(): string {
		const txt = this.#query.text ? ` text=${this.#query.text.value}` : "";
		const idx = this.#index === null ? "" : ` nth=${this.#index}`;
		return `locator(${this.#query.css}${txt}${idx})`;
	}

	/** Resolves to the single nodeId this locator points at, honouring `nth`. */
	async #resolveOne(): Promise<number | null> {
		const ids = await this._resolve();
		if (ids.length === 0) return null;
		const i = this.#index ?? 0;
		const real = i < 0 ? ids.length + i : i;
		return ids[real] ?? null;
	}

	/** Polls until the locator resolves to at least one node, returns its id. */
	async #waitForOne(timeout: number): Promise<number> {
		const deadline = Date.now() + timeout;
		do {
			const id = await this.#resolveOne();
			if (id !== null) return id;
			if (Date.now() >= deadline) break;
			await Bun.sleep(POLL_MS);
		} while (Date.now() < deadline);
		throw new Error(
			`Timeout ${timeout}ms exceeded waiting for ${this._description}`,
		);
	}

	// --- Locator narrowing -------------------------------------------------

	/** Narrows by text (`hasText`), mirroring Playwright `.filter()`. */
	filter(options: FilterOptions = {}): BxcLocator {
		if (options.hasText === undefined) return this;
		const m: TextMatcher =
			options.hasText instanceof RegExp
				? { kind: "regex", value: options.hasText.source, source: options.hasText }
				: { kind: "substring", value: options.hasText };
		return new BxcLocator(this.#page, this.#query, this.#index, m);
	}

	/** Returns a locator pointing at the first match. */
	first(): BxcLocator {
		return new BxcLocator(this.#page, this.#query, 0, this.#extraText);
	}

	/** Returns a locator pointing at the last match. */
	last(): BxcLocator {
		return new BxcLocator(this.#page, this.#query, -1, this.#extraText);
	}

	/** Returns a locator pointing at the `i`-th match (0-based). */
	nth(i: number): BxcLocator {
		return new BxcLocator(this.#page, this.#query, i, this.#extraText);
	}

	// --- Queries -----------------------------------------------------------

	/** Number of elements the locator currently resolves to. */
	async count(): Promise<number> {
		return (await this._resolve()).length;
	}

	/** Stripped text content of the targeted element (auto-waits). */
	async textContent(options: { timeout?: number } = {}): Promise<string | null> {
		const id = await this.#waitForOne(options.timeout ?? DEFAULT_TIMEOUT);
		return nodeText(this.#page, id);
	}

	/** Value of `name` on the targeted element (auto-waits). */
	async getAttribute(
		name: string,
		options: { timeout?: number } = {},
	): Promise<string | null> {
		const id = await this.#waitForOne(options.timeout ?? DEFAULT_TIMEOUT);
		return nodeAttribute(this.#page, id, name);
	}

	/** True when the targeted element is attached and not hidden. */
	async isVisible(): Promise<boolean> {
		const id = await this.#resolveOne();
		if (id === null) return false;
		return nodeVisible(this.#page, id);
	}

	/** Waits until the locator resolves (Playwright `state: 'attached'`). */
	async waitFor(options: { timeout?: number } = {}): Promise<void> {
		await this.#waitForOne(options.timeout ?? DEFAULT_TIMEOUT);
	}

	// --- Actions -----------------------------------------------------------

	/** Clicks the targeted element via CDP `Input.dispatchMouseEvent`. */
	async click(options: { timeout?: number } = {}): Promise<void> {
		const nodeId = await this.#waitForOne(options.timeout ?? DEFAULT_TIMEOUT);
		let x = 0;
		let y = 0;
		try {
			const { model } = (await this.#page._send("DOM.getBoxModel", {
				nodeId,
			})) as { model: { content: number[] } };
			x = ((model.content[0] ?? 0) + (model.content[2] ?? 0)) / 2;
			y = ((model.content[1] ?? 0) + (model.content[5] ?? 0)) / 2;
		} catch {
			// No layout in static profile — dispatch at origin (event still fires).
		}
		await this.#page._send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
		await this.#page._send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
	}

	/** Fills the targeted element with `value` via CDP focus + key events. */
	async fill(
		value: string,
		options: { timeout?: number } = {},
	): Promise<void> {
		const nodeId = await this.#waitForOne(options.timeout ?? DEFAULT_TIMEOUT);
		await this.#page._send("DOM.focus", { nodeId }).catch(() => undefined);
		for (const char of value) {
			await this.#page._send("Input.dispatchKeyEvent", {
				type: "keyDown",
				text: char,
			});
			await this.#page._send("Input.dispatchKeyEvent", {
				type: "keyUp",
				text: char,
			});
		}
	}
}
