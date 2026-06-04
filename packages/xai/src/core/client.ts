// SPDX-License-Identifier: Apache-2.0
import { resolveAuth, XAI_API_BASE, type ResolvedAuth } from "./session.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ModelsListResponse,
  Tool,
  ToolCall,
  TtsRequest,
} from "./types.ts";
import { XTools } from "../tools/x.ts";

export class XaiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "XaiError";
  }
}

export interface XaiClientOptions {
  baseUrl?: string;
  bearer?: string;
  timeoutMs?: number;
}

export class XaiClient {
  public readonly auth: ResolvedAuth;
  public readonly baseUrl: string;
  public readonly timeoutMs: number;

  constructor(options: XaiClientOptions = {}) {
    this.auth = resolveAuth(options.bearer);
    this.baseUrl = (options.baseUrl ?? XAI_API_BASE).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /** Account hint from Grok OIDC session (API key mode returns minimal info). */
  whoami(): {
    mode: ResolvedAuth["mode"];
    source: string;
    email?: string;
    user_id?: string;
    expires_at?: string;
  } {
    return {
      mode: this.auth.mode,
      source: this.auth.source,
      email: this.auth.email,
      user_id: this.auth.userId,
      expires_at: this.auth.expiresAt,
    };
  }

  async listModels(): Promise<ModelsListResponse> {
    return this.get<ModelsListResponse>("/models");
  }

  async chat(
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse | ReadableStream<Uint8Array>> {
    if (req.stream) {
      return this.stream("POST", "/chat/completions", req);
    }
    return this.post<ChatCompletionResponse>("/chat/completions", req);
  }

  /** One-shot user message helper. */
  async complete(
    prompt: string,
    model = "grok-3-mini",
    maxTokens = 1024,
  ): Promise<string> {
    const res = (await this.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    })) as ChatCompletionResponse;
    return res.choices[0]?.message?.content ?? "";
  }

  async tts(req: TtsRequest): Promise<ArrayBuffer> {
    const res = await this.request("POST", "/tts", {
      model: req.model ?? "eve",
      input: req.input,
      voice: req.voice,
      response_format: req.response_format ?? "mp3",
    });
    return res.arrayBuffer();
  }

  async stt(
    file: Blob | Buffer | Bun.BunFile,
    options: { model?: string; language?: string } = {},
  ): Promise<unknown> {
    const form = new FormData();
    let blob: Blob;
    if (file instanceof Blob) {
      blob = file;
    } else if (Buffer.isBuffer(file)) {
      blob = new Blob([new Uint8Array(file)]);
    } else {
      // Bun.BunFile (Blob-compatible au runtime : .arrayBuffer()).
      blob = new Blob([await (file as unknown as Blob).arrayBuffer()]);
    }
    form.append("file", blob, "audio.wav");
    if (options.model) form.append("model", options.model);
    if (options.language) form.append("language", options.language);
    return this.requestForm("POST", "/stt", form);
  }

  /** Generic OpenAI-compatible call (e.g. future xAI routes). */
  async raw<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.request(method, path.startsWith("/") ? path : `/${path}`, body);
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.auth.bearer}`,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url(path), {
        method,
        headers: this.headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new XaiError(
          `xAI ${method} ${path} → HTTP ${res.status}: ${errText.slice(0, 400)}`,
          res.status,
          errText,
        );
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestForm(
    method: string,
    path: string,
    form: FormData,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url(path), {
        method,
        headers: { Authorization: `Bearer ${this.auth.bearer}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new XaiError(
          `xAI ${method} ${path} → HTTP ${res.status}: ${errText.slice(0, 400)}`,
          res.status,
          errText,
        );
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.request("GET", path);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request("POST", path, body);
    return res.json() as Promise<T>;
  }

  private async stream(
    method: string,
    path: string,
    body: unknown,
  ): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new XaiError(
        `xAI stream ${path} → HTTP ${res.status}: ${errText.slice(0, 400)}`,
        res.status,
        errText,
      );
    }
    return res.body;
  }

  /**
   * Create a high-level fluent Chat session (multi-turn, append/sample/stream).
   * Fully native TS, uses the keyless SuperGrok/Grok OIDC bearer when available.
   *
   * Supports Python SDK parity options: reasoning_effort, search_parameters (legacy),
   * response_format for structured, etc. Passed through to wire.
   */
  createChat(
    model: string,
    options: {
      messages?: ChatMessage[];
      temperature?: number;
      tools?: Tool[];
      tool_choice?: any;
      max_tokens?: number;
      reasoning_effort?: string;
      search_parameters?: any;
      response_format?: any;
      parallel_tool_calls?: boolean;
      [k: string]: unknown;
    } = {},
  ): Chat {
    return new Chat(this, model, options.messages ?? [], options);
  }
}

/**
 * High-level fluent Chat session, inspired by xai-sdk-python's client.chat.create(...).append().sample().
 *
 * Supports multi-turn, tool calling (you provide tools + handle results yourself or use built-in),
 * streaming, and vision via content parts.
 *
 * Uses the underlying XaiClient (which supports keyless SuperGrok / Grok OIDC token from ~/.grok/auth.json
 * or explicit bearer, no paid XAI_API_KEY required for free/gratuite access).
 */
