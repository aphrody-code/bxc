# CLAUDE.md — bxc

> Contexte général partagé avec Gemini : voir [`GEMINI.md`](./GEMINI.md).  
> Mémoire agy VPS : `~/.gemini/antigravity-cli/MEMORY.md` · deploy : [`DEPLOY.md`](./DEPLOY.md).
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
- **MCP server** : `src/mcp/server.ts` (`bxc-native-mcp`, version = const en
  haut du fichier). Build : `bun run build:mcp` → `dist/standalone/bxc-mcp`.
  Manifest Gemini = `gemini-extension.json` (pointe sur `/usr/local/bin/bxc-mcp`).

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
bun src/cli/index.ts x whoami                # Native X client (profile|tweets|search|news|whoami)

# Stack binaire
cargo build -p bxc-engine --release          # moteur Rust
ls rust-bridge/target/release/               # binaires cdylib (libbxc_rust_bridge.*)

# Build + déploiement VPS — canonical: DEPLOY.md
bun run build:linux                          # dist/standalone/bxc-linux-x64
bun run build:mcp                            # dist/standalone/bxc-mcp
./scripts/bxc-control.sh deploy              # ~/.local + /usr/local + systemd
bash ~/aphrody/scripts/vps-sync-agent-stack.sh  # MCP mcp.json + Grok config.toml
```

> **Nouvelle sous-commande CLI** : créer `src/cli/<name>.ts` (`export async function main(argv, baseOpts)`),
> ajouter un `case "<name>"` dans `src/cli/index.ts`, et une ligne dans `printUsage()`.

> **Services systemd** : `bxc.service` (API/CDP `serve :9222`) + `bxc-crawler.service`
> (24/7 `crawl-worker`). Units source dans `scripts/deploy/`. Repo **PUBLIC** depuis 2026-06-01.

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
│   ├── x/                        # @aphrody-code/x — headless X/Twitter client (pure TS port) + examples/
│   └── zukan/                    # Inazuma Eleven Character database scraper
├── rust-bridge/                  # FFI Rust ↔ Bun (lol_html, V8 bindings)
│   └── crates/x-client/          # Native X/Twitter GraphQL+REST client (rusqlite 0.37, FFI via bxc_x_*)
├── vendor/                       # mcp-sdk-typescript (NE PAS TOUCHER)
├── test/                         # tests root level
├── DEPLOY.md                     # VPS + systemd + MCP deploy (canonical)
├── GEMINI.md                     # operating guide partagé
├── CLAUDE.md                     # ce fichier
├── MEGA-PLAN.md                  # roadmap macro
└── SKILLS.md                     # skills MCP intégrées
```

## Style commits

Idem global : `feat|fix|chore(scope): description` français, 1 ligne, pas
d'emoji, pas de `Co-Authored-By`, pas de `Generated with…`.

## Intégration vps

Submodule `vps/packages/bxc` → dernier tag `v0.6.0`. Workflow release :

```bash
cd ~/bxc
# ... commit + push ...
git tag -a vX.Y.Z -m "vX.Y.Z — <résumé>"
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --repo aphrody-code/bxc --title "bxc vX.Y.Z" --notes "<notes>"
# assets cross-platform : bun scripts/build-standalone.ts && gh release upload vX.Y.Z dist/standalone/bxc-* --clobber

# Build + déploiement standalone + restart systemd, automatisé via bxc-control :
./scripts/bxc-control.sh deploy
```

## Skills Claude Code à consulter

- **`rust-mcp-server-generator`** — pour étendre le MCP server `src/mcp/server.ts` (tools `registerTool` + Zod, `bxc-native-mcp`).
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
- **Pipe masque le code retour** : `cargo build … | tail` renvoie l'exit de `tail` (0), pas de cargo. Capturer le vrai code : `cmd > /tmp/x.log 2>&1; echo $?`.
- **`links="sqlite3"` (rusqlite)** : `libsqlite3-sys` déclare `links` → UNE seule version de rusqlite peut être linkée dans le cdylib. Toutes les crates de `rust-bridge/` doivent partager `rusqlite 0.37` (via `{ workspace = true }`). Aligner les deps partagées sur `[workspace.dependencies]` (features additives OK : `uuid = { workspace = true, features = ["fast-rng"] }`).
- **`verbatimModuleSyntax: true`** (tsconfig root) : tout package workspace importé depuis `src/` est typecheck transitivement → les imports type-only doivent utiliser `import type { … }` sinon `error TS1484`.
- **`.npmrc` n'est PAS un secret** : `_authToken=${NODE_AUTH_TOKEN}` est un placeholder env (le CI génère son propre `.npmrc`). Ne jamais conclure « token leak » sur `grep -c _authToken` — vérifier placeholder (`=${`) vs littéral. Ne pas Read/cat quand même.
- **`bxc-mcp` a 3 cibles** à garder fraîches au deploy : `~/.local/bin/bxc-mcp` (MCP Claude `~/.claude.json`), `/usr/local/bin/bxc-mcp` (extension Gemini), `dist/standalone/bxc-mcp` (configs gemini antigravity/plugins/aphrody). `bxc-control deploy` gère les deux premiers.
- **GitHub Packages visibilité** : `.npmrc` route `@aphrody-code/*` → GitHub Packages (`bun publish` par package, sous-packages avant root). Rendre un package **public** sur un compte **User** = **UI-only**, aucune API (`PATCH …/visibility` = 404), même repo public.
- **`bun test` ne run que `*.test.ts`** : déplacer des `examples/*.ts` sous `packages/` ne les transforme pas en tests.
