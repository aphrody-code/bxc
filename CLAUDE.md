# CLAUDE.md — bxc

> Contexte général partagé avec Gemini : voir [`GEMINI.md`](./GEMINI.md).  
> Mémoire agy VPS : `~/.gemini/antigravity-cli/MEMORY.md` · deploy : [`DEPLOY.md`](./DEPLOY.md).
> Ce fichier liste ce qui est **spécifique à Claude Code** ou ce qu'il faut
> rappeler systématiquement.

bxc — moteur de navigation "Zero-Spawn" pour agents IA. Bun runtime + Rust V8
bindings + historique Zig DOM. Publié sur GitHub Packages comme
`@aphrody/bxc` (repo `aphrody-code/bxc`), consommé par `rpb-challonge` (vps).

## Objectif directeur (depuis 2026-08-27)

**Protection des informations personnelles, confidentialité, anonymat en ligne.**
Le moteur de navigation est le moyen, plus la fin. Évaluer toute feature à
l'aune de « est-ce que ça réduit l'exposition de l'utilisateur ? ».

- **Noyau commun** : `src/privacy/pii.ts` (export `@aphrody/bxc/privacy`) —
  détection + caviardage des données identifiantes. Tout ce qui doit
  *reconnaître* une donnée perso passe par là, comme les deux purges X
  partagent `purge-engine.ts`. Précision > rappel : ce qui se valide est validé
  (Luhn, IBAN mod-97, clé NIR) ; `siren` est hors des types par défaut (9
  chiffres sur 10 passent Luhn). Pseudonymisation HMAC à sel obligatoire —
  refuser plutôt que dégrader en hash nu. Tests : `test/privacy/pii.test.ts`.
- **Briques existantes qui servent déjà l'objectif** : purges X (minimisation
  des données publiées), `src/profiles/fingerprint.ts` + `ghost/`
  (empreinte de navigation), `src/cookies/` (cloisonnement des sessions).

## Rappels critiques

- **Test scope** : `bun test test/ packages/ src/` — **jamais sans path**, sinon
  bun walk `vendor/` (mcp-sdk) et meurt.
- **Nommage** : tout identifiant/ref code/docs/binaires doit être `bxc*`. Le
  rebrand est terminé — ne réintroduire aucun ancien nommage de projet.
- **`packages/api`** : entry réel = `src/index.ts` (Elysia `.listen()`), PAS
  le `index.ts` racine (stub `bun init`). Cf. `packages/api/CLAUDE.md`.
- **Docs x/xai** : 
  - `packages/x/README.md` (complete: features, algo ranking from x-algorithm, X+Grok synergy, usage, CLI, MCP, prod notes).
  - `packages/xai/README.md` (complete & lisible: TOC, auth/SuperGrok, high-level Chat API with full examples for createChat/append/sample/stream/executeToolCalls/sampleStructured, XTools + tool defs + injectable for tests, native integration loops, quick ref, prod notes, contributing).
  See packages/xai/examples/grok-x-agent.ts for runnable native X + Grok example (docs item 7).
  - **Purges autonomes** : noyau partage `packages/x/src/services/purge-engine.ts`
    (`RateGovernor`, taxonomie d'erreurs, `runMutationQueue`, `readWithBackoff`). Trois freins
    independants (jitter 4-11 s, 45 / fenetre 15 min, 400 / 24 h) + headers `x-rate-limit-*`,
    journaux reprenables 0600 sous `~/.aphrody/`. **Un fix dans le noyau vaut pour les deux.**
    - `unfollow.ts` (`purgeFollowing`) — vide les abonnements, non-mutuels d'abord.
      CLI `bxc x unfollow`, MCP `bxc_x_unfollow_purge`, journal `x-unfollow-<handle>.json`.
    - `purge-tweets.ts` (`purgeTweets`) — supprime tweets/reponses/medias sous un seuil de
      likes, moins likes d'abord ; parcourt les 3 timelines (aucune n'est un sur-ensemble des
      autres) ; retweets hors scope par defaut (leurs likes ne sont pas les tiens).
      CLI `bxc x purge-tweets`, MCP `bxc_x_purge_tweets`, journal `x-purge-tweets-<handle>.json`.
    Les deux : dry-run par defaut, `--yes` pour executer. Exploitation VPS : daemons
    `bxc-x-unfollow.service` / `bxc-x-purge-tweets.service` (auto-retry ; code de sortie **77**
    = credentials rejetes → `RestartPreventExitStatus`, **130** = arret propre →
    `SuccessExitStatus`) + watchdog commun `scripts/x-purge-doctor.sh`.
    Tests : `packages/x/unfollow.test.ts` (41) + `packages/x/purge-tweets.test.ts` (40),
    horloge injectee, aucun appel live.
  - Root README.md table and sections link to them.
  - Keep in sync with code changes (new Chat methods, XTools, etc.). Tests: see `packages/x/index.test.ts`, `packages/x/unfollow.test.ts`, `packages/x/purge-tweets.test.ts` et `packages/xai/index.test.ts` (118 pass + 2 live-skipped = 120 total across packages; covers Chat full surface + stream/toolDeltas/execute/sampleStructured, XTools injectable+auto-dispatch+defs, algo rank full (filters/scoring/diversity), cross synergy with mock XClient, no live by default).
  - Sub-docs: packages/x/docs/ (COVERAGE.md updated with algo/tests notes, X_PRO.md, etc.).
