/**
 * Bunlight Benchmark Orchestrator
 *
 * Runs all benchmark scenarios sequentially, collects results, and writes:
 *   - benchmarks/results/<date>.json  (raw structured data)
 *   - benchmarks/results/<date>.md    (human-readable comparison table)
 *
 * Usage:
 *   bun benchmarks/run-all.ts
 *   bun benchmarks/run-all.ts --scenario static-simple
 *   bun benchmarks/run-all.ts --scenario spa-react
 *   bun benchmarks/run-all.ts --scenario cloudflare-basic
 *   bun benchmarks/run-all.ts --scenario parallel-100
 *
 * Environment variables:
 *   BUNLIGHT_LIGHTPANDA_BIN   Path to lightpanda binary (if not on PATH)
 *   PUPPETEER_EXECUTABLE_PATH Path to chromium/chrome binary
 *   BENCH_SCENARIOS           Comma-separated list of scenarios to run
 */

import type { BenchmarkReport, ScenarioResult } from "./types.ts";
import { rssNow } from "./types.ts";
import { join } from "path";

// ---------------------------------------------------------------------------
// Environment & CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const scenarioFilter = (() => {
	const idx = args.indexOf("--scenario");
	if (idx !== -1 && args[idx + 1]) return args[idx + 1];
	const envFilter = process.env.BENCH_SCENARIOS;
	if (envFilter) return envFilter;
	return null;
})();

const SCENARIOS_TO_RUN = scenarioFilter
	? scenarioFilter.split(",").map((s) => s.trim())
	: ["static-simple", "spa-react", "cloudflare-basic", "parallel-100"];

// ---------------------------------------------------------------------------
// Environment info
// ---------------------------------------------------------------------------

