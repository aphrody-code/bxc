import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LlmClient } from "../src/client.ts";
import { extractStructured } from "../src/extract.ts";

const HTML = `<!doctype html><html><head><title>Bunlight benchmarks</title></head>
<body><h1>Bunlight v0.1.0</h1>
<p>Author: aphrody-code</p>
<p>Runtime: Bun 1.3.14</p>
<a href="https://example.com/docs">Docs</a></body></html>`;

describe("extractStructured", () => {
	test("returns object matching schema", async () => {
		const client = new LlmClient();
		if (!(await client.health())) {
			console.warn("[skip] gemma server not running");
			return;
		}
		const schema = z.object({
			title: z.string(),
			version: z.string(),
			author: z.string(),
		});
		const out = await extractStructured(HTML, {
			schema,
			client,
			maxOutputTokens: 120,
		});
		expect(out.title.length).toBeGreaterThan(0);
		expect(out.version).toMatch(/0\.1\.0/);
	}, 60_000);
});
