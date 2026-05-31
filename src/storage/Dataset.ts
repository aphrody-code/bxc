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
 * @module bxc/storage/Dataset
 *
 * Append-only JSONL dataset backed by `Bun.file().writer()`.
 *
 * Inspired by Crawlee's Dataset
 * (packages/core/src/storages/dataset.ts) but rewritten Bun-native:
 *  - Uses `Bun.file().writer()` for buffered, non-blocking append writes.
 *  - No CSV dependency (optional CSV export uses hand-rolled serializer).
 *  - Auto-creates storage directory via `Bun.write`.
 *  - Supports JSON + JSONL + CSV export.
 *  - Atomic metadata file with record count (via `Bun.write`).
 *
 * Each dataset lives in:
 *   `<storageDir>/datasets/<name>/data.jsonl`   (rows, one JSON object per line)
 *   `<storageDir>/datasets/<name>/meta.json`    (count, createdAt, etc.)
 *
 * @example
 * ```ts
 * const ds = await Dataset.open("products");
 * await ds.pushData({ title: "Widget", price: 9.99 });
 * await ds.pushData([{ title: "Gadget" }, { title: "Gizmo" }]);
 * await ds.exportToJson("./out/products.json");
 * const count = await ds.getItemCount();
 * await ds.close();
 * ```
 */

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetItem = Record<string, unknown>;

export interface DatasetOptions {
	/**
	 * Root directory for all datasets.
	 * Default: `"./storage"`.
	 */
	storageDir?: string;
}

export interface DatasetMeta {
	name: string;
	createdAt: string;
	itemCount: number;
}

export interface DatasetExportOptions {
	/** Maximum number of rows to export. Default: all. */
	limit?: number;
	/** Rows to skip from the beginning. Default: 0. */
	offset?: number;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export class Dataset {
	readonly #dataPath: string;
	readonly #metaPath: string;
	readonly #name: string;
	#writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
	#itemCount = 0;

	private constructor(
		name: string,
		dataPath: string,
		metaPath: string,
		initialCount: number,
	) {
		this.#name = name;
		this.#dataPath = dataPath;
		this.#metaPath = metaPath;
		this.#itemCount = initialCount;
	}

	// ---------------------------------------------------------------------------
	// Factory
	// ---------------------------------------------------------------------------

	/**
	 * Open (or create) a named dataset.
	 * Datasets with the same name resume from where they left off.
	 */
	static async open(name: string, opts: DatasetOptions = {}): Promise<Dataset> {
		const storageDir = opts.storageDir ?? "./storage";
		const dir = join(storageDir, "datasets", name);
		const dataPath = join(dir, "data.jsonl");
		const metaPath = join(dir, "meta.json");

		// Ensure directory exists by writing a placeholder if needed
		// bun:mkdir is not available; use Bun.write to an empty sentinel
		const metaFile = Bun.file(metaPath);
		let initialCount = 0;

		if (await metaFile.exists()) {
			try {
				const meta = (await metaFile.json()) as DatasetMeta;
				initialCount = meta.itemCount ?? 0;
			} catch {
				initialCount = 0;
			}
		} else {
			// Bootstrap meta
			const meta: DatasetMeta = {
				name,
				createdAt: new Date().toISOString(),
				itemCount: 0,
			};
			await Bun.write(metaPath, JSON.stringify(meta, null, 2));
		}

		return new Dataset(name, dataPath, metaPath, initialCount);
	}

	// ---------------------------------------------------------------------------
	// Write
	// ---------------------------------------------------------------------------

	/**
	 * Append one or more items to the dataset.
	 * Each item must be a plain JSON-serializable object.
	 */
	async pushData(data: DatasetItem | DatasetItem[]): Promise<void> {
		const items = Array.isArray(data) ? data : [data];
		if (items.length === 0) return;

		// Lazy-init the streaming writer (append mode)
		if (this.#writer === null) {
			this.#writer = Bun.file(this.#dataPath).writer();
		}

		const writer = this.#writer;
		let newlines = "";
		for (const item of items) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) {
				throw new TypeError(
					`Dataset items must be plain objects, got: ${typeof item}`,
				);
			}
			newlines += JSON.stringify(item) + "\n";
			this.#itemCount++;
		}

