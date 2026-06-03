# X client coverage map

`@aphrody-code/x` + `aphrody-x-client` share one GraphQL catalog and bxc-aligned bundle discovery.

## Layers

| Layer | TS | Rust |
| --- | --- | --- |
| Catalog (158 ops) | `x-graphql-catalog.json` | `data/x-graphql-catalog.json` |
| Runtime queryIds | `QueryIdStore` | `QueryIdStore` |
| Bundle sync | `syncCatalogFromBundles()` | `x-cli catalog --sync` |
| Surface constants | `x-surface.ts` | `surface.rs` |
| Premium | `fetchAllPremiumGraphql()` | `x-cli premium` |
| bxc recon | `runXSurfaceRecon()` (profile **max**) | — use `bxc recon` CLI |

## Commands

```bash
# Sync queryIds from live X bundles (TS + Rust JSON)
cd bxc && bun run scripts/sync-x-catalog.ts
cd bxc/rust-bridge && cargo run -p x-client -- catalog --sync

# Coverage report (catalog drift + optional Premium probe)
cd bxc/packages/x && bun run coverage
cd bxc/packages/x && bun run coverage -- --probe   # needs ~/.aphrody/x-session.json

# bxc SPA recon (CDN, assets, CSP hosts)
cd bxc/packages/x && bun run recon

# Rust coverage + premium probe
cargo run -p x-client -- coverage --probe-premium
```

## Resolution order

1. Runtime queryId cache (`~/.config/aphrody/x/query-ids-cache.json`)
2. Embedded catalog `queryId`
3. On 404: refresh cache from bundles, retry

## npm packages

- **@aphrody-code/x** / **@aphrody-code/bxc** — this monorepo (cookie GraphQL + recon)
- **twitter-api-v2** — official API v2 (OAuth2, not interchangeable)