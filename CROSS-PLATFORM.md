# CROSS-PLATFORM.md — audit Linux (VPS) ↔ Windows 11

État au 2026-09-03, sur `main` à `a723189`. Second passage le même jour : m7, m12, m13, m14 et m15 traités (cf. leurs lignes). Périmètre audité : `src/`,
`packages/`, `scripts/`, `test/`, `bin/`, `.github/workflows/`, les fichiers
d'installation racine. Hors périmètre : `vendor/` (immuable),
`packages/frames/`, `packages/animesama/` (travaux parallèles).

Colonne **État** : `corrigé` = traité dans ce lot · `documenté` = décision
assumée, expliquée ici · `à faire` = reste ouvert.

---

## Résumé

| Gravité | Points | Corrigés |
| --- | --- | --- |
| BLOQUANT — bxc ne s'installe pas ou ne démarre pas sous Windows | 12 | 12 |
| MAJEUR — fonctionnalité cassée ou dégradée sans le dire | 14 | 12 (2 documentés) |
| MINEUR — dev, build ou CI seulement | 20+ | 12 |

Trois constats structurants :

1. **Le point d'entrée `bin` était un script bash.** `bun install -g` sous
   Windows produisait un shim inexécutable. C'est ce qui bloquait tout le
   reste.
2. **Les assets de release et les installeurs ne parlaient pas le même
   langage.** `release.yml` produisait `bxc-macos-arm64.tar.gz` en compilant
   `src/serverless/standalone.ts` (un serveur HTTP, sans `--version`), pendant
   que `install.sh` téléchargeait `bxc-darwin-arm64` et que la release v0.8.0
   réellement publiée contient des binaires nus (`bxc-linux-x64`,
   `bxc-windows-x64.exe`, …) issus de `scripts/build-standalone.ts`.
3. **Aucune résolution de configuration centralisée.** 49 fichiers lisaient
   `Bun.env` / `process.env` directement, dont plusieurs `process.env.HOME`,
   qui n'existe pas sous Windows.

---

## BLOQUANT

| # | Emplacement | Problème | État |
| --- | --- | --- | --- |
| B1 | `package.json:21-23` + `bin/bxc:1` | Seul `bin` déclaré = `#!/usr/bin/env bash`. Aucune installation globale possible sous Windows. | corrigé — `bin` pointe sur `bin/bxc.mjs` (lanceur JS), `bin/bxc.cmd` ajouté, `bin/bxc` conservé pour le lien symbolique du VPS |
| B12 | `.gitignore:6` | La règle `bin` excluait **tout** le répertoire : les nouveaux lanceurs n'auraient jamais été versionnés, et `package.json#bin` aurait pointé sur un fichier absent du paquet publié. Git ne sait pas ré-inclure un fichier dont le répertoire parent est exclu. | corrigé — `bin/*` + `!bin/bxc`, `!bin/bxc.mjs`, `!bin/bxc.cmd` ; les binaires compilés (`bxc.compiled`, `bxc.old-*`) restent ignorés |
| B2 | `bin/bxc:20-21` | `uname -s` / `uname -m` pour choisir le binaire : indisponible hors Git Bash. | corrigé — `bin/bxc.mjs` utilise `process.platform` / `process.arch` |
| B3 | `src/cli/install.ts:24` | `const homedir = () => Bun.env.HOME ?? "/tmp"` — `HOME` absent sous Windows, vendor dans un `/tmp` inexistant. | corrigé — helper mort supprimé, `getVendorDir()` fait déjà autorité |
| B4 | `src/cli/install.ts:79` | `destPath.substring(0, destPath.lastIndexOf("/"))` → `-1` sur `C:\…` → `mkdir ""`. | corrigé — `dirname()` |
| B5 | `src/cli/install.ts:232` | ``Bun.$`chmod +x` `` : `chmod` n'est pas un builtin du shell Bun et n'existe pas sous Windows. | corrigé — `chmodSync(…, 0o755)` gardé par `platform !== "win32"` |
| B6 | `src/cli/install.ts` (`mkdir -p`, `mv`) | Mêmes utilitaires POSIX lancés en sous-processus. | corrigé — `mkdirSync` / `renameSync` |
| B7 | `src/cli/install.ts:126-159` | `detectLightpandaPlatform()` renvoie `null` pour `win32` et `bxc install` affichait quand même « installed successfully ». | corrigé — message explicite : Lightpanda n'a pas d'asset Windows, bxc retombe sur les profils `chrome`/`http` |
| B8 | `src/cli/serve.ts:438-448` | Découverte de Lightpanda : `Bun.env.HOME` + chemins concaténés en `/` + pas de `.exe`. `bxc serve` inopérant. | corrigé — `homedir()` + `join()` + suffixe `.exe`, plus `getVendorDir()` dans les candidats |
| B9 | `src/detect.ts:88-106` | `wappalyzergo-cli` cherché sans suffixe `.exe` → `bxc detect` lève « binary not found ». | corrigé |
| B10 | `packages/ietv/src/cache.ts:43` | `dbPath.replace("~", process.env.HOME \|\| "/root")` → base SQLite sous `/root/...` sous Windows. | corrigé — `expandHome()` + `defaultCachePath()` exportés, `os.homedir()` |
| B11 | `packages/ietv/src/cache.ts:44` | `lastIndexOf("/")` → `mkdirSync("")`. | corrigé — `dirname()` |

