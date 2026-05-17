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
 * Browser domain handler tests — bun:test
 *
 * Tests cover Phase 1 additions:
 *   Browser.getWindowForTarget
 *   Browser.grantPermissions
 *   Browser.setDownloadBehavior
 *   Browser.setContentsSize
 *   Browser.downloadWillBegin event helper
 *   Browser.downloadProgress event helper
 * Plus regression tests for existing methods.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	emitDownloadProgress,
	emitDownloadWillBegin,
	getContentSize,
	getDownloadConfig,
	getGrantedPermissions,
} from "../../../src/cdp/domains/Browser.js";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// TransportMux — fan-out message dispatcher (avoids onmessage slot conflicts)
// ---------------------------------------------------------------------------

class TransportMux {
	readonly transport: StaticDomTransport;
	readonly #listeners = new Set<(raw: string) => void>();

	constructor() {
		this.transport = StaticDomTransport.create();
		this.transport.onmessage = (raw) => {
			for (const fn of this.#listeners) fn(raw);
		};
	}

	addListener(fn: (raw: string) => void): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const id = Math.floor(Math.random() * 1_000_000) + 1;
			const remove = this.addListener((raw) => {
				let msg: { id?: number; result?: unknown; error?: { message: string } };
				try {
					msg = JSON.parse(raw);
				} catch {
					return;
				}
				if (msg.id !== id) return;
				remove();
				if (msg.error) reject(new Error(msg.error.message));
				else resolve(msg.result);
			});
			this.transport.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	close(): void {
		this.transport.close();
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Browser domain — Phase 1 additions", () => {
	let mux: TransportMux;

	beforeEach(() => {
		mux = new TransportMux();
	});

	afterEach(() => {
		mux.close();
	});

	// -------------------------------------------------------------------------
	// Regression: existing methods
	// -------------------------------------------------------------------------

	test("Browser.getVersion returns product string (regression)", async () => {
		const result = (await mux.call("Browser.getVersion")) as { product: string };
		expect(result.product).toMatch("Bunlight");
	});

	// -------------------------------------------------------------------------
	// Browser.getWindowForTarget
	// -------------------------------------------------------------------------

	test("Browser.getWindowForTarget returns windowId and bounds", async () => {
		const result = (await mux.call("Browser.getWindowForTarget", {})) as {
			windowId: number;
			bounds: {
				left: number;
				top: number;
				width: number;
				height: number;
				windowState: string;
			};
		};
		expect(typeof result.windowId).toBe("number");
		expect(result.bounds.windowState).toBe("normal");
		expect(result.bounds.width).toBe(1280);
		expect(result.bounds.height).toBe(720);
	});

	test("Browser.getWindowForTarget bounds match setContentsSize override", async () => {
		await mux.call("Browser.setContentsSize", { width: 800, height: 600 });
		const result = (await mux.call("Browser.getWindowForTarget", {})) as {
			bounds: { width: number; height: number };
		};
		expect(result.bounds.width).toBe(800);
		expect(result.bounds.height).toBe(600);
	});

	// -------------------------------------------------------------------------
	// Browser.grantPermissions
	// -------------------------------------------------------------------------

	test("Browser.grantPermissions returns empty object", async () => {
		const result = await mux.call("Browser.grantPermissions", {
			origin: "https://google.com",
			permissions: ["geolocation"],
		});
		expect(result).toEqual({});
	});

	test("Browser.grantPermissions stores permissions in jar", async () => {
		await mux.call("Browser.grantPermissions", {
			origin: "https://google.com",
			permissions: ["geolocation", "notifications"],
		});
		const perms = getGrantedPermissions("https://google.com");
		expect(perms).toContain("geolocation");
		expect(perms).toContain("notifications");
	});

	test("Browser.grantPermissions merges duplicate permissions", async () => {
		await mux.call("Browser.grantPermissions", {
			origin: "https://google.com",
			permissions: ["geolocation"],
		});
		await mux.call("Browser.grantPermissions", {
			origin: "https://google.com",
			permissions: ["geolocation", "camera"],
		});
		const perms = getGrantedPermissions("https://google.com");
		const geoCount = perms.filter((p) => p === "geolocation").length;
		expect(geoCount).toBe(1);
		expect(perms).toContain("camera");
	});

	// -------------------------------------------------------------------------
	// Browser.setDownloadBehavior
	// -------------------------------------------------------------------------

	test("Browser.setDownloadBehavior returns empty object", async () => {
		const result = await mux.call("Browser.setDownloadBehavior", {
			behavior: "allow",
			downloadPath: "/tmp/downloads",
		});
		expect(result).toEqual({});
	});

	test("Browser.setDownloadBehavior stores config", async () => {
		await mux.call("Browser.setDownloadBehavior", {
			behavior: "allow",
			downloadPath: "/tmp/test-dl",
		});
		const cfg = getDownloadConfig();
		expect(cfg.behavior).toBe("allow");
		expect(cfg.downloadPath).toBe("/tmp/test-dl");
	});

	test("Browser.setDownloadBehavior deny mode stored", async () => {
		await mux.call("Browser.setDownloadBehavior", { behavior: "deny" });
		const cfg = getDownloadConfig();
		expect(cfg.behavior).toBe("deny");
	});

	// -------------------------------------------------------------------------
	// Browser.setContentsSize
	// -------------------------------------------------------------------------

	test("Browser.setContentsSize returns empty object", async () => {
		const result = await mux.call("Browser.setContentsSize", {
			width: 1920,
			height: 1080,
		});
		expect(result).toEqual({});
	});

	test("Browser.setContentsSize stores viewport dimensions", async () => {
		await mux.call("Browser.setContentsSize", { width: 1024, height: 768 });
		const size = getContentSize();
		expect(size.width).toBe(1024);
		expect(size.height).toBe(768);
	});

	// -------------------------------------------------------------------------
	// Download event helpers (tested via mock DispatchContext)
	// -------------------------------------------------------------------------

	test("emitDownloadWillBegin fires Browser.downloadWillBegin event", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		emitDownloadWillBegin(mockCtx as Parameters<typeof emitDownloadWillBegin>[0], {
			guid: "test-guid-001",
			url: "https://google.com/file.zip",
			suggestedFilename: "file.zip",
			frameId: "frame-1",
		});

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Browser.downloadWillBegin");
		expect(collectedEvents[0].params.guid).toBe("test-guid-001");
		expect(collectedEvents[0].params.suggestedFilename).toBe("file.zip");
	});

	test("emitDownloadProgress fires Browser.downloadProgress event", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		emitDownloadProgress(mockCtx as Parameters<typeof emitDownloadProgress>[0], {
			guid: "test-guid-001",
			totalBytes: 1000,
			receivedBytes: 500,
			state: "inProgress",
		});

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Browser.downloadProgress");
		expect(collectedEvents[0].params.state).toBe("inProgress");
		expect(collectedEvents[0].params.receivedBytes).toBe(500);
	});
});
