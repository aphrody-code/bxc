# Changelog

All notable changes to Bxc will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.9.5] - 2026-09-05

### Added

- `bxc wiki` — lecture d'un site MediaWiki par son API (Fandom, Wikipedia, Miraheze, wiki.gg,
  Fextralife) : `page`, `md`, `tables`, `images`, `infobox`, `search`, `check`. L'infobox est lue
  dans le wikitext (vrais noms de champs, stables entre pages), les `rowspan`/`colspan` des
  tableaux sont développés, et les images sont résolues en pleine résolution via `imageinfo`
  plutôt qu'en vignettes `/scale-to-width-down/`.
- Repli MediaWiki automatique dans `smartFetch` : l'API est interrogée avant l'escalade des
  profils sur les hôtes MediaWiki connus ou détectés, et en dernier recours quand tous les
  profils ont échoué. Débit limité à une requête toutes les 6 s par hôte.

### Fixed

- **Cache empoisonné** : les entrées inexploitables (corps vide, interstitiel) étaient resservies
  indéfiniment avec un code de sortie 0. 137 des 365 entrées de la base locale étaient dans ce cas.
  `isCrawlFailure` n'était appliquée qu'au crawl, jamais à la lecture du cache.
- **Base de cache par répertoire** : le repli `resolve(process.cwd(), "data/bxc.sqlite")` donnait
  une base distincte à chaque dossier depuis lequel bxc était lancé. Repli désormais sur
  `~/.bxc/bxc.sqlite`.
- **`scrape --markdown` rendait 0 octet avec un code de sortie 0** : une sortie vide est désormais
  une erreur nommant le profil, la source et la taille du HTML.
- **La ligne `[smartFetch]` polluait stdout**, donc le Markdown de chaque page. Passée sur stderr.
- **`bun run build:linux` ne construisait pas `bxc-engine`** : le workspace a un paquet racine, donc
  `cargo build` sans `--workspace` ne construit que lui. Les profils navigateur étaient muets faute
  de moteur, sans qu'aucune erreur ne l'explique.
- **`bxc-engine` sans `default-run`** malgré deux `[[bin]]` : `bxc chrome` échouait en
  « no bin target named bxc-engine ».
- **Le convertisseur Markdown natif faisait exploser les tableaux** : 89 008 045 o de sortie pour
  514 791 o d'entrée (×172,9, une ligne de 984 840 caractères) contre 169 387 o en 31 ms pour le
  convertisseur JS. Garde de ratio ajoutée ; le correctif de fond côté Rust reste à faire.

### Documentation

- `docs/RAPPORT-DEFAUTS-2026-09-05.md` : treize défauts mesurés, chacun avec sa reproduction, son
  chiffre et son état.

---

## [0.9.3] - 2026-09-04

### Fixed

- **Les deux historiques `main` et `master` sont refusionnés.** Ils portaient le
  même travail sous des SHA différents (historique réécrit), donc une
  merge-base vieille de 200 commits et 38 conflits qui n'en étaient pas. `main`
  repart de l'arbre de `master` — releases 0.9.1 et 0.9.2, auto-update horaire,
  watchdog, headers navigateur complets — avec le seul commit qui lui était
  propre réappliqué par-dessus. Plus rien ne diverge entre les deux branches.
- **Le watchdog ne relance plus une unit sortie sur un code qu'elle déclare
  non-relançable.** Le volet « units en échec » redémarrait tout ce qui matche
  `bxc*`, y compris les daemons de purge X et wonderbot dont le
  `RestartPreventExitStatus=77` sert précisément à rester en `failed` quand les
  credentials sont rejetés. Toutes les 5 minutes, le watchdog rejouait donc un
  démarrage voué à l'échec et noyait le signal « il faut renouveler la session ».
  La garde lit la déclaration de l'unit, sans liste en dur.
- **La chaîne de packaging Windows est de nouveau raccordée** :
  `build-windows.ps1` écrit dans `dist\standalone\windows` depuis l'alignement
  package management, `deploy-windows.ps1` lisait toujours `dist\windows` et
  empaquetait un répertoire vide.
- Le profil statique n'annonce plus d'UA `Bxc/*` : le test du handler
  `Emulation` attendait encore ce marqueur, resté rouge dans la 0.9.2 alors que
  le jeu de headers navigateur complet est justement là pour ne plus se
  déclarer robot.

### Changed

- `bun.lock` et `rust-bridge/Cargo.lock` resynchronisés avec les manifestes :
  les bumps 0.9.1 / 0.9.2 avaient touché les `package.json` et les `Cargo.toml`
  sans régénérer les verrous, qui épinglaient encore les crates locales en
  `0.1.0` et trois workspaces sur des plages périmées.
- `ai.json` et `gemini-extension.json` repassent à la version du dépôt : ils
  étaient figés en 0.7.0, trois releases en arrière.