- **`packages/xai`** (avec `packages/x`): client xAI/Grok natif. Toujours étendre createChat pour features Python SDK (reasoning_effort, search_parameters, structured zod/simple), XTools pour actions x (tweets/news/whoami+), améliorer erreurs Chat, tests unit tool-calling, compat SUPER_GROK_TOKEN. Mettre à jour README + CLAUDE. Focus combo Grok+X production agents. Vérif: bun test packages/xai/ + typecheck + lint (scoped, no live).
- **Services longs testables** : injecter `now` / `sleep` / `random` dans les
  options (cf. `packages/x/src/services/purge-engine.ts`) → budgets, fenêtres
  glissantes et backoff se testent sur horloge factice, sans attente réelle.
- **MCP server** : `src/mcp/server.ts` (`bxc-native-mcp`, version = const en
  haut du fichier). Build : `bun run build:mcp` → `dist/standalone/bxc-mcp`.
  Manifest Gemini = `gemini-extension.json` (pointe sur `/usr/local/bin/bxc-mcp`).

- **Claude Code Plugin (recommended)**: The complete reusable plugin lives at `plugins/bxc/`.
  It bundles generalized skills (bxc-core, rust-ffi, x-client, grok-xai, mcp-server, scraper, autopilot, docs), 7+ dedicated sub-agents, commands (`/bxc-verify` etc.), enforcement hooks, and MCP wiring.
  Install with the plugin-dev workflow or directly via `--plugin-dir plugins/bxc`.
  Use it (or load its skills/agents) for any bxc-like project. It follows the anthropics/claude-code plugin-dev patterns (see `plugins/plugin-dev-reference/`).
  Update the plugin when you add major capabilities to bxc (new agents, skills, cross-platform notes). The plugin README contains the install + adaptation guide for other projects.

- **Cœur média `src/media/`** (export `@aphrody/bxc/media`) : reconnaissance de
  l'hébergeur, déballage des scripts compressés, extraction de la piste,
  lecture des playlists HLS, résolution d'un embed. **voiranime et anime-sama
  n'ont plus de code de lecteur en propre** — ils traduisent le résultat dans
  leur vocabulaire. Un hébergeur corrigé ici l'est pour les deux (même règle
  que `purge-engine.ts`).
  - **Rien n'est évalué** : les charges `eval(function(p,a,c,k,e,d))` sont
    rejouées, jamais exécutées — c'est du code tiers arbitraire.
  - **Le réseau passe par `MediaTransport`**, injecté par l'appelant (page bxc,
    `fetch`, cache). D'où 49 tests sans réseau.
  - `resolveEmbed` **ne lève jamais** : un échec est décrit dans `error` avec
    l'hébergeur et les candidats — un scraper qui parcourt 30 épisodes ne doit
    pas s'arrêter sur un lecteur cassé.
  - Chaque candidat porte **sa provenance** (`rule`, `layer`, `offset`,
    `confidence`) : quand un hébergeur change sa page, on voit quelle règle a
    mordu au lieu de constater une URL vide.
  - Les URL de variantes sont **absolues** et les qualités de même hauteur sont
    départagées par leur débit (`416p (1282 kbps)`).
  - `playbackHeaders()` rend le `Referer`/`Origin` sans lequel le flux répond
    403 : première cause du « ça marche dans le navigateur, pas en CLI ».

