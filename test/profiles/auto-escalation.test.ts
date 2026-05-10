/**
 * Tests for auto-escalation: static → fast → stealth → max chain.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
	detectEscalationSignal,
	nextProfile,
	ESCALATION_ORDER,
	type EscalationStep,
} from "../../src/profiles/auto-escalation.ts";

describe("auto-escalation: signal detection", () => {
	it("should detect empty body", () => {
		const signal = detectEscalationSignal("", 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("empty_body");
	});

	it("should detect small body (SPA placeholder)", () => {
		const html = "<html><noscript>Please enable JavaScript</noscript></html>";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("spa_placeholder");
	});

	it("should detect HTTP 403", () => {
		const signal = detectEscalationSignal("Forbidden", 403);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("status_403");
	});

	it("should detect Cloudflare 'Just a moment'", () => {
		const html = "Just a moment while we check your browser...";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("cloudflare");
	});

	it("should detect Cloudflare 'Checking your browser'", () => {
		const html = "<title>Checking your browser</title>";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("cloudflare");
	});

	it("should detect cf-mitigated header", () => {
		const html = "cf-mitigated in response";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("cloudflare");
	});

	it("should detect DataDome protection", () => {
		const html = "<title>Access Denied</title> DataDome protection";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("datadome");
	});

	it("should detect Turnstile CAPTCHA", () => {
		const html = '<iframe id="cf-challenge" src="...">Turnstile CAPTCHA</iframe>';
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("turnstile");
	});

	it("should detect generic CAPTCHA", () => {
		const html = '<iframe id="g_recaptcha" ... />';
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeTruthy();
		expect(signal?.reason).toBe("captcha");
	});

	it("should return null for successful response", () => {
		const html = "<html><body><h1>Welcome</h1><p>Real content</p></body></html>";
		const signal = detectEscalationSignal(html, 200);
		expect(signal).toBeNull();
	});

	it("should return null for 404 (not a bot block)", () => {
		const html = "<h1>404 Not Found</h1>";
		const signal = detectEscalationSignal(html, 404);
		expect(signal).toBeNull();
	});

	it("should return null for 500 (server error, not bot block)", () => {
		const html = "<h1>500 Internal Server Error</h1>";
		const signal = detectEscalationSignal(html, 500);
		expect(signal).toBeNull();
	});
});

describe("auto-escalation: profile chain", () => {
	it("should have correct escalation order", () => {
		expect(ESCALATION_ORDER).toEqual(["static", "fast", "ghost"]);
	});

	it("should escalate from static to fast", () => {
		const next = nextProfile("static");
		expect(next).toBe("fast");
	});

	it("should escalate from fast to ghost", () => {
		const next = nextProfile("fast");
		expect(next).toBe("ghost");
	});

	it("should not escalate from ghost (end of chain)", () => {
		const next = nextProfile("ghost");
		expect(next).toBeNull();
	});

	it("should return null for invalid profile", () => {
		const next = nextProfile("unknown" as EscalationStep);
		expect(next).toBeNull();
	});
});

describe("auto-escalation: decision matrix", () => {
	const scenarios = [
		{
			name: "HN static response",
			body: "<html><body><div class='titleline'><a href='...'>Story</a></div></body></html>",
			status: 200,
			expectEscalate: false,
		},
		{
			name: "SPA empty placeholder",
			body: "<html><body><noscript>Enable JS</noscript></body></html>",
			status: 200,
			expectEscalate: true,
		},
		{
			name: "Cloudflare challenge",
			body: "Just a moment while we check your browser",
			status: 503,
			expectEscalate: true,
		},
		{
			name: "Forbidden (403)",
			body: "You do not have permission",
			status: 403,
			expectEscalate: true,
		},
		{
			name: "Large successful response",
			body: "<html><body>" + "x".repeat(5000) + "</body></html>",
			status: 200,
			expectEscalate: false,
		},
	];

	scenarios.forEach(({ name, body, status, expectEscalate }) => {
		it(`should ${expectEscalate ? "escalate" : "not escalate"} for: ${name}`, () => {
			const signal = detectEscalationSignal(body, status);
			if (expectEscalate) {
				expect(signal).toBeTruthy();
			} else {
				expect(signal).toBeNull();
			}
		});
	});
});
