// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";
import { GRYPHON_GRAPHQL_OPS } from "../config/x-pro-surface";

export interface XProDeckColumn {
  rest_id: string;
  pathname: string;
  width?: string;
  media_preview?: string;
  latest?: boolean;
  hide_header?: boolean;
}

export interface XProDeckConfig {
  title?: string;
  icon?: string;
  is_pinned?: boolean;
}

export interface XProDeck {
  rest_id: string;
  config?: XProDeckConfig;
  deck_columns_v2?: XProDeckColumn[];
}

export interface XProAccountSync {
  active_deck_id?: string;
  composer_expanded?: boolean;
  default_column_width?: string;
  default_media_preview?: string;
  navbar_expanded?: boolean;
}

export interface ViewerAccountSyncResult {
  decks: XProDeck[];
  accountsync_client_config?: XProAccountSync;
  accountsync_onboarding_state?: Record<string, unknown>;
  raw: unknown;
}

function dig<T = unknown>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T | undefined;
}

export function parseViewerAccountSync(json: unknown): ViewerAccountSyncResult {
  const viewer = dig<Record<string, unknown>>(json, ["data", "viewer_v2"]);
  const decks = (viewer?.decks as XProDeck[] | undefined) ?? [];
  return {
    decks,
    accountsync_client_config: viewer?.accountsync_client_config as
      | XProAccountSync
      | undefined,
    accountsync_onboarding_state: dig(json, [
      "data",
      "accountsync_onboarding_state",
    ]) as Record<string, unknown> | undefined,
    raw: json,
  };
}

export async function viewerAccountSync(
  client: XClient,
): Promise<ViewerAccountSyncResult> {
  const raw = await client.graphqlWaiting("ViewerAccountSync", {});
  return parseViewerAccountSync(raw);
}

export async function getDeck(
  client: XClient,
  deckId: string,
): Promise<XProDeck | null> {
  const sync = await viewerAccountSync(client);
  return sync.decks.find((d) => d.rest_id === deckId) ?? null;
}

export async function createDeck(
  client: XClient,
  name: string,
  columns: Array<{ pathname: string; width?: string }> = [],
): Promise<string | null> {
  const raw = await client.graphqlWaiting("CreateDeck", { name, columns });
  return dig<string>(raw, ["data", "deck_insert", "rest_id"]) ?? null;
}

export async function updateDeck(
  client: XClient,
  deckId: string,
  config: XProDeckConfig,
): Promise<unknown> {
  return client.graphqlWaiting("UpdateDeck", { deckId, config });
}

export async function removeDeck(
  client: XClient,
  deckId: string,
): Promise<unknown> {
  return client.graphqlWaiting("RemoveDeck", { deckId });
}

export async function reorderDecks(
  client: XClient,
  deckIds: string[],
): Promise<unknown> {
  return client.graphqlWaiting("ReorderDecks", { deckIds });
}

export async function createColumn(
  client: XClient,
  deckId: string,
  column: { pathname: string; width?: string; media_preview?: string },
): Promise<unknown> {
  return client.graphqlWaiting("CreateColumn", { deckId, column });
}

export async function updateColumn(
  client: XClient,
  deckId: string,
  columnId: string,
  column: Partial<XProDeckColumn>,
): Promise<unknown> {
  return client.graphqlWaiting("UpdateColumn", { deckId, columnId, column });
}

export async function removeColumn(
  client: XClient,
  deckId: string,
  columnId: string,
): Promise<unknown> {
  return client.graphqlWaiting("RemoveColumn", { deckId, columnId });
}

export async function reorderColumns(
  client: XClient,
  deckId: string,
  columnIds: string[],
): Promise<unknown> {
  return client.graphqlWaiting("ReorderColumns", { deckId, columnIds });
}

export async function importClientSyncColumns(client: XClient): Promise<unknown> {
  return client.graphqlWaiting("GryphonImportClientSyncColumns", {});
}

export async function probeXProAccess(client: XClient): Promise<{
  ok: boolean;
  deck_count: number;
  active_deck_id?: string;
  graphql_ops: readonly string[];
  error?: string;
}> {
  try {
    const sync = await viewerAccountSync(client);
    return {
      ok: true,
      deck_count: sync.decks.length,
      active_deck_id: sync.accountsync_client_config?.active_deck_id,
      graphql_ops: GRYPHON_GRAPHQL_OPS,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      deck_count: 0,
      graphql_ops: GRYPHON_GRAPHQL_OPS,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}