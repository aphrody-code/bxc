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
 * @module bunlight/ffi/zigquery
 *
 * Re-implementation of the ZigQuery interface using the new light Rust DOM bridge.
 */

import * as rustBridge from "../rust/bridge.ts";
import { openingTagOf, parseAttributes } from "../internal/html-utils.ts";

export function isZigQueryAvailable(): boolean {
	return true;
}

export function ensureInit(): any {
	return {};
}

export class ZigElement {
	#outerHTML: string;
	constructor(outerHTML: string) {
		this.#outerHTML = outerHTML;
	}
	textContent(): string {
		return this.#outerHTML.replace(/<[^>]+>/g, "").trim();
	}
	innerHTML(): string {
		return this.#outerHTML.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
	}
	outerHTML(): string {
		return this.#outerHTML;
	}
	tagName(): string {
		const match = /^<([a-zA-Z0-9-]+)/.exec(this.#outerHTML);
		return match ? match[1].toLowerCase() : "";
	}
	getAttribute(name: string): string {
		const attrs = parseAttributes(openingTagOf(this.#outerHTML));
		return attrs[name] ?? "";
	}
	async querySelector(selector: string): Promise<ZigElement | null> {
		const doc = await parseHtml(this.#outerHTML);
		try {
			return await doc.querySelector(selector);
		} finally {
			doc.destroy();
		}
	}
	async querySelectorAll(selector: string): Promise<ZigSelection> {
		const doc = await parseHtml(this.#outerHTML);
		try {
			return await doc.querySelectorAll(selector);
		} finally {
			doc.destroy();
		}
	}
	destroy(): void {}
}

export class ZigSelection {
	#elements: ZigElement[];
	constructor(elements: string[]) {
		this.#elements = elements.map(html => new ZigElement(html));
	}
	get count(): number {
		return this.#elements.length;
	}
	at(i: number): ZigElement | null {
		return this.#elements[i] ?? null;
	}
	toArray(): ZigElement[] {
		return [...this.#elements];
	}
	map<T>(fn: (el: ZigElement, i: number) => T): T[] {
		return this.#elements.map(fn);
	}
	filter(fn: (el: ZigElement, i: number) => boolean): ZigSelection {
		const filtered = this.#elements.filter(fn).map(el => el.outerHTML());
		return new ZigSelection(filtered);
	}
	find(fn: (el: ZigElement, i: number) => boolean): ZigElement | undefined {
		return this.#elements.find(fn);
	}
	[Symbol.iterator](): IterableIterator<ZigElement> {
		return this.#elements[Symbol.iterator]();
	}
	destroy(): void {}
}

export class ZigDoc {
	#handle: rustBridge.DomTreePtr;
	readonly html: string;
	
	constructor(handle: rustBridge.DomTreePtr, html: string) {
		this.#handle = handle;
		this.html = html;
	}
	
	async find(selector: string): Promise<ZigSelection> {
		if (!this.#handle) return new ZigSelection([]);
		const results = rustBridge.querySelectorAll(this.#handle, selector);
		return new ZigSelection(results);
	}

	async querySelector(selector: string): Promise<ZigElement | null> {
		const sel = await this.find(selector);
		return sel.at(0);
	}

	async querySelectorAll(selector: string): Promise<ZigSelection> {
		return this.find(selector);
	}
	
	destroy(): void {
		if (this.#handle) {
			rustBridge.destroyTree(this.#handle);
			this.#handle = 0;
		}
	}
}

export async function parseHtml(html: string): Promise<ZigDoc> {
	const handle = rustBridge.parseHtml(html);
	return new ZigDoc(handle, html);
}
