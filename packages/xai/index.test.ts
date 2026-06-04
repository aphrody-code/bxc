// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveAuth, XaiClient } from "./src/index.ts";

const runLive = process.env.BXC_TEST_LIVE_GROK === "1" || process.env.BXC_TEST_LIVE === "1";

describe("@aphrody/xai", () => {
  test("resolveAuth prefers explicit bearer", () => {
    const a = resolveAuth("xai-test-key");
    expect(a.mode).toBe("api_key");
    expect(a.bearer).toBe("xai-test-key");
  });

  test("resolveAuth supports SUPER_GROK_TOKEN as supergrok mode", () => {
    const origSuper = process.env.SUPER_GROK_TOKEN;
    const origGrokSuper = process.env.GROK_SUPER_TOKEN;
    const origXai = process.env.XAI_API_KEY;
    try {
      // explicit non-xai is supergrok (gratuite / keyless)
      const b = resolveAuth("sgk-my-super-token");
      expect(b.mode).toBe("supergrok");
      expect(b.bearer).toBe("sgk-my-super-token");

      // env SUPER_GROK_TOKEN (full gratuite compat, no file needed) — must override XAI if present in env
      delete process.env.XAI_API_KEY;
      process.env.SUPER_GROK_TOKEN = "sgk-env-123";
      delete process.env.GROK_SUPER_TOKEN;
      const c = resolveAuth(undefined);
      expect(c.mode).toBe("supergrok");
      expect(c.bearer).toBe("sgk-env-123");
      expect(c.source).toContain("SUPER_GROK_TOKEN");

      // GROK_SUPER_TOKEN alias too
      process.env.SUPER_GROK_TOKEN = "";
      process.env.GROK_SUPER_TOKEN = "sgk-alias-xyz";
      const d = resolveAuth();
      expect(d.mode).toBe("supergrok");
      expect(d.bearer).toBe("sgk-alias-xyz");
    } finally {
      process.env.SUPER_GROK_TOKEN = origSuper;
      process.env.GROK_SUPER_TOKEN = origGrokSuper;
      process.env.XAI_API_KEY = origXai;
    }
  });

  test.skipIf(!runLive)("listModels live (opt-in: BXC_TEST_LIVE_GROK=1)", async () => {
    const client = new XaiClient();
    const models = await client.listModels();
    expect(models.data.length).toBeGreaterThan(0);
    expect(models.data[0]?.id).toBeTruthy();
  });

  test.skipIf(!runLive)("chat smoke (opt-in: BXC_TEST_LIVE_GROK=1)", async () => {
    const client = new XaiClient();
    const text = await client.complete("Reply with exactly: OK", "grok-3-mini", 8);
    expect(text.toUpperCase()).toContain("OK");
  });

  // New unit tests for high-level Chat API (no network)
  test("createChat + append + getMessages (unit)", () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    const chat = client.createChat("grok-3-mini", {
      messages: [{ role: "system", content: "Be brief" }],
    });
    chat.append("Hello");
    const msgs = chat.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[1].role).toBe("user");
  });

  test("Chat append with assistant response object", () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    const chat = client.createChat("grok-3-mini");
    chat.append({ role: "assistant", content: "Hi there" });
    expect(chat.getMessages()[0].content).toBe("Hi there");
  });

  test("XTools instantiation (no auth needed for ctor)", async () => {
    const { XTools, xSearchToolDef } = await import("./src/index.ts");
    const tools = new XTools("auth_token=fake; ct0=fake"); // fake for ctor
    expect(tools).toBeTruthy();
    expect(xSearchToolDef.function.name).toBe("x_search");
  });

  test("XTools exposes more X actions (tweets, news, whoami) + defs (unit)", async () => {
    const mod = await import("./src/index.ts");
    expect(mod.xWhoamiToolDef.function.name).toBe("x_whoami");
    expect(mod.xTweetsToolDef.function.name).toBe("x_tweets");
    expect(mod.xNewsToolDef.function.name).toBe("x_news");
    const tools = new mod.XTools("auth_token=fake; ct0=fake");
    expect(typeof tools.whoami).toBe("function");
    expect(typeof tools.tweets).toBe("function");
    expect(typeof tools.news).toBe("function");
    // do not invoke (would hit X network); shape is sufficient for unit
  });

  test("XTools methods with injectable mock client (unit)", async () => {
    const mod = await import("./src/index.ts");

    let calls: string[] = [];
    const mockClient = {
      whoami: async () => { calls.push('whoami'); return { id: '1', screen_name: 'test' }; },
      userByScreenName: async (h: string) => { calls.push('userByScreenName:' + h); return { id: 'u1', screen_name: h, name: 'Test' }; },
      userTweets: async (id: string, c: number) => { calls.push('userTweets:' + id); return { tweets: [{ id: 't1', text: 'hi' }] }; },
      getNews: async (c: number) => { calls.push('getNews'); return [{ headline: 'news1' }]; },
      search: async (q: string) => { calls.push('search:' + q); return { tweets: [] }; },
    } as any;

    const tools = new mod.XTools(mockClient);
    await tools.whoami();
    await tools.profile({ handle: 'foo' });
    await tools.tweets({ handle: 'bar' });
    await tools.news({ count: 5 });
    await tools.search({ query: 'test' });

    expect(calls).toContain('whoami');
    expect(calls).toContain('userByScreenName:foo');
    expect(calls).toContain('userTweets:u1');
    expect(calls).toContain('getNews');
    expect(calls).toContain('search:test');
  });



  // Tool calling simulation (unit, no network, no live API)
  test("tool calling simulation via append (unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    const { xSearchToolDef } = await import("./src/index.ts");
    const chat = client.createChat("grok-3-mini", { tools: [xSearchToolDef] });
    chat.append("What is latest on bxc?");
    // simulate Grok deciding to call tool (as returned by sample() normally)
    chat.append({
      role: "assistant",
      content: null as any,
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: { name: "x_search", arguments: JSON.stringify({ query: "bxc", count: 5 }) },
        },
      ],
    });
    let msgs = chat.getMessages();
    expect(msgs.length).toBe(2); // user + assistant-tool
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].tool_calls?.[0]?.id).toBe("call_abc123");

    // simulate feeding tool result back (agent code would call XTools.search then append)
    chat.append({
      role: "tool",
      tool_call_id: "call_abc123",
      content: JSON.stringify({ tweets: [{ id: "1", text: "bxc rocks" }] }),
    });
    msgs = chat.getMessages();
    expect(msgs.length).toBe(3);
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].tool_call_id).toBe("call_abc123");
  });

  // Structured output basic (simulation via monkey-patch of chat, no net/live)
  test("structured output basic + sampleStructured (simulated unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    // Patch low-level chat to return fake JSON content response (simulates xAI structured)
    (client as any).chat = async (req: any) => {
      // echo that we received the format
      return {
        id: "cmpl-sim",
        object: "chat.completion",
        created: Date.now(),
        model: req.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ status: "ok", value: 42, from: "structured" }),
            },
            finish_reason: "stop",
          },
        ],
      };
    };

    const chat = client.createChat("grok-3-mini", {
      response_format: { type: "json_object" },
    });
    chat.append("return json {status, value}");

    const res = await chat.sampleStructured<{ status: string; value: number }>();
    expect(res.choices[0].message.content).toContain("ok");
    expect(res.parsed).toEqual({ status: "ok", value: 42, from: "structured" });

    // also test with explicit zod-like (duck) without actual zod dep required
    const duckZod = {
      parse: (j: any) => ({ ...j, validated: true }),
    };
    const res2 = await chat.sampleStructured(duckZod); // note: reuses patched, appends again internally
    expect((res2 as any).parsed?.validated).toBe(true);
  });

  test("executeToolCalls with XTools simulation (unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    const { XTools, xSearchToolDef } = await import("./src/index.ts");

    // mock XTools
    const mockX = {
      search: async (a: any) => ({ tweets: [{ id: "x1", text: "result for " + a.query }] }),
    } as any;

    const chat = client.createChat("grok-3-mini", { tools: [xSearchToolDef] });
    chat.append("search x for bxc");
    chat.append({
      role: "assistant",
      content: null as any,
      tool_calls: [{ id: "call1", type: "function", function: { name: "x_search", arguments: JSON.stringify({ query: "bxc" }) } }],
    } as any);

    const executed = await chat.executeToolCalls({
      x_search: (a) => mockX.search(a),
    });
    expect(executed).toBe(1);

    const msgs = chat.getMessages();
    expect(msgs.length).toBe(3);
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].content).toContain("result for bxc");
  });

  test("XaiClient low-level methods mocked (unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });

    // mock
    (client as any).get = async () => ({ data: [{ id: "grok-3" }] });
    (client as any).post = async (_p: string, body: any) => ({ choices: [{ message: { content: "mock " + body.model } }] });

    const models = await client.listModels();
    expect(models.data[0].id).toBe("grok-3");

    const chatRes = await client.chat({ model: "grok-3-mini", messages: [{ role: "user", content: "hi" }] } as any);
    expect((chatRes as any).choices[0].message.content).toContain("grok-3-mini");
  });

  // Cross-package synergy: x (native X) + xai (Grok) for agentic flows
  test("x + xai synergy import and basic usage (unit, no net)", async () => {
    const xPkg = await import("@aphrody/x");
    const xaiPkg = await import("./src/index.ts");

    expect(typeof xPkg.rankPosts).toBe("function");
    expect(typeof xaiPkg.XTools).toBe("function");
    expect(Array.isArray(xaiPkg.xNativeTools)).toBe(true);
    expect(xaiPkg.xNativeTools.length).toBeGreaterThan(0);

    // can construct XTools (uses x under) and pass to xai Chat tools
    const tools = new xaiPkg.XTools("auth_token=fake;ct0=fake");
    const chat = new (await import("./src/core/client.ts")).XaiClient({ bearer: "sgk" }).createChat("grok-3-mini", {
      tools: xaiPkg.xNativeTools as any,
    });
    expect(chat).toBeTruthy();
    // execute would use XTools internally in real agent
  });

  test("Chat.stream() yields content, toolCallDeltas, done (unit, mocked)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });

    // Create a mock SSE stream for deltas + tool call + done
    const encoder = new TextEncoder();
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call1","type":"function","function":{"name":"x_search","arguments":"{\\"query\\":\\"bxc\\"}"}}]},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"index":0,"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    (client as any).chat = async (req: any) => {
      if (req.stream) return stream;
      throw new Error("not stream");
    };

    const chat = client.createChat("grok-3-mini", { tools: [{type:"function", function:{name:"x_search"}}] as any });
    chat.append("search bxc");

    const yields: any[] = [];
    for await (const y of chat.stream()) {
      yields.push(y);
    }

    expect(yields.some(y => y.content === "Hello")).toBe(true);
    expect(yields.some(y => y.content === " world")).toBe(true);
    expect(yields.some(y => Array.isArray(y.toolCallDeltas))).toBe(true);
    const doneYield = yields.find(y => y.done);
    expect(doneYield).toBeTruthy();
    expect(doneYield.response).toBeTruthy();
  });

  test("Chat error handling (unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });

    // Simulate XaiError
    (client as any).chat = async () => {
      const err = new (await import("./src/core/client.ts")).XaiError("bad req", 400, "error body");
      throw err;
    };

    const chat = client.createChat("grok-3-mini");
    chat.append("hi");
    await expect(chat.sample()).rejects.toThrow(/bad req/);

    // Bad stream start
    (client as any).chat = async (req: any) => {
      if (req.stream) {
        throw new Error("stream fail");
      }
      return {};
    };
    const chat2 = client.createChat("grok-3-mini");
    chat2.append("hi");
    const gen = chat2.stream();
    await expect(gen.next()).rejects.toThrow(/stream fail/);
  });

  test("createChat forwards extra params like reasoning_effort (unit)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    let capturedReq: any = null;
    (client as any).chat = async (req: any) => {
      capturedReq = req;
      return { choices: [{ message: { content: "ok" } }] };
    };

    const chat = client.createChat("grok-3-mini", {
      reasoning_effort: "high",
      search_parameters: { mode: "auto" },
    });
    chat.append("test");
    await chat.sample();

    expect(capturedReq.reasoning_effort).toBe("high");
    expect(capturedReq.search_parameters).toEqual({ mode: "auto" });
  });

  test("full tool calling loop with XTools (unit, auto-dispatch simulation)", async () => {
    const client = new XaiClient({ bearer: "sgk-test" });
    const { XTools, xSearchToolDef } = await import("./src/index.ts");

    // Create a mock XClient that the XTools will use
    let searchCalledWith: any = null;
    const mockXClient = {
      search: async (query: string, count = 10) => {
        searchCalledWith = { query, count };
        return {
          tweets: [
            { id: "t1", text: `Result about ${query}`, author: { username: "test" }, created_at: "now", like_count: 10, retweet_count: 1 }
          ]
        };
      },
    } as any;

    const xtools = new XTools(mockXClient);  // injectable for test

    // Patch client.chat to simulate Grok returning a tool call first, then final answer
    let callCount = 0;
    (client as any).chat = async (req: any) => {
      callCount++;
      if (callCount === 1) {
        // First response: tool call
        return {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_x1",
                type: "function",
                function: { name: "x_search", arguments: JSON.stringify({ query: "bxc", count: 3 }) }
              }]
            },
            finish_reason: "tool_calls"
          }]
        };
      } else {
        // Second: final
        return {
          choices: [{
            message: {
              role: "assistant",
              content: "Based on X search: bxc is cool."
            },
            finish_reason: "stop"
          }]
        };
      }
    };

    const chat = client.createChat("grok-3-mini", { tools: [xSearchToolDef] });
    chat.append("what's new on bxc?");

    const res1 = await chat.sample();
    expect(res1.choices[0].message.tool_calls).toBeTruthy();

    // Auto dispatch using XTools for x_ tools
    const executed = await chat.executeToolCalls({
      x_search: (args) => xtools.search(args),
    });
    expect(executed).toBe(1);
    expect(searchCalledWith).toEqual({ query: "bxc", count: 3 });

    const res2 = await chat.sample();
    expect(res2.choices[0].message.content).toContain("bxc is cool");
  });
});