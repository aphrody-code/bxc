// End-to-end scrape-extract benchmark: 10 HTML samples → structured JSON via the
// local Gemma 4 E2B llama.cpp server. Reports pages/min, p50/p95 latency, and
// pulls cumulative token counts from /metrics. Bun-only.
//
// Run: bun benchmarks/extract.bench.ts

import { z } from "zod";
import { LlmClient } from "../src/client.ts";
import { extractStructured } from "../src/extract.ts";

const SAMPLES = [
	`<html><head><title>Doc Bun 1.3</title></head><body><h1>Bun 1.3</h1>
   <p>Release date: 2025-08-12</p><p>Highlights: Fetch v2, Bun.semaphore.</p></body></html>`,
	`<html><head><title>Gemma 4 E2B</title></head><body><h1>Effective 2B</h1>
   <p>Per-Layer Embeddings.</p><p>Context: 128K</p></body></html>`,
	`<html><body><h2>llama.cpp release</h2><p>Tag: b6473</p>
   <p>Author: ggml-org</p><p>Date: 2026-05-10</p></body></html>`,
	`<html><body><h1>TigerBeetle 0.16</h1><p>Author: tigerbeetle.</p>
   <p>Topic: financial ledger.</p></body></html>`,
	`<html><body><h1>Zig 0.15.1</h1><p>Date: 2026-04-02</p>
   <p>Build system: zig build new.</p></body></html>`,
	`<html><body><h1>TypeScript 5.9</h1><p>Author: Microsoft</p>
   <p>Date: 2026-03-15</p><p>New: import attributes.</p></body></html>`,
	`<html><body><h1>PostgreSQL 18</h1><p>Author: PGDG</p>
   <p>Date: 2025-09-25</p><p>Async I/O optional.</p></body></html>`,
	`<html><body><h1>Redis 8</h1><p>Author: Redis Ltd</p>
   <p>Date: 2025-05-01</p><p>Vector sets GA.</p></body></html>`,
	`<html><body><h1>Linux 7.0</h1><p>Author: kernel.org</p>
   <p>Date: 2026-02-14</p><p>BPF maps in shmem.</p></body></html>`,
	`<html><body><h1>nginx 1.29</h1><p>Author: F5</p>
   <p>Date: 2025-11-21</p><p>QUIC stable.</p></body></html>`,
] as const;

const schema = z.object({
	title: z.string(),
	version: z.string().optional(),
	author: z.string().optional(),
	date: z.string().optional(),
	topic: z.string().optional(),
});

const NS_PER_MS = 1_000_000n;

function nsToMs(ns: bigint): number {
	return Number(ns / NS_PER_MS);
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(
		sorted.length - 1,
		Math.floor((p / 100) * sorted.length),
	);
	return sorted[idx] ?? 0;
}

async function main(): Promise<void> {
	const client = new LlmClient();
	if (!(await client.health())) {
		console.error("gemma server not running on 127.0.0.1:8080");
		process.exit(1);
	}
	console.log(`bench: ${SAMPLES.length} HTML samples → structured JSON\n`);

	let ok = 0;
	const latencies: number[] = [];
	const start = Bun.nanoseconds();

	for (let i = 0; i < SAMPLES.length; i++) {
		const t0 = Bun.nanoseconds();
		try {
			const out = await extractStructured(SAMPLES[i] ?? "", {
				schema,
				client,
				maxOutputTokens: 150,
			});
			const dtMs = nsToMs(BigInt(Bun.nanoseconds() - t0));
			latencies.push(dtMs);
			ok++;
			console.log(
				`[${i + 1}/${SAMPLES.length}] ${dtMs.toString().padStart(5)} ms  ` +
					`title="${out.title.slice(0, 40)}" version=${out.version ?? "-"} ` +
					`author=${out.author ?? "-"}`,
			);
		} catch (err) {
			const dtMs = nsToMs(BigInt(Bun.nanoseconds() - t0));
			const msg = err instanceof Error ? err.message : String(err);
			console.log(
				`[${i + 1}/${SAMPLES.length}] ${dtMs} ms  FAIL: ${msg.slice(0, 80)}`,
			);
		}
	}

	const totalSec = nsToMs(BigInt(Bun.nanoseconds() - start)) / 1000;
	const pagesPerMin = (SAMPLES.length / totalSec) * 60;
	const sorted = [...latencies].sort((a, b) => a - b);
	const p50 = percentile(sorted, 50);
	const p95 = percentile(sorted, 95);

	let genTokens = 0;
	let promptTokens = 0;
	try {
		const metricsRes = await fetch(`${client.baseUrl}/metrics`);
		const metricsText = await metricsRes.text();
		const pickMetric = (name: string): number | undefined => {
			const m = metricsText.match(
				new RegExp(`^${name}\\s+(\\d+\\.?\\d*)`, "m"),
			);
			return m?.[1] !== undefined ? Number.parseFloat(m[1]) : undefined;
		};
		genTokens = pickMetric("llamacpp:tokens_predicted_total") ?? 0;
		promptTokens = pickMetric("llamacpp:prompt_tokens_total") ?? 0;
	} catch {
		/* metrics endpoint optional */
	}

	console.log(`\n--- RESULT ---`);
	console.log(`ok            : ${ok}/${SAMPLES.length}`);
	console.log(`wall time     : ${totalSec.toFixed(2)} s`);
	console.log(`pages / min   : ${pagesPerMin.toFixed(2)}`);
	console.log(`p50 latency   : ${p50} ms`);
	console.log(`p95 latency   : ${p95} ms`);
	console.log(`gen tokens    : ${genTokens} (cum since boot)`);
	console.log(`prompt tokens : ${promptTokens} (cum since boot)`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
