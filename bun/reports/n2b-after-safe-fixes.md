# node2bun report

- mode : `check`
- racine : `/home/ubuntu/bunlight`

## `.claude/mcp/bunlight-mcp/index.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 374:8 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 132:17 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 138:31 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 337:19 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 343:58 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 533:19 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 536:12 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 540:60 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 547:100 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `.npmrc`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `npmrc/scoped-registry` | registry scopé détecté — porter dans bunfig.toml : [install.scopes] |  |  |
| 2:1 | `npmrc/always-auth` | 'always-auth' est spécifique npm — Bun utilise le token directement quand présent |  |  |

## `benchmarks/agent-browser-engine.bench.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 43:52 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 44:43 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 58:2 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 60:23 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 83:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 128:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 174:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 204:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 298:23 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 332:23 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 682:6 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |
| 686:6 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |
| 697:4 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |

## `benchmarks/run-all.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 33:20 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 244:14 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 267:63 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/bunlight-fast.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 26:2 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 27:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 28:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 31:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 32:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 24:14 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |
| 75:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 84:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 101:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/bunlight-static.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 24:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 30:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 47:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/cheerio.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 58:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 75:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 98:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/fetch-native.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 28:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 43:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 60:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/jsdom.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 58:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 82:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 102:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/playwright.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 74:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 90:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 110:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/runners/puppeteer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 44:4 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 110:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 124:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 141:26 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/scenarios/cloudflare-basic.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 87:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 113:29 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/scenarios/parallel-100.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 60:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 67:29 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/scenarios/spa-react.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 58:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 76:29 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `benchmarks/scenarios/static-simple.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 41:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 60:29 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `examples/07-max-turnstile-solver.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 25:22 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 26:12 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 38:19 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 40:16 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `examples/08-massive-crawl.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 40:16 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 65:22 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 73:22 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 80:21 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `examples/09-ai-extraction.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 34:20 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 39:20 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `examples/crawl-chromium-developers.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 851:13 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 955:20 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 132:10 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 737:42 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 738:44 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 739:12 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 782:22 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 786:29 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 793:21 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 793:81 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 798:22 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 806:10 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 807:37 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 816:64 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 818:9 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 822:10 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 827:33 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 829:45 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 837:92 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |
| 839:34 | `api/escape-html` | Bun.escapeHTML() est natif (UTF-8, ~3× plus rapide que 'he') |  |  |

## `examples/wikipedia-infobox-extractor.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 127:16 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 154:32 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `ecosystem/oxlint` | oxlint (linter Rust OXC, ~50× ESLint) détecté — guide d'intégration Bun : https://oxc.rs/docs/guide/usage/linter.html | `https://oxc.rs/docs/guide/usage/linter.html` |  |

## `packages/api/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/drizzle` | Drizzle détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/drizzle | `https://bun.sh/guides/ecosystem/drizzle` |  |
| 1:1 | `ecosystem/elysia` | Elysia détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/elysia | `https://bun.sh/guides/ecosystem/elysia` |  |
| 1:1 | `ecosystem/graphql-yoga` | GraphQL Yoga détecté — guide d'intégration Bun : https://the-guild.dev/graphql/yoga-server/v3/integrations/integration-with-bun | `https://the-guild.dev/graphql/yoga-server/v3/integrations/integration-with-bun` |  |

## `packages/api/src/index.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 66:17 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `rust-bridge/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/tokio-tungstenite` | crate Rust `tokio-tungstenite` détecté (tokio-tungstenite (WS async)) — doc : https://docs.rs/tokio-tungstenite | `https://docs.rs/tokio-tungstenite` |  |
| 1:1 | `ecosystem/reqwest` | crate Rust `reqwest` détecté (reqwest (HTTP client)) — doc : https://docs.rs/reqwest | `https://docs.rs/reqwest` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |
| 1:1 | `ecosystem/clap` | crate Rust `clap` détecté (clap (CLI parser)) — doc : https://docs.rs/clap | `https://docs.rs/clap` |  |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |

## `rust-bridge/crates/bunlight-engine/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/clap` | crate Rust `clap` détecté (clap (CLI parser)) — doc : https://docs.rs/clap | `https://docs.rs/clap` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |

## `rust-bridge/crates/obscura-browser/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |

## `rust-bridge/crates/obscura-cdp/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/tokio-tungstenite` | crate Rust `tokio-tungstenite` détecté (tokio-tungstenite (WS async)) — doc : https://docs.rs/tokio-tungstenite | `https://docs.rs/tokio-tungstenite` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |

## `rust-bridge/crates/obscura-dom/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |

## `rust-bridge/crates/obscura-js/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |
| 1:1 | `ecosystem/reqwest` | crate Rust `reqwest` détecté (reqwest (HTTP client)) — doc : https://docs.rs/reqwest | `https://docs.rs/reqwest` |  |

## `rust-bridge/crates/obscura-mcp/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |
| 1:1 | `ecosystem/anyhow` | crate Rust `anyhow` détecté (anyhow (error handling)) — doc : https://docs.rs/anyhow | `https://docs.rs/anyhow` |  |

## `rust-bridge/crates/obscura-net/Cargo.toml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/reqwest` | crate Rust `reqwest` détecté (reqwest (HTTP client)) — doc : https://docs.rs/reqwest | `https://docs.rs/reqwest` |  |
| 1:1 | `ecosystem/tokio` | crate Rust `tokio` détecté (tokio (async runtime)) — doc : https://tokio.rs/ | `https://tokio.rs/` |  |
| 1:1 | `ecosystem/serde` | crate Rust `serde` détecté (Serde (ser/deserialize)) — doc : https://serde.rs/ | `https://serde.rs/` |  |
| 1:1 | `ecosystem/serde-json` | crate Rust `serde_json` détecté (serde_json) — doc : https://docs.rs/serde_json | `https://docs.rs/serde_json` |  |
| 1:1 | `ecosystem/thiserror` | crate Rust `thiserror` détecté (thiserror (derive Error)) — doc : https://docs.rs/thiserror | `https://docs.rs/thiserror` |  |

## `scripts/build-lightpanda-static.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 17:26 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |

## `scripts/build-serverless.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 7:21 | `imports/node-prefix` | préfixer 'fs/promises' avec 'node:' (recommandé) | `node:fs/promises` | compat: 🟢 full (node:fs/promises) |
| 13:12 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 29:27 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `scripts/build-standalone.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 181:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `scripts/cleanup.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 2:21 | `imports/node-prefix` | préfixer 'fs/promises' avec 'node:' (recommandé) | `node:fs/promises` | compat: 🟢 full (node:fs/promises) |

## `scripts/measure-coldstart.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 21:23 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 6:4 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 108:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/cli/chrome.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 51:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 88:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 13:2 | `api/process-stderr-write` | Bun.stderr.write() est l'équivalent natif Bun de process.stderr.write |  |  |

## `src/cli/serve.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 424:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/detect.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 90:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 160:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/ffi/curl-impersonate.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 244:55 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `src/google/dns.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 295:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 304:22 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/plugin/next-plugin.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 196:3 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 507:10 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 513:43 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 514:34 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 515:32 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 517:17 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 520:45 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |

## `src/plugin/tailwind-plugin.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 150:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/recorder/HarReplayer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 254:17 | `api/buffer-from-base64` | utiliser atob() / btoa() ou Uint8Array pour du Web-standard |  |  |

## `src/serverless/handler.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 155:14 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 158:29 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `src/transport/SocketPairTransport.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 250:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/transport/WebSocketTransport.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 96:15 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/cli/install.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 174:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 185:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 195:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 207:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 217:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 226:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 267:25 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/e2e/helpers.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 166:15 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `test/integration/curl-impersonate.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 425:18 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 428:16 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `test/integration/google-specialization.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 22:15 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `test/integration/showcase-hn.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 236:14 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/integration/spa-fast.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 25:15 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `test/perf/coldstart.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 10:41 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 89:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 244:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/perf/rss.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 253:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 314:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/profile-wiring.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 282:16 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 172:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |


