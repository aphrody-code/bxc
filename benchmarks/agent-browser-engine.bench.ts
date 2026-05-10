/**
 * agent-browser engine comparison benchmark
 *
 * Measures cold-start time, per-command latency (p50/p95), and peak RSS for
 * three engines: chrome, lightpanda, and bunlight.
 *
 * Usage:
 *   bun benchmarks/agent-browser-engine.bench.ts
 *   bun benchmarks/agent-browser-engine.bench.ts --iterations 10
 *   bun benchmarks/agent-browser-engine.bench.ts --engines chrome,bunlight
 *   bun benchmarks/agent-browser-engine.bench.ts --output-only
 *
 * Environment variables:
 *   BUNLIGHT_PATH    Path to bunlight serve script (default: src/cli/serve.ts relative to this file)
 *   AGENT_BROWSER    Path to agent-browser binary (default: auto-detect)
 *   BENCH_ITERATIONS Number of iterations per engine per scenario (default: 20)
 *   CHROME_ARGS      Extra args for Chrome (default: "--no-sandbox" in container env)
 *
 * Skip conditions (engine unavailable → logged + skipped, no failure):
 *   - chrome    : binary not found or CHROME_ARGS sandbox error
 *   - lightpanda: binary not found or lightpanda serve subcommand unsupported
 *   - bunlight  : serve.ts not found or bun not available
 */

import { percentile } from "./types.ts";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function argValue(flag: string, def: string): string {
	const idx = argv.indexOf(flag);
	if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
	return def;
}

function argFlag(flag: string): boolean {
	return argv.includes(flag);
}

const OUTPUT_ONLY = argFlag("--output-only");
const ITERATIONS = Number(argValue("--iterations", process.env.BENCH_ITERATIONS ?? "20"));
const ENGINES_ARG = argValue("--engines", process.env.BENCH_ENGINES ?? "chrome,lightpanda,bunlight")
	.split(",")
	.map((e) => e.trim());

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// import.meta.dir = /abs/path/to/bunlight/benchmarks
const BENCH_DIR = import.meta.dir;
// One level up: /abs/path/to/bunlight
const BUNLIGHT_ROOT = `${BENCH_DIR}/..`;
// Two levels up: /abs/path/to/bunmium; then into agent-browser
const AGENT_BROWSER_BIN =
	process.env.AGENT_BROWSER ?? `${BENCH_DIR}/../../agent-browser/cli/target/release/agent-browser`;

const BUNLIGHT_PATH = process.env.BUNLIGHT_PATH ?? `${BUNLIGHT_ROOT}/src/cli/serve.ts`;

// ---------------------------------------------------------------------------
// Engine probe: check availability before running
// ---------------------------------------------------------------------------

interface EngineStatus {
	engine: string;
	available: boolean;
	skipReason: string;
}

async function probeChrome(): Promise<EngineStatus> {
	if (!(await Bun.file(AGENT_BROWSER_BIN).exists())) {
		return {
			engine: "chrome",
			available: false,
			skipReason: `agent-browser binary not found at ${AGENT_BROWSER_BIN}`,
		};
	}

	// Try spawning Chrome once to check if --no-sandbox is needed and works.
	// We use a short timeout probe.
	const proc = Bun.spawn(
		[AGENT_BROWSER_BIN, "--engine", "chrome", "--args", "--no-sandbox", "open", "about:blank"],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env },
		},
	);

	const timer = setTimeout(() => proc.kill(), 12_000);
	const exitCode = await proc.exited.catch(() => -1);
	clearTimeout(timer);

	const stderr = await new Response(proc.stderr).text().catch(() => "");
	const stdout = await new Response(proc.stdout).text().catch(() => "");

	if (
		stderr.includes("No usable sandbox") ||
		stderr.includes("FATAL") ||
		(exitCode !== 0 && !stdout.includes("about:blank") && !stdout.includes("Example"))
	) {
		// Close any partial session
		await closeEngine("chrome").catch(() => {});
		return {
			engine: "chrome",
			available: false,
			skipReason: "Chrome requires sandbox unavailable in this environment",
		};
	}

	await closeEngine("chrome").catch(() => {});
	return { engine: "chrome", available: true, skipReason: "" };
}

