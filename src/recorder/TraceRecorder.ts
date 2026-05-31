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

import { HarRecorder } from "./HarRecorder.ts";
import type { Page } from "../api/browser.ts";

export interface BxcAction {
	type: "goto" | "click" | "fill" | "evaluate" | "keyboard" | "mouse";
	target: string;
	value?: string;
	timestamp: number;
	durationMs?: number;
}

export interface BxcSnapshot {
	url: string;
	html: string;
	timestamp: number;
}

export interface BxcTrace {
	version: "1.0";
	creator: string;
	actions: BxcAction[];
	snapshots: BxcSnapshot[];
	network: ReturnType<HarRecorder["stop"]>;
}

/**
 * Records a full trace of a Bxc session including network (HAR),
 * DOM snapshots, and logical actions.
 * Outputs a highly compressed .trace.zst file using Bun.zstdCompressSync.
 */
export class TraceRecorder {
	readonly #page: Page;
	readonly #harRecorder: HarRecorder;
	#actions: BxcAction[] = [];
	#snapshots: BxcSnapshot[] = [];
	#recording = false;

	constructor(page: Page) {
		this.#page = page;
		this.#harRecorder = new HarRecorder(page);
	}

	start(): void {
		if (this.#recording) return;
		this.#recording = true;
		this.#actions = [];
		this.#snapshots = [];
		this.#harRecorder.start();
	}

	async stopAndSave(path: string): Promise<void> {
		if (!this.#recording) return;
		this.#recording = false;

		const har = this.#harRecorder.stop();

		const trace: BxcTrace = {
			version: "1.0",
			creator: "bxc",
			actions: this.#actions,
			snapshots: this.#snapshots,
			network: har,
		};

		const jsonBuffer = Buffer.from(JSON.stringify(trace));
		// Use Bun's native ZSTD compression
		const compressed = Bun.zstdCompressSync(jsonBuffer);

		await Bun.write(path, compressed);
	}

	// Used internally or by Page wrappers to log actions
	recordAction(action: Omit<BxcAction, "timestamp">): void {
		if (!this.#recording) return;
		this.#actions.push({ ...action, timestamp: Date.now() });
	}

	// Capture a snapshot of the current DOM
	async captureSnapshot(): Promise<void> {
		if (!this.#recording) return;
		try {
			const html = await this.#page.content();
			const url = this.#page.url();
			this.#snapshots.push({
				url,
				html,
				timestamp: Date.now(),
			});
		} catch {
			// Ignore if page is closed or unreachable
		}
	}
}
