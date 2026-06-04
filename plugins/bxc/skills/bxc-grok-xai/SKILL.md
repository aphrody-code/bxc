---
name: bxc Grok xAI High-Level Client
description: This skill should be used for anything involving @aphrody/xai (high-level Chat.createChat/append/sample/stream/executeToolCalls/sampleStructured), XTools for native X fulfillment, SuperGrok / OIDC keyless (SUPER_GROK_TOKEN or ~/.grok/auth.json), reasoning_effort, structured outputs, tool calling loops with real @aphrody/x XClient, or porting Python xai-sdk patterns to Bun/TS while staying 100% fetch + OpenAI-compatible.
version: 0.1.0
---

# @aphrody/xai — High-Level Grok Client (Bun native, keyless)

OpenAI-compatible client for api.x.ai/v1 with a fluent stateful Chat API inspired by the official Python xai-sdk, plus first-class support for native X tool calling via the sibling @aphrody/x package.

## Auth (keyless first)
Resolution (in resolveAuth):
1. Explicit bearer
2. XAI_API_KEY (metered xai-...)
3. SUPER_GROK_TOKEN / GROK_SUPER_TOKEN env (preferred for gratuite)
4. ~/.grok/auth.json (from `grok login`, OIDC JWT) → treated as supergrok mode if not xai- key

Non-`xai-` tokens → "supergrok" / "grok_oidc" mode. Full compatibility for agent flows without billing.

## High-Level API (the main thing)
```ts
const grok = new XaiClient();
const chat = grok.createChat("grok-3", { 
  messages: [system("You are helpful.")],
  tools: xNativeTools,           // from @aphrody/xai
  reasoning_effort: "high",
  response_format: { type: "json_object" }
});
chat.append(user("..."));
const res = await chat.sample();
const n = await chat.executeToolCalls({ x_search: (a) => xTools.search(a), ... });
const stream = chat.stream(); // yields {content, toolCallDeltas, toolCalls, done, response?}
const structured = await chat.sampleStructured(schema?);
```

`executeToolCalls(handlersOrXToolsInstance)` auto-dispatches or uses provided map. Appends `role: "tool"` messages automatically.

XTools class (in tools/x.ts) wraps a real or mocked XClient from @aphrody/x. Constructor accepts optional prebuilt client for unit tests.

`xNativeTools` array of tool defs ready to pass to createChat.

## Integration with native X (@aphrody/x)
Grok can emit x_search / x_profile / x_whoami / x_tweets / x_news tool_calls.
Fulfillment is done locally with cookie-stealth XClient + local SQLite + optional local For-You ranking (no external Twitter API, no extra keys).

See packages/xai/examples/grok-x-agent.ts for a complete runnable loop.

## Low-level still supported
client.chat(), client.stream(), listModels(), etc. for when you need raw control.

## Testing
All new high-level features have unit tests (no live) in packages/xai/index.test.ts :
- stream yields content + toolCallDeltas + done
- executeToolCalls + full auto-dispatch loop with XTools
- sampleStructured
- error propagation
- param forwarding (reasoning_effort etc.)
- XTools with injectable mock client

Run with `bun test packages/xai/index.test.ts packages/x/index.test.ts`

## Common Pitfalls
- Dynamic zod for structured (only if zod is present at runtime in the project)
- Tool args arrive as JSON strings sometimes — parse defensively
- Stream tool_calls deltas accumulate by index
- For production agents, prefer XTools + native X over legacy search_parameters

Load bxc-x-client and bxc-mcp-server skills when touching the other side of the integration.
