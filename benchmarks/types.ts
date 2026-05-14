/**
 * Shared types for all benchmark runners and scenarios.
 */

export interface RunResult {
	/** Runner identifier */
	runner: string;
	/** Full URL that was fetched */
	url: string;
	/** Whether the fetch+parse succeeded */
	success: boolean;
	/** Wall-clock latency in milliseconds (includes spawn for browser runners) */
	latencyMs: number;
	/** Resident-set-size after the run, in MB */
	ramMb: number;
	/** Number of bytes in the returned HTML/content */
	contentLength: number;
	/** HTTP status code, 0 if not applicable */
	statusCode: number;
	/** Short error description if success === false */
	error?: string;
}

export interface ScenarioResult {
	scenario: string;
	runner: string;
	/** ISO timestamp of the run start */
	startedAt: string;
	runs: RunResult[];
	/** p50 latency in ms */
	p50Ms: number;
	/** p95 latency in ms */
	p95Ms: number;
	/** Arithmetic mean latency in ms */
	meanMs: number;
	/** Peak RSS in MB across all runs */
	peakRamMb: number;
	/** Successful runs / total runs */
	successRate: number;
	/** Total wall-clock time for the whole scenario in ms */
	totalMs: number;
}

export interface BenchmarkReport {
	version: string;
	date: string;
	environment: {
		platform: string;
		arch: string;
		bunVersion: string;
		cpuCores: number;
		totalRamMb: number;
	};
	scenarios: ScenarioResult[];
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function summarise(
	results: RunResult[],
): Pick<ScenarioResult, "p50Ms" | "p95Ms" | "meanMs" | "peakRamMb" | "successRate"> {
	const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
	const rams = results.map((r) => r.ramMb);
	const successCount = results.filter((r) => r.success).length;

	return {
		p50Ms: Math.round(percentile(latencies, 50)),
		p95Ms: Math.round(percentile(latencies, 95)),
		meanMs:
			latencies.length > 0
				? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
				: 0,
		peakRamMb: Math.round(Math.max(0, ...rams) * 10) / 10,
		successRate: results.length > 0 ? Math.round((successCount / results.length) * 1000) / 10 : 0,
	};
}

export function rssNow(): number {
	return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}
