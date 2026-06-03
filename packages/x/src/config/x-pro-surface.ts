// SPDX-License-Identifier: Apache-2.0
/** X Pro (Gryphon / TweetDeck successor) — pro.x.com decks surface. */

export const X_PRO_HOST = "https://pro.x.com" as const;
export const X_PRO_DECK_URL = (deckId: string) =>
  `${X_PRO_HOST}/i/decks/${deckId}` as const;
export const X_PRO_DECKS_NEW = `${X_PRO_HOST}/i/decks/new` as const;
export const X_PRO_DECKS_MANAGE = `${X_PRO_HOST}/i/decks/manage` as const;

export const GRYPHON_BUNDLE_BASE =
  "https://abs.twimg.com/gryphon-client/client-web/" as const;

export const X_PRO_ROUTES = [
  "/i/decks",
  "/i/decks/new",
  "/i/decks/manage",
  "/i/columns/picker",
  "/i/columns/populate_deck",
  "/i/tweetdeck_release_notes",
] as const;

export const GRYPHON_GRAPHQL_OPS = [
  "ViewerAccountSync",
  "CreateDeck",
  "UpdateDeck",
  "RemoveDeck",
  "ReorderDecks",
  "CreateColumn",
  "UpdateColumn",
  "RemoveColumn",
  "ReorderColumns",
  "GryphonImportClientSyncColumns",
  "GryphonDeleteAccountSync",
  "UpdateGryphonOnboardingState",
] as const;

export const X_PRO_COLUMN_TIMELINE_OPS = [
  "GenericTimelineById",
  "HomeTimeline",
  "HomeLatestTimeline",
  "SearchTimeline",
  "PinnedTimelines",
] as const;

export const X_PRO_RECON_URLS = [
  "https://pro.x.com",
  "https://pro.x.com/i/decks/new",
  X_PRO_DECK_URL("1823398034933199077"),
] as const;