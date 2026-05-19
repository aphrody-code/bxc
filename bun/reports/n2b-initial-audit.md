# node2bun report

- mode : `check`
- racine : `/home/ubuntu/bxc`

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
| 60:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
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

## `benchmarks/runners/bxc-fast.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 26:2 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 27:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 28:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 31:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 32:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 24:14 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `benchmarks/runners/puppeteer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 44:4 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `ecosystem/biome` | Biome (linter + formatter Rust, ~100× ESLint+Prettier) détecté — guide d'intégration Bun : https://biomejs.dev/ | `https://biomejs.dev/` |  |
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

## `packages/bxc-extension/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `ecosystem/oxlint` | oxlint (linter Rust OXC, ~50× ESLint) détecté — guide d'intégration Bun : https://oxc.rs/docs/guide/usage/linter.html | `https://oxc.rs/docs/guide/usage/linter.html` |  |

## `packages/bxc-extension/server.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 28:2 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `packages/bxc-extension/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |
| 1:1 | `tsconfig/verbatim-module-syntax` | moduleResolution=bundler + verbatimModuleSyntax=true est le combo recommandé Bun (force `import type` explicite) | `true` |  |
| 1:1 | `tsconfig/allow-ts-extensions` | Bun résout les extensions .ts nativement — allowImportingTsExtensions=true permet `import './x.ts'` | `true` |  |

## `packages/llm-extract/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

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

## `rust-bridge/crates/bxc-engine/Cargo.toml`

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

## `scripts/atlas-from-cache.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 22:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 22:37 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `scripts/build-standalone.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 197:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `scripts/god-mode-executor.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 18:43 | `imports/node-prefix` | préfixer 'fs' avec 'node:' (recommandé) | `node:fs` | compat: 🟢 full (node:fs) |
| 31:10 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 50:8 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `scripts/measure-coldstart.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 22:4 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 124:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `scripts/path-sentinel.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 25:46 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 33:19 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 33:42 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 52:49 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 52:72 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `scripts/post-mapping.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 18:23 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 17:31 | `imports/node-prefix` | préfixer 'fs' avec 'node:' (recommandé) | `node:fs` | compat: 🟢 full (node:fs) |

## `src/cli/chrome.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 64:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 99:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/cli/serve.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 438:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/detect.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 123:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/ffi/curl-impersonate.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 259:55 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `src/google/cache.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 67:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 68:21 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `src/google/dns.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 311:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 320:22 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/google/mandate-guard.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 48:7 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `src/google/search.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 157:43 | `imports/node-prefix` | préfixer 'fs' avec 'node:' (recommandé) | `node:fs` | compat: 🟢 full (node:fs) |

## `src/plugin/next-plugin.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 212:3 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 523:10 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 529:43 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 530:34 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 531:32 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 533:17 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |
| 536:45 | `api/file-based-routing` | Bun.FileSystemRouter expose un routeur file-based sans build step |  |  |

## `src/plugin/tailwind-plugin.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 166:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `src/transport/WebSocketTransport.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 193:15 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/cli/install.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 190:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 201:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 211:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 223:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 233:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 242:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 283:25 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/e2e/helpers.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 96:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 172:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 173:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 174:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 175:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 176:6 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 182:15 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `test/integration/google-specialization.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 38:15 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `test/integration/showcase-hn.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 252:14 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/perf/coldstart.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 26:41 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 105:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 260:20 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/perf/rss.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 269:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 330:21 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/profile-wiring.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 298:16 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 188:19 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `test/stealth-challenge.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 29:3 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/release.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 70:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 133:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 208:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 279:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 365:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 446:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 515:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 593:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 699:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 821:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 884:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 995:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 72:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 135:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 210:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 281:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 367:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 448:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 517:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 595:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 701:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 823:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 886:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 997:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/server-sanitize.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 71:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 73:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/server-self-hosted.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 71:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 73:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/server.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 97:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 146:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 99:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 148:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/ui-build.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 18:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 20:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 24:14 | `cli/npm-ci` | npm ci → bun install --frozen-lockfile | `bun install --frozen-lockfile` |  |
| 28:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |

## `vendor/gemma/sources/llama.cpp/.github/workflows/ui-ci.yml`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 55:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 106:9 | `ci/setup-node` | actions/setup-node → oven-sh/setup-bun@v2 | `uses: oven-sh/setup-bun@v2` |  |
| 57:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 108:11 | `ci/node-version` | remplacer 'node-version' par 'bun-version: latest' | `bun-version: latest` |  |
| 63:14 | `cli/npm-ci` | npm ci → bun install --frozen-lockfile | `bun install --frozen-lockfile` |  |
| 113:14 | `cli/npm-ci` | npm ci → bun install --frozen-lockfile | `bun install --frozen-lockfile` |  |
| 68:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 73:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 84:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 89:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 118:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 129:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 134:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 139:14 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 79:14 | `cli/npx` | npx → bunx | `bunx ` |  |
| 124:14 | `cli/npx` | npx → bunx | `bunx ` |  |

## `vendor/gemma/sources/llama.cpp/examples/ts-type-to-grammar.sh`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 22:1 | `cli/npx` | npx → bunx | `bunx ` |  |

## `vendor/gemma/sources/llama.cpp/scripts/serve-static.js`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:23 | `imports/node-prefix` | préfixer 'http' avec 'node:' (recommandé) | `node:http` | compat: 🟢 full (node:http) |
| 2:21 | `imports/node-prefix` | préfixer 'fs' avec 'node:' (recommandé) | `node:fs` | compat: 🟢 full (node:fs) |
| 3:23 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 66:16 | `api/http-createServer` | envisager Bun.serve() plutôt que http.createServer (API fetch-based, plus simple) |  |  |
| 11:20 | `api/path-join-dirname` | dans un ESM Bun, path.join(import.meta.dir, ...) évite __dirname |  |  |

## `vendor/gemma/sources/llama.cpp/tools/server/chat.mjs`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 108:13 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |
| 118:5 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/.npmrc`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `npmrc/engine-strict` | 'engine-strict' : Bun lit engines.bun du package.json et avertit si non matchant |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/.storybook/main.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 3:32 | `imports/node-prefix` | préfixer 'url' avec 'node:' (recommandé) | `node:url` | compat: 🟢 full (node:url) |
| 2:35 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 5:1 | `api/dirname-esm` | dans un ESM Bun, utiliser directement import.meta.dir (ou import.meta.dirname) | `const __dirname = import.meta.dir` |  |
| 5:27 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/.storybook/vitest.setup.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 4:28 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/components.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/shadcn` | components.json présent — shadcn/ui configuré (copy-paste components + CLI `bunx shadcn@latest add <component>`) | `https://ui.shadcn.com/` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/eslint.config.js`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 4:23 | `imports/bun-native` | remplacer 'eslint-config-prettier' par @biomejs/biome — plus besoin de désactiver les règles ESLint qui conflictent avec Prettier — Biome unifie | `@biomejs/biome` |  |
| 13:23 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |
| 13:37 | `api/new-url-import-meta` | utiliser import.meta.dir ou path.join(import.meta.dir, ...) plutôt que new URL(..., import.meta.url) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/package-lock.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `lock/rival` | lockfile concurrent 'package-lock.json' présent — exécuter 'bun install' puis supprimer ce fichier |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 1:29 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 1:61 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 1:91 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `ecosystem/sveltekit` | SvelteKit détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/sveltekit | `https://bun.sh/guides/ecosystem/sveltekit` |  |
| 1:1 | `ecosystem/clsx` | clsx (className concat) détecté — guide d'intégration Bun : https://github.com/lukeed/clsx | `https://github.com/lukeed/clsx` |  |
| 1:1 | `ecosystem/tailwind-merge` | tailwind-merge — dédupe classes détecté — guide d'intégration Bun : https://github.com/dcastil/tailwind-merge | `https://github.com/dcastil/tailwind-merge` |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'uuid' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |
| 1:1 | `ecosystem/vite` | Vite détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/vite | `https://bun.sh/guides/ecosystem/vite` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/scripts/install-git-hooks.sh`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 29:5 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 31:22 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 36:5 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 38:22 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 43:5 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 45:22 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 53:5 | `cli/npm-run` | npm run → bun run | `bun run ` |  |
| 55:19 | `cli/npm-run` | npm run → bun run | `bun run ` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/scripts/vite-plugin-llama-cpp-build.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 10:26 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 9:9 | `imports/node-prefix` | préfixer 'fs' avec 'node:' (recommandé) | `node:fs` | compat: 🟢 full (node:fs) |

## `vendor/gemma/sources/llama.cpp/tools/ui/src/lib/services/mcp.service.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 239:23 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 281:36 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 302:36 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 510:21 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 673:39 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/src/lib/services/parameter-sync.service.spec.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/src/lib/stores/agentic.svelte.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 766:27 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 803:28 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/client/page.svelte.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/stories/fixtures/ai-tutorial.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 54:21 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/stories/fixtures/api-docs.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 139:11 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/agentic-sections.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/agentic-strip.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/clipboard.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/latex-protection.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 2:45 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/mcp-service.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:54 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/model-id-parser.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/model-names.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/reasoning-context.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/redact.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/request-helpers.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/sanitize-headers.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/tests/unit/uri-template.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:39 | `imports/bun-native` | remplacer 'vitest' par bun:test — bun:test offre les mêmes fonctionnalités que vitest | `bun:test` |  |