- **`packages/frames`** : « d'où vient cette image ? ». Index local image par
  image (descripteur MPEG-7 ColorLayout, 33 octets/trame) + client trace.moe en
  recours. Sert l'objectif vie privée : en local **rien** ne sort ; en distant
  c'est `searchByVector` — 33 entiers partent, jamais l'image (précision
  mesurée identique : 0,9920 contre 0,9919 en téléversant).
  - **Le descripteur est global** : une incrustation, une bordure ou un
    recadrage change le vecteur. Les vignettes YouTube brandées de la chaîne
    IETV échouent (1 sur 10 au-dessus du seuil 0,90) ; une capture plein cadre
    donne 0,99. Ne jamais indexer une vignette à la place d'une trame.
  - **Une seule taille de vignette** pour l'index et pour la requête
    (`FrameSearch.size`) : deux tailles donnent des vecteurs différents. Au-delà
    de 64 px le descripteur ne bouge plus (mesuré identique jusqu'à 512).
  - **`ffmpeg` est la seule dépendance externe** ; le processus et le `fetch`
    sont injectables, d'où 61 tests sans ffmpeg ni réseau.
  - Ordres de grandeur mesurés : 24 min indexées à 1 img/s en 10,7 s (135×
    temps réel), 92 Ko/épisode, 32,5 Mo pour 412 épisodes, recherche
    exhaustive de 593 280 trames en ~500 ms.
  - trace.moe : 100 recherches/24 h sans clé, **une seule à la fois** — une
    requête concurrente est refusée avec le même code (402) qu'un quota épuisé,
    le client tranche avec le quota connu.

- **`packages/ietv` + `packages/wonderbot`** : catalogue Inazuma Eleven TV et son
  bot Discord. **Le bot ne scrape jamais en direct** — il lit le cache SQLite
  (`~/.cache/ietv/episodes.db`, `IETV_CACHE_PATH`) et le rafraîchit lui-même
  toutes les 6 h ; c'est ce qui évite qu'un serveur de 2 000 membres déclenche
  2 000 scrapings. Un seul module (`src/bot.ts`) parle à discord.js, tout le
  reste (config, catalogue, annonces, planificateur, commandes, rendu) se teste
  avec des objets littéraux — 63 cas, sans jeton, sans réseau, sans SQLite.
  - **Aucun intent privilégié** : `Guilds` seul. Les rôles de l'appelant sont
    dans la charge utile de l'interaction ; demander `GuildMembers` sans l'avoir
    coché dans le portail ferme la passerelle (4014) et fait boucler le service.
  - **`/episodes rafraichir` est ouvert aux administrateurs du serveur**, en plus de
    `WONDERBOT_STAFF_ROLE_IDS` : gater sur la seule liste de rôles laisse un
    serveur neuf sans personne pour lancer le premier scraping, propriétaire
    compris. `memberPermissions` arrive dans l'interaction, aucun intent requis.
  - **Surfaces publiques sans nom déposé** : nom et descriptions de la commande,
    pied de page des embeds, noms de salons. La racine s'appelait `/ietv` — d'où
    le renommage en `/episodes`. Les journaux dérivent de `DEFINITION_IETV.name`
    pour qu'un renommage ne laisse plus de message obsolète.
  - **La visibilité se fige au `deferReply`** : `editReply` refuse le drapeau
    `Ephemeral`. Le choix privé/public se fait donc AVANT d'exécuter la commande
    (`reponsePrivee()`).
  - **Rafraîchir = scraper d'abord, remplacer ensuite.** Vider la base avant de
    scraper laisse un catalogue vide quand le réseau tombe.
  - **Rafraîchissement au démarrage SI périmé** (jamais systématique : un
    `restart` en boucle martèlerait les sources) + boucle 6 h.
  - **Réparation bornée** : un trou = un numéro absent ENTRE le premier et le
    dernier épisode connus (une saison qui s'arrête à E12 est en cours, pas
    trouée). 2 tentatives espacées de 15 min par trou, puis il est *confirmé* et
    affiché dans le fil de la saison au lieu d'être retenté indéfiniment. Un trou
    disparu récupère ses tentatives.
  - **Le forum = le catalogue** (`WONDERBOT_FORUM_CHANNEL_ID`) : un fil par
    saison, message d'ouverture MODIFIÉ et non republié (sinon les réponses des
    membres sont noyées), fil retrouvé par identifiant mémorisé en cache, jamais
    supprimé. Une saison complète ne tient pas dans un embed (4 096) → format
    compact + découpage sous les 6 000 du message.
  - **Le premier passage n'annonce rien** : il amorce le journal, sinon un bot
    fraîchement installé déverserait 1 200 messages. Le journal mémorise des
    identifiants, pas une date (une source peut remettre en ligne un épisode
    ancien).
  - `packages/ietv/src/video-*.ts` : player media-chrome + hls.js et transcodage
    mediabunny. `media-chrome`, `hls.js` et `@mediabunny/server` sont des peers
    **optionnelles** chargées à l'exécution — rien n'entre dans le binaire `bxc`.
    Bun n'implémente pas WebCodecs : sans `@mediabunny/server`, `transcode()`
    échoue d'emblée en nommant le paquet à installer.

