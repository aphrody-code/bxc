# CLAUDE.md — packages/bunlight-extension

Extension MCP native pour Gemini CLI (`bunlight-gemini`). Stdio MCP server qui
expose 7 tools branchés sur le moteur Bunlight (engine Chromium Zero-Spawn).

Doc plus détaillée : `@DEVELOPMENT.md` (philosophie + setup). Ce fichier ne
duplique pas — il liste ce que Claude doit savoir pour intervenir vite.

## Layout

```
packages/bunlight-extension/
├── server.ts                    # MCP server (7 tools registerTool, 228 lignes)
├── gemini-extension.json        # manifest Gemini (mcpServers + settings)
├── bunlight-mcp                 # binaire compilé via bun build --compile
├── bunlight-memory.sqlite       # base mémoire (bun:sqlite), NOT tracked-friendly
├── skills/
│   └── rust-native-scanner/     # skill native Rust (Cargo + scripts/build-rust-skill.ts)
└── test/server.test.ts          # tests bun:test
```

## Tools exposés (server.ts)

| Ligne | Tool | Rôle |
|---|---|---|
| 40 | `tune_memory_sqlite` | CRUD sur table `memories` (key/value/created_at) |
| 73 | `vision_analyze` | CDP screenshot + parse visuel local (pas de cloud) |
| 99 | `start_scraping_subagent` | déclenche queue 24-worker/5656-page native |
| 123 | `auto_detect_skills` | scan dynamique de `skills/` |
| 154 | (4e tool — voir source) | |
| 177 | (5e tool — voir source) | |
| 200 | (6e tool — voir source) | |

## Commands

```bash
bun install                      # deps (workspace pour @modelcontextprotocol/sdk)
bun run typecheck                # tsc --noEmit
bun run lint                     # oxlint .
bun test                         # tests stdio MCP
bun run build                    # bun build --compile -> binaire ./bunlight-mcp (Linux x64)
```

Build skill Rust :
```bash
bun run skills/rust-native-scanner/scripts/build-rust-skill.ts
cargo run --manifest-path skills/rust-native-scanner/Cargo.toml -- scan
```

## Exception consciente au mandate Bun-only

`server.ts` importe `node:path`, `node:fs`, et utilise `process.env`, `process.cwd`,
`process.exit`. C'est **volontaire** : le SDK `@modelcontextprotocol/sdk` est
Node-first et l'extension tourne sous le runtime Gemini CLI (Node), pas Bun
direct. Ne PAS migrer ces imports vers `Bun.*` — ça casserait l'interop MCP.

Le reste du monorepo Bunlight reste strict Bun-only.

## Pièges

- **`bunlight-memory.sqlite` créé au cwd** : la DB se matérialise dès le lancement
  de `server.ts`. Si tu lances depuis la racine du repo, elle apparaît à la racine
  (laisser non-staged via `.gitignore`).
- **`@modelcontextprotocol/sdk` en `workspace:*`** : la version vient de
  `vendor/mcp-sdk-typescript/`. Pas de bump npm direct — bump le submodule.
- **Compile target = `bun-linux-x64`** : pas de cross-compile Windows pour le
  binaire MCP (le runtime Gemini CLI cible Linux/macOS host).
- **Gemini extension** : config dans `gemini-extension.json` (commande `bun`,
  cwd `${extensionPath}`, trust true). Voir `@gemini-extension.json`.
