/**
 * Tests for the Security domain handler.
 *
 * `Security.setIgnoreCertificateErrors` stores a flag on `page.security`.
 * `StaticDomTransport.#navigate` reads the flag and sets
 * `tls: { rejectUnauthorized: false }` on Bun's fetch when the flag is true.
 *
 * These tests spin up a local Bun HTTPS server with a self-signed certificate
 * to verify TLS behaviour end-to-end.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StaticDomTransport } from "../../../src/transport/StaticDomTransport.js";

// ---------------------------------------------------------------------------
// Self-signed certificate (CN=localhost, generated via openssl for testing)
// ---------------------------------------------------------------------------

const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUSnfppaJ/CuxlgJKWpxbTCc9EwsowDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDUxMDEyMDcwN1oXDTI3MDUx
MDEyMDcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAqBKdAsW/UwFZX5+4IpoAT7y8sRDgRdqalNIe/TkunviR
ozPK0Dopd+bbvGOTkrt+rYM87cIxUCb7REPq3Zu11HgAb+TJud6ldxRio1ZYTJrX
QgM/xxJqWrGWRgfyID5WeKN7qfZqckDZo9mX91JeYH5QHZiZ1YKvPHW2b3Gd6oSg
PL4i7ZLSCDAoZHY3oHEz312rgik28d8PcpsCY8iNbpoSMM2JjwV98JWD0eN9bRyG
HHpIDmYdONvSwTgMLvUGhxqdlSRFXFu0uU+f47UM7PANbo1dsPSCr+ZBA2kKRSEq
xvW6vGWXhsEM7lxTvSW6YlkrAR+nd1MsCJKG3JOVYQIDAQABo1MwUTAdBgNVHQ4E
FgQU02n9j3hAk+TesGeYxIXPIr0Q3NYwHwYDVR0jBBgwFoAU02n9j3hAk+TesGeY
xIXPIr0Q3NYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEApvlE
eQdJV5ime028IMlchB67absPCrfMj7RnxIz9YUKKK7iHmkIEP0LOP/gIveyrcbtV
FfLqfWv5gdIUHiOZpeqAQP5vH8u7xb0wFN8QA9uTmMuKuAU4SnDmKOS8Y3lyAQgV
dmYpVZRgCpu1Jjmch5AiolLPGuSKfnm7rqre74rgSUWejX5DQh5XQNmz7bnl9gQE
FxKcBKcq9qg3eo3VOyYJ/j9DBly1BEy5GsUQd3CVukLbAXk4s4r+siLdoSYYiusf
eubEsVygfh0+msUFVyZ1nA7jvwjWYSal4T4sKDpLw49CIYYgPk2UF+wAYco/Ox7x
JHoEJITU3pVD2y369Q==
-----END CERTIFICATE-----`;

const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCoEp0Cxb9TAVlf
n7gimgBPvLyxEOBF2pqU0h79OS6e+JGjM8rQOil35tu8Y5OSu36tgzztwjFQJvtE
Q+rdm7XUeABv5Mm53qV3FGKjVlhMmtdCAz/HEmpasZZGB/IgPlZ4o3up9mpyQNmj
2Zf3Ul5gflAdmJnVgq88dbZvcZ3qhKA8viLtktIIMChkdjegcTPfXauCKTbx3w9y
mwJjyI1umhIwzYmPBX3wlYPR431tHIYcekgOZh0429LBOAwu9QaHGp2VJEVcW7S5
T5/jtQzs8A1ujV2w9IKv5kEDaQpFISrG9bq8ZZeGwQzuXFO9JbpiWSsBH6d3UywI
kobck5VhAgMBAAECggEALuM6cCqQjGyE7VtWeDi0O4pwrYkCuBobI8dWo9gO/IRl
xLzPKLYBGZUK2gyBf97UoT1Kgx24uh6V3F6CKB6nZEWyAYU3DaZiTM0gE2ckLQLJ
aH4VjcjCaNjADntq/bnGT9NzzV+UJJmY3c/3SCTvdUXnvcnzqI/TqS9BnOd6YZD3
g7mCr+MtMG3dGbhAoeh7T3KcAPL24bhxW6rvrZPswlf5OcVEepVDkNpIArgpOuQ5
c0pg0Sg6BLzqtQmAuRGADb6lWTAyfneriFYVj/oFoWMNoUU2w9wGgz7Mgqgj91Fa
q7CXpSSwU/tlYLcIArkUTEsqC2H3qd7yUmiVpfigXQKBgQDtcBWjF3/0i4rI3n40
QauCx4fdKHaNO9mK3bZ1nYw3dbn7YHpDYWt1ItzWmM7896vV4i6Bf046fOEXqV4z
ogJ3gqTlOw/HODTz6Oe+NrTAWUfcQD6JEXurMtTgYXqqZJz6NL42Fhl+wwsSQp72
Ci1gW+AlmGJQI8xKpkSV5JgEewKBgQC1Nk20QSKvu88CBfT0rgW79a9rh6c2K5er
pVdR8cYRzmkpV5QWFUUKKQDKDaEVV5TWQ5+wRi8SFv5r0GU519BAefEFaFrCdkkH
v59mtWwXtpUmKB8G50N9Flu3ygKOih56kk+qxFdOSPj1yFcZQqh/XRVHk0cbXyPa
4c8GkOxs0wKBgQCHFP5qVANK+FyT3OkGB9pww93K96tCvKsOMwcMMP7FyqdtmTzV
usXs1VG4kSUpjCppu41jxS6XXdadpJDgZSpsHZp8g7Z9S7/siDPX5r28tM6KQs6R
Iq4t/vRXV333FNiuDHWuxbHpiUNyNw7CwZWBPaPvH5vHJiaizac1c+D8owKBgQCX
+My96Qpf+s+m0LwYH4GrmmXddkyjP3fZebZ7gJouAL9s7ofA5WGbHbwNt9RqA6NM
9jWMLa/4KdSBMqpSEk4SZLHfaR8EixLALtJN3sSiNntrHqa2sWiGFSQiRIZUaD0b
amzpt/PIMaao6bUx+Bc7iSL5fehaajW1sT5gMVY2BQKBgQDB1pHyADLeM1mXjZa3
5lQIm7SHoPeBxu/Khc4zGWexM/Fy44YqfnVVKE8um+YREdLP0GgASWTGNcTa2F2U
nl4UDz9RztEYq2uLTwRmREjAZAc9Qu4lJPhHUlwdMzwq9m1fxQ2VwM19773mpGrh
as1Wuvw7dn8IZg2LWff0FuJ8bQ==
-----END PRIVATE KEY-----`;

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
 * Spins up a local HTTPS server with a self-signed certificate.
 * Returns the server URL and a cleanup function.
 */