## Commandes essentielles

```bash
bun install                                  # deps workspace
bun test test/ packages/ src/                # scope interne uniquement
bun run build                                # rust-bridge + msvc + standalone
bun run build:linux                          # Linux Rust cdylib + standalone
BXC_TARGETS=linux-x64 bun scripts/build-standalone.ts  # rebuild TS seul (sans cargo)
sudo install -m755 dist/standalone/bxc-linux-x64 /usr/local/bin/bxc  # deploy binaire seul
bun run typecheck                            # tsc --noEmit sur workspaces
bun run lint                                 # oxlint .

# Commandes des Scrapers dédiés
bun src/cli/index.ts fut price <url>         # FIFA Ultimate Team Price
bun src/cli/index.ts voiranime search <q>    # VoirAnime search (ex: "inazuma")
bun src/cli/index.ts animesama seasons <slug> # anime-sama.to (search|info|seasons|episodes|resolve)
bun src/cli/index.ts frames search <img>     # d'où vient cette image : index local puis trace.moe
bun src/cli/index.ts google search <q>       # Google Atlas Audits
bun src/cli/index.ts xcom profile <user>     # Twitter profile markdown / screenshot
bun src/cli/index.ts x whoami                # Native X client (profile|tweets|search|news|whoami|rank|foryou + x-algorithm)
bun src/cli/index.ts x foryou                # demo local For You ranking (integrated from xai-org/x-algorithm)
bun src/cli/index.ts x unfollow              # purge autonome des abonnements (dry-run ; --yes pour executer)
bun src/cli/index.ts x purge-tweets          # purge autonome des posts sous N likes (dry-run ; --yes)
bun src/cli/index.ts wonderbot doctor        # Wonderbot : config + catalogue, sans Discord
bun src/cli/index.ts wonderbot refresh       # rafraîchit le catalogue IETV (sans Discord)
bun src/cli/index.ts wonderbot start         # bot Discord /ietv (passerelle + rafraîchissement)

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

> **Multiplateforme (Linux VPS + Windows 11)** : chemins via
> `src/utils/platform-paths.ts` (injectable, XDG / `%APPDATA%`), config via
> `src/config/resolve.ts` (env > `config.json` > défauts) — jamais
> `process.env.HOME` (absent sous Windows), jamais `` Bun.$`chmod|mkdir -p|mv` ``.
> `~/.bxc` reste prioritaire s'il existe : ne pas casser le VPS. Installation :
> `install.sh` / `install.ps1`, mise à jour `bxc self-update [--check]`.
> Audit et reste-à-faire : [`CROSS-PLATFORM.md`](./CROSS-PLATFORM.md).

> **Auto-update VPS** : `bxc-auto-update.timer` (horaire) →
> `scripts/bxc-auto-update.sh`. La prod tourne **depuis le checkout** (les
> `bxc` de `/usr/local/bin` et `~/.local/bin` sont des wrappers vers
> `bun src/cli/index.ts`), donc l'auto-update est un `git merge --ff-only` +
> `bun install`, **pas** `bxc self-update` — celui-ci remplacerait un binaire
> que rien n'exécute. Le script s'abstient sur worktree sale ou historique
> divergé, teste `--version` avant de toucher aux services, revient à la
> révision précédente si la fumée échoue, et ne redémarre que les units déjà
> actives. Détail : [`DEPLOY.md`](./DEPLOY.md).

> **Services systemd** : `bxc.service` (API/CDP `serve :9222`) + `bxc-scheduler.service`
> (`Bun.cron` in-process) + `bxc-watchdog.timer` (auto-remediation 5 min : CDP,
> memoire vs `MemoryMax`, units `failed` — tout est rate-limite, un service
> arrete a la main est signale jamais relance, et une unit sortie sur un code
> de son `RestartPreventExitStatus` — 77, credentials rejetes — n'est jamais
> relancee : elle s'est arretee expres) + `bxc-crawler.service`
> (24/7 `crawl-worker`) + `bxc-x-unfollow.service` / `bxc-x-purge-tweets.service`
> (daemons de purge X) + `bxc-x-purge-doctor.timer` (watchdog auto-fix commun,
> 10 min) + `bxc-wonderbot.service` (bot Discord IETV, opt-in) — les purges sont opt-in, non installees par `bxc-control deploy`,
> cf. DEPLOY.md. Units source dans `scripts/deploy/`. Repo **PUBLIC** depuis
> 2026-06-01.

## Layout

```
bxc/
├── src/                          # API browser TS
│   ├── media/                    # cœur média : hébergeurs, déballage, extraction, HLS, résolution d'embed
│   └── google/                   # Google Ecosystem Atlas & compliance
├── packages/                     # Monorepo workspaces & scrapers
│   ├── challonge/                # Challonge tournament brackets scraper
│   ├── fut/                      # FIFA Ultimate Team (FUTBin / FUTGG)
│   ├── frames/                   # @aphrody/frames — index image par image (ColorLayout MPEG-7) + client trace.moe
│   ├── voiranime/                # VoirAnime catalog & embed resolver
│   ├── animesama/                # @aphrody/animesama — anime-sama.to (catalogue, saisons/langues, episodes.js, lecteurs)
│   ├── worldbeyblade/            # Scraper & metagame sub-package
│   ├── xcom/                     # X.com profile markdown scraper
│   ├── ietv/                     # @aphrody/ietv — catalogue Inazuma Eleven TV (scraper + cache SQLite + video)
│   ├── wonderbot/                # @aphrody/wonderbot — bot Discord /episodes (discord.js, cache-first)
│   ├── x/                        # @aphrody/x — headless X/Twitter client (pure TS port) + examples/
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

