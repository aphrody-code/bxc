# X Pro (Gryphon / Decks) — API surface

Recon: `bxc detect/recon`, `scripts/x-pro-recon.ts`, live Gryphon bundle `main.a4ab919a.js` (2026-06-03).

## Primary URLs

| URL | Role |
| --- | --- |
| [https://pro.x.com](https://pro.x.com) | X Pro shell (Gryphon SPA) |
| [https://pro.x.com/i/decks/{deckId}](https://pro.x.com/i/decks/1823398034933199077) | Deep link to a deck |
| [https://pro.x.com/i/decks/new](https://pro.x.com/i/decks/new) | Create deck flow |
| [https://pro.x.com/i/decks/manage](https://pro.x.com/i/decks/manage) | Manage decks |
| [https://pro.x.com/i/columns/picker](https://pro.x.com/i/columns/picker) | Add column |

Auth cookies are scoped to **`.x.com`**; `pro.x.com` is a separate host but uses the same session.

## Stack

| Layer | Finding |
| --- | --- |
| Host | `pro.x.com` → Cloudflare → Express (`x-powered-by`) |
| Frontend | **Gryphon** client: `abs.twimg.com/gryphon-client/client-web/` (`main.a4ab919a.js`, `vendor.5e56224a.js`) |
| Main site | `x.com` uses `responsive-web/client-web/` — different bundle, shared GraphQL gateway |
| API gateway | `https://x.com/i/api/graphql/{queryId}/{OperationName}` (not `pro.x.com`) |
| State | Redux actions under `gryphon/decks/*`, `gryphon/columns/*`, `gryphon/accountsync/*` |

## GraphQL — Gryphon deck operations

These ops live in the **Gryphon** bundle catalog (not in the responsive-web `x-graphql-catalog.json` today). Add them via `sync-x-catalog` from Gryphon `main.*.js` or ship a `gryphon-graphql-catalog.json` overlay.

| Operation | queryId | Type | Variables (inferred + probed) |
| --- | --- | --- | --- |
| **ViewerAccountSync** | `zg67ZFVLUH0OWGwDZjhc0A` | query | `{}` — returns `viewer_v2.decks[]`, `accountsync_client_config`, onboarding |
| **CreateDeck** | `fVIC9NDfk0-Auids8FlqQQ` | mutation | `{ name, columns }` → `deck_insert.rest_id` |
| **UpdateDeck** | `XW307yOKJINBAvlwOnLteg` | mutation | `{ deckId, config }` — title, icon, pinned, sharing |
| **RemoveDeck** | `c20tuAQJznmUHtmOAvHLyA` | mutation | `{ deckId }` |
| **ReorderDecks** | `u2A0QRHa7bBRBhZZSmJKXQ` | mutation | `{ deckIds: string[] }` |
| **CreateColumn** | `O4iIdjZUiZpm0KBSiftNGQ` | mutation | `{ deckId, column }` |
| **UpdateColumn** | `suRGd49L2EZ0nuuU4he4aw` | mutation | `{ deckId, columnId, column }` |
| **RemoveColumn** | `lfB7GP4w9oCpx5F_BxwRkw` | mutation | `{ deckId, columnId }` |
| **ReorderColumns** | `JJpn5RKFDbYXC957QragBQ` | mutation | `{ deckId, columnIds: string[] }` |
| **GryphonImportClientSyncColumns** | `elhfTZAzxsCyjDZTlVitRw` | mutation | TweetDeck / legacy import |
| **GryphonDeleteAccountSync** | `DiJkSLAFULTIt7Z6ZnFhgQ` | mutation | Reset account sync |
| **UpdateGryphonOnboardingState** | `zCQ0LjxvX0Ky0br3nE__PA` | mutation | Onboarding flags |

### Column timelines (shared with x.com)

Columns reference `pathname` (e.g. `/home?mode=home_latest`, `/yoyo__goat`, list URLs). Feed data uses standard timeline ops:

| Operation | queryId | Use in Pro |
| --- | --- | --- |
| **GenericTimelineById** | `wv4VPj4oH-yFD3cuQC7Tbg` | Column timeline by id |
| **HomeTimeline** | `-M5P8LkjBRfeMF2MRJfbqA` | Home column |
| **HomeLatestTimeline** | `v8D8YuUcH9097nKOVvRPgA` | Latest home |
| **SearchTimeline** | `-TFXKoMnMTKdEXcCn-eahw` | Search columns |
| **PinnedTimelines** | `SnNm4YWv4Xu26VSx-MIYlw` | Pinned feeds |

## ViewerAccountSync response shape

```json
{
  "data": {
    "accountsync_onboarding_state": { "show_onboarding_tour": true, ... },
    "viewer_v2": {
      "accountsync_client_config": {
        "active_deck_id": "1823398034933199077",
        "composer_expanded": true,
        "default_column_width": "Medium",
        "default_media_preview": "Cropped",
        "navbar_expanded": true
      },
      "decks": [{
        "rest_id": "...",
        "config": { "title": "...", "icon": "⭐️", "is_pinned": true },
        "deck_columns_v2": [{
          "rest_id": "...",
          "pathname": "/home?mode=home_latest",
          "width": "Wide",
          "media_preview": "Cropped",
          "latest": true,
          "hide_header": true
        }]
      }]
    }
  }
}
```

## Auth

Same as x.com cookie GraphQL:

- Cookies: `auth_token` (httpOnly), `ct0` on **`.x.com`**
- Headers: `x-csrf-token: <ct0>`, `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`
- Static Bearer token (web client) on `authorization`

`pro.x.com` HTML preconnects `api.x.com`; all deck GraphQL hits **`x.com/i/api/graphql`**.

## Premium+ / X Pro entitlement

- Product SKU mapping in Gryphon bundle: `BlueVerifiedPlus` → **`premium_plus`** (highest consumer tier).
- Feature switches: `gryphon_client`, `gryphon_underground_enabled`, timeline polling overrides.
- Server-side enforcement: accounts without Premium+ typically cannot load Gryphon or get empty/error on `ViewerAccountSync` (verify per account).
- Legacy TweetDeck import: `GryphonImportClientSyncColumns`, routes `/i/tweetdeck_release_notes`.

See also [PREMIUM.md](./PREMIUM.md) for subscription purchase GraphQL (`Upsells`, `pay.x.com`).

## Implementation names

| Layer | Recommended name |
| --- | --- |
| Rust (`aphrody-x-client`) | `x_pro_deck` module — `viewer_account_sync()`, `create_deck()`, … |
| TypeScript (`@aphrody-code/x`) | `XProDeckService` — wraps Gryphon catalog + `ViewerAccountSync` |

## CLI / artifacts

```bash
cd ~/bxc && bxc detect https://pro.x.com/i/decks/1823398034933199077 --json
cd ~/bxc && bxc recon  https://pro.x.com/i/decks/1823398034933199077 --profile max --json
cd ~/bxc && bun run scripts/x-pro-recon.ts
cd ~/bxc && bxc har record https://pro.x.com/i/decks/1823398034933199077 ~/bxc/storage/x-pro-recon/pro-deck.har --profile max
```

Artifacts: `~/bxc/storage/x-pro-recon/` (also copied to `~/yoyo/data/x-pro-recon/summary.json`).

## npm / Rust twins

| Package | Use |
| --- | --- |
| **@aphrody-code/x** | Extend catalog with Gryphon ops; add `XProDeckService` |
| **aphrody-x-client** | `x-cli pro deck` subcommands |
| **twitter-api-v2** | Official API — no deck/column surface |