## `vendor/gemma/sources/llama.cpp/tools/ui/vite.config.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 3:35 | `imports/node-prefix` | préfixer 'path' avec 'node:' (recommandé) | `node:path` | compat: 🟢 full (node:path) |
| 4:32 | `imports/node-prefix` | préfixer 'url' avec 'node:' (recommandé) | `node:url` | compat: 🟢 full (node:url) |
| 11:1 | `api/dirname-esm` | dans un ESM Bun, utiliser directement import.meta.dir (ou import.meta.dirname) | `const __dirname = import.meta.dir` |  |
| 11:27 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `vendor/mcp-sdk-typescript/.npmrc`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `npmrc/registry` | registry custom détecté — porter dans bunfig.toml : [install].registry = "..." | `[install] registry = "..."` |  |

## `vendor/mcp-sdk-typescript/common/tsconfig/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/bun-types` | compilerOptions.types inclut 'node' mais pas 'bun' — ajouter 'bun' pour typer Bun.* |  |  |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/common/vitest-config/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/common/vitest-config/vitest.config.js`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 7:36 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `vendor/mcp-sdk-typescript/examples/client-quickstart/src/index.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 22:56 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 168:20 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/client-quickstart/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/examples/client/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/examples/client/src/dualModeAuth.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 82:31 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 89:64 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 93:26 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 94:30 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/client/src/elicitationUrlExample.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 807:9 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |

## `vendor/mcp-sdk-typescript/examples/client/src/simpleClientCredentials.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 24:28 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 27:22 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 34:27 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 36:27 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 46:26 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/client/src/simpleStreamableHttp.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 528:13 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |
| 547:13 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |
| 991:9 | `api/process-stdout-write` | Bun.stdout.write() est l'équivalent natif Bun de process.stdout.write |  |  |

