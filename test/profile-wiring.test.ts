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
 * Profile wiring tests — Phase 1.5
 *
 * Verifies that `bxc serve --profile <X>` boots, exposes `/json/version`
 * with a valid `webSocketDebuggerUrl`, and responds to `Browser.getVersion`
 * over the CDP WebSocket.
 *
 * Tests:
 *   1. profile=static  — in-process StaticDomTransport
 *   2. profile=http    — curl-impersonate HttpProfileTransport
 *   3. profile=fast    — Lightpanda sub-process proxy
 *
 * Skip rules:
 *   - fast   : skip if lightpanda binary absent
 *   -
 *   -
 *
 * All skips are logged with a clear reason.
 */

import { expect, test } from "bun:test";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BXC_DIR = join(import.meta.dir, "..");
const SERVE_SCRIPT = join(BXC_DIR, "src/cli/serve.ts");

/** Timeout for each profile boot test (http takes longer). */
const BOOT_TIMEOUT_MS = 60_000;

/** How long to wait for the serve process to print the port. */
const PORT_SCAN_TIMEOUT_MS = 20_000;

function logSkip(reason: string): void {
	console.warn(`[profile-wiring] SKIP: ${reason}`);
}

/**
 * Scans stderr/stdout of a Bun.spawn process for "listening on http://127.0.0.1:PORT"
 * or similar, and returns the port number.
 *
 * Lightpanda fast mode logs to stderr; static/http modes log to stderr
 * via `console.error("[bxc] ...")`.
 */
async function readPortFromOutput(
	proc: ReturnType<typeof Bun.spawn>,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;

	// Pattern: "listening on http://127.0.0.1:PORT/"
	const PORT_RE = /listening on http:\/\/[^:]+:(\d+)\//;

	async function scanStream(
		stream: ReadableStream<Uint8Array> | null,
		label: string,
	): Promise<number> {
		if (!stream) return -1;
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		try {
			while (Date.now() < deadline) {
				const timeout = deadline - Date.now();
				const raceResult = await Promise.race([
					reader.read(),
					new Promise<{ done: true; value: undefined }>((_, reject) =>
						setTimeout(
							() => reject(new Error("timeout")),
							Math.max(timeout, 100),
						),
					),
				]);
				if (raceResult.done) break;
				const chunk = decoder.decode(raceResult.value, { stream: true });
				buf += chunk;
				const m = PORT_RE.exec(buf);
				if (m) {
					reader.releaseLock();
					return Number.parseInt(m[1], 10);
				}
			}
		} catch {
			// timeout or stream error
		}
		try {
			reader.releaseLock();
		} catch {
			// best effort
		}
		void label;
		return -1;
	}

	// Race stdout and stderr — bxc always writes to stderr via console.error.
	const [stderrPort] = await Promise.race([
		// Try stderr first (most reliable)
		scanStream(proc.stderr as ReadableStream<Uint8Array> | null, "stderr").then(
			(p) => [p],
		),
		// Then stdout
		scanStream(proc.stdout as ReadableStream<Uint8Array> | null, "stdout").then(
			(p) => [p],
		),
		// Hard timeout
		new Promise<[number]>((_, reject) =>
			setTimeout(
				() =>
					reject(new Error(`Port not found in output within ${timeoutMs}ms`)),
				timeoutMs,
			),
		),
	]);

	return stderrPort;
}

/**
 * Sends Browser.getVersion over the WebSocket and returns the result.
 */
async function getBrowserVersion(wsUrl: string): Promise<{ product?: string }> {
	const ws = new WebSocket(wsUrl);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("WS open timeout")),
			10_000,
		);
		ws.addEventListener("open", () => {
			clearTimeout(timer);
			resolve();
		});
		ws.addEventListener("error", (ev) => {
			clearTimeout(timer);
			reject(new Error(`WS error: ${String((ev as ErrorEvent).message)}`));
		});
	});

	ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));

	const reply = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("WS reply timeout")),
			10_000,
		);
		ws.addEventListener("message", (ev: MessageEvent) => {
			const data = typeof ev.data === "string" ? ev.data : String(ev.data);
			const msg = JSON.parse(data) as { id?: number };
			if (msg.id === 1) {
				clearTimeout(timer);
				resolve(data);
			}
		});
	});

	ws.close();
	return JSON.parse(reply) as { result: { product?: string } } & {
		product?: string;
	};
}

