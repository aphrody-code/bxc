# CLAUDE.md — bxc

> Contexte général partagé avec Gemini : voir [`GEMINI.md`](./GEMINI.md).
> Ce fichier liste ce qui est **spécifique à Claude Code** ou ce qu'il faut
> rappeler systématiquement.

bxc — moteur de navigation "Zero-Spawn" pour agents IA. Bun runtime + Rust V8
bindings + historique Zig DOM. Publié sur GitHub Packages comme
`@aphrody-code/bxc` (repo `aphrody-code/bxc`), consommé par `rpb-challonge` (vps).

## Rappels critiques

- **Test scope** : `bun test test/ packages/ src/` — **jamais sans path**, sinon
  bun walk `vendor/` (mcp-sdk) et meurt.
- **Nommage** : tout identifiant/ref code/docs/binaires doit être `bxc*`. Le
  rebrand est terminé — ne réintroduire aucun ancien nommage de projet.
- **`packages/api`** : entry réel = `src/index.ts` (Elysia `.listen()`), PAS
  le `index.ts` racine (stub `bun init`). Cf. `packages/api/CLAUDE.md`.
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

# Commandes des Scrapers dédiés
bun src/cli/index.ts fut price <url>         # FIFA Ultimate Team Price
bun src/cli/index.ts voiranime search <q>    # VoirAnime search (ex: "inazuma")
bun src/cli/index.ts google search <q>       # Google Atlas Audits
bun src/cli/index.ts xcom profile <user>     # Twitter profile markdown / screenshot

# Stack binaire
cargo build -p bxc-engine --release          # moteur Rust
ls rust-bridge/target/release/               # binaires cdylib (libbxc_rust_bridge.*)
```

## Layout

```
bxc/
├── src/                          # API browser TS
│   └── google/                   # Google Ecosystem Atlas & compliance
├── packages/                     # Monorepo workspaces & scrapers
│   ├── challonge/                # Challonge tournament brackets scraper
│   ├── fut/                      # FIFA Ultimate Team (FUTBin / FUTGG)
│   ├── voiranime/                # VoirAnime catalog & embed resolver
│   ├── worldbeyblade/            # Scraper & metagame sub-package
│   ├── xcom/                     # X.com profile markdown scraper
│   └── zukan/                    # Inazuma Eleven Character database scraper
├── rust-bridge/                  # FFI Rust ↔ Bun (lol_html, V8 bindings)
├── vendor/                       # mcp-sdk-typescript (NE PAS TOUCHER)
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

Submodule `vps/packages/bxc` → tag `v0.5.7`. Workflow update :

```bash
cd ~/bxc
# ... commit + push ...
git tag -a v0.5.7 -m "v0.5.7 — refactor scrapers to workspace packages and fix TS5097 error in consumer projects"
git push origin v0.5.7
gh release create v0.5.7 --repo aphrody-code/bxc --title "bxc v0.5.7" --notes "Release version 0.5.7 with scrapers refactored to workspace packages under @aphrody-code scope, compiled standalone mcp, and TS5097 import extension fix"

# Deploying standalone and reloading systemd service is automated via bxc-control:
./scripts/bxc-control.sh deploy
```

## Skills Claude Code à consulter

- **`rust-mcp-server-generator`** — pour étendre `packages/bxc-extension` (MCP stdio `bxc-gemini`, ajout de tools, structure rmcp SDK).
- **`rust-async-patterns`** — pour `rust-bridge/` (lol_html, V8 bindings, FFI ↔ Bun).
- **`rust-best-practices`** + **`rust-testing`** — pour tout nouveau code Rust.
- **`m15-anti-pattern`** — review avant commit.

## Pièges

- **Vendor immuables** : `vendor/mcp-sdk-typescript/`. Lecture seule. Leur CLAUDE.md est externe.
- **Google search instable** : `googleWebSearch` peut renvoyer 0 résultat sur
  des requêtes nouvelles (ex `'bxc'`). Pour les tests d'intégration, utiliser
  une requête stable (ex `'bun runtime'`).
- **`bxc-engine` binaire absent** : reconstruire via
  `cargo build -p bxc-engine --release` (≈2-3 min cold cache).
- **cdylib `libbxc_rust_bridge` absent** : la lib FFI du DOM/markdown
  (`rust-bridge/target/release/libbxc_rust_bridge.{so,dylib,dll}`) doit être
  compilée (`cargo build -p bxc-rust-bridge --release` ou `bun run build:linux`).
  Elle est `dlopen`-ée **paresseusement** (premier appel) : son absence ne crash
  plus à l'import — les chemins texte (extractTitle/stripTags/markdown) retombent
  sur un fallback JS pur (`src/internal/html-to-markdown.ts`), seules les requêtes
  CSS natives lèvent une erreur actionnable. Override : `BXC_RUST_BRIDGE_LIB`.
- **Test scope walk vendor** : `bun test test/ src/` discover quand même
  `vendor/mcp-sdk-typescript/**` → ~60-140 échecs préexistants (Zod v4, Task
  pagination, capabilities, CF-workers qui exige `pnpm`). Ce ne sont PAS des
  régressions bxc — filtrer le bruit MCP-SDK avant de conclure.
- **Mapping de profiles des scrapers** : Le CLI expose `stealth`, `max`, `fast`, `static` et `http`. Certains scrapers internes (comme `fut` ou `voiranime`) n'acceptent qu'un sous-ensemble (ex: `ghost` ou `static`). Veillez à bien mapper les types de profile CLI vers les options attendues par les scrapers sous peine d'erreurs strictes à la compilation TypeScript (`tsc --noEmit`).