---

## MAJEUR

| # | Emplacement | Problème | État |
| --- | --- | --- | --- |
| M1 | `.github/workflows/release.yml:60,67` | Le binaire publié compilait `src/serverless/standalone.ts` (serveur HTTP), pas `src/cli/index.ts` : `bxc --version`, `bxc recon`… n'existaient pas dans l'artefact. | corrigé — entry `src/cli/index.ts`, `bun install --frozen-lockfile` ajouté, smoke test `--version` dans le job |
| M2 | `release.yml` ↔ `install.sh` ↔ `install.ps1` | Trois conventions de nommage d'assets incompatibles (`macos-*` vs `darwin-*`, `.tar.gz`/`.zip` vs binaire nu). | corrigé — la CI publie désormais le binaire nu `bxc-<platform>-<arch>[.exe]` **et** l'archive ; installeurs et `self-update` essaient les deux, dans cet ordre |
| M3 | `install.ps1:126-136` | Attendait `bxc-windows-x64.zip`, jamais publié — la release v0.8.0 contient `bxc-windows-x64.exe`. Installeur Windows cassé. | corrigé — liste de candidats `.exe` puis `.zip`, premier téléchargement qui aboutit |
| M4 | absence | Aucune commande de mise à jour. `update.sh` réexécutait un `install.sh` lui-même désaligné. | corrigé — `bxc self-update` (+ `--check`), `update.sh` délègue |
| M5 | `package.json:24-32` | `files` n'incluait pas `packages/` alors que 12 sous-chemins d'`exports` y pointent : morts dans le tarball npm. | corrigé — `packages/*/src/`, `packages/*/package.json` ajoutés |
| M6 | `scripts/postinstall.ts:145,212,307` | Concaténation `/`, `lastIndexOf("/")`, ``Bun.$`chmod +x` ``. | corrigé — `join`/`dirname`/`chmodSync` gardé |
| M7 | `packages/x/src/services/purge-engine.ts:111,114` | `mode: 0o600` et `chmodSync` sont des no-op sur NTFS : le journal de purge (comptes et posts supprimés) se retrouve lisible par tout profil de la machine. Enjeu vie privée, pas seulement portabilité. | corrigé — avertissement unique sous Windows nommant le fichier ; la protection réelle passe par un dossier à ACL restreinte (`%LOCALAPPDATA%`) |
| M8 | `packages/wonderbot/src/config.ts:161` | `env.HOME \|\| homedir()` : sous Windows `HOME` est vide et sous Git Bash il diverge de `USERPROFILE`. | corrigé — `HOME` (injectable, testable) → `USERPROFILE` → `os.homedir()` |
| M9 | `src/cli/ietv.ts:186-190` | `!!process.env.HOME && …` : le doctor annonçait « credentials absents » sous Windows même quand ils étaient là. | corrigé — `homedir()` + `existsSync` |
| M10 | `src/google/search.ts:192` | `Bun.env.TMPDIR ?? "/tmp"` — `TMPDIR` n'existe pas sous Windows. | corrigé — `os.tmpdir()` |
| M11 | `src/cli/chrome.ts:64` | URL de snapshot Chromium codée en dur `Linux_x64/…/chrome-linux.zip` : `bxc chrome fetch` télécharge un binaire Linux sous Windows. | corrigé — `chromiumSnapshot(platform, arch)` (table `Linux_x64` / `Win_x64` / `Mac` / `Mac_Arm`), erreur explicite sur une cible sans snapshot |
| M12 | `src/google/dns.ts:311,320` | `Bun.spawn(["dig", …])` — `dig` n'est pas livré avec Windows. Le repli DoH existait déjà mais n'était atteint que par le `catch` du spawn raté. | corrigé — court-circuit explicite vers `isGoogleViaDoh()` sous `win32` |
| M13 | `src/mirror/mirror.ts:886,895` | `pngquant` / `jpegoptim` absents sous Windows. | documenté — déjà en `try/catch`, dégradation silencieuse acceptable (optimisation d'images optionnelle) |
| M14 | `scripts/deploy/*.service`, `*.timer` (7 unités) + `src/cli/x.ts:369-376`, `src/cli/wonderbot.ts:192-195`, `src/cli/crawl-worker.ts:113-114` | Daemons pensés pour systemd ; `SIGTERM` n'est pas délivré nativement sous Windows. | documenté — Windows est une **station de travail** (CLI + MCP), pas une cible de daemon. Les purges X, le crawler et le bot restent Linux/VPS. Un portage Scheduled Task est possible mais hors objectif |

---

## MINEUR

| # | Emplacement | Problème | État |
| --- | --- | --- | --- |
| m1 | `package.json` script `build:mcp` | `--target=bun-linux-x64` en dur : pas de MCP Windows. | corrigé — `build:mcp:win` ajouté |
| m2 | `bin/bxc` | Ignorait la variante `-baseline` produite par `build-standalone.ts`. | corrigé dans `bin/bxc.mjs` (candidat de repli) |
| m3 | `scripts/install-bxc.ps1` | Deuxième installeur Windows, recommandé par le README, avec une logique de version différente de `install.ps1`. | corrigé — devenu un renvoi déprécié vers `install.ps1` |
| m4 | `install.sh` | Fallback `v0.1.0` silencieux quand l'API GitHub ne répond pas → installe une version arbitraire. | corrigé — échec explicite |
| m5 | `test/unit/postinstall.test.ts:110` | Asserte un chemin non normalisé (`/abs/scripts/../vendor/…`). | corrigé + cas Windows `.exe` ajouté |
| m6 | `scripts/build-windows.ts:144,174,253,257,265,268,312,345` | `curl`, `unzip`, `zip`, `ls -la`, `/tmp/…` en dur : le script de build **Windows** ne tourne en réalité que depuis un hôte POSIX. | documenté — c'est un cross-compilateur Linux→Windows ; l'équivalent natif est `scripts/build-windows.ps1` |
| m7 | `scripts/cleanup.ts`, `scripts/build-standalone.ts:516`, `scripts/build-lightpanda-static.ts:48` | `rm -rf`, `mkdir -p` via le shell. | corrigé — `rmSync`/`mkdirSync` + `Bun.Glob` ; `cleanup.ts` est désormais **en simulation par défaut** (`--yes` pour exécuter) : il supprime `node_modules/` et `dist/`, soit plusieurs minutes de réinstallation |
| m8 | `src/config/BxcConfig.ts:40` | `UV_THREADPOOL_SIZE` réglé uniquement sous Linux. | documenté — perte de perf, pas de casse |
| m9 | `src/cli/recon.ts:472,573-581` | Chemins de snapshot concaténés en `/`. | documenté — les API Node acceptent `/` sous Windows |
| m10 | `test/e2e/helpers.ts:68`, `test/integration/google-specialization.test.ts:41-42`, `test/perf/rss.test.ts:100`, `test/integration/crawlee-patterns.test.ts:47`, `test/integration/showcase-hn.test.ts:267`, `packages/fut/src/test/futgg.test.ts:30-50`, `packages/x/{unfollow,purge-tweets}.test.ts` (mode `0o600`) | Tests liés à POSIX (`/proc`, `mkdir -p`, `rm -rf`, `.so` seul, bits de permission). | partiel — les deux assertions `0o600` sont gardées par `process.platform !== "win32"` ; les suites `e2e/`, `perf/`, `integration/` restent hors du scope Windows de la CI |
| m11 | `.github/workflows/ci.yml:36,65` | Les deux jobs lançaient `bun test` **sans chemin** (marche `vendor/`) et sans `bun install`. | corrigé — `bun install --frozen-lockfile` ajouté, Linux scopé `test/ packages/ src/`, Windows sur un sous-ensemble portable + smoke test du lanceur |
| m12 | `scripts/postinstall.ts` | Jamais exécuté (aucun hook `postinstall` dans `package.json`) alors que `CONTRIBUTING.md` et `PUBLISHING.md` l'annoncent. | corrigé — hook branché **et** garde de dépôt : `shouldSkip()` s'arrête quand un `.git` est présent à côté du script, donc `bun install` ici reste inerte ; `LIGHTPANDA_AUTOINSTALL=1` force, `BXC_NO_AUTOINSTALL=1` coupe (4 cas de test) |
| m13 | Sous-packages `packages/*/package.json` | Aucun n'a `files` ni `engines` : les tarballs npm embarquent tests, docs et exemples. | corrigé — les **15** paquets déclarent `files` (`src/` sans `*.test.ts`, README, LICENSE) et `engines.bun`. Le tarball d'`@aphrody/animesama` passe de tout le répertoire à 3 fichiers. La racine excluait aussi 15 `*.test.ts` via `packages/*/src/` : négations ajoutées, 328 → 313 fichiers |
| m14 | `PUBLISHING.md` | Référence `bun run build:cdylib` / `build:exe` (scripts inexistants) et affirme que le tarball contient deux `.so`. | corrigé — commandes réelles (`cargo build -p bxc-rust-bridge`, `BXC_TARGETS=… build-standalone.ts`, `build:mcp`), contenu du tarball **mesuré** (313 fichiers, 2,71 Mo, aucun `.so`, aucun test), scope de `bun test` corrigé, section publication et note `postinstall` ajoutées |
| m15 | `.npmrc` / `publish.yml:41` | La racine épingle 13 dépendances `@aphrody/*` en version exacte, la CI n'en publie que 3 (`x`, `xai`, `test`). Un `bun add @aphrody/bxc` échoue si les autres ne sont pas au registre. | corrigé — `scripts/publish-workspaces.ts` : tri topologique (dépendances d'abord), saut de ce qui est déjà au registre, racine en dernier, échec isolé qui n'arrête pas la série. 10 cas de test, `--dry-run` pour l'ordre |