function startSelfSignedServer(): { url: string; stop: () => void } {
	const server = Bun.serve({
		port: 0,
		tls: {
			key: SELF_SIGNED_KEY,
			cert: SELF_SIGNED_CERT,
		},
		fetch() {
			return new Response("<html><head><title>TLS Test</title></head><body>secure</body></html>", {
				headers: { "Content-Type": "text/html" },
			});
		},
	});

	return {
		url: `https://localhost:${server.port}/`,
		stop: () => server.stop(true),
	};
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Security domain handler", () => {
	let transport: StaticDomTransport;

	beforeEach(() => {
		transport = StaticDomTransport.create();
	});

	afterEach(() => {
		transport.close();
	});

	// -------------------------------------------------------------------------
	// setIgnoreCertificateErrors — state storage
	// -------------------------------------------------------------------------

	test("setIgnoreCertificateErrors(true) returns {} without throwing", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Security.setIgnoreCertificateErrors",
			{ ignore: true },
			sessionId,
		);
		expect(result).toEqual({});
	});

	test("setIgnoreCertificateErrors(false) returns {} without throwing", async () => {
		const sessionId = await openSession(transport);
		const result = await cdpCall(
			transport,
			"Security.setIgnoreCertificateErrors",
			{ ignore: false },
			sessionId,
		);
		expect(result).toEqual({});
	});

	// -------------------------------------------------------------------------
	// TLS behaviour — verified with a local self-signed HTTPS server
	// -------------------------------------------------------------------------

	test("Page.navigate to self-signed HTTPS succeeds when ignoreCertificateErrors is true", async () => {
		const sessionId = await openSession(transport);
		const { url, stop } = startSelfSignedServer();

		try {
			// Enable certificate error ignoring
			await cdpCall(transport, "Security.setIgnoreCertificateErrors", { ignore: true }, sessionId);

			// Navigate to the self-signed HTTPS server — should succeed
			const navResult = await cdpCall(transport, "Page.navigate", { url }, sessionId);
			expect(navResult).toBeDefined();

			// Verify the page loaded correctly
			const titleResult = (await cdpCall(
				transport,
				"Runtime.evaluate",
				{ expression: "document.title", returnByValue: true },
				sessionId,
			)) as { result: { value?: string } };
			expect(titleResult.result.value).toBe("TLS Test");
		} finally {
			stop();
		}
	});

	test("Page.navigate to self-signed HTTPS fails when ignoreCertificateErrors is false (default)", async () => {
		const sessionId = await openSession(transport);
		const { url, stop } = startSelfSignedServer();

		try {
			// Explicitly set to false (default)
			await cdpCall(transport, "Security.setIgnoreCertificateErrors", { ignore: false }, sessionId);

			// Navigate — should fail with a TLS error surfaced as a CDP error
			await expect(cdpCall(transport, "Page.navigate", { url }, sessionId)).rejects.toThrow(
				/cert|tls|ssl|certificate/i,
			);
		} finally {
			stop();
		}
	});
});
