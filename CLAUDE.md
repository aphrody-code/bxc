# CLAUDE.md — bxc

> Contexte général partagé avec Gemini : voir [`GEMINI.md`](./GEMINI.md).
> Ce fichier liste ce qui est **spécifique à Claude Code** ou ce qu'il faut
> rappeler systématiquement.

bxc — moteur de navigation "Zero-Spawn" pour agents IA. Bun runtime + Rust V8
bindings + historique Zig DOM. Publié sur GitHub Packages comme
`@aphrody-code/bxc` (repo `aphrody-code/bxc`), consommé par `rpb-challonge` (vps).

## Rappels critiques

- **Test scope** : `bun test test/ packages/ src/` — **jamais sans path**, sinon
  bun walk `vendor/` (llama.cpp, gemma) et meurt.
- **Nommage** : tout identifiant/ref code/docs/binaires doit être `bxc*`. Le
  rebrand est terminé — ne réintroduire aucun ancien nommage de projet.
- **`packages/api`** : entry réel = `src/index.ts` (Elysia `.listen()`), PAS
  le `index.ts` racine (stub `bun init`). Cf. `packages/api/CLAUDE.md`.
- **`packages/llm-extract`** : single-stream queue obligatoire (Gemma CPU =
  memory-bandwidth bound). Cf. `packages/llm-extract/CLAUDE.md`.
- **`packages/bxc-extension`** : MCP server stdio (`bxc-gemini`), 7 tools sur
  le moteur bxc. Cf. `packages/bxc-extension/CLAUDE.md`.

## Commandes essentielles

```bash
bun install                                  # deps workspace
bun test test/ packages/ src/                # scope interne uniquement
bun run build                                # rust-bridge + msvc + standalone
bun run build:linux                          # Linux Rust cdylib + standalone
bun run typecheck                            # tsc --noEmit sur workspaces
bun run lint                                 # oxlint .

# Stack binaire
cargo build -p bxc-engine --release          # moteur Rust
ls rust-bridge/target/release/               # binaires cdylib (libbxc_rust_bridge.*)
```

## Layout

```
bxc/
├── src/                          # API browser TS
├── packages/
│   ├── api/                      # Elysia server (GraphQL + REST)
│   ├── bxc-extension/            # MCP stdio (bxc-gemini)
│   ├── llm-extract/              # Gemma 4 wrapper (single-stream queue)
│   └── ...
├── rust-bridge/                  # FFI Rust ↔ Bun (lol_html, V8 bindings)
├── vendor/                       # gemma, llama.cpp, mcp-sdk-typescript (NE PAS TOUCHER)
├── test/                         # tests root level
├── GEMINI.md                     # operating guide partagé
├── CLAUDE.md                     # ce fichier
├── MEGA-PLAN.md                  # roadmap macro
└── SKILLS.md                     # skills MCP intégrées
```

## Style commits

Idem global : `feat|fix|chore(scope): description` français, 1 ligne, pas
d'emoji, pas de `Co-Authored-By`, pas de `Generated with…`.

## Intégration vps

Submodule `vps/packages/bxc` → tag `v0.1.0`. Workflow update :

```bash
cd ~/bxc
# ... commit + push ...
git tag -a v0.X.0 -m "v0.X.0 — …"
git push origin v0.X.0
gh release create v0.X.0 --repo aphrody-code/bxc --title "bxc v0.X.0" --notes "…"

cd ~/vps/packages/bxc
git fetch --tags origin && git checkout v0.X.0
cd ~/vps && git add packages/bxc && git commit -m "chore(bxc): repin → v0.X.0" && git push
```

## Skills Claude Code à consulter

- **`rust-mcp-server-generator`** — pour étendre `packages/bxc-extension` (MCP stdio `bxc-gemini`, ajout de tools, structure rmcp SDK).
- **`rust-async-patterns`** — pour `rust-bridge/` (lol_html, V8 bindings, FFI ↔ Bun).
- **`rust-best-practices`** + **`rust-testing`** — pour tout nouveau code Rust.
- **`m15-anti-pattern`** — review avant commit.

## Pièges

- **Vendor immuables** : `vendor/gemma/`, `vendor/gemma/sources/llama.cpp/`,
  `vendor/mcp-sdk-typescript/`. Lecture seule. Leur CLAUDE.md est externe.
- **Google search instable** : `googleWebSearch` peut renvoyer 0 résultat sur
  des requêtes nouvelles (ex `'bxc'`). Pour les tests d'intégration, utiliser
  une requête stable (ex `'bun runtime'`).
- **`bxc-engine` binaire absent** : reconstruire via
  `cargo build -p bxc-engine --release` (≈2-3 min cold cache).
