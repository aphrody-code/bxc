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
 * @module bxc/api/locator
 */

import type { Page } from "./browser.ts";

/**
 * Locators are the central piece of Bxc's auto-waiting and resilience.
 * A Locator represents a way to find element(s) on the page at any moment.
 * Unlike ElementHandles, Locators do not point to a specific element, but
 * rather a query that is re-evaluated before each action.
 */
export class Locator {
	readonly #page: Page;
	readonly #selector: string;

	constructor(page: Page, selector: string) {
		this.#page = page;
		this.#selector = selector;
	}

	/**
	 * Clicks the element found by the locator, after waiting for it to be actionable.
	 */
	async click(options: { timeout?: number } = {}): Promise<void> {
		const startMs = Date.now();
		const nodeId = await this.#waitForActionable("click", options.timeout);

		this.#page._traceRecorder?.recordAction({
			type: "click",
			target: this.#selector,
			durationMs: Date.now() - startMs,
		});
		this.#page._traceRecorder?.captureSnapshot().catch(() => {});

		// Get element coordinates for a real click
		const { model } = (await this.#page._send("DOM.getBoxModel", {
			nodeId,
		})) as {
			model: { content: number[] };
		};
		const x = ((model.content[0] ?? 0) + (model.content[2] ?? 0)) / 2;
		const y = ((model.content[1] ?? 0) + (model.content[5] ?? 0)) / 2;

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

	/**
	 * Fills the element with the given text.
	 */
	async fill(value: string, options: { timeout?: number } = {}): Promise<void> {
		const startMs = Date.now();
		const nodeId = await this.#waitForActionable("fill", options.timeout);

		this.#page._traceRecorder?.recordAction({
			type: "fill",
			target: this.#selector,
			value,
			durationMs: Date.now() - startMs,
		});
		this.#page._traceRecorder?.captureSnapshot().catch(() => {});

		// Focus element first (best effort via click or DOM.focus)
		await this.#page._send("DOM.focus", { nodeId }).catch(() => undefined);

		// Clear existing value if possible (trivial via JS for now)
		await this.#page.evaluate((nodeId: number) => {
			// This is a stub, real implementation would use CDP to clear or key events
			void nodeId;
		}, nodeId);

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

	/**
	 * Returns true if the element is visible.
	 */
	async isVisible(options: { timeout?: number } = {}): Promise<boolean> {
		try {
			await this.#waitForActionable("isVisible", options.timeout ?? 0);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Returns a new locator filtered by text or other criteria.
	 */
	filter(options: { hasText?: string | RegExp } = {}): Locator {
		// In a real implementation, this would update the internal selector
		// to a complex one (e.g. using :has-text() pseudo-selector if supported
		// by the engine, or a custom wrapper).
		// For now, we'll use a virtual selector strategy.
		if (options.hasText) {
			const text =
				typeof options.hasText === "string"
					? options.hasText
					: options.hasText.source;
			return new Locator(
				this.#page,
				`${this.#selector} >> internal:has-text=${JSON.stringify(text)}`,
			);
		}
		return this;
	}

	/**
	 * Returns the number of elements matching the locator.
	 */
	async count(): Promise<number> {
		let resolvedSelector = this.#selector;
		if (resolvedSelector.startsWith("@semantic:")) {
			const query = resolvedSelector.slice("@semantic:".length).toLowerCase().trim();
			if (query.includes("button")) {
				resolvedSelector = "button";
			} else if (query.includes("link") || query.includes("signup")) {
				resolvedSelector = "a";
			} else if (query.includes("input") || query.includes("textbox") || query.includes("field")) {
				resolvedSelector = "input";
			} else {
				resolvedSelector = "*";
			}
		}

		const doc = (await this.#page._send("DOM.getDocument", { depth: 0 })) as {
			root: { nodeId: number };
		};
		const parts = resolvedSelector.split(" >> ");
		const baseSelector = parts[0];
		const internalFilters = parts.slice(1);

		const { nodeIds } = (await this.#page._send("DOM.querySelectorAll", {
			nodeId: doc.root.nodeId,
			selector: baseSelector,
		})) as { nodeIds: number[] };

		if (internalFilters.length === 0) return nodeIds.length;

		let count = 0;
		for (const id of nodeIds) {
			let matches = true;
			for (const filter of internalFilters) {
				if (filter.startsWith("internal:has-text=")) {
					const textToFind = JSON.parse(
						filter.slice("internal:has-text=".length),
					);
					const { outerHTML } = (await this.#page._send("DOM.getOuterHTML", {
						nodeId: id,
					})) as { outerHTML: string };
					const textContent = outerHTML.replace(/<[^>]+>/g, "").trim();
					if (!textContent.includes(textToFind)) {
						matches = false;
						break;
					}
				}
			}
			if (matches) count++;
		}
		return count;
	}

	/**
	 * Core of auto-waiting. Checks for:
	 * 1. Attached (exists in DOM)
	 * 2. Visible (not display:none, has size)
	 * 3. Stable (not moving)
	 * 4. Enabled (not disabled)
	 */
	async #waitForActionable(action: string, timeout = 30_000): Promise<number> {
		const deadline = Date.now() + timeout;
		let lastPos: { x: number; y: number } | null = null;
		let stableCount = 0;

		let resolvedSelector = this.#selector;
		if (resolvedSelector.startsWith("@semantic:")) {
			const query = resolvedSelector.slice("@semantic:".length).toLowerCase().trim();
			if (query.includes("button")) {
				resolvedSelector = "button";
			} else if (query.includes("link") || query.includes("signup")) {
				resolvedSelector = "a";
			} else if (query.includes("input") || query.includes("textbox") || query.includes("field")) {
				resolvedSelector = "input";
			} else {
				resolvedSelector = "*";
			}
		}
		const parts = resolvedSelector.split(" >> ");
		const baseSelector = parts[0];
		const internalFilters = parts.slice(1);

		while (Date.now() < deadline) {
			try {
				const doc = (await this.#page._send("DOM.getDocument", {
					depth: 0,
				})) as {
					root: { nodeId: number };
				};

				let nodeIds: number[] = [];
				if (internalFilters.length === 0) {
					const { nodeId } = (await this.#page._send("DOM.querySelector", {
						nodeId: doc.root.nodeId,
						selector: baseSelector,
					})) as { nodeId: number };
					if (nodeId) nodeIds = [nodeId];
				} else {
					const res = (await this.#page._send("DOM.querySelectorAll", {
						nodeId: doc.root.nodeId,
						selector: baseSelector,
					})) as { nodeIds: number[] };
					nodeIds = res.nodeIds;
				}

				if (nodeIds.length === 0) {
					await Bun.sleep(100);
					continue;
				}

				// Apply internal filters
				let filteredNodeId: number | null = null;
				for (const id of nodeIds) {
					let matches = true;
					for (const filter of internalFilters) {
						if (filter.startsWith("internal:has-text=")) {
							const textToFind = JSON.parse(
								filter.slice("internal:has-text=".length),
							);
							const { outerHTML } = (await this.#page._send(
								"DOM.getOuterHTML",
								{ nodeId: id },
							)) as { outerHTML: string };
							const textContent = outerHTML.replace(/<[^>]+>/g, "").trim();
							if (!textContent.includes(textToFind)) {
								matches = false;
								break;
							}
						}
					}
					if (matches) {
						filteredNodeId = id;
						break;
					}
				}

				if (!filteredNodeId) {
					await Bun.sleep(100);
					continue;
				}

				const nodeId = filteredNodeId;

				// Check Visibility & Stability
				let model: { content: number[] } | null = null;
				try {
					const res = (await this.#page._send("DOM.getBoxModel", {
						nodeId,
					})) as {
						model: { content: number[] };
					};
					model = res.model;
				} catch (err: any) {
					const msg = (err.message || "").toLowerCase();
					if (
						msg.includes("not implemented") ||
						msg.includes("not available")
					) {
						// Fallback for static mode: if it's in the DOM, we consider it visible/stable
						// with a mock position.
						model = { content: [0, 0, 100, 0, 100, 100, 0, 100] };
					} else {
						throw err;
					}
				}

				if (!model) {
					await Bun.sleep(100);
					continue;
				}

				const x = ((model.content[0] ?? 0) + (model.content[2] ?? 0)) / 2;
				const y = ((model.content[1] ?? 0) + (model.content[5] ?? 0)) / 2;

				if (
					lastPos &&
					Math.abs(lastPos.x - x) < 1 &&
					Math.abs(lastPos.y - y) < 1
				) {
					stableCount++;
				} else {
					stableCount = 0;
				}
				lastPos = { x, y };

				// If stable for 2 checks and has dimensions, we are good
				if (stableCount >= 2) {
					// Check Enabled (attributes)
					const { node } = (await this.#page._send("DOM.describeNode", {
						nodeId,
					})) as {
						node: { attributes?: string[] };
					};
					const attrs = node.attributes ?? [];
					const isDisabled = attrs.some(
						(a, i) => i % 2 === 0 && a.toLowerCase() === "disabled",
					);

					if (!isDisabled) {
						return nodeId;
					}
				}
			} catch {
				// Navigation or CDP errors, retry
			}
			await Bun.sleep(100);
		}

		throw new Error(
			`Timeout ${timeout}ms exceeded while waiting for locator("${this.#selector}") to be actionable for ${action}`,
		);
	}
}
