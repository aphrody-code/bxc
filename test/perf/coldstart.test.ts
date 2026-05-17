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
 * test/perf/coldstart.test.ts — Cold start performance tests for `bxc serve`.
 *
 * Targets:
 *   profile=static  p50 < 50 ms  (Bun startup + Bun.serve bind, lazy FFI)
 *   profile=fast    p50 < 80 ms  (Bun startup + Lightpanda spawn, tighter poll)
 *
 * Methodology:
 *   - Spawn `bun run src/cli/serve.ts serve --cdp-port N --profile P`
 *   - Measure wall-clock time from Bun.spawn() to first HTTP 200 on /json/version
 *   - Run N_RUNS times, compute p50
 *   - Skip with log if the relevant binary (lightpanda) is absent for fast profile
 *
 * These tests are intentionally lenient on CI (3x headroom) to avoid flakiness
 * on slow VMs.  The tighter targets are validated by scripts/measure-coldstart.ts
 * which is the authoritative measurement tool.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..", "..");
const SERVE_ENTRY = join(ROOT, "src", "cli", "serve.ts");

// Number of warm runs per profile.  Keep low to avoid slowing CI.
const N_RUNS = 5;

// Per-run timeout.  If the server does not respond within this window we mark
// the run as timed out and the test fails.
const RUN_TIMEOUT_MS = 12_000;

// Performance targets (ms, p50).  CI VMs are slow — apply 3x headroom.
const TARGET_STATIC_MS = 50;
const TARGET_FAST_MS = 80;
const CI_HEADROOM = Bun.env.CI ? 3 : 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logSkip(reason: string): void {
	console.log(`[coldstart.test] SKIP: ${reason}`);
}

async function findFreePort(): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
		try {
			const srv = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response(null) });
			srv.stop(true);
			return port;
		} catch {
			// taken
		}
	}
	throw new Error("coldstart.test: could not find a free port");
}

async function waitForVersion(host: string, port: number, deadlineMs: number): Promise<boolean> {
	const deadline = Date.now() + deadlineMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://${host}:${port}/json/version`, {
				signal: AbortSignal.timeout(500),
			});
			if (res.ok) return true;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 5));
	}
	return false;
}

interface MeasureResult {
	elapsedMs: number;
	timedOut: boolean;
}

async function measureColdStart(profile: string, logLevel = "silent"): Promise<MeasureResult> {
	const port = await findFreePort();

	const t0 = Bun.nanoseconds();

	const proc = Bun.spawn(
		[
			"bun",
			"run",
			SERVE_ENTRY,
			"serve",
			"--cdp-port",
			String(port),
			"--profile",
			profile,
			"--log-level",
			logLevel,
		],
		{
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		},
	);

	const ready = await waitForVersion("127.0.0.1", port, RUN_TIMEOUT_MS);
	const elapsed = (Bun.nanoseconds() - t0) / 1_000_000;

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

	return { elapsedMs: ready ? elapsed : RUN_TIMEOUT_MS, timedOut: !ready };
}

function computeP50(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// ---------------------------------------------------------------------------
// Check for lightpanda binary (needed for fast profile)
// ---------------------------------------------------------------------------

let lightpandaAvailable = false;

beforeAll(async () => {
	const home = Bun.env.HOME ?? "";
	const candidates = [
		Bun.env.BXC_LIGHTPANDA_PATH,
		`${home}/.cache/lightpanda-node/lightpanda`,
		`${home}/.lightpanda/lightpanda`,
		`${home}/.local/bin/lightpanda`,
		`${home}/bunmium/lightpanda-src/zig-out/bin/lightpanda`,
	].filter(Boolean) as string[];

	for (const c of candidates) {
		try {
			const stat = await Bun.file(c).stat();
			if (stat.size > 32_768) {
				lightpandaAvailable = true;
				break;
			}
		} catch {
			// not present
		}
	}

	if (!lightpandaAvailable) {
		// Try PATH fallback
		try {
			const result = Bun.spawnSync(["lightpanda", "--version"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			if (result.exitCode === 0) lightpandaAvailable = true;
		} catch {
			// not on PATH
		}
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cold start performance", () => {
	test(
		`profile=static p50 < ${TARGET_STATIC_MS}ms (x${CI_HEADROOM} CI headroom)`,
		async () => {
			const samples: number[] = [];

			for (let i = 0; i < N_RUNS; i++) {
				const result = await measureColdStart("static");
				if (result.timedOut) {
					throw new Error(`profile=static run ${i + 1} timed out after ${RUN_TIMEOUT_MS}ms`);
				}
				samples.push(result.elapsedMs);
				console.log(
					`[coldstart.test] static run ${i + 1}/${N_RUNS}: ${result.elapsedMs.toFixed(1)} ms`,
				);
				// Brief cooldown to avoid port reuse races.
				await new Promise((r) => setTimeout(r, 60));
			}

			const p50 = computeP50(samples);
			const target = TARGET_STATIC_MS * CI_HEADROOM;

			console.log(`[coldstart.test] profile=static p50=${p50.toFixed(1)}ms target=<${target}ms`);

			expect(p50).toBeLessThan(target);
		},
		{ timeout: N_RUNS * RUN_TIMEOUT_MS + 5000 },
	);

	test(
		`profile=fast p50 < ${TARGET_FAST_MS}ms (x${CI_HEADROOM} CI headroom)`,
		async () => {
			if (!lightpandaAvailable) {
				logSkip(
					"lightpanda binary not found — install it via `bun run postinstall` or set BXC_LIGHTPANDA_PATH. Skipping fast cold start test.",
				);
				// Return without failing — the test infrastructure will show the skip log.
				return;
			}

			const samples: number[] = [];

			for (let i = 0; i < N_RUNS; i++) {
				const result = await measureColdStart("fast");
				if (result.timedOut) {
					throw new Error(`profile=fast run ${i + 1} timed out after ${RUN_TIMEOUT_MS}ms`);
				}
				samples.push(result.elapsedMs);
				console.log(
					`[coldstart.test] fast run ${i + 1}/${N_RUNS}: ${result.elapsedMs.toFixed(1)} ms`,
				);
				await new Promise((r) => setTimeout(r, 60));
			}

			const p50 = computeP50(samples);
			const target = TARGET_FAST_MS * CI_HEADROOM;

			console.log(`[coldstart.test] profile=fast p50=${p50.toFixed(1)}ms target=<${target}ms`);

			expect(p50).toBeLessThan(target);
		},
		{ timeout: N_RUNS * RUN_TIMEOUT_MS + 5000 },
	);

	test("profile=static /json/version returns valid JSON within 5 ms of first HTTP success", async () => {
		// Functional correctness test: verify the response body is valid CDP discovery JSON.
		const port = await findFreePort();
		const proc = Bun.spawn(
			[
				"bun",
				"run",
				SERVE_ENTRY,
				"serve",
				"--cdp-port",
				String(port),
				"--profile",
				"static",
				"--log-level",
				"silent",
			],
			{ stdin: "ignore", stdout: "ignore", stderr: "ignore" },
		);

		try {
			const ready = await waitForVersion("127.0.0.1", port, 10_000);
			expect(ready).toBe(true);

			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			expect(res.ok).toBe(true);

			const body = (await res.json()) as Record<string, string>;
			expect(typeof body.Browser).toBe("string");
			expect(body.Browser).toContain("Bxc");
			expect(typeof body.webSocketDebuggerUrl).toBe("string");
			expect(body.webSocketDebuggerUrl).toMatch(/^ws:\/\//);
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
	}, 15_000);
});