## `vendor/mcp-sdk-typescript/examples/client/src/simpleTokenProvider.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 21:28 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 24:19 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/client/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/examples/server-quickstart/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/examples/server-quickstart/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/examples/server/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/express` | Express détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/express | `https://bun.sh/guides/ecosystem/express` |  |
| 1:1 | `ecosystem/hono` | Hono détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/hono | `https://bun.sh/guides/ecosystem/hono` |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/examples/server/src/customProtocolVersion.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 54:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 54:53 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/src/elicitationFormExample.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 322:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 322:53 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/src/elicitationUrlExample.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 213:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 213:57 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 214:19 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 214:63 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/src/honoWebStandardStreamableHttp.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 62:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 62:53 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/src/simpleStreamableHttp.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 599:18 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 599:57 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 600:19 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 600:63 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/src/simpleTaskInteractive.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 446:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 446:49 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/examples/server/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/examples/shared/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/redundant-dep` | dépendance 'better-sqlite3' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |
| 1:1 | `ecosystem/express` | Express détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/express | `https://bun.sh/guides/ecosystem/express` |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |

## `vendor/mcp-sdk-typescript/examples/shared/src/authServer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 105:5 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/examples/shared/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/package-manager` | packageManager='pnpm@10.26.1' — remplacer par 'bun@<version>' ou supprimer |  |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/packages/client/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |

## `vendor/mcp-sdk-typescript/packages/client/src/client/auth.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 61:60 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/packages/client/src/client/middleware.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 191:27 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 198:30 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |
| 215:30 | `api/performance-now` | Bun.nanoseconds() offre une horloge haute précision (retourne nanosecondes depuis démarrage) |  |  |

## `vendor/mcp-sdk-typescript/packages/client/src/client/sse.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 3:51 | `imports/bun-native` | remplacer 'eventsource' par Bun.EventSource — Bun.EventSource est un client SSE natif | `Bun.EventSource` |  |
| 124:33 | `api/eventsource-new` | EventSource est global dans Bun (Bun.EventSource) — plus besoin de la dep 'eventsource' |  |  |

## `vendor/mcp-sdk-typescript/packages/client/src/client/stdio.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 8:20 | `imports/bun-native` | remplacer 'cross-spawn' par Bun.spawn — Bun.spawn est cross-platform par défaut | `Bun.spawn` |  |
| 121:29 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |

## `vendor/mcp-sdk-typescript/packages/client/test/client/barrelClean.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 8:29 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `vendor/mcp-sdk-typescript/packages/client/test/client/crossSpawn.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 4:20 | `imports/bun-native` | remplacer 'cross-spawn' par Bun.spawn — Bun.spawn est cross-platform par défaut | `Bun.spawn` |  |

## `vendor/mcp-sdk-typescript/packages/client/test/client/sse.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 23:21 | `api/buffer-from-base64` | utiliser atob() / btoa() ou Uint8Array pour du Web-standard |  |  |

## `vendor/mcp-sdk-typescript/packages/client/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/core/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |

## `vendor/mcp-sdk-typescript/packages/core/src/shared/stdio.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 11:39 | `api/buffer-concat` | utiliser Uint8Array et concaténation Web-standard plutôt que Buffer.concat |  |  |

## `vendor/mcp-sdk-typescript/packages/core/test/shared/protocol.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 737:62 | `api/set-immediate` | setImmediate n'est pas Web-standard — utiliser queueMicrotask() ou setTimeout(fn, 0) |  |  |

## `vendor/mcp-sdk-typescript/packages/core/test/validators/validators.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 619:42 | `api/path-join-dirname` | dans un ESM Bun, path.join(import.meta.dir, ...) évite __dirname |  |  |

## `vendor/mcp-sdk-typescript/packages/core/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/express/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/express` | Express détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/express | `https://bun.sh/guides/ecosystem/express` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/express/src/auth/metadataRouter.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 9:5 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 9:73 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/packages/middleware/express/src/express.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 65:5 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/packages/middleware/express/test/auth/resourceServer.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 147:9 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |
| 173:9 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |
| 187:9 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/packages/middleware/express/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/fastify/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/fastify` | Fastify détecté — guide d'intégration Bun : https://bun.sh/guides | `https://bun.sh/guides` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/fastify/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/hono/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/hono` | Hono détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/hono | `https://bun.sh/guides/ecosystem/hono` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/hono/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/node/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |
| 1:1 | `ecosystem/hono` | Hono détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/hono | `https://bun.sh/guides/ecosystem/hono` |  |