async function probeLightpanda(): Promise<EngineStatus> {
	if (!(await Bun.file(AGENT_BROWSER_BIN).exists())) {
		return {
			engine: "lightpanda",
			available: false,
			skipReason: `agent-browser binary not found at ${AGENT_BROWSER_BIN}`,
		};
	}

	// Check if lightpanda binary supports CDP serve mode (the version installed
	// in this environment only has an interactive REPL, not a CDP server mode).
	const proc = Bun.spawn([AGENT_BROWSER_BIN, "--engine", "lightpanda", "open", "about:blank"], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});

	const timer = setTimeout(() => proc.kill(), 10_000);
	const exitCode = await proc.exited.catch(() => -1);
	clearTimeout(timer);

	const stderr = await new Response(proc.stderr).text().catch(() => "");

	if (
		stderr.includes("exited before CDP became ready") ||
		stderr.includes("Please enter a command") ||
		exitCode !== 0
	) {
		return {
			engine: "lightpanda",
			available: false,
			skipReason:
				"Lightpanda binary (installed: interactive REPL mode) does not expose a CDP server. " +
				"Requires lightpanda v0.2+ with `lightpanda serve --port <N>` support.",
		};
	}

	await closeEngine("lightpanda").catch(() => {});
	return { engine: "lightpanda", available: true, skipReason: "" };
}

async function probeBunlight(): Promise<EngineStatus> {
	if (!(await Bun.file(AGENT_BROWSER_BIN).exists())) {
		return {
			engine: "bunlight",
			available: false,
			skipReason: `agent-browser binary not found at ${AGENT_BROWSER_BIN}`,
		};
	}
	if (!(await Bun.file(BUNLIGHT_PATH).exists())) {
		return {
			engine: "bunlight",
			available: false,
			skipReason: `BUNLIGHT_PATH not found: ${BUNLIGHT_PATH}`,
		};
	}

	const proc = Bun.spawn([AGENT_BROWSER_BIN, "--engine", "bunlight", "open", "about:blank"], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, BUNLIGHT_PATH },
	});

	const timer = setTimeout(() => proc.kill(), 15_000);
	const exitCode = await proc.exited.catch(() => -1);
	clearTimeout(timer);

	const stderr = await new Response(proc.stderr).text().catch(() => "");

	if (exitCode !== 0 && stderr.includes("exited before CDP became ready")) {
		return {
			engine: "bunlight",
			available: false,
			skipReason: `Bunlight failed to start: ${stderr.slice(0, 200)}`,
		};
	}

	await closeEngine("bunlight").catch(() => {});
	return { engine: "bunlight", available: true, skipReason: "" };
}

// ---------------------------------------------------------------------------
// Close engine daemon helper
// ---------------------------------------------------------------------------

async function closeEngine(engine: string): Promise<void> {
	const env = engine === "bunlight" ? { ...process.env, BUNLIGHT_PATH } : { ...process.env };
	const proc = Bun.spawn([AGENT_BROWSER_BIN, "--engine", engine, "close", "--all"], {
		stdout: "pipe",
		stderr: "pipe",
		env,
	});
	await proc.exited.catch(() => {});
}

// ---------------------------------------------------------------------------
// RSS measurement: read /proc/<pid>/status to get VmRSS
// ---------------------------------------------------------------------------

