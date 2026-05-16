import { describe, expect, test } from "bun:test";
import { LlmClient } from "../src/client.ts";

describe("LlmClient", () => {
	test("health returns true when server is up", async () => {
		const client = new LlmClient();
		const healthy = await client.health();
		if (!healthy) {
			console.warn("[skip] gemma server not running on 127.0.0.1:8080");
			return;
		}
		expect(healthy).toBe(true);
	});

	test("chat returns a non-empty assistant message", async () => {
		const client = new LlmClient();
		if (!(await client.health())) return;
		const res = await client.chat(
			[{ role: "user", content: "Réponds par OK." }],
			{ maxTokens: 16 },
		);
		expect(res.choices[0]?.message.content.length).toBeGreaterThan(0);
		expect(res.usage.total_tokens).toBeGreaterThan(0);
	}, 30_000);
});