## Intégration VPS / release

Workflow release (tagging + GitHub + deploy via bxc-control) :

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
- **Test scope walk vendor** : `bun test <paths>` discover quand même
  `vendor/mcp-sdk-typescript/**` ET `vendor/chroma/**` → ~200 échecs
  préexistants (Zod v4, Task pagination, capabilities, `chromadb` absent,
  CF-workers qui exige `pnpm`). Ce ne sont PAS des régressions bxc. Pour un
  signal net, nommer les cibles exactes :
  `bun test packages/x packages/xai test/cli/install.test.ts`.
- **`bxc x <cmd> --help` sort en 1** (`EXIT.MISUSE`) : sous `set -o pipefail`,
  `bxc … --help | grep -q X` renvoie 1 même quand grep matche. Capturer la
  sortie d'abord (`H="$(bxc … --help 2>&1 || true)"; grep -q X <<<"$H"`).
- **`pgrep -f '<motif>'` s'auto-matche aussi, en pire** : une boucle
  `while pgrep -f foo; do sleep; done` écrite *dans* un script passé en heredoc
  à Bash met le motif dans la ligne de commande du shell parent → la condition
  est vraie pour toujours et l'attente ne sort jamais. Filtrer par nom de
  binaire (`pgrep -x`), ou tester un fichier sentinelle écrit en fin de tâche.
- **`pkill -f '<motif>'` s'auto-matche** : la commande de l'outil Bash contient
  le motif → le shell courant se tue (exit 143/144, patch en cours perdu).
  Utiliser TaskStop sur l'id de tâche, ou `systemctl stop`.
- **Timer systemd sur `Type=oneshot`** : `OnUnitActiveSec` ne se replanifie pas
  (`NextElapseUSecMonotonic=infinity`, `NEXT` vide dans `list-timers`) → utiliser
  `OnUnitInactiveSec`. `Persistent=` ne s'applique qu'à `OnCalendar`. Vérifier
  avec `systemctl list-timers <unit>` que `NEXT` est renseigné.
- **Timelines X** : (1) un retweet est attribué au **retweeteur** — `author_id`
  vaut le tien, un contrôle d'auteur ne détecte rien ; utiliser le préfixe
  `RT @handle:`. (2) X sert des curseurs frais sur des pages déjà vues :
  `!next_cursor` n'est pas une fin de timeline fiable, il faut une garde
  « N pages sans rien de neuf ». (3) Les chemins de **lecture** ont besoin d'un
  backoff 429 autant que les mutations (cf. `readWithBackoff`).