async function readRssKb(pid: number): Promise<number> {
	const file = Bun.file(`/proc/${pid}/status`);
	if (!(await file.exists())) return 0;
	const text = await file.text().catch(() => "");
	const m = text.match(/VmRSS:\s*(\d+)\s*kB/);
	return m ? parseInt(m[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Scenario definition
// ---------------------------------------------------------------------------

interface Scenario {
	name: string;
	url: string;
	/**
	 * Commands to run after `open`. Each is an array of CLI args appended to
	 * `agent-browser --engine <engine>`. Commands are run sequentially as
	 * separate invocations (daemon persists between calls).
	 */
	commands: string[][];
}

const SCENARIOS: Scenario[] = [
	{
		name: "open-snapshot-close",
		url: "https://news.ycombinator.com",
		commands: [["snapshot"], ["close", "--all"]],
	},
	{
		name: "open-screenshot",
		url: "https://example.com",
		commands: [
			["screenshot", "/tmp/bench-shot.png"],
			["close", "--all"],
		],
	},
	{
		name: "open-click-snapshot",
		url: "https://example.com",
		commands: [["click", "@e2"], ["snapshot"], ["close", "--all"]],
	},
];

// ---------------------------------------------------------------------------
// Per-command timing sample
// ---------------------------------------------------------------------------

interface CommandSample {
	command: string;
	latencyMs: number;
}

interface ScenarioSample {
	engine: string;
	scenario: string;
	iteration: number;
	coldStartMs: number;
	commands: CommandSample[];
	peakRssKb: number;
	totalMs: number;
	success: boolean;
	errorMsg?: string;
}

// ---------------------------------------------------------------------------
// Run a single scenario iteration for a given engine
// ---------------------------------------------------------------------------

async function runIteration(
	engine: string,
	scenario: Scenario,
	iteration: number,
): Promise<ScenarioSample> {
	const env = engine === "bunlight" ? { ...process.env, BUNLIGHT_PATH } : { ...process.env };

	const chromeExtraArgs = engine === "chrome" ? ["--args", "--no-sandbox"] : [];

	const t0 = Bun.nanoseconds();
	let peakRssKb = 0;

	// Open (cold start: measure time from here to first response)
	const openProc = Bun.spawn(
		[AGENT_BROWSER_BIN, "--engine", engine, ...chromeExtraArgs, "open", scenario.url],
		{ stdout: "pipe", stderr: "pipe", env },
	);

	// Monitor RSS of the daemon child while it starts
	const monitorInterval = setInterval(async () => {
		const rss = await readRssKb(openProc.pid).catch(() => 0);
		if (rss > peakRssKb) peakRssKb = rss;
	}, 100);

	const openExit = await openProc.exited.catch(() => 1);
	const coldStartMs = (Bun.nanoseconds() - t0) / 1_000_000;

	if (openExit !== 0) {
		clearInterval(monitorInterval);
		const errText = await new Response(openProc.stderr).text().catch(() => "");
		return {
			engine,
			scenario: scenario.name,
			iteration,
			coldStartMs,
			commands: [],
			peakRssKb,
			totalMs: coldStartMs,
			success: false,
			errorMsg: errText.slice(0, 300),
		};
	}

	// Run subsequent commands
	const commandSamples: CommandSample[] = [];
	for (const cmdArgs of scenario.commands) {
		const tc = Bun.nanoseconds();
		const cmdProc = Bun.spawn([AGENT_BROWSER_BIN, "--engine", engine, ...cmdArgs], {
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
		const rss = await readRssKb(cmdProc.pid).catch(() => 0);
		if (rss > peakRssKb) peakRssKb = rss;
		await cmdProc.exited.catch(() => {});
		commandSamples.push({
			command: cmdArgs.join(" "),
			latencyMs: (Bun.nanoseconds() - tc) / 1_000_000,
		});
	}

	clearInterval(monitorInterval);
	const totalMs = (Bun.nanoseconds() - t0) / 1_000_000;

	return {
		engine,
		scenario: scenario.name,
		iteration,
		coldStartMs,
		commands: commandSamples,
		peakRssKb,
		totalMs,
		success: true,
	};
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

function statsFromSamples(values: number[]): {
	p50: number;
	p95: number;
	mean: number;
	stddev: number;
	min: number;
	max: number;
} {
	if (values.length === 0) return { p50: 0, p95: 0, mean: 0, stddev: 0, min: 0, max: 0 };
	const sorted = [...values].sort((a, b) => a - b);
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return {
		p50: Math.round(percentile(sorted, 50)),
		p95: Math.round(percentile(sorted, 95)),
		mean: Math.round(mean),
		stddev: Math.round(Math.sqrt(variance)),
		min: Math.round(sorted[0]),
		max: Math.round(sorted[sorted.length - 1]),
	};
}

// ---------------------------------------------------------------------------
// Markdown report generator
// ---------------------------------------------------------------------------

function generateMarkdown(
	engineStatuses: EngineStatus[],
	allSamples: ScenarioSample[],
	date: string,
): string {
	const lines: string[] = [];

	lines.push(`# Engine Comparison Benchmark — ${date}`);
	lines.push("");
	lines.push("Compares `chrome`, `lightpanda`, and `bunlight` engines via the");
	lines.push("`agent-browser` CLI for cold-start time, per-command latency, and peak RSS.");
	lines.push("");

	// Environment
	lines.push("## Environment");
	lines.push("");
	lines.push("| Key | Value |");
	lines.push("|-----|-------|");
	lines.push(`| Platform | ${process.platform} ${process.arch} |`);
	lines.push(`| Bun version | ${Bun.version} |`);
	lines.push(`| Iterations | ${ITERATIONS} per engine per scenario |`);
	lines.push(`| agent-browser | ${AGENT_BROWSER_BIN} |`);
	lines.push(`| bunlight serve | ${BUNLIGHT_PATH} |`);
	lines.push("");

	// Engine availability
	lines.push("## Engine Availability");
	lines.push("");
	lines.push("| Engine | Status | Notes |");
	lines.push("|--------|--------|-------|");
	for (const s of engineStatuses) {
		const status = s.available ? "available" : "skipped";
		const notes = s.available ? "ran" : s.skipReason;
		lines.push(`| ${s.engine} | ${status} | ${notes} |`);
	}
	lines.push("");

	// Per-scenario results
	for (const scenario of SCENARIOS) {
		lines.push(`## Scenario: ${scenario.name}`);
		lines.push("");
		lines.push(`URL: ${scenario.url}`);
		lines.push("");

		lines.push("### Cold Start (open + first response)");
		lines.push("");
		lines.push("| Engine | p50 (ms) | p95 (ms) | mean (ms) | stddev | min | max |");
		lines.push("|--------|----------|----------|-----------|--------|-----|-----|");

		for (const es of engineStatuses) {
			if (!es.available) {
				lines.push(`| ${es.engine} | SKIP | SKIP | SKIP | — | — | — |`);
				continue;
			}
			const successes = allSamples.filter(
				(s) => s.engine === es.engine && s.scenario === scenario.name && s.success,
			);
			if (successes.length === 0) {
				lines.push(`| ${es.engine} | ERR | ERR | ERR | — | — | — |`);
				continue;
			}
			const st = statsFromSamples(successes.map((s) => s.coldStartMs));
			lines.push(
				`| ${es.engine} | ${st.p50} | ${st.p95} | ${st.mean} | ${st.stddev} | ${st.min} | ${st.max} |`,
			);
		}
		lines.push("");

		// Per-command latency
		lines.push("### Per-Command Latency");
		lines.push("");

		// Collect all command names for this scenario
		const cmdNames: string[] = [];
		for (const sample of allSamples) {
			if (sample.scenario !== scenario.name) continue;
			for (const c of sample.commands) {
				if (!cmdNames.includes(c.command)) cmdNames.push(c.command);
			}
		}

		if (cmdNames.length > 0) {
			lines.push(`| Engine | Command | p50 (ms) | p95 (ms) | mean (ms) |`);
			lines.push(`|--------|---------|----------|----------|-----------|`);
			for (const es of engineStatuses) {
				if (!es.available) continue;
				for (const cmdName of cmdNames) {
					const latencies = allSamples
						.filter((s) => s.engine === es.engine && s.scenario === scenario.name && s.success)
						.flatMap((s) =>
							s.commands.filter((c) => c.command === cmdName).map((c) => c.latencyMs),
						);
					if (latencies.length === 0) continue;
					const st = statsFromSamples(latencies);
					lines.push(`| ${es.engine} | \`${cmdName}\` | ${st.p50} | ${st.p95} | ${st.mean} |`);
				}
			}
			lines.push("");
		}

		// Peak RSS
		lines.push("### Peak RSS");
		lines.push("");
		lines.push("| Engine | p50 (MB) | p95 (MB) | mean (MB) |");
		lines.push("|--------|----------|----------|-----------|");
		for (const es of engineStatuses) {
			if (!es.available) {
				lines.push(`| ${es.engine} | SKIP | SKIP | SKIP |`);
				continue;
			}
			const successes = allSamples.filter(
				(s) => s.engine === es.engine && s.scenario === scenario.name && s.success,
			);
			if (successes.length === 0) {
				lines.push(`| ${es.engine} | ERR | ERR | ERR |`);
				continue;
			}
			const rssMb = successes.map((s) => Math.round((s.peakRssKb / 1024) * 10) / 10);
			const st = statsFromSamples(rssMb);
			lines.push(`| ${es.engine} | ${st.p50} | ${st.p95} | ${st.mean} |`);
		}
		lines.push("");

		// Success rate
		const totalPerEngine = ITERATIONS;
		lines.push("### Success Rate");
		lines.push("");
		lines.push("| Engine | Successes | Total | Rate |");
		lines.push("|--------|-----------|-------|------|");
		for (const es of engineStatuses) {
			if (!es.available) {
				lines.push(`| ${es.engine} | — | — | SKIP |`);
				continue;
			}
			const total = allSamples.filter(
				(s) => s.engine === es.engine && s.scenario === scenario.name,
			).length;
			const successes = allSamples.filter(
				(s) => s.engine === es.engine && s.scenario === scenario.name && s.success,
			).length;
			const rate = total > 0 ? `${Math.round((successes / total) * 100)}%` : "0%";
			lines.push(`| ${es.engine} | ${successes} | ${total} | ${rate} |`);
		}
		lines.push("");
	}

	// Summary comparison table (cold start p50 across all scenarios)
	lines.push("## Summary — Cold Start p50 Comparison");
	lines.push("");
	lines.push("Lower is better. Shows cold-start p50 in ms for each engine x scenario combination.");
	lines.push("");

	const availEngines = engineStatuses.filter((e) => e.available).map((e) => e.engine);
	if (availEngines.length > 0) {
		const header = `| Scenario | ${availEngines.join(" | ")} |`;
		const sep = `|----------|${availEngines.map(() => "----------").join("|")}|`;
		lines.push(header);
		lines.push(sep);

		for (const scenario of SCENARIOS) {
			const cols: string[] = [];
			for (const eng of availEngines) {
				const successes = allSamples.filter(
					(s) => s.engine === eng && s.scenario === scenario.name && s.success,
				);
				if (successes.length === 0) {
					cols.push("ERR");
				} else {
					const st = statsFromSamples(successes.map((s) => s.coldStartMs));
					cols.push(`${st.p50} ms`);
				}
			}
			lines.push(`| ${scenario.name} | ${cols.join(" | ")} |`);
		}
		lines.push("");
	}

	// Bunlight vs Chrome comparison note
	const bunlightStatus = engineStatuses.find((e) => e.engine === "bunlight");
	const chromeStatus = engineStatuses.find((e) => e.engine === "chrome");
	if (bunlightStatus?.available && chromeStatus?.available) {
		lines.push("## Bunlight vs Chrome Analysis");
		lines.push("");
		for (const scenario of SCENARIOS) {
			const bunlightSamples = allSamples.filter(
				(s) => s.engine === "bunlight" && s.scenario === scenario.name && s.success,
			);
			const chromeSamples = allSamples.filter(
				(s) => s.engine === "chrome" && s.scenario === scenario.name && s.success,
			);
			if (bunlightSamples.length === 0 || chromeSamples.length === 0) continue;
			const bunSt = statsFromSamples(bunlightSamples.map((s) => s.coldStartMs));
			const chrSt = statsFromSamples(chromeSamples.map((s) => s.coldStartMs));
			const ratio = chrSt.p50 > 0 ? ((chrSt.p50 / bunSt.p50) * 100).toFixed(0) : "n/a";
			const diff = chrSt.p50 - bunSt.p50;
			lines.push(
				`**${scenario.name}**: bunlight p50=${bunSt.p50}ms, chrome p50=${chrSt.p50}ms — ` +
					`bunlight is ${diff >= 0 ? "faster" : "slower"} by ${Math.abs(diff)}ms (${ratio}% of Chrome time).`,
			);
		}
		lines.push("");
	}

	lines.push("---");
	lines.push(`*Generated by \`benchmarks/agent-browser-engine.bench.ts\` on ${date}.*`);
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const date = new Date().toISOString().slice(0, 10);
	console.log(`[bench] agent-browser engine comparison — ${date}`);
	console.log(`[bench] iterations=${ITERATIONS} engines=${ENGINES_ARG.join(",")}`);
	console.log(`[bench] agent-browser: ${AGENT_BROWSER_BIN}`);
	console.log(`[bench] bunlight: ${BUNLIGHT_PATH}`);
	console.log("");

	// Check agent-browser binary exists
	if (!(await Bun.file(AGENT_BROWSER_BIN).exists())) {
		console.error(
			`[bench] SKIP: agent-browser binary not found at ${AGENT_BROWSER_BIN}. ` +
				`Build it with: cd ~/bunmium/agent-browser && cargo build --release`,
		);
		process.exit(0);
	}

	// Probe each engine
	// Ensure a clean slate before probing (kill any leftover daemons).
	for (const eng of ["chrome", "lightpanda", "bunlight"]) {
		await closeEngine(eng).catch(() => {});
	}
	await Bun.sleep(500);

	console.log("[bench] probing engine availability...");
	const engineStatuses: EngineStatus[] = [];

	for (const engine of ENGINES_ARG) {
		// Clear state from previous probe before each engine check.
		for (const eng of ["chrome", "lightpanda", "bunlight"]) {
			await closeEngine(eng).catch(() => {});
		}
		await Bun.sleep(300);

		let status: EngineStatus;
		if (engine === "chrome") {
			status = await probeChrome();
		} else if (engine === "lightpanda") {
			status = await probeLightpanda();
		} else if (engine === "bunlight") {
			status = await probeBunlight();
		} else {
			status = { engine, available: false, skipReason: `unknown engine: ${engine}` };
		}
		engineStatuses.push(status);
		if (status.available) {
			console.log(`[bench]   ${engine}: available`);
		} else {
			console.log(`[bench]   ${engine}: SKIP — ${status.skipReason}`);
		}
	}

	const availableEngines = engineStatuses.filter((s) => s.available).map((s) => s.engine);
	if (availableEngines.length === 0) {
		console.log("[bench] No engines available. Writing skip report.");
	} else {
		console.log(
			`\n[bench] Running ${availableEngines.length} engine(s) × ${SCENARIOS.length} scenarios × ${ITERATIONS} iterations`,
		);
	}
	console.log("");

	const allSamples: ScenarioSample[] = [];

	for (const engine of availableEngines) {
		for (const scenario of SCENARIOS) {
			console.log(`[bench] ${engine} / ${scenario.name}`);
			let successCount = 0;

			for (let i = 0; i < ITERATIONS; i++) {
				// Close any lingering daemon before each iteration start
				await closeEngine(engine).catch(() => {});

				const sample = await runIteration(engine, scenario, i);
				allSamples.push(sample);

				if (sample.success) {
					successCount++;
					process.stdout.write(
						`\r[bench]   iter ${i + 1}/${ITERATIONS} cold=${Math.round(sample.coldStartMs)}ms ok`,
					);
				} else {
					process.stdout.write(
						`\r[bench]   iter ${i + 1}/${ITERATIONS} FAILED: ${(sample.errorMsg ?? "").slice(0, 80)}`,
					);
				}

				// Always close after iteration to reset daemon state
				await closeEngine(engine).catch(() => {});
				// Brief pause between iterations to let OS reclaim resources
				await Bun.sleep(200);
			}

			process.stdout.write("\n");

			// Print quick stats
			const successes = allSamples.filter(
				(s) => s.engine === engine && s.scenario === scenario.name && s.success,
			);
			if (successes.length > 0) {
				const coldStats = statsFromSamples(successes.map((s) => s.coldStartMs));
				console.log(
					`[bench]   cold start: p50=${coldStats.p50}ms p95=${coldStats.p95}ms mean=${coldStats.mean}ms (${successCount}/${ITERATIONS} ok)`,
				);
			} else {
				console.log(`[bench]   all iterations failed`);
			}
		}
	}

	// Generate markdown report
	console.log("\n[bench] generating report...");
	const markdown = generateMarkdown(engineStatuses, allSamples, date);

	const resultsDir = `${BENCH_DIR}/results`;
	const mdPath = `${resultsDir}/${date}-engine-comparison.md`;

	await Bun.write(mdPath, markdown);
	console.log(`[bench] report written to ${mdPath}`);

	// Print summary to stdout
	console.log("\n=== SUMMARY ===\n");
	for (const es of engineStatuses) {
		if (!es.available) {
			console.log(`${es.engine}: SKIP (${es.skipReason})`);
			continue;
		}
		for (const scenario of SCENARIOS) {
			const successes = allSamples.filter(
				(s) => s.engine === es.engine && s.scenario === scenario.name && s.success,
			);
			if (successes.length === 0) {
				console.log(`${es.engine} / ${scenario.name}: 0 successful iterations`);
				continue;
			}
			const coldStats = statsFromSamples(successes.map((s) => s.coldStartMs));
			const rssStats = statsFromSamples(
				successes.map((s) => Math.round((s.peakRssKb / 1024) * 10) / 10),
			);
			console.log(
				`${es.engine} / ${scenario.name}: cold p50=${coldStats.p50}ms p95=${coldStats.p95}ms | rss p50=${rssStats.p50}MB`,
			);
		}
	}
}

main().catch((err: unknown) => {
	console.error("[bench] fatal:", err);
	process.exit(1);
});