---

## Résolution de configuration et de secrets

**Avant.** Aucun point d'entrée unique. `src/config/BxcConfig.ts` ne couvrait
que le stockage du crawler. Les jetons et chemins étaient lus au fil de l'eau :
`packages/x/src/core/session.ts:34` (`~/.aphrody/x-session.json`),
`packages/xai/src/core/session.ts:103` (`~/.grok/auth.json`),
`packages/ietv/src/index.ts:224`, `packages/x/src/db/store.ts:58`. Ces trois
derniers utilisaient déjà `os.homedir()` — corrects — mais rien ne définissait
l'ordre de priorité ni ne le rendait testable.

**Après.** `src/config/resolve.ts` expose **une** fonction injectable :

```ts
resolveBxcConfig({ ctx, readFile })  // ctx = { platform, arch, env, home, exists }
```

Ordre appliqué, vérifié par `test/config/resolve.test.ts` :

1. variables d'environnement (`BXC_DIR`, `BXC_COOKIES_DIR`, `BXC_INSTALL_DIR`,
   `BXC_RELEASE_REPO`, `BXC_TIMEOUT_MS`, …) ;
2. fichier utilisateur `config.json` ;
3. défauts dérivés de la plateforme.

Emplacements du `config.json`, résolus par `src/utils/platform-paths.ts` :

