// SPDX-License-Identifier: Apache-2.0

export { XaiClient, XaiError, Chat, type XaiClientOptions } from "./core/client.ts";
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
  MessageContentPart,
  Tool,
  ToolCall,
  ModelInfo,
  ModelsListResponse,
  TtsRequest,
} from "./core/types.ts";

export { system, user, assistant } from "./core/types.ts";

import {
  XTools,
  xSearchToolDef,
  xProfileToolDef,
  xWhoamiToolDef,
  xTweetsToolDef,
  xNewsToolDef,
  // types for tool arg builders if users want typed calls
  type XSearchToolArgs,
  type XProfileToolArgs,
  type XTweetsToolArgs,
  type XNewsToolArgs,
} from "./tools/x.ts";

export {
  XTools,
  xSearchToolDef,
  xProfileToolDef,
  xWhoamiToolDef,
  xTweetsToolDef,
  xNewsToolDef,
  type XSearchToolArgs,
  type XProfileToolArgs,
  type XTweetsToolArgs,
  type XNewsToolArgs,
};

/** Ready-to-use array of X tool definitions for Grok tool-calling (native @aphrody/x backed). */
export const xNativeTools = [
  xSearchToolDef,
  xProfileToolDef,
  xNewsToolDef,
  xTweetsToolDef,
  xWhoamiToolDef,
] as const;