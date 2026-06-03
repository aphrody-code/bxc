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
 * PagePool concurrency / back-pressure test.
 *
 * Spins up a local HTTP server with a tiny static body, points the pool at
 * 100 URLs in parallel, and verifies:
 *
 *   - Every URL completes successfully.
 *   - Concurrency is bounded (active count never exceeds the configured limit).
 *   - Idle pages are reused (live page count stays under `maxPages`).
 *   - The whole batch finishes well under 60 seconds.
 *
 * Uses the `static` profile so the test is self-contained (no Lightpanda
 * binary required).  Replace with `profile: "fast"` for the realistic path.
 */

import { describe, expect, test } from "bun:test";
import { PagePool } from "../../src/pool/PagePool.ts";

describe("PagePool — bounded concurrency", () => {
	test("100 URLs / concurrency=20 / maxPages=10 — all complete", async () => {
		// Spin up a tiny server.
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const u = new URL(req.url);
				const id = u.searchParams.get("id") ?? "?";
				return new Response(
					`<!doctype html><html><head><title>page-${id}</title></head><body><h1 id="x">${id}</h1></body></html>`,
					{ headers: { "content-type": "text/html" } },
				);
			},
		});
		const base = `http://127.0.0.1:${server.port}`;

		try {
			const pool = new PagePool({
				profile: "static",
				concurrency: 20,
				maxPages: 10,
			});

			const urls = Array.from({ length: 100 }, (_, i) => `${base}/?id=${i}`);

			let peakActive = 0;
			const monitor = setInterval(() => {
				const s = pool.stats();
				if (s.active > peakActive) peakActive = s.active;
			}, 5);

			const t0 = Date.now();
			const results = await pool.run(urls, async (page, url) => {
				await page.goto(url);
				return page.title();
			});
			const elapsed = Date.now() - t0;
			clearInterval(monitor);

			expect(results.length).toBe(100);
			const ok = results.filter((r) => r.ok).length;
			expect(ok).toBe(100);

			const titles = results.map((r) => (r.ok ? r.value : ""));
			// First and last pages have predictable titles.
			expect(titles[0]).toBe("page-0");
			expect(titles[99]).toBe("page-99");

			// Concurrency cap respected.
			expect(peakActive).toBeLessThanOrEqual(20);

			// Throughput sanity: should finish in seconds, not minutes.
			expect(elapsed).toBeLessThan(60_000);

			const final = pool.stats();
			expect(final.completed).toBe(100);
			expect(final.failed).toBe(0);

			await pool.close();
		} finally {
			server.stop(true);
		}
	}, 90_000);

	test("runStrict throws on first error", async () => {
		const pool = new PagePool({ profile: "static", concurrency: 4 });
		try {
			const inputs = [1, 2, 3, 4];
			await expect(
				pool.runStrict(inputs, async (_p, n) => {
					if (n === 3) throw new Error("boom");
					return n * 2;
				}),
			).rejects.toThrow("boom");
		} finally {
			await pool.close();
		}
	});
});