export class Chat {
  private messages: ChatMessage[] = [];
  private readonly model: string;
  private readonly client: XaiClient;
  private readonly params: Partial<ChatCompletionRequest>;
  /** Optional schema for basic structured output (zod instance with .parse, or fn, or truthy for json). */
  private structuredSchema: any = null;

  constructor(
    client: XaiClient,
    model: string,
    initialMessages: ChatMessage[] = [],
    extra: Partial<ChatCompletionRequest> = {},
  ) {
    this.client = client;
    this.model = model;
    this.messages = [...initialMessages];
    this.params = extra;
    // Support passing zod (or simple schema) via options for post-sample parsing
    const extraAny = extra as any;
    this.structuredSchema = extraAny.structuredSchema ?? extraAny.zodSchema ?? extraAny.response_format ?? null;
  }

  /** Append a message (string, ChatMessage, or assistant response from previous sample). Supports tool_calls. */
  append(message: string | ChatMessage | { role?: string; content?: string | null; tool_calls?: any }): this {
    if (typeof message === "string") {
      this.messages.push({ role: "user", content: message });
    } else if (message && typeof message === "object" && "role" in message && message.role) {
      this.messages.push(message as ChatMessage);
    } else if (message && typeof message === "object" && "content" in message) {
      // response-like or choice.message
      this.messages.push({
        role: "assistant",
        content: (message as any).content ?? "",
        tool_calls: (message as any).tool_calls,
      } as ChatMessage);
    }
    return this;
  }

  /** Get current messages (for inspection or serialization). */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** One-shot sample (non-streaming). Returns the full response. */
  async sample(): Promise<ChatCompletionResponse> {
    const req: ChatCompletionRequest = {
      model: this.model,
      messages: this.messages,
      ...this.params,
      stream: false,
    };
    let res: ChatCompletionResponse;
    try {
      res = (await this.client.chat(req)) as ChatCompletionResponse;
    } catch (err: any) {
      if (err instanceof XaiError) throw err;
      throw new XaiError(
        `Chat.sample failed: ${err?.message || err}`,
        err?.status ?? 0,
        err?.body,
      );
    }
    // Auto-append assistant message for multi-turn
    const choice = res.choices?.[0];
    if (choice?.message) {
      this.append({
        role: "assistant",
        content: choice.message.content ?? "",
        tool_calls: (choice.message as any).tool_calls,
      } as any);
    }
    return res;
  }

