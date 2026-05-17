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
 * Build the Bxc serverless handler into a standalone executable
 * (`dist/bxc-serverless`) using `Bun.build({ compile: true })`.
 */

import { rm } from "node:fs/promises";

const distDir = `${import.meta.dir}/../dist`;
await rm(distDir, { recursive: true, force: true });

console.log("[build-serverless] compiling…");
const t0 = Bun.nanoseconds() / 1e6;

const result = await Bun.build({
	entrypoints: [`${import.meta.dir}/../src/serverless/standalone.ts`],
	outdir: distDir,
	target: "bun",
	minify: true,
	sourcemap: "external",
	format: "esm",
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

const tookMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
console.log(`[build-serverless] ok in ${tookMs}ms — outputs:`);
for (const out of result.outputs) {
	const sizeKb = (out.size / 1024).toFixed(1);
	console.log(`  ${out.path}  ${sizeKb} KB`);
}
