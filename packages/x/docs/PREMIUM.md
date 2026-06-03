# X Premium / Blue Verified — API surface

Recon source: `bxc recon` (profile **max**), `scripts/x-premium-recon.ts`, live bundle `main.*.js` (2026-06).

## Primary URL

[https://x.com/i/premium](https://x.com/i/premium) — React SPA; no dedicated `PremiumHubPage` GraphQL op.

## GraphQL (cookie auth)

| Operation | Role |
| --- | --- |
| **Upsells** | `viewer_v2.upsell_config_for_surfaces` |
| **Viewer** | Payments + super-follow flags |
| **UserByScreenName** | `is_blue_verified`, gifting, subscription counts |
| **UserCreatorSubscriptions** / **CreatorSubscriptionsTimeline** | Creator monetization |
| **BlueVerifiedFollowers** | Blue-verified followers sample |
| **UserArticlesTweets** | Long-form tab (requires `withVoice: true`) |

Path template: `https://x.com/i/api/graphql/{queryId}/{OperationName}`

Use `fetchPremiumBundle()` or `bun run scripts/x-premium-dump.ts --also-store`.

## Payments & CDN (CSP / bundle)

| Host | Purpose |
| --- | --- |
| `pay.x.com` / `pay.twitter.com` | Checkout |
| `money.x.com` (+ dev/staging) | Wallet / WASM forward |
| `payments-*.x.com` | Payment SDK + WASM |
| `abs.twimg.com/responsive-web/client-web/` | Webpack bundles |
| `api.x.com` | Alternate GraphQL host (legacy paths) |

## Product SKUs (client enum)

`BlueVerified`, `BlueVerifiedPlus`, `PremiumBasic`, 3/6-month variants — see `PREMIUM_PRODUCT_SKUS` in `src/config/premium-surface.ts`.

## npm ecosystem

| Package | Use |
| --- | --- |
| **@aphrody/x** | Cookie GraphQL (this package) |
| **aphrody-x-client** (`rust-bridge/crates/x-client`) | Rust CLI: `x-cli premium` |
| **twitter-api-v2** | Official API v2 (OAuth2 — different model) |

## CLI

```bash
cd bxc && bun run scripts/x-premium-recon.ts
cd bxc && bun run scripts/x-premium-dump.ts --also-store
cargo run -p x-client -- premium          # from rust-bridge/
cargo run -p x-client -- premium --raw
```