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
 * Tests for the Emulation domain handler.
 *
 * Verifies state storage and HTTP-header propagation for each Emulation.*
 * method.  Tests that affect HTTP headers (User-Agent, Accept-Language) spin
 * up a local Bun.serve instance to capture actual request headers sent by
 * StaticDomTransport.#navigate.
 *
 * Tests that only store state (deviceMetrics, geolocation, timezone, media)
 * verify the handler returns {} without throwing, which is the correct
 * behaviour for static-mode no-ops.
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

/** Create a target + session, return the sessionId. */
async function openSession(transport: StaticDomTransport): Promise<string> {
	const { targetId } = (await cdpCall(transport, "Target.createTarget", {
		url: "about:blank",
	})) as { targetId: string };
	const { sessionId } = (await cdpCall(transport, "Target.attachToTarget", {
		targetId,
		flatten: true,
	})) as { sessionId: string };
	return sessionId;
}

/**
 * Spins up a minimal Bun HTTP server that captures a single request and
 * resolves the promise with the request headers.  The server keeps accepting
 * connections (needed so the response can be fully sent before we stop).
 */
function captureOneRequest(): { url: string; promise: Promise<Headers>; stop: () => void } {
	let resolveHeaders!: (h: Headers) => void;
	const promise = new Promise<Headers>((resolve) => {
		resolveHeaders = resolve;
	});

	const server = Bun.serve({
		port: 0, // OS-assigned port
		fetch(req) {
			resolveHeaders(req.headers);
			return new Response("<html><body>ok</body></html>", {
				headers: { "Content-Type": "text/html" },
			});
		},
	});

	return {
		url: `http://localhost:${server.port}/`,
		promise,
		stop: () => server.stop(true),
	};
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Emulation domain handler", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => {
		transport.close();
	});

	// -------------------------------------------------------------------------
	// setDeviceMetricsOverride
	// -------------------------------------------------------------------------

	test("setDeviceMetricsOverride returns {} and accepts full params", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setDeviceMetricsOverride",
			{ width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
			sessionId,
		);
		expect(result).toEqual({});
	});

	test("setDeviceMetricsOverride accepts partial params (uses defaults)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setDeviceMetricsOverride",
			{ width: 1024, height: 768 },
			sessionId,
		);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// clearDeviceMetricsOverride
	// -------------------------------------------------------------------------

	test("clearDeviceMetricsOverride returns {} after setDeviceMetricsOverride", async () => {
		const sessionId = await openSession(transport);
		await cdpCall(
			transport,
			"Emulation.setDeviceMetricsOverride",
			{ width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
			sessionId,
		);
		const result = await cdpCall(transport, "Emulation.clearDeviceMetricsOverride", {}, sessionId);
		expect(result).toEqual({});
	});

	test("clearDeviceMetricsOverride without prior set is safe (no throw)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(transport, "Emulation.clearDeviceMetricsOverride", {}, sessionId);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// setEmulatedMedia
	// -------------------------------------------------------------------------

	test("setEmulatedMedia stores media type (print)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setEmulatedMedia",
			{ media: "print" },
			sessionId,
		);
		expect(result).toEqual({});
	});

	test("setEmulatedMedia stores media features (prefers-color-scheme: dark)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setEmulatedMedia",
			{
				media: "screen",
				features: [{ name: "prefers-color-scheme", value: "dark" }],
			},
			sessionId,
		);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// setUserAgentOverride — verified via HTTP header capture
	// -------------------------------------------------------------------------

	test("setUserAgentOverride injects UA into next Page.navigate request headers", async () => {
		const sessionId = await openSession(transport);
		const customUA = "MyTestBot/2.0 (bxc-test)";

		await cdpCall(transport, "Emulation.setUserAgentOverride", { userAgent: customUA }, sessionId);

		const { url, promise, stop } = captureOneRequest();
		try {
			await cdpCall(transport, "Page.navigate", { url }, sessionId);
			const headers = await promise;
			expect(headers.get("user-agent")).toBe(customUA);
		} finally {
			stop();
		}
	});

	test("setUserAgentOverride with empty string reverts to default Bxc UA", async () => {
		const sessionId = await openSession(transport);

		// Set a custom UA first
		await cdpCall(
			transport,
			"Emulation.setUserAgentOverride",
			{ userAgent: "CustomAgent/1.0" },
			sessionId,
		);
		// Clear it with empty string
		await cdpCall(transport, "Emulation.setUserAgentOverride", { userAgent: "" }, sessionId);

		const { url, promise, stop } = captureOneRequest();
		try {
			await cdpCall(transport, "Page.navigate", { url }, sessionId);
			const headers = await promise;
			// Should fall back to the default Bxc UA
			expect(headers.get("user-agent")).toMatch(/Bxc/);
		} finally {
			stop();
		}
	});

	// -------------------------------------------------------------------------
	// setGeolocationOverride
	// -------------------------------------------------------------------------

	test("setGeolocationOverride stores lat/lng/accuracy and returns {}", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setGeolocationOverride",
			{ latitude: 48.8566, longitude: 2.3522, accuracy: 50 },
			sessionId,
		);
		expect(result).toEqual({});
	});

	test("setGeolocationOverride with empty params clears override", async () => {
		const sessionId = await openSession(transport);
		await cdpCall(
			transport,
			"Emulation.setGeolocationOverride",
			{ latitude: 37.7749, longitude: -122.4194 },
			sessionId,
		);
		const result = await cdpCall(transport, "Emulation.setGeolocationOverride", {}, sessionId);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// setLocaleOverride — verified via Accept-Language header
	// -------------------------------------------------------------------------

	test("setLocaleOverride injects Accept-Language into next Page.navigate headers", async () => {
		const sessionId = await openSession(transport);
		await cdpCall(transport, "Emulation.setLocaleOverride", { locale: "fr-FR" }, sessionId);

		const { url, promise, stop } = captureOneRequest();
		try {
			await cdpCall(transport, "Page.navigate", { url }, sessionId);
			const headers = await promise;
			const acceptLang = headers.get("accept-language") ?? "";
			// Should contain the primary locale
			expect(acceptLang).toContain("fr-FR");
		} finally {
			stop();
		}
	});

	// -------------------------------------------------------------------------
	// setTimezoneOverride
	// -------------------------------------------------------------------------

	test("setTimezoneOverride stores IANA timezone and returns {}", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setTimezoneOverride",
			{ timezoneId: "America/New_York" },
			sessionId,
		);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// setTouchEmulationEnabled (no-op)
	// -------------------------------------------------------------------------

	test("setTouchEmulationEnabled returns {} (no-op in static mode)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setTouchEmulationEnabled",
			{ enabled: true, maxTouchPoints: 5 },
			sessionId,
		);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// setScrollbarsHidden (no-op)
	// -------------------------------------------------------------------------

	test("setScrollbarsHidden returns {} (no-op in static mode)", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Emulation.setScrollbarsHidden",
			{ hidden: true },
			sessionId,
		);
		expect(result).toEqual({});
	});
});