		// Write all new lines in a single call for efficiency
		writer.write(newlines);
		await writer.flush();

		// Update meta atomically
		await this.#writeMeta();
	}

	// ---------------------------------------------------------------------------
	// Read / export
	// ---------------------------------------------------------------------------

	/**
	 * Read all items from the dataset into an array.
	 * Uses `Bun.file().text()` and splits on newlines — memory-efficient for
	 * moderate datasets (< 1 GB).
	 */
	async getData(opts: DatasetExportOptions = {}): Promise<DatasetItem[]> {
		const file = Bun.file(this.#dataPath);
		if (!(await file.exists())) return [];

		const text = await file.text();
		const offset = opts.offset ?? 0;
		const limit = opts.limit ?? Infinity;

		const lines = text.split("\n").filter((l) => l.trim().length > 0);
		const sliced = lines.slice(
			offset,
			limit === Infinity ? undefined : offset + limit,
		);

		const items: DatasetItem[] = [];
		for (const line of sliced) {
			try {
				items.push(JSON.parse(line) as DatasetItem);
			} catch {
				// Skip malformed lines
			}
		}
		return items;
	}

	/** Return the total number of items stored. */
	getItemCount(): number {
		return this.#itemCount;
	}

	/**
	 * Export data as a formatted JSON array to `outputPath`.
	 * Uses `Bun.write` for atomic single-shot write.
	 */
	async exportToJson(
		outputPath: string,
		opts?: DatasetExportOptions,
	): Promise<void> {
		const items = await this.getData(opts);
		await Bun.write(outputPath, JSON.stringify(items, null, 2));
	}

	/**
	 * Export data as CSV to `outputPath`.
	 * Column order is derived from the keys of the first item.
	 * Fields containing commas, newlines, or quotes are properly escaped (RFC 4180).
	 */
	async exportToCsv(
		outputPath: string,
		opts?: DatasetExportOptions,
	): Promise<void> {
		const items = await this.getData(opts);
		if (items.length === 0) {
			await Bun.write(outputPath, "");
			return;
		}

		const headers = Object.keys(items[0]);
		const escape = (v: unknown): string => {
			const s = v === null || v === undefined ? "" : String(v);
			if (
				s.includes(",") ||
				s.includes('"') ||
				s.includes("\n") ||
				s.includes("\r")
			) {
				return `"${s.replace(/"/g, '""')}"`;
			}
			return s;
		};

		const csvLines = [
			headers.map(escape).join(","),
			...items.map((row) => headers.map((h) => escape(row[h])).join(",")),
		];
		await Bun.write(outputPath, csvLines.join("\n") + "\n");
	}

	// ---------------------------------------------------------------------------
	// Management
	// ---------------------------------------------------------------------------

	/**
	 * Drop all data in this dataset (truncate both files).
	 */
	async clear(): Promise<void> {
		await this.close();
		await Bun.write(this.#dataPath, "");
		this.#itemCount = 0;
		await this.#writeMeta();
	}

	/**
	 * Flush and close the underlying file writer.
	 * Must be called before process exit to ensure all data is written.
	 */
	async close(): Promise<void> {
		if (this.#writer !== null) {
			await this.#writer.end();
			this.#writer = null;
		}
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	async #writeMeta(): Promise<void> {
		const meta: DatasetMeta = {
			name: this.#name,
			createdAt: new Date().toISOString(),
			itemCount: this.#itemCount,
		};
		// Bun.write is atomic on POSIX (write to temp + rename under the hood)
		await Bun.write(this.#metaPath, JSON.stringify(meta, null, 2));
	}
}