- **Mapping de profiles des scrapers** : Le CLI expose `stealth`, `max`, `fast`, `static` et `http`. Certains scrapers internes (comme `fut` ou `voiranime`) n'acceptent qu'un sous-ensemble (ex: `ghost` ou `static`). Veillez à bien mapper les types de profile CLI vers les options attendues par les scrapers sous peine d'erreurs strictes à la compilation TypeScript (`tsc --noEmit`).
- **Pipe masque le code retour** : `cargo build … | tail` renvoie l'exit de `tail` (0), pas de cargo. Capturer le vrai code : `cmd > /tmp/x.log 2>&1; echo $?`.
- **`links="sqlite3"` (rusqlite)** : `libsqlite3-sys` déclare `links` → UNE seule version de rusqlite peut être linkée dans le cdylib. Toutes les crates de `rust-bridge/` doivent partager `rusqlite 0.37` (via `{ workspace = true }`). Aligner les deps partagées sur `[workspace.dependencies]` (features additives OK : `uuid = { workspace = true, features = ["fast-rng"] }`).
- **`verbatimModuleSyntax: true`** (tsconfig root) : tout package workspace importé depuis `src/` est typecheck transitivement → les imports type-only doivent utiliser `import type { … }` sinon `error TS1484`.
- **`.npmrc` n'est PAS un secret** : `_authToken=${NODE_AUTH_TOKEN}` est un placeholder env (le CI génère son propre `.npmrc`). Ne jamais conclure « token leak » sur `grep -c _authToken` — vérifier placeholder (`=${`) vs littéral. Ne pas Read/cat quand même.
- **`bxc-mcp` a 3 cibles** à garder fraîches au deploy : `~/.local/bin/bxc-mcp` (MCP Claude `~/.claude.json`), `/usr/local/bin/bxc-mcp` (extension Gemini), `dist/standalone/bxc-mcp` (configs gemini antigravity/plugins/aphrody). `bxc-control deploy` gère les deux premiers.
- **Registre npm** : `.npmrc` route `@aphrody/*` → **npmjs.org** (`bun publish` par package, sous-packages avant root). C'est `@aphrody-code/*` et `@rose-griffon/*` qui vont sur GitHub Packages, via `~/.npmrc`. Rendre un package **public** sur un compte **User** = **UI-only**, aucune API (`PATCH …/visibility` = 404), même repo public.
- **`bun test` ne run que `*.test.ts`** : déplacer des `examples/*.ts` sous `packages/` ne les transforme pas en tests.
- **Code Gemini Web unifié** (commit `c2a7ea3` sur main) : `src/google/gemini-session.ts` = `GeminiSessionPool` (1 client/conversation, continuité `keepContext`, drop-on-error) + `isGeminiStaleError()` + `GEMINI_STALE_MESSAGE` — cœur partagé unique pour les serveurs HTTP qui exposent Gemini.
  - Exports subpath : `@aphrody/bxc/google/gemini-web` et `@aphrody/bxc/google/gemini-session` (en plus du barrel `./google`).
  - `gemini-scraper.ts` réutilise `GEMINI_HOST`/`GEMINI_APP_URL`/`DEFAULT_USER_AGENT` de `gemini-web.ts` (plus de constantes dupliquées) ; `GEMINI_BASE_URL` = alias déprécié de `GEMINI_HOST`.
  - Consommé par aphrody web (chat MD3 natif, modèle `"gemini-web"`). La CLI `bxc google chat` utilise `GeminiWebClient` en direct (one-shot, pas de pool).

## Vitrine Rust — bxc.aphrody.com

La prochaine surface publique est une crate `bxc-site` 100 % Rust : Axum 0.8,
Tokio 1.x, Tower et rustls, écoute privée `127.0.0.1:8084`. Elle ne doit jamais
exposer CDP `9222`, cookies, profils, crawls, secrets ou données personnelles.
Routes minimales : `/healthz`, `/robots.txt`, `/.well-known/security.txt` ;
futures API sous `/api/v1/` avec authentification. Le DNS/TLS est déjà réservé.
Voir [`AGENTS.md`](AGENTS.md) pour les critères de livraison.
