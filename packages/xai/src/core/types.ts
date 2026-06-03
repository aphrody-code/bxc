// SPDX-License-Identifier: Apache-2.0

export type AuthMode = "grok_oidc" | "api_key";

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
  content: string;
  name?: string;
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
  message: { role: string; content: string };
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