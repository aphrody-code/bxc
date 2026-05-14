/**
 * Tracing domain handler tests — bun:test
 *
 * Tests cover:
 *   Tracing.start
 *   Tracing.end (emits dataCollected + tracingComplete)
 *   isTracingActive helper
 *   emitDataCollected helper
 *   emitTracingComplete helper
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	emitDataCollected,
	emitTracingComplete,
	isTracingActive,
} from "../../../src/cdp/domains/Tracing.js";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// TransportMux — fan-out message dispatcher
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

	/**
	 * Collects CDP events until `stopEventMethod` is received.
	 * Returns all events seen (including the stop event).
	 */
	collectUntil(
		stopEventMethod: string,
		timeoutMs = 3000,
	): Promise<Array<{ method: string; params: Record<string, unknown> }>> {
		return new Promise((resolve, reject) => {
			const events: Array<{ method: string; params: Record<string, unknown> }> = [];
			const timer = setTimeout(
				() => reject(new Error(`Timeout collecting events until ${stopEventMethod}`)),
				timeoutMs,
			);
			const remove = this.addListener((raw) => {
				let msg: { id?: number; method?: string; params?: Record<string, unknown> };
				try {
					msg = JSON.parse(raw);
				} catch {
					return;
				}
				if (msg.method) {
					events.push({ method: msg.method, params: msg.params ?? {} });
					if (msg.method === stopEventMethod) {
						clearTimeout(timer);
						remove();
						resolve(events);
					}
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

describe("Tracing domain", () => {
	let mux: TransportMux;

	beforeEach(() => {
		mux = new TransportMux();
	});

	afterEach(async () => {
		// Ensure any active trace is ended before closing transport
		try {
			await mux.call("Tracing.end");
		} catch {
			// ignore
		}
		mux.close();
	});

	// -------------------------------------------------------------------------
	// Tracing.start
	// -------------------------------------------------------------------------

	test("Tracing.start returns empty object", async () => {
		const result = await mux.call("Tracing.start", { categories: "blink" });
		expect(result).toEqual({});
	});

	test("Tracing.start marks tracing as active", async () => {
		await mux.call("Tracing.start", {});
		expect(isTracingActive()).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Tracing.end
	// -------------------------------------------------------------------------

	test("Tracing.end returns empty object", async () => {
		await mux.call("Tracing.start", {});
		const result = await mux.call("Tracing.end");
		expect(result).toEqual({});
	});

	test("Tracing.end emits Tracing.dataCollected event", async () => {
		await mux.call("Tracing.start", {});

		const collectPromise = mux.collectUntil("Tracing.tracingComplete");
		await mux.call("Tracing.end");
		const events = await collectPromise;

		const dataCollected = events.filter((e) => e.method === "Tracing.dataCollected");
		expect(dataCollected.length).toBeGreaterThan(0);
		const value = dataCollected[0].params.value as unknown[];
		expect(Array.isArray(value)).toBe(true);
		expect(value.length).toBeGreaterThan(0);
	});

	test("Tracing.end emits Tracing.tracingComplete event", async () => {
		await mux.call("Tracing.start", {});

		const collectPromise = mux.collectUntil("Tracing.tracingComplete");
		await mux.call("Tracing.end");
		const events = await collectPromise;

		const complete = events.find((e) => e.method === "Tracing.tracingComplete");
		expect(complete).toBeDefined();
		expect(complete?.params.dataLossOccurred).toBe(false);
	});

	test("Tracing.end marks tracing as inactive", async () => {
		await mux.call("Tracing.start", {});

		const collectPromise = mux.collectUntil("Tracing.tracingComplete");
		await mux.call("Tracing.end");
		await collectPromise;

		expect(isTracingActive()).toBe(false);
	});

	test("Tracing.end without prior start emits events without error", async () => {
		const collectPromise = mux.collectUntil("Tracing.tracingComplete");
		const result = await mux.call("Tracing.end");
		expect(result).toEqual({});
		const events = await collectPromise;
		const complete = events.find((e) => e.method === "Tracing.tracingComplete");
		expect(complete).toBeDefined();
	});

	// -------------------------------------------------------------------------
	// Event helpers (tested via mock DispatchContext)
	// -------------------------------------------------------------------------

	test("emitDataCollected sends correct event structure", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		const traceEvents = [{ pid: 1, tid: 1, ph: "M", cat: "meta", name: "test", ts: 0 }];
		emitDataCollected(mockCtx as Parameters<typeof emitDataCollected>[0], traceEvents);

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Tracing.dataCollected");
		const value = collectedEvents[0].params.value as Array<Record<string, unknown>>;
		expect(Array.isArray(value)).toBe(true);
		expect(value[0].name).toBe("test");
	});

	test("emitTracingComplete sends correct event structure", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		emitTracingComplete(mockCtx as Parameters<typeof emitTracingComplete>[0]);

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Tracing.tracingComplete");
		expect(collectedEvents[0].params.dataLossOccurred).toBe(false);
	});
});
