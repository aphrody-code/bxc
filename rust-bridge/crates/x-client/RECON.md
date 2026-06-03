<!-- SPDX-License-Identifier: Apache-2.0 -->
# X (Twitter) private web API — reconnaissance

Reverse-engineered surface map driving `aphrody-x-client`. Goal: drive the
full account headlessly (no browser) with cookie auth. Captured live from the
authenticated `x.com` client-web build on 2026-05-22.

## Frontend / backend stack

| Layer | Finding |
|---|---|
| Frontend | React + Redux SPA, Webpack bundles served from `abs.twimg.com/responsive-web/client-web/` (`main.<hash>.js`, `vendor.<hash>.js`, `i18n/en.<hash>.js`). |
| GraphQL operation descriptors | Consolidated **inside `main.js`** (no separate lazy endpoint chunks in this build) — so the extracted catalog is the *complete* operation set the client knows. |
| API gateway | GraphQL: `https://x.com/i/api/graphql/{queryId}/{OperationName}`. REST legacy: `https://x.com/i/api/1.1/...`. Some `…/2/…` (OAuth, etc.). |
| Auth | Public web Bearer (static) + cookie `auth_token` + `ct0`, with `x-csrf-token: <ct0>`, `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`. |

## X Premium / Blue Verified (2026-06)

| Surface | Detail |
|---|---|
| Hub URL | `https://x.com/i/premium` |
| Primary GraphQL | **Upsells** (`viewer_v2.upsell_config_for_surfaces`) — no `PremiumHub*` op in catalog |
| Payments | `pay.x.com`, `money.x.com`, `payments-*.x.com` (Plaid/Stripe/Adyen per CSP) |
| SKUs | `BlueVerified`, `BlueVerifiedPlus`, `PremiumBasic`, … (client enum) |
| CLI | `x-cli premium` / `x-cli premium --raw` |
| TS twin | `@aphrody/x` → `packages/x/docs/PREMIUM.md`, `scripts/x-premium-recon.ts` |

Full bxc recon artifacts: `~/bxc/storage/premium-recon/PREMIUM_RECON.json`.

## Coverage tooling (bxc + x-client)

```bash
bun run scripts/sync-x-catalog.ts          # TS + Rust catalog queryIds
cargo run -p x-client -- catalog --sync    # Rust-only catalog refresh
cargo run -p x-client -- coverage --probe-premium
cd packages/x && bun run coverage -- --probe
```

See `packages/x/docs/COVERAGE.md`.

## Operation catalog

- **158 operations** total: **94 queries**, **64 mutations**. Full machine-readable
  map in [`data/x-graphql-catalog.json`](data/x-graphql-catalog.json):
  `{ operationName: { queryId, operationType, featureSwitches[] } }`.
- Embedded into the binary via `src/catalog.rs` (`include_str!`), looked up at
  runtime so a queryId rotation only needs a catalog refresh, not a recompile.

### Core action mutations (live queryIds, 2026-05-22)

| Operation | queryId | Notes |
|---|---|---|
| CreateTweet | `H-t2v_HvFR07ZBP9aOeKoA` | post / reply / quote |
| CreateNoteTweet | `yeInFtqpUoABoBE_YWPYgA` | long-form (>280) |
| DeleteTweet | `nxpZCY2K-I6QoFHAHeojFQ` | |
| FavoriteTweet / UnfavoriteTweet | `lI07N6Otwv1PhnEgXILM7A` / `ZYKSe-w7KEslx3JhSIk5LA` | like / unlike |
| CreateRetweet / DeleteRetweet | `mbRO74GrOvSfRcJnlMapnQ` / `ZyZigVsNiFO6v1dEks1eWg` | |
| CreateBookmark / DeleteBookmark | `aoDbu3RHznuiSkQ9aNM67Q` / `Wlmlj2-xzyS1GN3a6cj-mQ` | |
| PinTweet / UnpinTweet | `VIHsNu89pK-kW35JpHq7Xw` / `BhKei844ypCyLYCg0nwigw` | |
| (queries) UserByScreenName / HomeTimeline | `IGgvgiOx4QZndDHuD3x9TQ` / `Ly0idwoXvMotg0ArhGnnow` | |

Lists, communities, highlights, moderation, downvote, NSFW/DM filters, etc. are
all present in the catalog.

## REST v1.1 (cookie-auth, not GraphQL)

`friendships/create|destroy.json` (follow/unfollow), `blocks/create|destroy.json`,
`mutes/users/create|destroy.json`, `favorites/create.json`, `dm/new2.json`
(direct messages). Path templates are built client-side; the descriptors above
are stable and standard.

## Rate limiting — the honest part

X enforces **server-side, per-account** limits (e.g. error **344** "daily limit
for sending Tweets/messages"). These cannot be bypassed by any client; the
framework instead:

1. Captures `x-rate-limit-limit` / `-remaining` / `-reset` from every response.
2. Offers an opt-in waiting invoker that sleeps until `reset` when a *soft*
   per-window limit is hit (bounded by a max-wait), so scripts queue instead of
   hard-failing.
3. Hard account caps (344) surface cleanly via `XError::Api { code, message }`.

## `x-client-transaction-id`

X progressively enforces a per-request transaction id derived from an animation
SVG + a verification key in the page. Empirically **not required** for this
account's GraphQL calls (live `CreateTweet` returned 344, never 353). Reference
algorithm: `isarabjitdhiman/xclienttransaction`. Tracked as a best-effort
follow-up; the framework works without it today.

## X Pro / Gryphon Decks (2026-06-03)

| Surface | Detail |
|---|---|
| Host | `https://pro.x.com` (TweetDeck successor) |
| Deck URL | `https://pro.x.com/i/decks/{deckId}` |
| Frontend | Gryphon SPA — `abs.twimg.com/gryphon-client/client-web/main.a4ab919a.js` |
| GraphQL host | **`https://x.com/i/api/graphql/`** (same cookie auth as x.com; not pro.x.com) |
| Primary read | **ViewerAccountSync** (`zg67ZFVLUH0OWGwDZjhc0A`) — decks, columns, client config |
| Deck CRUD | CreateDeck, UpdateDeck, RemoveDeck, ReorderDecks |
| Column CRUD | CreateColumn, UpdateColumn, RemoveColumn, ReorderColumns |
| Import / onboarding | GryphonImportClientSyncColumns, GryphonDeleteAccountSync, UpdateGryphonOnboardingState |
| Column feeds | GenericTimelineById, HomeTimeline, SearchTimeline, … (shared catalog) |
| Entitlement | **Premium+** (`premium_plus` / `BlueVerifiedPlus` SKU in bundle) |
| Rust module | `x_pro_deck` (proposed) |
| TS service | `XProDeckService` (proposed) |
| Docs | `packages/x/docs/X_PRO.md` |
| Artifacts | `~/bxc/storage/x-pro-recon/` — `recon.json`, `bundle-scan.json`, `graphql-ops.json`, `graphql-probe.json`, `pro-deck.har` |

Gryphon operations are **not** in `data/x-graphql-catalog.json` (responsive-web only). Sync from Gryphon `main.*.js` or maintain a Gryphon overlay catalog before exposing `x-cli pro` helpers.
