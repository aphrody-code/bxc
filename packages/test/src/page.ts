// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/bxc-test/page
 *
 * `TestPage` — a Playwright-shaped page surface (`packages/playwright-core/
 * src/client/page.ts`) wrapping a bxc `AnyPage` (`src/api/browser.ts`). It owns
 * the lifecycle of the underlying bxc page and exposes navigation + the locator
 * factories that build {@link BxcLocator}s over bxc's CDP DOM domain.
 */

import { Browser } from "../../../src/api/browser.ts";
import type { AnyPage } from "../../../src/api/types.ts";
import { BxcLocator, type CdpPage } from "./locator.ts";
import {
	getByAltText,
	getByLabel,
	getByPlaceholder,
	getByRole,
	getByTestId,
	getByText,
	getByTitle,
	type ByRoleOptions,
} from "./selectors.ts";

/** Options for {@link TestPage.create}. Mirrors the relevant `use` config. */
export interface TestPageOptions {
	/** bxc transport profile. `static` is fully offline/zero-spawn (default). */
	profile?: "static" | "fast";
	/** Prepended to relative `goto` URLs, like Playwright's `baseURL`. */
	baseURL?: string;
	/** Attribute used by `getByTestId` (default `data-testid`). */
	testIdAttribute?: string;
}

/**
 * A page under test. Construct with {@link TestPage.create}; dispose with
 * {@link TestPage.close} (or `await using`).
 */
export class TestPage {
	readonly #page: AnyPage;
	readonly #baseURL?: string;
	readonly #testIdAttribute: string;

	private constructor(page: AnyPage, opts: TestPageOptions) {
		this.#page = page;
		this.#baseURL = opts.baseURL;
		this.#testIdAttribute = opts.testIdAttribute ?? "data-testid";
	}

	/** Opens a fresh bxc page and wraps it. */
	static async create(opts: TestPageOptions = {}): Promise<TestPage> {
		const page = await Browser.newPage({ profile: opts.profile ?? "static" });
		return new TestPage(page, opts);
	}

	/** @internal — the underlying bxc page (exposes CDP `_send`). */
	get _cdp(): CdpPage {
		return this.#page as unknown as CdpPage;
	}

	/** The wrapped bxc page, for escape-hatch access to the full bxc API. */
	get raw(): AnyPage {
		return this.#page;
	}

	// --- Navigation --------------------------------------------------------

	/** Navigates to `url` (relative URLs resolve against `baseURL`). */
	async goto(url: string): ReturnType<AnyPage["goto"]> {
		const full =
			this.#baseURL && !/^[a-z]+:/i.test(url)
				? new URL(url, this.#baseURL).href
				: url;
		return this.#page.goto(full);
	}

	/** Replaces the page document with `html` (Playwright `page.setContent`). */
	async setContent(html: string): Promise<void> {
		await this.#page.setContent(html);
	}

	/** Current document `<title>`. */
	title(): Promise<string> {
		return this.#page.title();
	}

	/** Full document `outerHTML`. */
	content(): Promise<string> {
		return this.#page.content();
	}

	/** Current page URL. */
	url(): string {
		return this.#page.url();
	}

	// --- Locator factories -------------------------------------------------

	/** Builds a CSS-selector locator (Playwright `page.locator`). */
	locator(selector: string): BxcLocator {
		return new BxcLocator(this._cdp, { css: selector });
	}

	/** `page.getByTestId(id)`. */
	getByTestId(testId: string): BxcLocator {
		return new BxcLocator(this._cdp, getByTestId(testId, this.#testIdAttribute));
	}

	/** `page.getByRole(role, opts)`. */
	getByRole(role: string, opts: ByRoleOptions = {}): BxcLocator {
		return new BxcLocator(this._cdp, getByRole(role, opts));
	}

	/** `page.getByText(text, { exact })`. */
	getByText(text: string | RegExp, opts: { exact?: boolean } = {}): BxcLocator {
		return new BxcLocator(this._cdp, getByText(text, opts));
	}

	/** `page.getByLabel(text, { exact })`. */
	getByLabel(text: string | RegExp, opts: { exact?: boolean } = {}): BxcLocator {
		return new BxcLocator(this._cdp, getByLabel(text, opts));
	}

	/** `page.getByPlaceholder(text)`. */
	getByPlaceholder(text: string): BxcLocator {
		return new BxcLocator(this._cdp, getByPlaceholder(text));
	}

	/** `page.getByAltText(text)`. */
	getByAltText(text: string): BxcLocator {
		return new BxcLocator(this._cdp, getByAltText(text));
	}

	/** `page.getByTitle(text)`. */
	getByTitle(text: string): BxcLocator {
		return new BxcLocator(this._cdp, getByTitle(text));
	}

	// --- Lifecycle ---------------------------------------------------------

	/** Closes the underlying bxc page. */
	async close(): Promise<void> {
		await this.#page.close();
	}

	/** `await using page = await TestPage.create()` support. */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}
}
