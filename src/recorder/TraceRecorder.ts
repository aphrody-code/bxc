import { HarRecorder } from "./HarRecorder.ts";
import type { Page } from "../api/browser.ts";

export interface BunlightAction {
	type: "goto" | "click" | "fill" | "evaluate" | "keyboard" | "mouse";
	target: string;
	value?: string;
	timestamp: number;
	durationMs?: number;
}

export interface BunlightSnapshot {
	url: string;
	html: string;
	timestamp: number;
}

export interface BunlightTrace {
	version: "1.0";
	creator: string;
	actions: BunlightAction[];
	snapshots: BunlightSnapshot[];
	network: ReturnType<HarRecorder["stop"]>;
}

/**
 * Records a full trace of a Bunlight session including network (HAR),
 * DOM snapshots, and logical actions.
 * Outputs a highly compressed .trace.zst file using Bun.zstdCompressSync.
 */
export class TraceRecorder {
	readonly #page: Page;
	readonly #harRecorder: HarRecorder;
	#actions: BunlightAction[] = [];
	#snapshots: BunlightSnapshot[] = [];
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
		
		const trace: BunlightTrace = {
			version: "1.0",
			creator: "bunlight",
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
	recordAction(action: Omit<BunlightAction, "timestamp">): void {
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