| Plateforme | Configuration | Cache | Données | Binaire global |
| --- | --- | --- | --- | --- |
| Linux/macOS | `$XDG_CONFIG_HOME/bxc` → `~/.config/bxc` | `$XDG_CACHE_HOME/bxc` → `~/.cache/bxc` | `$XDG_DATA_HOME/bxc` → `~/.local/share/bxc` | `~/.local/bin` |
| Windows 11 | `%APPDATA%\bxc` | `%LOCALAPPDATA%\bxc\cache` | `%LOCALAPPDATA%\bxc\data` | `%LOCALAPPDATA%\bxc\bin` |

**`~/.bxc` reste prioritaire quand le dossier existe déjà** : c'est la racine
historique, celle du VPS de production et celle qu'écrivent
`scripts/x-purge-doctor.sh` et la documentation existante. Un poste neuf part
sur XDG / `%APPDATA%`, une machine existante ne bouge pas.

Un JSON invalide n'interrompt rien : les défauts s'appliquent et
`configError` porte le message.

---

## FFI Rust

`src/rust/bridge.ts:26-46` était **déjà correct** : nom
`bxc_rust_bridge.<suffix>` sous Windows contre `libbxc_rust_bridge.<suffix>`
ailleurs, `suffix` fourni par `bun:ffi`, `SetDllDirectoryW` appelé avant
`dlopen` pour que les DLL voisines se résolvent (`bridge.ts:98-113`).
`src/ffi/curl-impersonate.ts:293-370` suit le même schéma.

