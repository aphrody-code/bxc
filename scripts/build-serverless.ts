#!/usr/bin/env bun
/**
 * Build the Bunlight serverless handler into a standalone executable
 * (`dist/bunlight-serverless`) using `Bun.build({ compile: true })`.
 */

import { rm } from "node:fs/promises";

const distDir = `${import.meta.dir}/../dist`;
await rm(distDir, { recursive: true, force: true });

console.log("[build-serverless] compiling…");
const t0 = performance.now();

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

const tookMs = Math.round(performance.now() - t0);
console.log(`[build-serverless] ok in ${tookMs}ms — outputs:`);
for (const out of result.outputs) {
	const sizeKb = (out.size / 1024).toFixed(1);
	console.log(`  ${out.path}  ${sizeKb} KB`);
}
