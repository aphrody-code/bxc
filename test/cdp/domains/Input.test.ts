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
 * Input domain handler — unit tests.
 *
 * Tests verify:
 *   - All four Input.* methods throw CDPError -32601 in static profile
 *     with a message containing "static profile".
 *   - All four Input.* methods throw CDPError -32601 in http profile
 *     with a message containing "no JS in http".
 *   - createInputHandler("fast") returns null for all Input.* methods
 *     (transport proxy handles forwarding at a lower layer).
 *   - Non-Input methods are ignored (return null) in all profiles.
 *
 * Total: 13 tests (4 static + 4 http + 4 fast delegation + 1 non-Input pass-through).
 */

import { describe, expect, test } from "bun:test";
import { createInputHandler, InputHandler } from "../../../src/cdp/domains/Input.ts";
import type { DispatchContext } from "../../../src/cdp/types.ts";
import { CDPError } from "../../../src/transport/InProcessTransport.ts";

// ---------------------------------------------------------------------------
// Minimal mock context — InputHandler does not access ctx fields, so an empty
// stub satisfies the DomainHandler signature.
// ---------------------------------------------------------------------------

const mockCtx = {} as unknown as DispatchContext;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INPUT_METHODS = [
	"Input.dispatchKeyEvent",
	"Input.dispatchMouseEvent",
	"Input.dispatchTouchEvent",
	"Input.insertText",
] as const;


/** Invokes a handler and returns the rejection reason if it rejects. */
async function callHandler(
	handler: ReturnType<typeof createInputHandler>,
	method: string,
): Promise<{ thrown: CDPError | null; result: unknown }> {
	try {
		const result = await handler(method, {}, mockCtx, undefined);
		return { thrown: null, result };
	} catch (err) {
		if (err instanceof CDPError) {
			return { thrown: err, result: undefined };
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// 1. Static profile — all four methods throw CDPError with "static profile"
// ---------------------------------------------------------------------------

describe("InputHandler static profile", () => {
	const handler = createInputHandler("static");

	for (const method of INPUT_METHODS) {
		test(`${method} in static throws CDPError -32601 with "static profile" message`, async () => {
			const { thrown } = await callHandler(handler, method);
			expect(thrown).not.toBeNull();
			expect(thrown).toBeInstanceOf(CDPError);
			expect(thrown!.code).toBe(-32601);
			expect(thrown!.message).toContain("static profile");
		});
	}

	test("exported InputHandler is equivalent to createInputHandler('static')", async () => {
		const { thrown } = await callHandler(InputHandler, "Input.dispatchKeyEvent");
		expect(thrown).toBeInstanceOf(CDPError);
		expect(thrown!.message).toContain("static profile");
	});
});

// ---------------------------------------------------------------------------
// 2. HTTP profile — all four methods throw CDPError "no JS in http"
// ---------------------------------------------------------------------------

describe("InputHandler http profile", () => {
	const handler = createInputHandler("http");

	for (const method of INPUT_METHODS) {
		test(`${method} in http throws CDPError -32601 with "no JS in http" message`, async () => {
			const { thrown } = await callHandler(handler, method);
			expect(thrown).not.toBeNull();
			expect(thrown).toBeInstanceOf(CDPError);
			expect(thrown!.code).toBe(-32601);
			expect(thrown!.message).toContain("no JS in http");
		});
	}
});

// ---------------------------------------------------------------------------
// 3. Fast profile — returns null (delegation to transport proxy)
// ---------------------------------------------------------------------------

describe("InputHandler fast profile delegation", () => {
	const handler = createInputHandler("fast");

	for (const method of INPUT_METHODS) {
		test(`${method} in fast returns null (proxy handles forwarding)`, async () => {
			const { thrown, result } = await callHandler(handler, method);
			expect(thrown).toBeNull();
			expect(result).toBeNull();
		});
	}
});

// ---------------------------------------------------------------------------
// 4. Stealth and max profiles — returns null (same proxy delegation)
// ---------------------------------------------------------------------------

describe("InputHandler stealth profile delegation", () => {
	const handler = createInputHandler("stealth");

	test("Input.dispatchKeyEvent in stealth returns null", async () => {
		const { thrown, result } = await callHandler(handler, "Input.dispatchKeyEvent");
		expect(thrown).toBeNull();
		expect(result).toBeNull();
	});
});

describe("InputHandler max profile delegation", () => {
	const handler = createInputHandler("max");

	test("Input.insertText in max returns null", async () => {
		const { thrown, result } = await callHandler(handler, "Input.insertText");
		expect(thrown).toBeNull();
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 5. Non-Input methods pass through (return null) in all profiles
// ---------------------------------------------------------------------------

describe("InputHandler ignores non-Input methods", () => {
	const staticHandler = createInputHandler("static");
	const httpHandler = createInputHandler("http");

	const NON_INPUT_METHODS = [
		"Page.navigate",
		"DOM.querySelector",
		"Runtime.evaluate",
		"Network.enable",
		"Target.createTarget",
	];

	for (const method of NON_INPUT_METHODS) {
		test(`${method} returns null in static profile (not owned by InputHandler)`, async () => {
			const { thrown, result } = await callHandler(staticHandler, method);
			expect(thrown).toBeNull();
			expect(result).toBeNull();
		});
	}

	test("Page.navigate returns null in http profile", async () => {
		const { thrown, result } = await callHandler(httpHandler, "Page.navigate");
		expect(thrown).toBeNull();
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 6. Integration — StaticDomTransport rejects Input.* via the handler chain
// ---------------------------------------------------------------------------

describe("StaticDomTransport Input.* integration", () => {
	test("Input.dispatchKeyEvent via StaticDomTransport returns CDPError in response", async () => {
		const { StaticDomTransport } = await import("../../../src/transport/StaticDomTransport.ts");
		const transport = StaticDomTransport.create();

		const response = await new Promise<{
			id: number;
			error?: { code: number; message: string };
		}>((resolve) => {
			transport.onmessage = (raw: string) => {
				const msg = JSON.parse(raw) as {
					id: number;
					error?: { code: number; message: string };
				};
				if (msg.id === 999) resolve(msg);
			};
			transport.send(
				JSON.stringify({
					id: 999,
					method: "Input.dispatchKeyEvent",
					params: { type: "keyDown", key: "Enter" },
				}),
			);
		});

		transport.close();

		expect(response.error).toBeDefined();
		expect(response.error!.code).toBe(-32601);
		expect(response.error!.message).toContain("static profile");
	});

	test("Input.dispatchMouseEvent via StaticDomTransport returns CDPError in response", async () => {
		const { StaticDomTransport } = await import("../../../src/transport/StaticDomTransport.ts");
		const transport = StaticDomTransport.create();

		const response = await new Promise<{
			id: number;
			error?: { code: number; message: string };
		}>((resolve) => {
			transport.onmessage = (raw: string) => {
				const msg = JSON.parse(raw) as {
					id: number;
					error?: { code: number; message: string };
				};
				if (msg.id === 1000) resolve(msg);
			};
			transport.send(
				JSON.stringify({
					id: 1000,
					method: "Input.dispatchMouseEvent",
					params: { type: "mousePressed", x: 100, y: 200, button: "left" },
				}),
			);
		});

		transport.close();

		expect(response.error).toBeDefined();
		expect(response.error!.code).toBe(-32601);
		expect(response.error!.message).toContain("static profile");
	});
});