Absence de la bibliothèque : le `dlopen` est **paresseux**
(`bridge.ts:117-140`), les chemins texte retombent sur
`src/internal/html-to-markdown.ts` en JS pur et seules les requêtes CSS natives
lèvent une erreur nommant `BXC_RUST_BRIDGE_LIB`. Rien à corriger.

Ce qui manque côté Windows n'est pas le chargement mais la **production** de la
DLL : `scripts/build-windows.ts:280` exige `cargo xwin` et le Windows SDK.
`.github/workflows/release.yml` la construit bien en MSVC et l'embarque dans
l'archive `.zip` — mais pas à côté du `.exe` nu. Un utilisateur qui installe via
`install.ps1` en mode `.exe` obtient donc bxc **sans** la DLL : c'est le mode
dégradé décrit ci-dessus, fonctionnel pour tout sauf les requêtes CSS natives.

---

## Packaging

`package.json` racine, après correction :

- `bin` → `./bin/bxc.mjs` (shim npm/bun valide sur les trois plateformes) ;
- `files` inclut `packages/*/src/`, `packages/*/package.json`, les trois
  lanceurs `bin/`, et `scripts/postinstall.ts` ;
- `engines.bun` conservé, **pas** de champ `os` ni `cpu` : le paquet doit
  s'installer partout, la sélection de binaire se fait à l'exécution.

Les 15 sous-packages déclarent désormais `files` et `engines`, et
`scripts/publish-workspaces.ts` publie tout le dépôt dans l'ordre de ses
dépendances — la racine en dernier. `bun add @aphrody/bxc` cesse d'échouer sur
une dépendance absente du registre dès la prochaine release.

---

## Ce qui n'a pas pu être vérifié ici

Aucune machine Windows n'est disponible dans cet environnement, et `pwsh` n'y
est pas installé. Ont été validés **statiquement** :

- la logique de chemins, testée avec des séparateurs et des variables Windows
  simulés (`test/utils/platform-paths.test.ts`, 27 cas) ;
- la résolution de configuration sous `win32` (`test/config/resolve.test.ts`) ;
- la sélection de cible et la comparaison de versions
  (`test/cli/self-update.test.ts`, 29 cas) ;
- la sélection de binaire du lanceur (`test/cli/launcher.test.ts`) ;
- la syntaxe de `install.sh` (`bash -n` + `shellcheck`) et le YAML des
  workflows.

**Reste à tester sur un vrai Windows 11 :**

1. `irm …/install.ps1 | iex` de bout en bout — la syntaxe PowerShell n'a pas pu
   être analysée ici ;
2. `bun install -g @aphrody/bxc` puis `bxc --version` depuis `cmd.exe` et
   PowerShell (validité du shim généré à partir de `bin/bxc.mjs`) ;
3. `bxc self-update` remplaçant un `bxc.exe` **en cours d'exécution** (renommage
   en `.old-<ts>` puis mise en place) ;
4. `bxc install` puis `bxc serve` : Lightpanda n'a pas d'asset Windows, il faut
   confirmer que le repli sur le profil `chrome` est propre ;
5. le chargement de `bxc_rust_bridge.dll` posée à côté du `.exe`
   (`SetDllDirectoryW`) ;
6. `tar -xf` sur un `.zip` (bsdtar, présent depuis la build 17063) — chemin
   d'extraction de `bxc self-update` ;
7. le job `test-windows` de `ci.yml`, désormais scopé sur un sous-ensemble
   portable (`test/cli test/config test/utils test/unit test/privacy packages/x
   packages/xai`) : il faut confirmer qu'il passe réellement sur un runner
   `windows-latest`.

Deux pièges Windows ont été anticipés à l'aveugle et méritent une confirmation
sur place :

- **BOM UTF-8** : `Set-Content -Encoding UTF8` de Windows PowerShell 5.1 préfixe
  le fichier d'un `U+FEFF` que `JSON.parse` refuse. L'installeur écrit
  désormais via `File::WriteAllText` sans BOM, **et** `resolveBxcConfig()`
  retire un BOM éventuel (test dédié).
- **`NativeCommandError`** : avec `$ErrorActionPreference = "Stop"`, PowerShell
  transforme le stderr d'un exécutable natif en erreur terminale. Un 404 attendu
  de `curl.exe` interrompait la boucle de candidats — l'appel est maintenant
  dans un `try/catch`.
