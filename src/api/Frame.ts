/**
 * @module bunlight/api/frame
 */

import type { Page } from "./browser.ts";
import { Locator } from "./Locator.ts";

/**
 * Frames represent a part of the page (main frame or iframes).
 * Each frame has its own DOM and can be interacted with via Locators.
 */
export class Frame {
	readonly #page: Page;
	readonly #id: string;
	readonly #name?: string;
	readonly #parentId?: string;
	readonly #childFrames: Set<Frame> = new Set();

	constructor(page: Page, id: string, name?: string, parentId?: string) {
		this.#page = page;
		this.#id = id;
		this.#name = name;
		this.#parentId = parentId;
	}

	get id(): string { return this.#id; }
	get name(): string | undefined { return this.#name; }
	get parentId(): string | undefined { return this.#parentId; }

	/**
	 * Returns the parent frame, if any.
	 */
	parentFrame(): Frame | null {
		if (!this.#parentId) return null;
		// This requires a frame registry in Page, which we'll add.
		return (this.#page as any)._frame(this.#parentId);
	}

	/**
	 * Returns all child frames.
	 */
	childFrames(): Frame[] {
		return [...this.#childFrames];
	}

	/** @internal */
	_addChild(frame: Frame): void {
		this.#childFrames.add(frame);
	}

	/** @internal */
	_removeChild(frame: Frame): void {
		this.#childFrames.delete(frame);
	}

	/**
	 * Returns a locator for the given selector, scoped to this frame.
	 */
	locator(selector: string): Locator {
		// Future: support frame-scoped locators.
		return new Locator(this.#page, selector);
	}

	/**
	 * Returns the frame's content.
	 */
	async content(): Promise<string> {
		const { outerHTML } = (await this.#page._send("DOM.getOuterHTML", {
			nodeId: (await this.#page._send("DOM.getDocument", { depth: 0 }) as any).root.nodeId,
		})) as { outerHTML: string };
		return outerHTML;
	}

	/**
	 * Navigates the frame to the given URL.
	 */
	async goto(url: string, options?: any): Promise<any> {
		return this.#page._send("Page.navigate", { url, frameId: this.#id });
	}

	/**
	 * Returns the frame's title.
	 */
	async title(): Promise<string> {
		const { result } = (await this.#page._send("Runtime.evaluate", {
			expression: "document.title",
			returnByValue: true,
			// Future: execute in frame-specific execution context
		})) as { result: { value?: string } };
		return (result.value as string) ?? "";
	}
}
