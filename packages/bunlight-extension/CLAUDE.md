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

## Bun-native — pas d'exception

`server.ts` est désormais 100% Bun-native (cf `ai.json` shared_rules) :
- Plus d'imports `node:path` / `node:fs` — remplacés par template strings
  (`${process.cwd()}/skills`) et `Bun.Glob("*/").scan({cwd, onlyFiles:false})`.
- `process.env` / `process.cwd` / `process.exit` restent : ce sont des globals
  natifs Bun (pas des imports `node:`), aucune dépendance Node.
- Le SDK `@modelcontextprotocol/sdk` est vendoré et migré Bun-native dans
  `vendor/mcp-sdk-typescript/` (workspace:* via `package.json`). Plus de bump
  npm direct ; bump le submodule.

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
