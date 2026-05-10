/**
 * Smoke test for the lightpanda Bun plugin.
 *
 * Validates two paths:
 *   1. Build-time: Bun.build with lightpandaPlugin embeds rendered HTML
 *      into a generated module.
 *   2. Runtime: renderPage() returns Lightpanda-rendered HTML on demand.
 */

import { lightpandaPlugin, renderPage, lightpandaCacheStats } from "../src/plugin/index.ts";

// ---------------------------------------------------------------------------
// 1. Runtime path
// ---------------------------------------------------------------------------

console.log("[plugin-test] runtime renderPage()");
const t0 = Bun.nanoseconds();
const html = await renderPage("https://example.com", { cacheTtlMs: 30_000 });
const ms = ((Bun.nanoseconds() - t0) / 1e6).toFixed(0);
console.log(`[plugin-test] first ${html.length} bytes in ${ms} ms`);
console.log(`[plugin-test] head: ${html.slice(0, 80).replace(/\s+/g, " ")}`);

const t1 = Bun.nanoseconds();
const html2 = await renderPage("https://example.com", { cacheTtlMs: 30_000 });
const ms2 = ((Bun.nanoseconds() - t1) / 1e6).toFixed(0);
console.log(`[plugin-test] second (cached) ${html2.length} bytes in ${ms2} ms`);
console.log(`[plugin-test] cache: ${JSON.stringify(lightpandaCacheStats())}`);

// ---------------------------------------------------------------------------
// 2. Build-time path
// ---------------------------------------------------------------------------

console.log("");
console.log("[plugin-test] build-time Bun.build with lightpanda plugin");

const entry = "/tmp/bunlight-plugin-entry.ts";
await Bun.write(
	entry,
	`import html from "lightpanda:https://example.com";\nexport default html;\n`,
);

const result = await Bun.build({
	entrypoints: [entry],
	target: "bun",
	plugins: [lightpandaPlugin({ cacheTtlMs: 30_000, logLevel: "error" })],
}).catch((err) => {
	console.log(`[plugin-test] build error: ${err instanceof Error ? err.message : String(err)}`);
	return null;
});

if (result?.success) {
	const out = result.outputs[0];
	const txt = await out.text();
	console.log(`[plugin-test] build OK ${out.path} ${txt.length} bytes`);
	console.log(
		`[plugin-test] embedded HTML excerpt: ${txt.match(/<title>[^<]+<\/title>/i)?.[0] ?? "no <title>"}`,
	);
} else if (result) {
	console.log(`[plugin-test] build failed: ${result.logs.length} logs`);
	for (const log of result.logs) console.log(`  - ${log}`);
}
