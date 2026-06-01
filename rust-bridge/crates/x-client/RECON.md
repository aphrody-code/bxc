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
