# @aphrody/xai

Headless **xAI Grok** client for Bun — OpenAI-compatible `https://api.x.ai/v1`.

**Table of Contents**

- [Auth (keyless / gratuite)](#auth-no-xai_api_key-required)
- [CLI (`bxc grok`)](#cli-bxc-grok)
- [High-level Library API (fluent Chat, Python SDK parity)](#library-high-level-fluent-chat-like-xai-sdk-python)
- [Native X + Grok Integration (XTools for agentic use)](#native-x--grok-integration)
- [Low-level API](#low-level-still-supported)
- [MCP Tools](#mcp)
- [Production-grade Notes](#production-grade-grok--native-x)

## Auth (no `XAI_API_KEY` required)

After `grok login`, Grok Build stores an OIDC JWT in `~/.grok/auth.json`. This package uses that token as `Authorization: Bearer …` (same as the Grok CLI).

Resolution order:

1. Explicit `bearer` option / `--bearer`
2. `XAI_API_KEY` environment variable (metered `xai-…` key)
3. `~/.grok/auth.json` → `key` field (OIDC)

**SuperGrok / free access (gratuite)**: set `SUPER_GROK_TOKEN` (or `GROK_SUPER_TOKEN`) env or use `~/.grok/auth.json` (from `grok login`). No paid `xai-` key needed. Full compatibility: explicit non-`xai-` bearer or SUPER_* env forces `supergrok` mode (preferred before falling back to auth file). The client detects non-`xai-` tokens as `supergrok` / `grok_oidc` mode. Use for agent flows without metered billing.

## CLI (`bxc grok`)

```bash
bxc grok whoami
bxc grok models
bxc grok chat "Hello"
bxc grok chat "Hi" --model grok-4 --stream
bxc grok tts "Hello" --output /tmp/out.mp3
bxc grok stt recording.wav
bxc grok raw GET /models
```

## Library (high-level fluent Chat like xai-sdk-python)

The high-level API provides a stateful `Chat` session for multi-turn conversations, tool calling, streaming, structured outputs, and reasoning — directly inspired by the Python xai-sdk.

```ts
import { XaiClient, system, user } from "@aphrody/xai"; // (add helpers if you want)

const client = new XaiClient(); // keyless via ~/.grok/auth.json (SuperGrok / Grok OIDC) or SUPER_GROK_TOKEN

// High-level multi-turn (append + sample/stream)
const chat = client.createChat("grok-3", {
  messages: [system("You are a helpful pirate.")],
});
chat.append(user("Hello!"));
const res = await chat.sample();
console.log(res.choices[0]?.message?.content);
chat.append(res); // continue conversation

// Streaming
for await (const { content, done } of chat.stream()) {
  if (!done) process.stdout.write(content);
}

// Advanced: reasoning, structured (zod or simple json), tool-calling (see Native X section below)
const chatAdv = client.createChat("grok-4", {
  reasoning_effort: "high",
  response_format: { type: "json_object" },
});
const structured = await chatAdv.sampleStructured(); // basic zod/.parse or json auto
console.log(structured.parsed);
```

See the full `Chat` API in the Quick Reference below and source `src/core/client.ts`. Tool-calling with native X fulfillment is shown in the "Native X + Grok integration" section.

## Native X + Grok integration

Analyse of our stack:
- `packages/x`: full native cookie-auth X/Twitter client (GraphQL + REST, queryId catalog sync, sqlite store, X Pro/Radar, media, archive, stealth profiles). Zero official API key.
- `packages/xai`: this package, now with high-level fluent Chat (create/append/sample/stream) + low-level OpenAI compat, using the same keyless SuperGrok token.

Use them together for agentic Grok: let Grok decide to call an `x_search` tool, then fulfill it with the native `XClient` from `@aphrody/x` (no extra keys, fully local/native).

Example tool handler (user code):
```ts
import { XClient } from "@aphrody/x";
const x = new XClient(session);
if (tool.name === "x_search") {
  const results = await x.search(args.query, args.count);
  // feed back as tool result to chat.append( tool_result(...) )
}
```

Using built-in XTools (recommended):
```ts
import { XaiClient, XTools, xSearchToolDef, xWhoamiToolDef, xTweetsToolDef, xNewsToolDef } from "@aphrody/xai";
const grok = new XaiClient();
const xTools = new XTools(); // reuses our native packages/x (cookie, store, stealth)

const chat = grok.createChat("grok-3", { tools: [xSearchToolDef, xWhoamiToolDef, xTweetsToolDef, xNewsToolDef] });
// after Grok returns a tool_call e.g. for x_tweets or x_news:
const toolRes = await xTools.tweets({ handle: "aphrody", count: 5 });
// or await xTools.news({count:3}); await xTools.whoami();
chat.append({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolRes) });
const final = await chat.sample();
```

XTools now covers key X actions for Grok agentic use (all use the native @aphrody/x XClient under the hood for zero extra keys, full stealth, and local SQLite state):

- `search({query, count?, mode?})`: Latest/Top search.
- `profile({handle})`: User profile.
- `whoami()`: Authenticated viewer.
- `tweets({handle, count?})`: User timeline.
- `news({count?})`: Explore/trending news.

**Testability**: XTools constructor accepts an optional pre-built (or mocked) XClient instance for unit testing without real network or auth:

```ts
const mockX = { search: async (q) => ({tweets: [...]}) /* etc */ };
const xTools = new XTools(mockX);
```

Corresponding tool defs (`xSearchToolDef`, etc.) and the `xNativeTools` array are exported for easy use in `createChat({ tools: xNativeTools })`.

See `src/tools/x.ts` for full signatures and simplified return shapes suitable for tool results.

Simple agent loop with native X tools:
```ts
const grok = new XaiClient();
const xTools = new XTools();
const chat = grok.createChat("grok-3", { tools: xNativeTools as any });

chat.append(user("What's the latest on bxc or xai on X?"));
let res = await chat.sample();

while (res.choices[0]?.message?.tool_calls?.length) {
  const n = await chat.executeToolCalls({
    x_search: (a) => xTools.search(a),
    x_profile: (a) => xTools.profile(a),
    x_whoami: () => xTools.whoami(),
    x_tweets: (a) => xTools.tweets(a),
    x_news: (a) => xTools.news(a),
  });
  if (n === 0) break;
  res = await chat.sample();
}
console.log(res.choices[0]?.message?.content);
```

## Low-level (still supported)

```ts
import { XaiClient } from "@aphrody/xai";

const client = new XaiClient();
const models = await client.listModels();
const reply = await client.complete("Explain Rust in one line", "grok-3-mini");
```

## MCP

- `bxc_grok_whoami`
- `bxc_grok_models`
- `bxc_grok_chat` (now also supports high-level via the package)

## API Quick Reference (high-level)

```ts
// Chat session
const chat = client.createChat(model, { messages?, tools?, reasoning_effort?, response_format?, ... });
chat.append(msgOrStringOrResponse);
const res = await chat.sample();
const stream = chat.stream(); // yields {content?, toolCallDeltas?, toolCalls?, done, response?}
const n = await chat.executeToolCalls({ toolName: (args) => impl(args) }); // returns #executed
const structured = await chat.sampleStructured<T>(schema?); // { ...res, parsed? }

// XTools (for Grok tool fulfillment or direct use)
const xTools = new XTools(sessionOrMockClient?);
await xTools.search({query, count?, mode?});
await xTools.profile({handle});
await xTools.whoami();
await xTools.tweets({handle, count?});
await xTools.news({count?});
```

See `src/core/client.ts` (Chat + XaiClient), `src/tools/x.ts` (XTools + all *ToolDef), `src/index.ts` (exports + `xNativeTools` array).

Runnable example: [packages/xai/examples/grok-x-agent.ts](examples/grok-x-agent.ts) (full agent loop with native X fulfillment).

## Production-grade Grok + native X

The combo `@aphrody/xai` (Chat + XTools) + `@aphrody/x` (XClient) enables fully keyless, native, agentic Grok flows inside bxc: Grok can call x_search / x_tweets / x_news / x_whoami / x_profile tools; fulfillment is done locally with stealth cookies + sqlite, results fed back as tool messages. Improved Chat error handling, reasoning_effort/search_params/response_format parity, and basic structured (zod-if-present or json simple) make it robust for autonomous agents. All verified unit-only (30 pass + 2 skip live, 32 total, no live API required by default).

See also: packages/x/docs/* (including the new top-level README.md), src/cli/{grok,x}.ts , MEGA-PLAN.md (shipped milestone for native clients), tests in `packages/*/index.test.ts`.

## Contributing & Notes

- Keep packages light (dynamic zod for structured if present at runtime).
- Prefer tools + XTools for agentic X access over legacy search_parameters.
- Update catalog/surfaces via the scripts in root bxc when X changes.
- Tests: `bun test packages/xai packages/x` (unit-only by default; live opt-in via env flags). Now includes comprehensive units for new high-level features: Chat (multi-turn, stream with toolCallDeltas, executeToolCalls, sampleStructured, error handling, param forwarding like reasoning_effort), XTools (instantiation, methods with injectable mocks, defs), tool calling sims, structured outputs, x + xai synergy, full agentic loop with auto-dispatch. 30 pass + 2 live-skipped (32 total across x+xai, 120 expect() calls).

See `index.test.ts` for details (all mocks, no live required for core coverage). Also `packages/x/index.test.ts` for algo + client units + cross synergy.