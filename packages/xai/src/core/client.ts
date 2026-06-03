// SPDX-License-Identifier: Apache-2.0
import { resolveAuth, XAI_API_BASE, type ResolvedAuth } from "./session.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelsListResponse,
  TtsRequest,
} from "./types.ts";

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
    const blob =
      file instanceof Blob
        ? file
        : new Blob([file instanceof Buffer ? file : await file.arrayBuffer()]);
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
}