---
name: bxc
description: Référence d'usage du moteur bxc (CLI globale `bxc` 0.6.1 + `@aphrody-code/x` 1.0.6 + tools MCP) pour rechercher sur le web, scraper une page, extraire du Markdown, faire de la recon ou détecter une stack. À utiliser dès qu'une tâche demande "cherche/recherche sur le web", "scrape X", "récupère le contenu de cette URL", "quelle stack utilise ce site", ou tout besoin de données web fraîches.
---

# bxc — moteur de navigation Zero-Spawn pour agents

`bxc` est installé globalement (`~/.local/bin/bxc`, v0.6.1). Bun + cdylib Rust
(DOM html5ever + HTML→Markdown), zéro spawn Chromium pour les charges statiques.
Préfère `bxc` à un `curl`/`WebFetch` brut dès qu'il faut du Markdown propre, des
résultats de recherche structurés, ou de la résilience anti-bot.

## CLI — quick reference

```bash
# Recherche web Google → résultats propres (texte | --json | --markdown)
bxc search "rust async patterns" --num 5
bxc search "actualité ia" --hl fr --gl FR --markdown
bxc search "who invented javascript" --rich      # + featured snippet / PAA / related
bxc search "openai" --json                        # JSON structuré pour parsing

# Page → Markdown GFM propre (le primitif AI par excellence)
bxc scrape https://example.com --markdown

# Page → textContent d'éléments CSS
bxc scrape https://example.com h1 --max 20

# Recon complète (stack, CDN, assets, statut) en Markdown
bxc recon https://example.com

# Détection framework / CMS / WAF
bxc detect https://example.com --json

# Miroir d'un site complet (HTML+CSS+JS+assets)
bxc mirror https://example.com

# X / Twitter (cookies auth_token + ct0 — ~/.aphrody/x-session.json ou env)
bxc x whoami
bxc x profile yoyo__goat
bxc x search "rust" --json

# X Pro Gryphon decks + Radar (voir packages/x/docs/X_PRO.md)
bxc x xpro probe
bxc x xpro sync
```

Flags globaux : `--json`, `--insecure`/`-k`, `--proxy <url>`, `--quiet`/`-q`,
`--timeout <ms>` (défaut 30000).

**Codes de sortie** (stables pour le control-flow) : `0` succès · `1` mauvais
usage · `65` erreur data/runtime · `70` erreur interne · `130` interrompu.
Données sur `stdout`, erreurs sur `stderr` (`[error] <msg>`).

## Profils (du moins cher au plus cher)

| Profil | Backend | Quand |
|---|---|---|
| `static` (défaut) | StaticDomTransport in-process (DOM via cdylib Rust) | HTML rendu côté serveur, requêtes CSS, le plus rapide |
| `http` | curl-impersonate (TLS-fingerprinté) | anti-bot basique rejette `fetch`, pas de DOM/JS |
| `fast` | Lightpanda (CDP, JS complet) | SPA / rendu JS requis |
| `stealth` / `max` | Lightpanda + injects stealth CDP | détection de fingerprint, dernier recours |

Reste au profil le plus bas qui fonctionne. `bxc search` choisit seul
(transport `auto` : `fetch` natif → `ghost` → `http`).

## Authentification (recherche Google connectée)

`bxc search` charge automatiquement `~/.bxc/cookies/google.json` s'il existe
(jar Playwright/CDP JSON) → résultats authentifiés, moins de challenges.
Override : `--cookies <path>`. Forcer anonyme : `--no-auth`. Autres jars connus :
`~/.bxc/cookies/gemini.json`. **Ne jamais `cat`/afficher ces fichiers** (secrets).

## API librairie (`@aphrody-code/bxc`)

```ts
import { Browser } from "@aphrody-code/bxc";

const page = await Browser.newPage({ profile: "static" }); // static|fast|http|stealth|max
await page.goto("https://example.com", { timeoutMs: 30_000 });
const md = await page.markdown();          // HTML → Markdown (fallback JS si cdylib absent)
const html = await page.content();
const els = await page.$$("article h2");   // querySelectorAll → handles
await page.close();
```

```ts
import { googleSearchRich } from "@aphrody-code/bxc/google";
const r = await googleSearchRich("bun runtime", { hl: "en", gl: "US", num: 5 });
// r.organic[] {position,title,url,snippet}, r.totalResults, r.authenticated, r.profileUsed
```

## Tools MCP (serveur `bxc-native-mcp`)

- `bxc_search` — recherche Google puissante (SERP riche + verticales web/images/news/videos/books, authentifiée).
- `bxc_google_fetch` — URL → Markdown + JSON-LD/OpenGraph/Twitter/canonical.
- `bxc_scrape_markdown`, `bxc_detect_frameworks`, `bxc_cdp_evaluate`, `tune_memory_sqlite`, `bxc_keyword_search`, `bxc_semantic_search`, `bxc_actor_run`.
- `bxc_x_client` — profil, tweets, recherche, news, whoami (cookie auth).
- `bxc_xpro_deck` — decks Gryphon + Radar (`querySource: radar`).

## Pièges

- **cdylib `libbxc_rust_bridge` requise** pour DOM/SERP (pas le Markdown : fallback JS).
  Build : `bun run build:linux` ou `cargo build -p bxc-rust-bridge --release`.
  Override de chemin : `BXC_RUST_BRIDGE_LIB`.
- **`bxc search` vise `www.google.com`** (l'apex `google.com` renvoie un shell JS vide).
- **Test scope** : `bun test test/ packages/ src/` — jamais sans path (walk `vendor/`).
- Le binaire global garde le chemin de build du cdylib (`/home/ubuntu/bxc/rust-bridge/target/release/`) : ne pas déplacer ce dossier sinon `search`/DOM cassent.
