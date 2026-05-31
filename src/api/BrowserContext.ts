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
 * @module bxc/api/browser-context
 */

import type { PageOptions } from "./browser.ts";
import { Browser } from "./browser.ts";
import type { Cookie } from "../cookies/cookie-loader.ts";
import { TraceRecorder } from "../recorder/TraceRecorder.ts";
import type { AnyPage } from "./types.ts";

/**
 * BrowserContext provides isolation between execution environments.
 * It manages its own cookies, permissions, and pages.
 */
export class BrowserContext implements AsyncDisposable {
	readonly #pages: AnyPage[] = [];
	readonly #cookies: Cookie[] = [];
	#closed = false;

	#tracing = false;
	readonly #traceRecorders = new Map<AnyPage, TraceRecorder>();

	/** @internal */
	constructor() {}

	/**
	 * Creates a new page within this context.
	 */
	async newPage(options: PageOptions = {}): Promise<AnyPage> {
		this.#assertOpen();

		const page = await Browser.newPage(options, this);
		this.#pages.push(page);

		// Inject context cookies
		if (this.#cookies.length > 0) {
			if ("addCookies" in page) {
				await page.addCookies(this.#cookies).catch(() => undefined);
			}
		}

		if (this.#tracing) {
			this.#startTracingOnPage(page as AnyPage);
		}

		// Wrap close to remove from list
		const originalClose = page.close.bind(page);
		(page as any).close = async () => {
			await originalClose();
			const idx = this.#pages.indexOf(page);
			if (idx !== -1) this.#pages.splice(idx, 1);
		};

		return page;
	}

	/**
	 * Adds cookies to this context.
	 */
	async addCookies(cookies: Cookie[]): Promise<void> {
		this.#assertOpen();
		this.#cookies.push(...cookies);
		// Inject into existing pages if they support it
		for (const page of this.#pages) {
			if ("addCookies" in page) {
				await page.addCookies(cookies).catch(() => undefined);
			}
		}
	}

	/**
	 * Returns all cookies in this context.
	 */
	async cookies(): Promise<Cookie[]> {
		this.#assertOpen();
		return [...this.#cookies];
	}

	/**
	 * Returns all open pages in this context.
	 */
	pages(): AnyPage[] {
		return [...this.#pages];
	}

	/**
	 * Tracing API (Phase 2): Records Network, Snapshots, and Actions
	 * to a highly compressed `.trace.zst` archive.
	 */
	tracing() {
		return {
			start: () => {
				this.#tracing = true;
				for (const page of this.#pages) {
					this.#startTracingOnPage(page as AnyPage);
				}
			},
			stop: async (options?: { path: string }) => {
				this.#tracing = false;
				const promises = [];
				for (const recorder of this.#traceRecorders.values()) {
					if (options?.path) {
						promises.push(recorder.stopAndSave(options.path));
					} else {
						// Stop recording without saving
						// Actually, TraceRecorder doesn't have a stop() without save right now, but we can call stopAndSave to /dev/null or ignore
					}
				}
				await Promise.all(promises);
				this.#traceRecorders.clear();
			},
		};
	}

	#startTracingOnPage(page: AnyPage) {
		if (!this.#traceRecorders.has(page) && "evaluate" in page) {
			const recorder = new TraceRecorder(page as any);
			recorder.start();
			this.#traceRecorders.set(page, recorder);
			if ("_traceRecorder" in page) {
				(page as any)._traceRecorder = recorder;
			}
		}
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await Promise.all(this.#pages.map((p) => p.close().catch(() => undefined)));
		this.#pages.length = 0;
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error("BrowserContext is closed");
	}
}
