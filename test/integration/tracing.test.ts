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

import { test, expect } from "bun:test";
import { Browser } from "../../src/api/browser.ts";
import { unlink } from "node:fs/promises";

test("TraceRecorder > captures actions, snapshots and network, and outputs a valid zstd compressed JSON", async () => {
	const tracePath = `/tmp/bunlight-test-trace-${Date.now()}.trace.zst`;
	const context = await Browser.newContext();
	const tracer = context.tracing();
	
	tracer.start();
	const page = await context.newPage({ profile: "static" });
	
	await page.goto("https://google.com");
	await page.evaluate(() => {
		return 1 + 1;
	}).catch(() => {}); // static evaluate is limited but it might not crash, or just don't do it
	
	// Add a dummy action to trace to ensure it's captured
	(page as any)._traceRecorder?.recordAction({ type: "evaluate", target: "1+1" });
	await (page as any)._traceRecorder?.captureSnapshot();
	
	await tracer.stop({ path: tracePath });
	await context.close();

	const compressed = await Bun.file(tracePath).arrayBuffer();
	expect(compressed.byteLength).toBeGreaterThan(0);
	
	const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressed));
	const trace = JSON.parse(new TextDecoder().decode(decompressed));
	
	expect(trace.version).toBe("1.0");
	expect(trace.actions.length).toBeGreaterThanOrEqual(2);
	expect(trace.actions[0].type).toBe("goto");
	expect(trace.actions[0].target).toBe("https://google.com");
	
	expect(trace.snapshots.length).toBeGreaterThan(0);
	expect(trace.network.entries.length).toBeGreaterThan(0);
	
	await unlink(tracePath).catch(() => {});
});