## `vendor/mcp-sdk-typescript/packages/middleware/node/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/packages/server/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |
| 1:1 | `pkg/redundant-dep` | dépendance 'tsx' redondante avec Bun (voir Bun.file / Bun.env / fetch global / bun:sqlite / bun test) |  |  |

## `vendor/mcp-sdk-typescript/packages/server/test/server/barrelClean.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 8:29 | `api/fileURLToPath` | Bun.fileURLToPath() est équivalent (ou utiliser import.meta.dir/path) |  |  |

## `vendor/mcp-sdk-typescript/packages/server/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/scripts/cli.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 56:9 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/scripts/fetch-spec-types.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 4:28 | `imports/bun-native` | remplacer 'prettier' par @biomejs/biome — Biome remplace Prettier (formatter intégré au linter) | `@biomejs/biome` |  |

## `vendor/mcp-sdk-typescript/test/conformance/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/package-manager` | packageManager='pnpm@10.24.0' — remplacer par 'bun@<version>' ou supprimer |  |  |
| 1:1 | `pkg/engines-pm` | engines.{npm,pnpm,yarn} est superflu avec Bun — utiliser 'engines.bun' |  |  |
| 1:1 | `ecosystem/express` | Express détecté — guide d'intégration Bun : https://bun.sh/guides/ecosystem/express | `https://bun.sh/guides/ecosystem/express` |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/test/conformance/src/authTestServer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 34:25 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 42:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 270:5 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/test/conformance/src/everythingClient.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 74:17 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 459:26 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |

## `vendor/mcp-sdk-typescript/test/conformance/src/everythingServer.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1022:14 | `api/process-env` | Bun.env est un alias plus court de process.env (préférence stylistique) |  |  |
| 877:1 | `api/express-app` | Bun.serve() est un serveur HTTP natif zéro-config (fetch-based, routing intégré) |  |  |

## `vendor/mcp-sdk-typescript/test/conformance/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/test/helpers/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/package-manager` | packageManager='pnpm@10.24.0' — remplacer par 'bun@<version>' ou supprimer |  |  |
| 1:1 | `pkg/engines-pm` | engines.{npm,pnpm,yarn} est superflu avec Bun — utiliser 'engines.bun' |  |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/test/helpers/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/test/integration/package.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `pkg/package-manager` | packageManager='pnpm@10.24.0' — remplacer par 'bun@<version>' ou supprimer |  |  |
| 1:1 | `pkg/engines-pm` | engines.{npm,pnpm,yarn} est superflu avec Bun — utiliser 'engines.bun' |  |  |
| 1:1 | `ecosystem/zod` | Zod (schema validation) détecté — guide d'intégration Bun : https://zod.dev/ | `https://zod.dev/` |  |

## `vendor/mcp-sdk-typescript/test/integration/test/server/cloudflareWorkers.test.ts`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 88:22 | `api/child-process-spawn` | Bun.spawn offre une API plus ergonomique (streams Web, ipc, preload) |  |  |
| 33:28 | `api/execSync` | utiliser le shell Bun ($`cmd`) ou Bun.spawnSync() à la place de execSync |  |  |
| 85:9 | `api/execSync` | utiliser le shell Bun ($`cmd`) ou Bun.spawnSync() à la place de execSync |  |  |

## `vendor/mcp-sdk-typescript/test/integration/tsconfig.json`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 1:1 | `tsconfig/module-detection` | compilerOptions.moduleDetection absent — 'force' garantit que chaque fichier est ESM (évite les .js traités comme CJS) | `"force"` |  |

## `vendor/mcp-sdk-typescript/typedoc.config.mjs`

| ligne | règle | message | remplacement | compat |
| --- | --- | --- | --- | --- |
| 2:17 | `imports/bun-native` | remplacer 'fast-glob' par bun (Glob) — import { Glob } from 'bun' est natif (pas bun:glob) | `bun (Glob)` |  |