---

## [0.9.2] - 2026-09-04

### Added

- **Watchdog d'auto-remédiation** (`scripts/bxc-watchdog.sh`,
  `bxc-watchdog.timer`, 5 min) : endpoint CDP en échec 3 cycles de suite,
  mémoire d'un service au-dessus de 90 % de son `MemoryMax`, unit `bxc*` en
  `failed`. Chaque action est rate-limitée par un cooldown (30 / 60 min) — un
  watchdog qui redémarre en boucle est pire que la panne qu'il traite. Les
  services attendus actifs mais arrêtés sont **signalés, pas relancés** : un
  arrêt manuel est une décision.
- `bxc-scheduler.service` (planificateur `Bun.cron` in-process) et les units du
  watchdog sont désormais posées et activées par `bxc-control.sh deploy` — elles
  tournaient en prod sans jamais être rafraîchies depuis le dépôt.
- `.mcp.json` versionné : le serveur `bxc-native-mcp` est déclaré au niveau du
  projet, plus besoin de câblage manuel par poste.

### Fixed

- **L'auto-update horaire suit la branche du checkout**, plus `main` en dur. La
  prod tourne sur `master` : `bxc-auto-update.service` échouait à chaque passage
  (« fast-forward impossible : l'historique local a divergé ») sans jamais rien
  mettre à jour, et laissait une unit en `failed` en permanence.
  `BXC_UPDATE_BRANCH` force toujours le comportement.
- `bxc-watchdog.timer` passe à `OnUnitInactiveSec` : sur un `Type=oneshot`,
  l'intervalle doit se compter depuis la **fin** du passage précédent, sinon
  deux runs peuvent se chevaucher.
- **`bxc-control.sh deploy` ne remplace plus les wrappers du checkout.**
  `/usr/local/bin/bxc` est un wrapper bash et `~/.local/bin/bxc` un symlink vers
  `bin/bxc` : les écraser par le standalone de 291 Mo faisait tourner la prod
  sur un binaire figé, pendant que l'auto-update horaire mettait consciencieusement
  à jour un checkout que plus rien n'exécutait. `BXC_DEPLOY_BINARY=1` force
  l'ancien comportement.
- L'auto-update ne redémarre plus les services quand le checkout est **en
  avance** sur l'amont (commits locaux non poussés) : `merge --ff-only` était un
  no-op, mais les trois services redémarraient à chaque passage horaire.

---

## [0.9.1] - 2026-09-03

### Fixed

- **VoirAnime — les deux pages d'une série sont scrapées.** Une série existe en
  VF *et* en VOSTFR sur deux pages distinctes ; n'en lire qu'une laissait un
  lecteur VF mort sans remplaçant possible. Mapping Kai ajouté au passage.

### Changed

- Dépendances remises à niveau dans leurs plages semver (`@biomejs/biome`
  2.5.12, `patchright` 1.62.3) et plages `^` réalignées sur l'installé.
- Bump de tous les paquets npm (16 workspaces + racine), des crates Rust du
  workspace, du serveur MCP et du plugin Claude Code.

---

## [0.9.0] - 2026-09-03

### Added

- **Cœur média `src/media/`** (export `@aphrody/bxc/media`) : reconnaissance de
  l'hébergeur, déballage des scripts compressés, extraction de la piste, lecture
  des playlists HLS, résolution d'un embed. voiranime et anime-sama n'ont plus
  de code de lecteur en propre. Rien n'est jamais `eval`-ué : les charges
  `eval(function(p,a,c,k,e,d))` sont rejouées. Réseau injecté via
  `MediaTransport`, d'où 49 tests hors ligne ; `resolveEmbed` ne lève jamais.
- **`packages/animesama`** — scraper anime-sama.to : catalogue, saisons,
  épisodes, lecteurs, adossé au cœur média.
- **`packages/frames`** — « d'où vient cette image ? ». Index local image par
  image (descripteur MPEG-7 ColorLayout, 33 octets/trame) et client trace.moe en
  recours, interrogé par vecteur : 33 entiers partent, jamais l'image.
- **Multiplateforme Windows 11** — chemins via `src/utils/platform-paths.ts`,
  config via `src/config/resolve.ts`, installation en une commande
  (`install.sh` / `install.ps1`) et `bxc self-update [--check]`. Audit :
  [`CROSS-PLATFORM.md`](CROSS-PLATFORM.md).
- **Publication de tout le dépôt** dans l'ordre des dépendances, hook
  `postinstall` conservé.

### Fixed

- Le plugin Claude Code `plugins/bxc/` se charge enfin dans Claude Code.

---

## [0.8.0] - 2026-09-02

### Added

- **`packages/ietv`** — catalogue Inazuma Eleven TV : YouTube (flux Atom),
  site officiel (JSON-LD), Pluto.tv multi-région, chronologie Wikipédia (dates
  de diffusion, titres originaux), films nommés, métadonnées d'épisode et
  langue par chaîne, gestion VF/VOSTFR. Cache SQLite multi-couches, serveur
  REST + client universel (`@aphrody/ietv-client`), player media-chrome +
  hls.js et transcodage mediabunny.
- **`packages/wonderbot`** — bot Discord du catalogue IETV, jamais de scraping
  en direct : il lit le cache et le rafraîchit lui-même toutes les 6 h. Forum
  comme catalogue (un fil par saison, message d'ouverture modifié),
  rafraîchissement au démarrage si périmé, réparation bornée des trous, lecteur
  vidéo intégré — aucun lien sortant.

### Fixed

- Aucun nom déposé sur les surfaces publiques Discord ; `/ietv` renommé plus
  tard en `/episodes`.
- `/…  rafraichir` ouvert aux administrateurs du serveur, sans quoi un serveur
  neuf n'a personne pour lancer le premier scraping.
- Un catalogue vide est toujours considéré périmé.
- `deploy` : `cp --remove-destination`, sans quoi `bin/bxc` était écrasé via un
  lien symbolique.
- Aucune minification des binaires : elle casse les `eval` CDP.

---

## [0.7.0] - 2026-08-31

### Added

- **Objectif directeur — vie privée.** Le cap du dépôt devient la protection
  des informations personnelles, la confidentialité et l'anonymat en ligne ; le
  moteur Zero-Spawn est le moyen, plus la fin. Feuille de route P0→P5 dans
  [`MEGA-PLAN.md`](MEGA-PLAN.md).
- **Noyau PII** — `src/privacy/pii.ts`, exporté par `@aphrody/bxc/privacy` et
  `@aphrody/bxc/privacy/pii` : `detectPii`, `redactPii`, `redactObject`,
  `summarizePii`, `pseudonymize`, plus les validateurs `luhn`, `ibanIsValid`,
  `nirIsValid`. Précision > rappel — seul ce qui se valide est signalé, `siren`
  reste hors des types par défaut. Pseudonymisation HMAC à sel **obligatoire** :
  elle refuse plutôt que de dégrader en hash nu. 100 % local, rien ne sort de la
  machine. Tests : `test/privacy/pii.test.ts`.
- **Purges autonomes X** — noyau partagé
  `packages/x/src/services/purge-engine.ts` (`RateGovernor`, taxonomie
  d'erreurs, `runMutationQueue`, `readWithBackoff`) : trois freins indépendants
  (jitter 4-11 s, 45 / fenêtre de 15 min, 400 / 24 h), lecture des en-têtes
  `x-rate-limit-*`, journaux reprenables en 0600 sous `~/.aphrody/`.
  - `unfollow.ts` (`purgeFollowing`) — vide la liste d'abonnements, non-mutuels
    d'abord. CLI `bxc x unfollow`, MCP `bxc_x_unfollow_purge`.
  - `purge-tweets.ts` (`purgeTweets`) — supprime tweets / réponses / médias sous
    un seuil de likes, les moins likés d'abord, en parcourant les trois
    timelines ; retweets hors périmètre par défaut. CLI `bxc x purge-tweets`,
    MCP `bxc_x_purge_tweets`.
  - Les deux : **dry-run par défaut**, `--yes` pour exécuter. 81 tests à horloge
    injectée, aucun appel live.
- **Exploitation VPS des purges** — daemons `bxc-x-unfollow.service` /
  `bxc-x-purge-tweets.service` (auto-retry ; sortie **77** = credentials
  rejetés → `RestartPreventExitStatus`, **130** = arrêt propre →
  `SuccessExitStatus`) et watchdog commun `bxc-x-purge-doctor.timer`
  (`scripts/x-purge-doctor.sh`, 10 min). Opt-in — non installés par
  `bxc-control deploy`. Procédure dans [`DEPLOY.md`](DEPLOY.md).
- `EXIT.NOPERM` (77, sysexits `EX_NOPERM`) dans `src/cli/shared.ts` : credentials
  rejetés, réessayer ne sert à rien.

### Changed

- **Les binaires standalone ne sont plus minifiés du tout.** Les `eval` CDP
  référencent des fonctions par nom (`awaitPromise`) depuis des chaînes que le
  bundler ne voit pas : `--minify` les cassait en renommant, et
  `--minify-syntax` les cassait aussi en réécrivant les déclarations. Tout
  binaire compilé échouait sur les commandes navigateur (`bxc recon <url>` →
  « awaitPromise is not defined »). `scripts/build-standalone.ts` et
  `build:mcp` compilent désormais sans minification ; `BXC_MINIFY=1` la
  réactive en connaissance de cause.
- `bin/bxc` accepte `BXC_FROM_SOURCE=1` pour court-circuiter le binaire
  standalone et repasser par les sources.

### Meta

- Versions alignées : racine `0.7.0`, `ai.json` et `gemini-extension.json`
  rattrapés depuis un `0.6.4` périmé, serveur MCP `0.9.0`,
  `@aphrody/x` **1.1.0** (nouvelle surface publique : `purge-engine`,
  `unfollow`, `purge-tweets`).
- `bun.lock` régénéré : le SDK MCP publié (`^1.30.0`) remplace l'entrée
  `workspace:*` restée dans le verrou après la version précédente.

---

## [0.6.2] - 2026-06-04

### Changed

- **Full-Bun TS surface** — converted the remaining `fs` sync calls and
  `child_process.spawnSync` to native Bun APIs (`Bun.file`, `Bun.write`,
  `Bun.spawn`) across `worldbeyblade`, mirror, and analysis scripts; n2b
  Node-API findings dropped 75 -> 59 (the remainder are false positives on
  already-`Bun.spawn` call sites). Typecheck clean.

### Fixed

- Repaired corrupted path-scrub artifacts (`atlas-from-cache.ts`,
  `test/e2e/helpers.ts`), removed the self-corrupted `scripts/path-sentinel.ts`,
  and dropped dead `packages/bxc-extension` references from CI (`ci.yml` was red
  on a clean checkout). Added `SKIP_NETWORK_TESTS=1` to the Linux/Windows test
  jobs.

### Meta

- Version manifests aligned: `ai.json` and `gemini-extension.json` corrected
  from a stale `0.6.0` to match `package.json` (now `0.6.2`).

---

## [0.6.1] - 2026-06-03

### Added

- **X Pro (Gryphon)** — `pro.x.com/i/decks` recon (`bxc detect` / `recon` / `har`), `scripts/x-pro-recon.ts`, docs [`packages/x/docs/X_PRO.md`](packages/x/docs/X_PRO.md).
- **`@aphrody/x` 1.0.6** — Gryphon GraphQL catalog overlay (12 deck ops: `ViewerAccountSync`, `CreateDeck`, …), `x-pro-deck` service, **Radar** (`SearchTimeline` + `querySource: radar`), `radar-surface`, `x-pro-surface`.
- **Rust `x-cli`** — `xpro` subcommand (`probe`, `sync`, `deck`, `create`, `remove`).
- **MCP** — `bxc_xpro_deck` tool (decks sync, radar search, probe).
- **CLI** — `bxc har record` documented; `bxc x` extended via workspace package.

### Changed

- GraphQL catalog merge: responsive-web (158 ops) + Gryphon (12 ops) in TS and Rust `x-client`.
- `X_DISCOVERY_PAGES` / `X_RECON_URLS` include `pro.x.com` and Radar routes.

---

## [0.6.0] - 2026-06-01

### Added

- Native X / Twitter client imported from `x-client`: Rust crate `x-client` under `rust-bridge/crates/` (workspace member, GraphQL + REST cookie-auth client) and pure-TypeScript port published as `@aphrody/x`.
- FFI wrappers `bxc_x_user_by_screen_name` and `bxc_x_user_tweets` exported from the `bxc-rust-bridge` cdylib (cookie auth via `auth_token` + `ct0`).
- Subcommand `bxc x <profile|tweets|search|news|whoami>` driving the `@aphrody/x` client.
- MCP tool `bxc_x_client` exposing the X client (profile / tweets / search / news / whoami) over the `bxc-native-mcp` server.

### Changed

- `bxc-native-mcp` MCP server bumped to 0.5.0; `bxc-gemini` extension manifest bumped to 0.6.0.
- Relocated the top-level `examples/` directory under `packages/x/examples/`.

---

## [0.5.8] - 2026-06-01

### Added

- Subcommand `bxc crawl-worker` to run the autonomous recursive crawler worker daemon 24/7 on the VPS.
- SQLite FTS5 Full-Text Search indexing and triggers to automatically keep the FTS virtual table `scrapes_fts` synchronized with `scrapes`.
- Sitemap XML parsing inside the autonomous crawler to dynamically extract and enqueue `<loc>` URLs.
- Proxy Pool rotation in `BrowserCrawler` and `AutonomousCrawler` to select random proxy IPs per request.
- REST `/api/v1/search/keyword` and GraphQL `keywordSearch` queries to perform FTS search natively.
- Client SDK method `searchKeyword` and MCP tool `bxc_keyword_search` to expose full-text search capabilities system-wide.
- Walkthrough documentation in `docs/autonomous_crawler_walkthrough.md`.

### Fixed

- Handled crawler daemon loop gracefully by adding a `daemon` mode option that prevents premature exits when the queue is temporarily empty.
- Restored graceful stop / abort signal control over active crawling tasks.

## [0.5.4] - 2026-05-31

### Added

- Script unifié [bxc-control.sh](file:///home/ubuntu/bxc/scripts/bxc-control.sh) pour l'automatisation des tâches de déploiement et d'administration sur le VPS (build, backup, déploiement, logs, et SSH tunnel).
- Configuration [biome.json](file:///home/ubuntu/bxc/biome.json) pour formater l'intégralité du projet en ignorant les répertoires tiers (`vendor/`, `tmp/`, `dist/`).

### Fixed

- Résolution d'un bug de double démarrage du serveur CDP sur le port 9222 dans [serve.ts](file:///home/ubuntu/bxc/src/cli/serve.ts#L969-L975) lors de l'import du module par le routeur principal, via l'ajout d'une garde `import.meta.main`.
- Correction des permissions du dossier `/var/log/bxc/` pour permettre à l'utilisateur `ubuntu` d'écrire dans les logs du service systemd.
- Vérification complète de la compilation cross-platform sur Linux, Windows MSVC, et WebAssembly (`wasm32-unknown-unknown` sur `bxc-rust-bridge` et `obscura-dom`).

### Documentation

- Fusion complète des notes techniques de Lightpanda Windows dans le guide centralisé [BUILD-WINDOWS.md](file:///home/ubuntu/bxc/docs/BUILD-WINDOWS.md) et suppression du fichier doublon `docs/LIGHTPANDA-WINDOWS.md`.
- Mise à jour de [CLAUDE.md](file:///home/ubuntu/bxc/CLAUDE.md) pour y documenter la procédure de mise à jour automatisée de version.

## [0.5.3] - 2026-05-29

### Refactored

- Restructuration, unification et modularisation complète du scraper et de l'analyseur métagame de **WorldBeyblade** sous le module unifié [worldbeyblade](file:///home/ubuntu/bxc/packages/worldbeyblade/src/).
- Décomposition de la logique monolithique en sous-modules spécialisés :
  - [types.ts](file:///home/ubuntu/bxc/packages/worldbeyblade/src/types.ts) : interfaces et typages stricts (sans `any`).
  - [scraper.ts](file:///home/ubuntu/bxc/packages/worldbeyblade/src/scraper.ts) : client d'automatisation de forum MyBB (profiles, threads, MPs).
  - [rankings.ts](file:///home/ubuntu/bxc/packages/worldbeyblade/src/rankings.ts) : synchronisation et parsing hors-ligne des classements via Wayback CDX.
  - [analytics.ts](file:///home/ubuntu/bxc/packages/worldbeyblade/src/analytics.ts) : normalisation des pièces (Blades, Bits) et calculs mathématiques (Podium Score, Combo Synergy).
  - [index.ts](file:///home/ubuntu/bxc/packages/worldbeyblade/src/index.ts) : export "barrel" propre.
- Simplification du script d'analyse [bbx_metagame_analyst.ts](file:///home/ubuntu/bxc/scripts/bbx_metagame_analyst.ts) (-500 lignes de code dupliqué) en important les fonctions analytiques partagées du module principal.
- Mise en conformité stricte `oxlint` et formatage `biome` de tous les fichiers modifiés.
- Ajout de tests unitaires hors-ligne complets pour l'analyse métagame dans [worldbeyblade.test.ts](file:///home/ubuntu/bxc/test/scrapers/worldbeyblade.test.ts).

### Documentation

- Alignement du [README.md](file:///home/ubuntu/bxc/README.md) et de la landing page GitHub Pages [index.html](file:///home/ubuntu/bxc/docs/index.html) avec les meilleures pratiques (Table des matières, balises meta de SEO, liens vers les guides développeurs de Google Atlas et Playwright Killer Plan, versioning).

## [0.5.2] - 2026-05-29

### Added

- Outils MCP natifs WBO:
  - `bxc_wbo_rankings` : recherche filtrée des classements des joueurs WBO.
  - `bxc_wbo_metagame` : requêtes sur les statistiques métagames des pièces de Beyblade X.
- Découverte automatique des compétences IA : ajout de métadonnées YAML frontmatter conformes aux spécifications Gemini CLI.
- Documentation IA-Optimisée : création de `docs/llms.txt` pour indexer le contexte des agents.

## [0.5.1] - 2026-05-29

### Added

- Dashboard interactif WBO : interface utilisateur haut de gamme (glassmorphism, mode sombre, polices Inter) tournant localement sur Elysia.
- Analyseur métagame Beyblade X : calcul des performances pondérées des pièces (Weighted Podium Score) et des synergies de combos (Combo Synergy Score).

## [0.5.0] - 2026-05-29

### Added

- Scraper Voiranime : moteur d'extraction des animés, saisons, épisodes et lecteurs vidéos avec résolveur de flux HLS natif.
- Base de données Dragon Ball : mapping structuré des épisodes et sagas.

## [0.4.0] - 2026-05-29

### Added

- Recherche Web Google (`bxc search`) : intégration de la recherche web via le paramètre stable `udm=14` avec support de cookies playwrigth, proxy et fallback automatique vers `ghost` (Lightpanda) ou `http` (curl-impersonate).
- Routage intelligent Google Atlas.

## [0.3.1] - 2026-05-29

### Added

- Rétablissement des profils `http` (curl-impersonate) et exportations des parseurs de tournois Challonge.

## [0.1.0-alpha.1] - 2026-05-12

### Added

- Trinity Architecture: integration native Rust (`rust-bridge`) et Python (`python-bridge`) via FFI
- Spécialisation Google: détection avancée, DNS, rate-limiting et stratégies spécifiques pour l'écosystème Google
- Support des sous-modules `depot_tools` pour la gestion des dépendances Chromium

## [0.2.0] - 2026-05-10

### Added — Phase 1 (CDP coverage)

- CDP dispatcher refactor: monolithic switch (~395 LOC) split into 16 modular domain handlers under `src/cdp/domains/` (Page, Target, Browser, DOM, Runtime, Network, Emulation, Security, Accessibility, Input, Fetch, IO, Tracing, Audits, Performance, Log) — chain-of-responsibility via `DomainHandler` interface in `src/cdp/types.ts`
- CDP coverage extended from 25 working / 17 stubs to **76 working methods** across all 15 agent-browser domains (97 RPC matrix in `docs/CDP-COVERAGE.md`)
- Target domain complete: `createBrowserContext`, `getTargets`, `detachFromTarget` + `detachedFromTarget` event (10/10 methods)
- Browser domain complete: `getWindowForTarget`, `grantPermissions`, `setDownloadBehavior`, `setContentsSize` + download events (6/6 methods)
- Runtime domain complete: `addBinding` + `consoleAPICalled` / `exceptionThrown` event helpers (6/6 methods)
- Tracing domain new: `Tracing.start` / `Tracing.end` + `dataCollected` (8 synthetic TEF events) + `tracingComplete` event (2/2 methods)
- Network domain complete: in-memory cookie jar (RFC 6265 matching), response body cache, extra headers injection. Events `requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed` emitted during `Page.navigate` (8/8 methods + 4 events)
- Fetch domain new: request interception via URL pattern, `fulfillRequest` (mock response), `failRequest` (abort), `continueRequest` (resume), `continueWithAuth` (credentials) + `requestPaused` event (6/6 methods)
- IO domain new: `IO.read` returns base64 chunks (65536 bytes default), `IO.close` releases buffer + `registerIOStream()` helper (2/2 methods)
- Page CDP coverage: `addScriptToEvaluateOnNewDocument`, `getLayoutMetrics`, `captureScreenshot`, `printToPDF`, `setDocumentContent`, `startScreencast` / `stopScreencast`, `handleJavaScriptDialog`, `bringToFront` + `domContentEventFired` / `loadEventFired` / `frameNavigated` / `javascriptDialogOpening` events
- DOM CDP coverage: `getBoxModel`, `resolveNode`, `setFileInputFiles` and Accessibility `enable` / `getFullAXTree` (with LRU 64-entry cache, hit <0.5 ms p50, invalidated on `Page.navigate` / `reload` / `setDocumentContent`)
- Input domain new: `dispatchKeyEvent`, `dispatchMouseEvent`, `dispatchTouchEvent`, `insertText`
- Emulation extended: `setUserAgentOverride`, `setEmulatedMedia`, `setGeolocationOverride`, `setLocaleOverride`, `setTimezoneOverride`

### Added — Phase 1.5 (profile wiring)

- All 5 profiles wired in `src/cli/serve.ts` and bootable via `bxc serve --profile {static,fast,http,stealth,max}`
- Profile `http` exposed in CLI (was unwired); profiles `stealth` and `max` no longer exit with "not implemented in CLI mode"
- `test/profile-wiring.test.ts` — 5/5 boot smoke tests pass

### Added — Phase 2 (performance)

- Cold start measured with `scripts/measure-coldstart.ts` (5-10 runs, p50/p95 table, exit 1 on miss)
- Static profile cold start: **p50 = 25.4 ms** (target <50 ms), Fast profile cold start: **p50 = 35.4 ms** (target <80 ms) — both pass
- Lazy imports of `StaticDomTransport` and `HttpProfileTransport` in `serve.ts` (FFI libs not dlopen'd until first WS connection)
- `Bun.serve` port bound *before* Lightpanda spawn in `startFast` (early `/json/version` synthesis)
- Lightpanda + SocketPair waitForReady poll interval reduced from 50 ms to 10 ms
- `WeakRef<ZigDoc>` + `FinalizationRegistry` in `StaticDomTransport.ParsedDocument` — native DOM memory reclaimable by GC
- `Bun.gc(false)` hint added after `Page.navigate` completes in `StaticDomHandler`
- RSS reduction: 67-76 MB peak to ~39 MB idle (47% reduction). Bun runtime floor ~37 MB makes 30 MB target impossible without runtime patch
- Accessibility AX cache LRU (max 64 entries) keyed by `sessionId|loaderId` — cache hit <0.5 ms p50
- Engine comparison benchmark `benchmarks/agent-browser-engine.bench.ts`: bxc is **19-54% faster than Chrome** on cold start, snapshot p50 = 187 ms vs Chrome 1565 ms (8.4x faster)
- 0 regressions: 545 pass / 4 skip / 4 fail (pre-existing)

### Added — Phase 3 (E2E)

- E2E tests against production sites (`test/e2e/agent-browser-stealth.e2e.test.ts`): gemini.google.com, workspace.google.com (Next.js prod custom CDN), challonge.com (anti-bot + cookies persistants)
- Bxc skill for agent-browser usage (`.claude/skill-data/bxc/SKILL.md`)
- Auto-escalation pipeline `src/profiles/auto-escalation.ts` (static -> fast -> stealth -> max)

### Added — Phase 4 (distribution)

- **Multi-platform standalone executables**: `scripts/build-standalone.ts` produces 4 binaries (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`) via `bun build --compile --target=bun-<platform>`
- `BXC_TARGETS=linux-x64,darwin-arm64` env flag for subset builds; `BXC_HOST_ONLY=1` for host arch only
- Output table `target | ok | sizeMB | error` rendered after build; exit 0 if at least one target succeeds, exit 1 if all fail
- CI release matrix `.github/workflows/release.yml`: 4 native runners (ubuntu-latest x2 for linux x64/arm64, macos-latest x2 for darwin x64/arm64); upload-artifact + softprops/action-gh-release on `v*` tags; npm publish job on tagged stable releases
- Note on local builds: only the host target builds reliably on a single VPS; cross-compile darwin/arm64 from linux-x64 may fail at link time (FFI libs are runtime-resolved, but Bun's compile target depends on host capabilities). **Multi-platform builds are produced via the CI matrix** — local builds default to host arch via `BXC_HOST_ONLY=1`.
- `linux-x64` standalone size: ~96 MB ; cold start ~50 ms ; CDP `/json/version` smoke test pass

---

## [0.1.0-alpha.0] - 2026-05-10

### Added (Vague 4 — improvements)

- Bun-native migration: 12 source files migrated from `node:*` to `Bun.file` / `Bun.write` / `Bun.spawn` / `Bun.$` / `Bun.gunzipSync` / `Bun.Cookie` — 140/140 tests pass after migration
- Plugin Claude Code marketplace-ready 0.2.0: 8 agents, 8 slash commands, 1 skill, 10 references, 4 hooks, 1 MCP server (`bxc-mcp`)
- Plugin best-practices fixes: frontmatter `model` + `color`, `argument-hint` on all commands, Style B examples, Claude-instructions tone — 14 fixes total
- MCP server `bxc-mcp` (Bun-native TypeScript) exposing `bxc_scrape`, `bxc_detect`, `bxc_extract_cookies`, `bxc_pool_run`
- `plugin.json` marketplace metadata (semver 0.2.0, SPDX MIT, `.claude-plugin/README.md`)

### Added (Vague 3 — integrations)

- `agent-browser` engine `bxc` in Rust (983 LOC, `cli/src/native/cdp/bxc.rs`), 30 unit tests + 5 integration tests pass; branch `feat/bxc-engine` PR-ready against vercel-labs/agent-browser
- CLI `bxc serve --cdp-port N --profile P` (684 LOC, `src/cli/serve.ts`)
- Wappalyzergo framework detector (`src/detect.ts`): 3000+ technologies via Go binary, 20/20 tests pass; auto-routing via `src/router/{challenge-detect,framework-strategy}.ts`
- 20 modern network CLIs installed system-wide: xh, hurl, oha, k6, httpx, trippy, doggo, jaq, dasel, aria2, gron, bombardier, vegeta, gping, bandwhich, dust, procs, sd, wrk (documented in `MODERN-NET-CLI.md`)
- Cookie injection multi-format (`src/cookies/`): Playwright JSON / CDP / Netscape to CDP `Network.setCookies` + http profile Cookie header; 12/12 challonge.com auth tests pass
- Crawlee patterns (`src/{pool,queue,storage}/`, `src/utils/{sitemap,robots}.ts`): RequestQueue (`bun:sqlite` state machine PENDING/LOCKED/DONE/FAILED with dead-letter queue), AutoScaledPool, ProxyPool, SessionPool, Dataset (append-only JSONL via `Bun.file().writer()`), KeyValueStore (dual-backend: sqlite < 64 KiB / blob > 64 KiB), Sitemap XML parser, robots.txt RFC 9309 — 49/49 tests pass
- Plugin Claude AI onboarding: 4 initial agents (`bxc-scraper`, `bxc-crawler`, `bxc-debugger`, `bxc-cookie-extractor`), 4 slash commands (`/init`, `/scrape`, `/crawl`, `/detect`), 1 skill with 8 references, 8 reference docs
- Google Developers research report on agent/skill best practices (707 LOC, `docs/AGENTS-SKILLS-BEST-PRACTICES.md`, 35 curated sources)
- Brotli decompression fix using `node:zlib.brotliDecompressSync` (Bun does not expose brotli decompress natively)

### Added (Vague 2 — finalisation)

- Fork Bun build validation: codegen confirmed (`ResolvedSourceTag.zig` contains `@"bun:browser" = 512`), commit `a0bf70d` in `forks/bun/`
- Profile `http` (curl-impersonate): 13/13 tests pass, JA4 fingerprint Chrome 131 validated against tls.peet.ws; 34 supported TLS profiles documented in `docs/CURL-IMPERSONATE.md`
- Profile `stealth` + `max` audit: 26 tests pass + 4 skip (Chromium/Firefox not installed); skip with logged reason
- Benchmarks complete: 6 runners (bxc-static, bxc-fast, fetch-native, cheerio, jsdom, puppeteer), 4 scenarios (static-simple, spa-react, cloudflare-basic, parallel-100), results in `benchmarks/results/2026-05-10.{json,md}`
- zigquery wire + pool + interception: 9/9 tests pass

### Added (Vague 1 — initial)

- Profile `fast` (Lightpanda CDP sub-process, `src/transport/SocketPairTransport.ts`): 8 tests pass, goto latency 64-707 ms on 5 SPAs (HackerNews, react.dev, nuxt.com, nextjs.org, svelte.dev)
- Fork Bun architecture (`forks/bun/`): patches to `HardcodedModule.zig` + `ModuleLoader.zig` exposing `bun:browser` builtin; `src/js/bun/browser.ts` (28 KB); codegen valid
- curl-impersonate FFI binding (`src/ffi/curl-impersonate.ts`, 782 LOC): `bun:ffi` binding to `libcurl-impersonate-chrome.so.4.8.0` (2.5 MB, lexiforest v1.5.6, 34 profiles)
- Stealth stack (`src/profiles/stealth/`, `src/profiles/max/`, 1700 LOC): patchright integration, Camoufox v135 Firefox fork, browserforge fingerprint generation, CapSolver Turnstile/reCAPTCHA/hCaptcha solver (mock when `CAPSOLVER_API_KEY` absent)
- Benchmarks scaffolding: `benchmarks/targets/urls-100.json` (100 URLs categorised: static, SPA, Cloudflare, Turnstile, ecommerce)

### Architecture

- 5 profiles: `static` (zigquery in-process), `fast` (Lightpanda CDP), `http` (curl-impersonate FFI), `stealth` (patchright Chromium), `max` (Camoufox v135 + CapSolver)
- cdylib zigquery 1.7 MB (`vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so`, 20 C ABI symbols)
- curl-impersonate 2.5 MB (`vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0`)
- 14 328 LOC TypeScript (src + test + benchmarks)
- 150+ tests pass, 0 fail, ~6 conditional skips
- Bun-native throughout: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.$`, `Bun.Cookie`, `Bun.Glob`, `bun:sqlite`, `bun:ffi`, `bun:test`

### Tested production targets

- HackerNews, react.dev, nuxt.com, nextjs.org, svelte.dev (SPA classics)
- gemini.google.com, workspace.google.com (Next.js prod, custom CDN)
- design.google, developers.google.com (static)
- challonge.com/fr/B_TS5 (anti-bot + persistent cookies)
- nowsecure.nl, tls.peet.ws (JA4 fingerprint validation)
- www.cloudflare.com (CF basic)

---

[Unreleased]: https://github.com/aphrody-code/bxc/compare/v0.5.3...HEAD
[0.5.3]: https://github.com/aphrody-code/bxc/releases/tag/v0.5.3
[0.5.2]: https://github.com/aphrody-code/bxc/releases/tag/v0.5.2
[0.5.1]: https://github.com/aphrody-code/bxc/releases/tag/v0.5.1
[0.5.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.5.0
[0.4.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.4.0
[0.3.1]: https://github.com/aphrody-code/bxc/releases/tag/v0.3.1
[0.2.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.2.0
[0.1.0-alpha.0]: https://github.com/aphrody-code/bxc/releases/tag/v0.1.0-alpha.0
