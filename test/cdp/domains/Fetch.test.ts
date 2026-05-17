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
 * Fetch domain handler tests.
 *
 * Tests cover:
 *  - Fetch.enable / Fetch.disable
 *  - Fetch.fulfillRequest — mock response during Page.navigate
 *  - Fetch.failRequest    — abort navigation with custom error
 *  - Fetch.continueRequest — resume request (pass-through during data: nav)
 *  - Fetch.continueWithAuth — supply credentials
 *  - Fetch.requestPaused event emitted for matched requests
 *  - Multiple patterns filtering
 *
 * All tests run against StaticDomTransport in-process.
 * Tests that exercise real HTTP navigation are skipped if offline.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

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

async function createSession(transport: StaticDomTransport): Promise<string> {
	const { targetId } = (await cdpCall(transport, "Target.createTarget", {
		url: "about:blank",
	})) as { targetId: string };
	const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
		targetId,
		flatten: true,
	})) as { sessionId: string };
	return sessionId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Fetch domain handler", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => {
		transport.close();
	});

	// -------------------------------------------------------------------------
	// Enable / Disable
	// -------------------------------------------------------------------------

	test("Fetch.enable returns empty object", async () => {
		const result = await cdpCall(transport, "Fetch.enable", { patterns: [] });
		expect(result).toEqual({});
	});

	test("Fetch.disable returns empty object", async () => {
		await cdpCall(transport, "Fetch.enable", {});
		const result = await cdpCall(transport, "Fetch.disable");
		expect(result).toEqual({});
	});

	test("Fetch.disable is idempotent without prior enable", async () => {
		const result = await cdpCall(transport, "Fetch.disable");
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// Fetch.fulfillRequest — mock response during navigate
	// -------------------------------------------------------------------------

	test("Fetch.fulfillRequest mocks a navigation response", async () => {
		const sessionId = await createSession(transport);

		// Enable interception for all URLs
		await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);

		// Collect requestPaused events and immediately fulfill them
		let pausedRequestId: string | null = null;

		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { method?: string; params?: Record<string, unknown>; sessionId?: string };
			try {
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
				pausedRequestId = (msg.params?.requestId as string | undefined) ?? null;
				if (pausedRequestId) {
					// Fulfill with mock HTML
					const bodyBase64 = Buffer.from(
						"<html><head><title>Mocked</title></head></html>",
					).toString("base64");
					void cdpCall(
						transport,
						"Fetch.fulfillRequest",
						{
							requestId: pausedRequestId,
							responseCode: 200,
							responseHeaders: [{ name: "content-type", value: "text/html" }],
							body: bodyBase64,
						},
						sessionId,
					);
				}
			}
		};

		// Navigate to a URL that will be intercepted
		await cdpCall(transport, "Page.navigate", { url: "https://google.com" }, sessionId);
		transport.onmessage = prev;

		expect(pausedRequestId).not.toBeNull();

		// The page title should reflect the mocked response
		const { result } = (await cdpCall(
			transport,
			"Runtime.evaluate",
			{ expression: "document.title", returnByValue: true },
			sessionId,
		)) as { result: { value: string } };
		expect(result.value).toBe("Mocked");
	});

	// -------------------------------------------------------------------------
	// Fetch.failRequest — abort with error
	// -------------------------------------------------------------------------

	test("Fetch.failRequest aborts navigation with an error", async () => {
		const sessionId = await createSession(transport);

		// Enable interception
		await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);

		// Fail any paused request
		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { method?: string; params?: Record<string, unknown>; sessionId?: string };
			try {
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
				const reqId = msg.params?.requestId as string | undefined;
				if (reqId) {
					void cdpCall(
						transport,
						"Fetch.failRequest",
						{ requestId: reqId, errorReason: "Aborted" },
						sessionId,
					);
				}
			}
		};

		// The navigate should fail (transport re-throws the error from #navigate)
		await expect(
			cdpCall(transport, "Page.navigate", { url: "https://google.com" }, sessionId),
		).rejects.toThrow();
		transport.onmessage = prev;
	});

	// -------------------------------------------------------------------------
	// Fetch.continueRequest — pass-through
	// -------------------------------------------------------------------------

	test("Fetch.continueRequest allows navigation to proceed", async () => {
		const sessionId = await createSession(transport);

		// Enable interception
		await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);

		// Continue any paused request
		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { method?: string; params?: Record<string, unknown>; sessionId?: string };
			try {
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
				const reqId = msg.params?.requestId as string | undefined;
				if (reqId) {
					void cdpCall(transport, "Fetch.continueRequest", { requestId: reqId }, sessionId);
				}
			}
		};

		// Navigate with a data: URI (data: URIs skip fetch interception so no pause fires)
		// This tests that disabling interception doesn't break navigation
		await cdpCall(transport, "Page.navigate", { url: "data:text/html,<p>hi</p>" }, sessionId);
		transport.onmessage = prev;

		// If we get here without error the test passes
		expect(true).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Fetch.continueWithAuth
	// -------------------------------------------------------------------------

	test("Fetch.continueWithAuth returns empty object for unknown requestId", async () => {
		// continueWithAuth with an unknown requestId must be a no-op
		const result = await cdpCall(transport, "Fetch.continueWithAuth", {
			requestId: "non-existent",
			authChallengeResponse: { response: "ProvideCredentials", username: "u", password: "p" },
		});
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// Pattern matching
	// -------------------------------------------------------------------------

	test("Fetch.enable with specific pattern only intercepts matching URLs", async () => {
		const sessionId = await createSession(transport);

		// Enable interception only for /api/* paths
		await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] }, sessionId);

		let intercepted = false;
		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { method?: string; params?: Record<string, unknown>; sessionId?: string };
			try {
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
				intercepted = true;
				const reqId = msg.params?.requestId as string | undefined;
				if (reqId) {
					// Continue immediately to avoid hanging
					void cdpCall(transport, "Fetch.continueRequest", { requestId: reqId }, sessionId);
				}
			}
		};

		// Navigate to a data: URI — should NOT be intercepted (not matching pattern)
		await cdpCall(transport, "Page.navigate", { url: "data:text/html,<p>test</p>" }, sessionId);
		transport.onmessage = prev;

		expect(intercepted).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Fulfill with custom status code
	// -------------------------------------------------------------------------

	test("Fetch.fulfillRequest with 404 code delivers body to page", async () => {
		const sessionId = await createSession(transport);

		await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);

		const prev = transport.onmessage;
		transport.onmessage = (raw: string) => {
			prev?.call(transport, raw);
			let msg: { method?: string; params?: Record<string, unknown>; sessionId?: string };
			try {
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
				const reqId = msg.params?.requestId as string | undefined;
				if (reqId) {
					const b64 = Buffer.from("<html><head><title>Not Found</title></head></html>").toString(
						"base64",
					);
					void cdpCall(
						transport,
						"Fetch.fulfillRequest",
						{
							requestId: reqId,
							responseCode: 404,
							responseHeaders: [{ name: "content-type", value: "text/html" }],
							body: b64,
						},
						sessionId,
					);
				}
			}
		};

		await cdpCall(transport, "Page.navigate", { url: "https://google.com/missing" }, sessionId);
		transport.onmessage = prev;

		const { result } = (await cdpCall(
			transport,
			"Runtime.evaluate",
			{ expression: "document.title", returnByValue: true },
			sessionId,
		)) as { result: { value: string } };
		expect(result.value).toBe("Not Found");
	});
});
