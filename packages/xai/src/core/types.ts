// SPDX-License-Identifier: Apache-2.0

export type AuthMode = "grok_oidc" | "api_key" | "supergrok";

export interface GrokAuthEntry {
  key: string;
  auth_mode?: string;
  email?: string;
  user_id?: string;
  expires_at?: string;
  refresh_token?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessageContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  top_p?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  /** xAI / Grok Python SDK compat: controls reasoning depth on supported models (e.g. grok-4 variants). */
  reasoning_effort?: "low" | "medium" | "high" | (string & {});
  /** Legacy/compat search control (prefer tools like web_search or x_search for agentic). Kept for parity with xai-sdk-python. */
  search_parameters?: Record<string, unknown>;
  /** Structured outputs: OpenAI/xAI style. Use { type: "json_object" } or { type: "json_schema", json_schema: { name, schema, strict? } }. */
  response_format?: unknown;
  parallel_tool_calls?: boolean;
  // Additional future-proof fields accepted by the wire (passthrough via ...params)
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface ModelsListResponse {
  data: ModelInfo[];
  object?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
    // xAI may return reasoning traces or other under these for structured/reasoning models
    reasoning_content?: string;
    [key: string]: unknown;
  };
  finish_reason?: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TtsRequest {
  model?: string;
  input: string;
  voice?: string;
  response_format?: string;
}

export interface SttRequest {
  model?: string;
  file: Blob | Buffer | Bun.BunFile;
  language?: string;
}

// Convenience message creators (inspired by xai-sdk-python chat helpers)
export const system = (content: string): ChatMessage => ({ role: "system", content });
export const user = (content: string | MessageContentPart[]): ChatMessage => ({ role: "user", content: Array.isArray(content) ? content : content });
export const assistant = (content: string): ChatMessage => ({ role: "assistant", content });

/** Richer message content for vision / tools. */
export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}