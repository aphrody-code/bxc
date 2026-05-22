<!-- SPDX-License-Identifier: Apache-2.0 -->
# bxc profile — profileur de précision du stack web Google

`bxc profile` capture, sur une propriété Google, l'**HTML rendu réel + CSS + JS +
fonts + le graphe réseau + la surface d'API + les frameworks + les globals JS**,
puis nourrit un **corpus auto-renforçant** : chaque scrape rend le suivant plus
précis.

## Usage

```bash
bxc profile <target|url> [options]

# cibles connues
bxc profile gemini              # gemini.google.com (vrai Chrome)
bxc profile cloud --json        # cloud.google.com, sortie JSON
bxc profile design              # design.google
bxc profile antigravity
bxc profile --all               # toutes les cibles à la suite
bxc profile https://m3.material.io/ --profile static
```

Cibles : `google.com, search, cloud, console, design, material, antigravity,
gemini, aistudio, fonts` — ou n'importe quelle URL.

| Option | Effet |
|--------|-------|
| `--profile <name>` | `max` (défaut, **vrai Chrome** → graphe réseau complet) · `static`/`http`/`fast`/`stealth` |
| `--chrome-profile <p>` | profil Chrome pour `max` (défaut `$BXC_CHROME_PROFILE` ou `Profile 5`) |
| `--all` | profiler toutes les cibles Google |
| `--out <file>` | écrire le JSON complet |
| `--json` | JSON sur stdout (sinon résumé lisible) |

> Les SPA Google (Cloud, Gemini, Antigravity) ne livrent leur graphe réseau /
> API qu'avec `--profile max` (Chrome exécute le JS). `static`/`http` donnent
> l'HTML + assets liés sans navigateur.

## Ce qui est capturé (`GoogleProfile`)

- **HTML** rendu (taille, titre, status, URL finale).
- **CSS / JS / fonts** : URLs classées depuis `performance.getEntriesByType`.
- **APIs** : endpoints normalisés (query strippée) matchant
  `googleapis.com`, `batchexecute`, `/_/<app>/data`, Boq RPC, `/v1/`…
- **frameworks** : via `detect` (best-effort) + heuristique Wiz/Boq DOM.
- **globals JS live** : `gapi, google, __NEXT_DATA__, ng, React, Lit,
  trustedTypes, botguard, grecaptcha, WIZ_global_data`…

## Corpus — la « memory » qui se renforce

`src/google/corpus.ts` persiste `storage/google-profiles/corpus.json`
(surchargé par `BXC_PROFILE_DIR`). À chaque scrape :

- incrémente les tallies (count + first/lastSeen) de chaque framework / endpoint
  API / global vu sur l'hôte ;
- met à jour des stats EMA (css/js/api/htmlBytes) ;
- `corpusHints(host)` réinjecte ce que bxc sait déjà au scrape suivant.

→ La confiance et la surface d'API connue **croissent de façon monotone** à
chaque passage.

## Accélération mirror (outils externes)

`bxc mirror --engine auto|spider|monolith|aria2|native [--site]` choisit le
meilleur binaire **installé** (sinon fallback mirror Bun natif) et renforce le
corpus :

| Engine | Outil | Rôle | Licence |
|--------|-------|------|---------|
| `spider` | spider-rs (`spider.exe`) | crawl multi-pages concurrent HTTP/2 + anti-bot | MIT |
| `monolith` | monolith | page unique → un seul `.html` (CSS/JS/img inline) | CC0/MIT |
| `aria2` | aria2c | téléchargement multi-segment d'assets lourds | GPLv2 (**binaire externe only**) |

Installation globale : `cargo install spider_cli` · `winget install aria2.aria2`.

> **monolith sur Windows** : son build vendore OpenSSL et requiert Strawberry
> Perl (échoue avec le perl msys/WSL → `VC-WIN64A` config error). Optionnel /
> Linux-first ; sur Windows le mirror Bun natif (`--engine native`) couvre déjà
> la page unique (HTML+CSS+JS+assets inline). `bestEngine` retombe
> automatiquement sur `aria2`/natif quand monolith est absent.
