#!/usr/bin/env bun
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
 * measure-coldstart.ts — Cold start measurement for `bxc serve`.
 *
 * Spawns the server in a child process and measures the wall-clock time from
 * spawn() to the first successful HTTP 200 on /json/version.
 *
 * Usage:
 *   bun scripts/measure-coldstart.ts [--runs 10] [--profiles static,fast]
 *
 * Output:
 *   Prints a table with p50 / p95 / mean / min / max for each profile.
 *
 * Environment variables:
 *   BXC_LIGHTPANDA_PATH   Override path to the lightpanda binary
 *   COLDSTART_RUNS             Number of runs per profile (default 10)
 *   COLDSTART_TIMEOUT_MS       Max wait per run (default 15000)
 *   COLDSTART_PROFILES         Comma-separated profiles (default static,fast)
 */

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..");
const SERVE_ENTRY = join(ROOT, "src", "cli", "serve.ts");

const DEFAULT_RUNS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PROFILES = ["static", "fast", "http", "stealth", "max"] as const;
type Profile = (typeof DEFAULT_PROFILES)[number];

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function argValue(flag: string, fallback: string): string {
	const idx = argv.indexOf(flag);
	if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
	return fallback;
}

const runs = Number.parseInt(
	argValue("--runs", String(Bun.env.COLDSTART_RUNS ?? DEFAULT_RUNS)),
	10,
);
const timeoutMs = Number.parseInt(
	argValue(
		"--timeout-ms",
		String(Bun.env.COLDSTART_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
	),
	10,
);
const rawProfiles = argValue(
	"--profiles",
	Bun.env.COLDSTART_PROFILES ?? "static,fast",
);
const profiles = rawProfiles.split(",").map((p) => p.trim()) as Profile[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free TCP port by binding a short-lived Bun.serve. */
async function findFreePort(): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
		try {
			const srv = Bun.serve({
				port,
				hostname: "127.0.0.1",
				fetch: () => new Response(null),
			});
			srv.stop(true);
			return port;
		} catch {
			// taken, retry
		}
	}
	throw new Error("measure-coldstart: could not find a free port");
}

/** Probe /json/version until it returns 200 or the deadline passes. */
async function waitForVersion(
	host: string,
	port: number,
	deadline: number,
): Promise<boolean> {
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

// ---------------------------------------------------------------------------
// Single measurement
// ---------------------------------------------------------------------------

interface Sample {
	elapsedMs: number;
	timedOut: boolean;
}

async function measure(profile: Profile): Promise<Sample> {
	const port = await findFreePort();
	const host = "127.0.0.1";

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
			"silent",
		],
		{
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			env: { ...Bun.env, BXC_SKIP_WARMUP: "1" },
		},
	);

	const deadline = Date.now() + timeoutMs;
	const ready = await waitForVersion(host, port, deadline);

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

	if (!ready) {
		return { elapsedMs: timeoutMs, timedOut: true };
	}

	return { elapsedMs: elapsed, timedOut: false };
}

// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.floor(sorted.length * p);
	return sorted[Math.min(idx, sorted.length - 1)];
}

function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ProfileResult {
	profile: Profile;
	runs: number;
	timeouts: number;
	p50: number;
	p95: number;
	mean: number;
	min: number;
	max: number;
}

async function runProfile(profile: Profile): Promise<ProfileResult> {
	Bun.stderr.write(`[measure-coldstart] profile=${profile} runs=${runs}\n`);

	const samples: number[] = [];
	let timeouts = 0;

	for (let i = 0; i < runs; i++) {
		const s = await measure(profile);
		if (s.timedOut) {
			timeouts++;
			Bun.stderr.write(`  run ${i + 1}/${runs}: TIMEOUT\n`);
		} else {
			samples.push(s.elapsedMs);
			Bun.stderr.write(
				`  run ${i + 1}/${runs}: ${s.elapsedMs.toFixed(1)} ms\n`,
			);
		}
		// Brief cooldown between runs to avoid port reuse races.
		await new Promise((r) => setTimeout(r, 80));
	}

	const sorted = [...samples].sort((a, b) => a - b);

	return {
		profile,
		runs,
		timeouts,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		mean: mean(samples),
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
	};
}

function printTable(results: ProfileResult[]): void {
	const targets: Record<string, number> = { static: 50, fast: 80 };
	const cols = [
		"profile",
		"p50",
		"p95",
		"mean",
		"min",
		"max",
		"timeouts",
		"target",
	];
	const widths = [10, 8, 8, 8, 8, 8, 10, 10];

	const pad = (s: string, w: number) => s.padEnd(w);
	const header = cols.map((c, i) => pad(c, widths[i])).join("  ");
	const sep = widths.map((w) => "-".repeat(w)).join("  ");

	Bun.stdout.write("\n" + header + "\n" + sep + "\n");

	for (const r of results) {
		const target = targets[r.profile];
		const targetStr = target !== undefined ? `<${target} ms` : "n/a";
		const p50Pass =
			target !== undefined ? (r.p50 < target ? "PASS" : "FAIL") : "";
		const row = [
			pad(r.profile, widths[0]),
			pad(`${r.p50.toFixed(1)}`, widths[1]),
			pad(`${r.p95.toFixed(1)}`, widths[2]),
			pad(`${r.mean.toFixed(1)}`, widths[3]),
			pad(`${r.min.toFixed(1)}`, widths[4]),
			pad(`${r.max.toFixed(1)}`, widths[5]),
			pad(String(r.timeouts), widths[6]),
			pad(`${targetStr} ${p50Pass}`.trim(), widths[7]),
		].join("  ");
		Bun.stdout.write(row + "\n");
	}
	Bun.stdout.write("\n");
}

const results: ProfileResult[] = [];

for (const profile of profiles) {
	// Skip profiles that require external binaries unless they are present.
	if (profile === "stealth" || profile === "max") {
		Bun.stderr.write(
			`[measure-coldstart] skipping profile=${profile} (requires patchright/camoufox)\n`,
		);
		continue;
	}
	try {
		const r = await runProfile(profile);
		results.push(r);
	} catch (err) {
		Bun.stderr.write(
			`[measure-coldstart] profile=${profile} error: ${String(err)}\n`,
		);
	}
}

if (results.length > 0) {
	printTable(results);

	// Exit with non-zero if any measured profile exceeds its target.
	const targets: Record<string, number> = { static: 50, fast: 80 };
	const failures = results.filter((r) => {
		const t = targets[r.profile];
		return t !== undefined && r.p50 >= t;
	});
	if (failures.length > 0) {
		Bun.stderr.write(
			`[measure-coldstart] FAILED: profiles with p50 above target: ${failures.map((f) => f.profile).join(", ")}\n`,
		);
		process.exit(1);
	} else {
		Bun.stderr.write(
			"[measure-coldstart] All measured profiles within target.\n",
		);
	}
} else {
	Bun.stderr.write("[measure-coldstart] No profiles measured.\n");
}