  /**
   * If the (most recent) assistant message has tool_calls, execute them using the provided impls
   * and append the tool results. Returns the number of tools executed.
   *
   * Robust: per-tool errors are caught (result = {error: msg}); continues remaining tools.
   * Auto-execute: for any "x_*" tool name (x_search, x_profile, x_whoami, x_tweets, x_news)
   * if no impl provided for it, auto-dispatches via XTools (uses passed XTools instance if first arg
   * is XTools or second param; else lazily creates one via default session load).
   * Pass explicit impls to override; empty call executeToolCalls() auto-uses XTools for x_* .
   */
  async executeToolCalls(
    impls: Record<string, (args: any) => Promise<any> | any> | XTools = {},
    autoXTools?: XTools,
  ): Promise<number> {
    // find most recent assistant that has pending tool_calls (robust to post-tool messages)
    let last: any = null;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.tool_calls?.length) {
        last = m;
        break;
      }
    }
    if (!last || !last.tool_calls?.length) return 0;

    // resolve impl map + auto XTools (supports passing XTools as first arg for auto)
    let implMap: Record<string, (args: any) => Promise<any> | any> = {};
    let xt: XTools | undefined = autoXTools;
    if (impls instanceof XTools || (impls && typeof (impls as any).search === "function")) {
      xt = impls as XTools;
    } else {
      implMap = impls as Record<string, (args: any) => Promise<any> | any>;
    }

    let executed = 0;
    for (const tc of last.tool_calls) {
      if (!tc || !tc.function || !tc.function.name || !tc.id) continue;
      const name = tc.function.name;
      let fn = implMap[name];
      if (!fn && name.startsWith("x_")) {
        if (!xt) {
          try {
            xt = new XTools();
          } catch {
            // no default session for auto X; caller must provide or pass impl; skip auto for this
          }
        }
        if (xt) {
          // map x_foo -> foo (special: x_whoami -> whoami)
          const mname = name === "x_whoami" ? "whoami" : name.slice(2);
          const meth = (xt as any)[mname];
          if (typeof meth === "function") {
            fn = (args: any) => meth.call(xt, args);
          }
        }
      }
      if (!fn) continue;
      let args: any = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      let result: any;
      try {
        result = await Promise.resolve(fn(args));
      } catch (e: any) {
        result = { error: e?.message || String(e) };
      }
      this.append({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
      executed++;
    }
    return executed;
  }

  /** Stream deltas. Yields chunks. Auto appends final on end if you consume fully. Supports tool_calls deltas. */
  async *stream(): AsyncGenerator<
    { content?: string; done: boolean; response?: ChatCompletionResponse; toolCallDeltas?: any[]; toolCalls?: ToolCall[] },
    void,
    unknown
  > {
    const req: ChatCompletionRequest = {
      model: this.model,
      messages: this.messages,
      ...this.params,
      stream: true,
    };
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = (await this.client.chat(req)) as ReadableStream<Uint8Array>;
    } catch (err: any) {
      if (err instanceof XaiError) throw err;
      throw new XaiError(
        `Chat.stream failed to start: ${err?.message || err}`,
        err?.status ?? 0,
        err?.body,
      );
    }
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalContent = "";
    let finalResponse: ChatCompletionResponse | undefined;
    // Accumulator for streamed tool_calls (args arrive in chunks, by index)
    const toolCallAccs: Record<number, { id?: string; type?: string; function: { name?: string; arguments: string } }> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            // append final assistant (content and/or tool_calls)
            const finalTcs: ToolCall[] = Object.keys(toolCallAccs)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => {
                const a = toolCallAccs[Number(k)];
                if (!a.id) return null;
                return {
                  id: a.id,
                  type: (a.type as any) || "function",
                  function: {
                    name: a.function.name || "",
                    arguments: a.function.arguments || "{}",
                  },
                };
              })
              .filter(Boolean) as ToolCall[];
            if (finalContent || finalTcs.length) {
              this.append({
                role: "assistant",
                content: finalContent || "",
                tool_calls: finalTcs.length ? finalTcs : undefined,
              } as any);
            }
            yield { content: "", done: true, response: finalResponse, toolCalls: finalTcs.length ? finalTcs : undefined };
            return;
          }
          try {
            const chunk = JSON.parse(data);
            if (chunk.error) {
              throw new XaiError(
                `xAI stream error: ${JSON.stringify(chunk.error)}`,
                500,
                JSON.stringify(chunk.error),
              );
            }
            const choiceDelta = chunk.choices?.[0]?.delta || {};
            const contentDelta = choiceDelta.content ?? "";
            if (contentDelta) {
              finalContent += contentDelta;
              yield { content: contentDelta, done: false };
            }
            const tcsDelta = choiceDelta.tool_calls;
            if (Array.isArray(tcsDelta) && tcsDelta.length) {
              for (const td of tcsDelta) {
                const idx = typeof td.index === "number" ? td.index : 0;
                if (!toolCallAccs[idx]) {
                  toolCallAccs[idx] = { function: { arguments: "" } };
                }
                const acc = toolCallAccs[idx];
                if (td.id) acc.id = td.id;
                if (td.type) acc.type = td.type;
                if (td.function?.name) acc.function.name = td.function.name;
                if (td.function?.arguments != null) acc.function.arguments += td.function.arguments;
              }
              yield { toolCallDeltas: tcsDelta, done: false };
            }
            if (chunk.choices?.[0]?.finish_reason) {
              finalResponse = chunk; // last chunk has usage etc sometimes
            }
          } catch (parseErr) {
            if (parseErr instanceof XaiError) throw parseErr;
            // ignore non-data noise; surface only real errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Sample + basic structured output support (production-grade for agents).
   * - If schema (zod with .parse, or fn) passed or set at createChat, attempts JSON.parse(content) + schema(json).
   * - Falls back to simple JSON if no zod-like.
   * - Always returns the raw res; parsed is attached if successful.
   * Uses dynamic import for zod if not bundled (keeps @aphrody/xai light, zod optional at runtime).
   */
  async sampleStructured<T = unknown>(schema?: any): Promise<ChatCompletionResponse & { parsed?: T }> {
    const res = await this.sample();
    const content = res.choices?.[0]?.message?.content;
    let parsed: T | undefined;
    let useSchema = schema ?? this.structuredSchema;

    if (content && useSchema) {
      try {
        const json = typeof content === "string" ? JSON.parse(content.trim()) : content;
        // If looks like zod (has parse), use directly. Else try dynamic load for conversion/validation.
        if (useSchema && typeof useSchema.parse === "function") {
          parsed = useSchema.parse(json);
        } else if (typeof useSchema === "function") {
          parsed = useSchema(json) as T;
        } else {
          // simple: treat as success if we got json
          parsed = json as T;
        }
      } catch {
        // structured parse failed; caller still has raw content in res
      }
    }
    // If no schema but response_format requested json, still try auto json parse as "simple"
    if (!parsed && content && (this.params as any)?.response_format) {
      try {
        const rf: any = (this.params as any).response_format;
        const wantsJson = (rf && (rf === "json_object" || rf?.type === "json_object" || rf?.type === "json_schema"));
        if (wantsJson && typeof content === "string") {
          parsed = JSON.parse(content.trim()) as T;
        }
      } catch {}
    }
    return Object.assign({}, res, { parsed }) as any;
  }
}

