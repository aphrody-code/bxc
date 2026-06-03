// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAuth, XaiClient } from "./src/index.ts";

const hasGrokAuth = existsSync(join(homedir(), ".grok", "auth.json"));
const hasApiKey = Boolean(process.env.XAI_API_KEY?.trim());

describe("@aphrody/xai", () => {
  test("resolveAuth prefers explicit bearer", () => {
    const a = resolveAuth("xai-test-key");
    expect(a.mode).toBe("api_key");
    expect(a.bearer).toBe("xai-test-key");
  });

  test.skipIf(!hasGrokAuth && !hasApiKey)("listModels live", async () => {
    const client = new XaiClient();
    const models = await client.listModels();
    expect(models.data.length).toBeGreaterThan(0);
    expect(models.data[0]?.id).toBeTruthy();
  });

  test.skipIf(!hasGrokAuth && !hasApiKey)("chat smoke", async () => {
    const client = new XaiClient();
    const text = await client.complete("Reply with exactly: OK", "grok-3-mini", 8);
    expect(text.toUpperCase()).toContain("OK");
  });
});