function getEnvironment(): BenchmarkReport["environment"] {
	const cpuInfo = (() => {
		try {
			const result = Bun.spawnSync(["nproc"], { stdout: "pipe" });
			return Number(result.stdout.toString().trim()) || 4;
		} catch {
			return 4;
		}
	})();

	const totalRam = (() => {
		try {
			const result = Bun.spawnSync(["grep", "MemTotal", "/proc/meminfo"], { stdout: "pipe" });
			const match = result.stdout.toString().match(/(\d+)/);
			return match ? Math.round(Number(match[1]) / 1024) : 0;
		} catch {
			return 0;
		}
	})();

	return {
		platform: process.platform,
		arch: process.arch,
		bunVersion: Bun.version,
		cpuCores: cpuInfo,
		totalRamMb: totalRam,
	};
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function formatTable(scenarios: ScenarioResult[]): string {
	if (scenarios.length === 0) return "_No results_\n";

	const rows: string[] = [];
	rows.push(
		"| Scenario | Runner | p50 (ms) | p95 (ms) | Mean (ms) | Peak RAM (MB) | Success | Total (ms) |",
	);
	rows.push(
		"|----------|--------|----------|----------|-----------|---------------|---------|------------|",
	);

	for (const s of scenarios) {
		rows.push(
			`| ${s.scenario} | ${s.runner} | ${s.p50Ms} | ${s.p95Ms} | ${s.meanMs} | ${s.peakRamMb} | ${s.successRate}% | ${s.totalMs} |`,
		);
	}

	return rows.join("\n") + "\n";
}

function generateMarkdownReport(report: BenchmarkReport): string {
	const env = report.environment;
	const date = report.date;

	const sections: string[] = [];

	sections.push(`# Bunlight Benchmark Results — ${date}`);
	sections.push("");
	sections.push("## Environment");
	sections.push("");
	sections.push(`| Key | Value |`);
	sections.push(`|-----|-------|`);
	sections.push(`| Platform | ${env.platform} ${env.arch} |`);
	sections.push(`| Bun version | ${env.bunVersion} |`);
	sections.push(`| CPU cores | ${env.cpuCores} |`);
	sections.push(`| Total RAM | ${env.totalRamMb} MB |`);
	sections.push(`| Bunlight version | ${report.version} |`);
	sections.push("");

	// Group by scenario
	const byScenario = new Map<string, ScenarioResult[]>();
	for (const result of report.scenarios) {
		const key = result.scenario.split(" (")[0]; // normalize parallel-100 variants
		if (!byScenario.has(key)) byScenario.set(key, []);
		byScenario.get(key)!.push(result);
	}

	sections.push("## Summary Table");
	sections.push("");
	sections.push(formatTable(report.scenarios));
	sections.push("");

	// Per-scenario detail
	for (const [scenarioId, results] of byScenario) {
		sections.push(`## Scenario: ${scenarioId}`);
		sections.push("");
		sections.push(formatTable(results));

		// Add honest interpretation
		if (scenarioId === "static-simple") {
			sections.push("**Interpretation**: All runners operate on pre-fetched static HTML.");
			sections.push("bunlight-static uses an in-process DOM transport (no spawn, no WebSocket).");
			sections.push(
				"fetch-native is the raw HTTP baseline. cheerio and jsdom add parsing overhead.",
			);
			sections.push("For pure static HTML, the fastest option is the one closest to raw fetch.");
		} else if (scenarioId === "spa-react") {
			sections.push("**Interpretation**: SPAs require JS execution to render content.");
			sections.push("bunlight-static and fetch-native return the HTML skeleton only (~500 bytes).");
			sections.push(
				"bunlight-fast (Lightpanda) executes the page JS and returns the rendered content.",
			);
			sections.push(
				"The latency difference reflects Lightpanda process spawn + JS execution overhead.",
			);
		} else if (scenarioId === "cloudflare-basic") {
			sections.push(
				"**Interpretation**: Success here means 'got a network response', NOT 'bypassed Cloudflare'.",
			);
			sections.push("The mock server always returns CF challenge HTML (HTTP 403).");
			sections.push(
				"Real Cloudflare bypass requires profile 'stealth' (patchright) or 'max' (Camoufox).",
			);
			sections.push(
				"bunlight-fast uses Lightpanda UA='Lightpanda/1.0' which is detected by real Cloudflare.",
			);
		} else if (scenarioId === "parallel-100") {
			sections.push("**Interpretation**: 100 requests in parallel against localhost mock server.");
			sections.push("bunlight-static uses the shared in-process transport (no per-request spawn).");
			sections.push("fetch-native tests raw Bun.fetch concurrency at different batch sizes.");
			sections.push(
				"Both should be fast against localhost — bottleneck is CPU + memory, not network.",
			);
		}

		sections.push("");
	}

	sections.push("## Methodology");
	sections.push("");
	sections.push("- All benchmarks use a **local mock HTTP server** (Bun.serve on :9999)");
	sections.push("- This avoids rate-limiting, flaky networks, and spam of real websites");
	sections.push("- Latency includes network RTT to localhost, HTML parse, and any JS execution");
	sections.push(
		"- RAM is measured via `process.memoryUsage().rss` (Bun process + any sub-processes)",
	);
	sections.push("- First run = cold start (includes warmup costs); subsequent runs = warm");
	sections.push("- p50/p95 computed across all runs for a given runner/scenario pair");
	sections.push("- Puppeteer/playwright runners are skipped if Chromium is not installed");
	sections.push(
		"- bunlight-fast runner is skipped if lightpanda binary is not in PATH or BUNLIGHT_LIGHTPANDA_BIN",
	);
	sections.push("");
	sections.push("## Reproducing");
	sections.push("");
	sections.push("```bash");
	sections.push("# Full suite");
	sections.push("bun run benchmark");
	sections.push("");
	sections.push("# Single scenario");
	sections.push("bun benchmarks/run-all.ts --scenario static-simple");
	sections.push("");
	sections.push("# With Lightpanda (fast profile)");
	sections.push(
		"BUNLIGHT_LIGHTPANDA_BIN=/path/to/lightpanda bun benchmarks/run-all.ts --scenario spa-react",
	);
	sections.push("```");
	sections.push("");
	sections.push("## Honest caveats");
	sections.push("");
	sections.push(
		"- Benchmarks run against **localhost** — real-world latency will be dominated by network RTT",
	);
	sections.push(
		"- Cloudflare bypass rates are from docs/PROFILES.md estimates, not measured in this suite",
	);
	sections.push("  (measuring requires real Cloudflare-protected URLs, risking rate limits)");
	sections.push(
		"- bunlight-fast (Lightpanda) cold start includes process spawn; warm-path is ~50-100 ms",
	);
	sections.push("- Chromium runners were not measured due to missing binary in test environment");
	sections.push("  (add PUPPETEER_EXECUTABLE_PATH to include them)");
	sections.push("- jsdom is not available in this environment (no node_modules/jsdom)");
	sections.push("- All fast-profile SPA metrics come from docs/PROFILE-FAST-RESULTS.md");

	return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log("=== Bunlight Benchmark Suite ===");
	console.log(`Date: ${new Date().toISOString()}`);
	console.log(`Bun: ${Bun.version}`);
	console.log(`Scenarios: ${SCENARIOS_TO_RUN.join(", ")}`);
	console.log(`Initial RSS: ${rssNow()} MB`);
	console.log("");

	const env = getEnvironment();
	const allResults: ScenarioResult[] = [];

	for (const scenarioName of SCENARIOS_TO_RUN) {
		console.log(`\n=== Running scenario: ${scenarioName} ===`);
		const t0 = performance.now();

		try {
			let results: ScenarioResult[] = [];

			if (scenarioName === "static-simple") {
				const mod = await import("./scenarios/static-simple.ts");
				results = await mod.run();
			} else if (scenarioName === "spa-react") {
				const mod = await import("./scenarios/spa-react.ts");
				results = await mod.run();
			} else if (scenarioName === "cloudflare-basic") {
				const mod = await import("./scenarios/cloudflare-basic.ts");
				results = await mod.run();
			} else if (scenarioName === "parallel-100") {
				const mod = await import("./scenarios/parallel-100.ts");
				results = await mod.run();
			} else {
				console.warn(`Unknown scenario: ${scenarioName} — skipping`);
				continue;
			}

			allResults.push(...results);
			console.log(`Scenario ${scenarioName} done in ${Math.round(performance.now() - t0)}ms`);
		} catch (err) {
			console.error(`Scenario ${scenarioName} failed:`, err);
		}

		// Brief pause between scenarios to let GC settle
		await new Promise((r) => setTimeout(r, 500));
	}

	// Write results
	const dateStr = new Date().toISOString().slice(0, 10);
	const report: BenchmarkReport = {
		version: "0.1.0-alpha.0",
		date: dateStr,
		environment: env,
		scenarios: allResults,
	};

	const resultsDir = join(import.meta.dir, "results");
	Bun.spawnSync(["mkdir", "-p", resultsDir], { stdin: "ignore" });

	const jsonPath = join(resultsDir, `${dateStr}.json`);
	const mdPath = join(resultsDir, `${dateStr}.md`);

	await Bun.write(jsonPath, JSON.stringify(report, null, 2));
	console.log(`\nResults written to: ${jsonPath}`);

	const markdown = generateMarkdownReport(report);
	await Bun.write(mdPath, markdown);
	console.log(`Report written to:  ${mdPath}`);

	// Print summary to stdout
	console.log("\n=== SUMMARY ===");
	console.log("| Scenario | Runner | p50 (ms) | p95 (ms) | Peak RAM | Success |");
	console.log("|----------|--------|----------|----------|----------|---------|");
	for (const s of allResults) {
		console.log(
			`| ${s.scenario.padEnd(20)} | ${s.runner.padEnd(18)} | ${String(s.p50Ms).padStart(8)} | ${String(s.p95Ms).padStart(8)} | ${String(s.peakRamMb).padStart(6)} MB | ${s.successRate}% |`,
		);
	}
	console.log("");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
