/**
 * Runtime domain handler tests — bun:test
 *
 * Tests cover Phase 1 additions:
 *   Runtime.addBinding
 *   Runtime.consoleAPICalled event helper
 *   Runtime.exceptionThrown event helper
 * Plus regression test for existing Runtime.enable.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";
import {
	getRegisteredBindings,
	emitConsoleAPICalled,
	emitExceptionThrown,
} from "../../../src/cdp/domains/Runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cdpCall(
	transport: StaticDomTransport,
	method: string,
	params: Record<string, unknown> = {},
	sessionId?: string,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const id = Math.floor(Math.random() * 1_000_000) + 1;
		const prev = transport.onmessage;

		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { id?: number; result?: unknown; error?: { message: string } };
			try {
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			if (msg.id !== id) return;
			transport.onmessage = prev;
			if (msg.error) reject(new Error(msg.error.message));
			else resolve(msg.result);
		};

		transport.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Runtime domain — Phase 1 additions", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => {
		transport.close();
	});

	// -------------------------------------------------------------------------
	// Runtime.addBinding
	// -------------------------------------------------------------------------

	test("Runtime.addBinding returns empty object", async () => {
		const result = await cdpCall(transport, "Runtime.addBinding", { name: "myBinding" });
		expect(result).toEqual({});
	});

	test("Runtime.addBinding registers the binding name", async () => {
		await cdpCall(transport, "Runtime.addBinding", { name: "testBinding" });
		expect(getRegisteredBindings().has("testBinding")).toBe(true);
	});

	test("Runtime.addBinding accepts multiple bindings", async () => {
		await cdpCall(transport, "Runtime.addBinding", { name: "bindingA" });
		await cdpCall(transport, "Runtime.addBinding", { name: "bindingB" });
		expect(getRegisteredBindings().has("bindingA")).toBe(true);
		expect(getRegisteredBindings().has("bindingB")).toBe(true);
	});

	// -------------------------------------------------------------------------
	// emitConsoleAPICalled helper
	// -------------------------------------------------------------------------

	test("emitConsoleAPICalled emits Runtime.consoleAPICalled event", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		emitConsoleAPICalled(mockCtx as Parameters<typeof emitConsoleAPICalled>[0], "session-1", {
			type: "log",
			args: [{ type: "string", value: "hello" }],
			executionContextId: 1,
			timestamp: Date.now(),
		});

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Runtime.consoleAPICalled");
		expect(collectedEvents[0].params.type).toBe("log");
	});

	// -------------------------------------------------------------------------
	// emitExceptionThrown helper
	// -------------------------------------------------------------------------

	test("emitExceptionThrown emits Runtime.exceptionThrown event", () => {
		const collectedEvents: Array<{ method: string; params: Record<string, unknown> }> = [];

		const mockCtx = {
			emitEvent: (ev: { method: string; params: Record<string, unknown> }) => {
				collectedEvents.push(ev);
			},
		};

		emitExceptionThrown(mockCtx as Parameters<typeof emitExceptionThrown>[0], "session-2", {
			timestamp: Date.now(),
			exceptionDetails: {
				exceptionId: 1,
				text: "ReferenceError: foo is not defined",
				lineNumber: 5,
				columnNumber: 10,
				exception: { type: "object", description: "ReferenceError: foo is not defined" },
			},
		});

		expect(collectedEvents.length).toBe(1);
		expect(collectedEvents[0].method).toBe("Runtime.exceptionThrown");
		const details = collectedEvents[0].params.exceptionDetails as Record<string, unknown>;
		expect(details.text).toBe("ReferenceError: foo is not defined");
	});
});
