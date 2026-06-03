// SPDX-License-Identifier: Apache-2.0

export { XaiClient, XaiError, type XaiClientOptions } from "./core/client.ts";
export {
  resolveAuth,
  loadGrokAuthFile,
  XAI_API_BASE,
  type ResolvedAuth,
} from "./core/session.ts";
export type {
  AuthMode,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ModelInfo,
  ModelsListResponse,
  TtsRequest,
} from "./core/types.ts";