// ---------------------------------------------------------------------------
// Shared test runner
// ---------------------------------------------------------------------------

async function runProfileBootTest(profile: string): Promise<void> {
	// Pick a random port in the ephemeral range to avoid conflicts.
	const port = 49200 + Math.floor(Math.random() * 1000);

	const proc = Bun.spawn(
		[
			"bun",
			"run",
			SERVE_SCRIPT,
			"serve",
			"--cdp-port",
			String(port),
			"--profile",
			profile,
			"--log-level",
			"info",
		],
		{
			cwd: BXC_DIR,
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	let portFromOutput = -1;
	try {
		portFromOutput = await readPortFromOutput(proc, PORT_SCAN_TIMEOUT_MS);
	} catch {
		// Port not found in output — try the requested port directly.
		portFromOutput = port;
	}

	if (portFromOutput <= 0) portFromOutput = port;

	// Give the server a moment to fully start
	await new Promise((r) => setTimeout(r, 200));

	try {
		// 1. Probe /json/version
		const res = await fetch(`http://127.0.0.1:${portFromOutput}/json/version`, {
			signal: AbortSignal.timeout(5_000),
		});
		expect(res.ok).toBe(true);

		const body = (await res.json()) as { webSocketDebuggerUrl?: string };
		expect(body.webSocketDebuggerUrl).toBeDefined();
		expect(body.webSocketDebuggerUrl).toMatch(/^ws:\/\//);

		// 2. Browser.getVersion via WebSocket
		const versionResp = await getBrowserVersion(
			body.webSocketDebuggerUrl as string,
		);
		const result = (versionResp as unknown as { result?: { product?: string } })
			.result;
		expect(result).toBeDefined();
		expect(result?.product).toBeDefined();
		expect(typeof result?.product).toBe("string");
	} finally {
		try {
			proc.kill();
		} catch {
			// best effort
		}
		try {
			await proc.exited;
		} catch {
			// best effort
		}
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
	"profile=static boots and exposes /json/version + Browser.getVersion",
	async () => {
		await runProfileBootTest("static");
	},
	BOOT_TIMEOUT_MS,
);

test(
	"profile=http boots and exposes /json/version + Browser.getVersion",
	async () => {
		// http profile requires curl-impersonate FFI library.
		// Accept any of the possible filenames produced by the build.
		const curlVendorDir = join(BXC_DIR, "vendor/curl-impersonate");
		const curlCandidates = [
			`${curlVendorDir}/libcurl-impersonate-chrome.so.4.8.0`,
			`${curlVendorDir}/libcurl-impersonate.so.4.8.0`,
			`${curlVendorDir}/libcurl-impersonate.so`,
		];
		let libAvail = false;
		for (const c of curlCandidates) {
			if (await Bun.file(c).exists()) {
				libAvail = true;
				break;
			}
		}
		if (!libAvail) {
			logSkip("curl-impersonate library not found at vendor/curl-impersonate/");
			return;
		}
		await runProfileBootTest("http");
	},
	BOOT_TIMEOUT_MS,
);

test(
	"profile=fast boots and exposes /json/version + Browser.getVersion",
	async () => {
		// Check if lightpanda binary is available (any candidate location).
		const home = process.env.HOME ?? "";
		const candidates = [
			`${home}/.cache/lightpanda-node/lightpanda`,
			`${home}/.lightpanda/lightpanda`,
			`${home}/.local/bin/lightpanda`,
			`${home}/bunmium/lightpanda-src/zig-out/bin/lightpanda`,
		];
		let found = false;
		for (const c of candidates) {
			try {
				const stat = await Bun.file(c).stat();
				if (stat.size > 32_768) {
					found = true;
					break;
				}
			} catch {
				// not present
			}
		}
		if (!found) {
			logSkip("lightpanda binary not found — skipping profile=fast boot test");
			return;
		}
		await runProfileBootTest("fast");
	},
	BOOT_TIMEOUT_MS,
);

// stealth / max tests removed: forbidden engines (Chromium / Firefox).
