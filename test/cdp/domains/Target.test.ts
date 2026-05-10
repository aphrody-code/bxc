/**
 * Target domain handler tests — bun:test
 *
 * Tests cover Phase 1 additions:
 *   Target.createBrowserContext
 *   Target.getTargets
 *   Target.detachFromTarget
 *   Target.detachedFromTarget event
 * Plus regression tests for existing methods.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// TransportMux — multiplexes CDP responses and events to multiple listeners
// ---------------------------------------------------------------------------

/**
 * Wraps StaticDomTransport with a fan-out message dispatcher.
 * Each cdpCall and waitForEvent registers its own listener, avoiding the
 * single-onmessage slot conflict that causes event delivery failures.
 */
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

	waitForEvent(eventMethod: string, timeoutMs = 2000): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`Timeout waiting for ${eventMethod}`)),
				timeoutMs,
			);
			const remove = this.addListener((raw) => {
				let msg: { method?: string; params?: Record<string, unknown> };
				try {
					msg = JSON.parse(raw);
				} catch {
					return;
				}
				if (msg.method === eventMethod) {
					clearTimeout(timer);
					remove();
					resolve(msg.params ?? {});
				}
			});
		});
	}

	close(): void {
		this.transport.close();
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Target domain — Phase 1 additions", () => {
	let mux: TransportMux;

	beforeEach(() => {
		mux = new TransportMux();
	});

	afterEach(() => {
		mux.close();
	});

	// -------------------------------------------------------------------------
	// Target.createBrowserContext
	// -------------------------------------------------------------------------

	test("Target.createBrowserContext returns a contextId string", async () => {
		const result = (await mux.call("Target.createBrowserContext")) as {
			browserContextId: string;
		};
		expect(typeof result.browserContextId).toBe("string");
		expect(result.browserContextId.length).toBeGreaterThan(0);
	});

	test("Target.createBrowserContext returns unique IDs on repeated calls", async () => {
		const r1 = (await mux.call("Target.createBrowserContext")) as {
			browserContextId: string;
		};
		const r2 = (await mux.call("Target.createBrowserContext")) as {
			browserContextId: string;
		};
		expect(r1.browserContextId).not.toBe(r2.browserContextId);
	});

	// -------------------------------------------------------------------------
	// Target.getTargets
	// -------------------------------------------------------------------------

	test("Target.getTargets returns array of targetInfos", async () => {
		const result = (await mux.call("Target.getTargets")) as {
			targetInfos: Array<{ targetId: string; type: string }>;
		};
		expect(Array.isArray(result.targetInfos)).toBe(true);
		expect(result.targetInfos.length).toBeGreaterThan(0);
	});

	test("Target.getTargets includes newly created page targets", async () => {
		await mux.call("Target.createTarget", { url: "about:blank" });
		const result = (await mux.call("Target.getTargets")) as {
			targetInfos: Array<{ targetId: string; type: string }>;
		};
		const pageTargets = result.targetInfos.filter((t) => t.type === "page");
		expect(pageTargets.length).toBeGreaterThanOrEqual(1);
	});

	test("Target.getTargets returns targetInfos with required fields", async () => {
		const result = (await mux.call("Target.getTargets")) as {
			targetInfos: Array<{ targetId: string; url: string; type: string }>;
		};
		for (const info of result.targetInfos) {
			expect(typeof info.targetId).toBe("string");
			expect(typeof info.url).toBe("string");
			expect(typeof info.type).toBe("string");
		}
	});

	// -------------------------------------------------------------------------
	// Target.detachFromTarget
	// -------------------------------------------------------------------------

	test("Target.detachFromTarget returns empty object", async () => {
		const { targetId } = (await mux.call("Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const { sessionId } = (await mux.call("Target.attachToTarget", {
			targetId,
		})) as { sessionId: string };

		const result = await mux.call("Target.detachFromTarget", { sessionId });
		expect(result).toEqual({});
	});

	test("Target.detachFromTarget emits Target.detachedFromTarget event", async () => {
		const { targetId } = (await mux.call("Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const { sessionId } = (await mux.call("Target.attachToTarget", {
			targetId,
		})) as { sessionId: string };

		// Set up event listener before the call that triggers it
		const eventPromise = mux.waitForEvent("Target.detachedFromTarget");
		await mux.call("Target.detachFromTarget", { sessionId });
		const event = await eventPromise;
		expect(event.sessionId).toBe(sessionId);
	});

	test("Target.detachFromTarget with unknown sessionId still returns ok", async () => {
		const result = await mux.call("Target.detachFromTarget", {
			sessionId: "nonexistent-session",
		});
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// Regression: existing methods still work
	// -------------------------------------------------------------------------

	test("Target.getBrowserContexts still returns context IDs (regression)", async () => {
		const result = (await mux.call("Target.getBrowserContexts")) as {
			browserContextIds: string[];
		};
		expect(Array.isArray(result.browserContextIds)).toBe(true);
		expect(result.browserContextIds.length).toBeGreaterThan(0);
	});

	test("Target.closeTarget still works after Phase 1 changes (regression)", async () => {
		const { targetId } = (await mux.call("Target.createTarget", {
			url: "about:blank",
		})) as { targetId: string };
		const result = (await mux.call("Target.closeTarget", { targetId })) as {
			success: boolean;
		};
		expect(result.success).toBe(true);
	});
});
