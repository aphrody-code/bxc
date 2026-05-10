# Real-browser profile (Windows-first) — attacher Chrome local + profil utilisateur

> Branche : `windows`. Objectif : sur Windows, exécuter les flows agent dans le **vrai Chrome installé**, avec le **profil utilisateur réel** (cookies, history, sessions, extensions, saved logins). On utilise `puppeteer-core` + `puppeteer-extra` + plugins (stealth, adblocker, anonymize-ua) pour piloter via CDP.

---

## TL;DR

```powershell
# Inspect: voir où est Chrome + le user data dir + les SQLite
bunlight real-browser inspect

# Lister les sous-profils Chrome (Default, Profile 1, ...)
bunlight real-browser profiles

# Lancer Chrome avec ton profil par défaut, garder la fenêtre ouverte
bunlight real-browser launch --keep-alive

# Idem mais headless + profile spécifique
bunlight real-browser launch --profile-directory "Profile 1" --headless
```

Détection automatique :
- **chrome.exe** : `C:\Program Files\Google\Chrome\Application\chrome.exe` (puis fallbacks Edge/Brave/Chromium)
- **User Data** : `C:\Users\<user>\AppData\Local\Google\Chrome\User Data` (résolu via `%LOCALAPPDATA%`)
- **Sub-profile** : `Default` (override `--profile-directory "Profile 1"`)

Override via env :
- `BUNLIGHT_CHROME_PATH` — chemin chrome.exe
- `BUNLIGHT_CHROME_PROFILE_DIR` — chemin User Data dir
- `BUNLIGHT_REAL_BROWSER_ANYHOST=1` — debloquer macOS/Linux (privacy: à utiliser en connaissance de cause)

---

## 1. Pourquoi un profil "real-browser" séparé ?

bunlight expose 5 profils distincts. Chacun a un usage spécifique :

| Profil | Engine | JS | Anti-bot | Typical use |
|---|---|---|---|---|
| `static` | bunlight DOM in-process | non | low | RSS, sitemap, server-side HTML |
| `fast` | Lightpanda subprocess | oui | medium | SPA, dashboard, API JSON-rendered |
| `http` | curl-impersonate Chrome 131 | non | high (TLS-fp) | Cloudflare-gated APIs |
| `stealth` | Patchright Chromium | oui | very high | DataDome, PerimeterX |
| **`real-browser`** | **Chrome local + user profile** | **oui** | **maximum** | **Sites avec login persistant, paywall, paypal, mfa** |

`real-browser` est le seul profil qui :
- ne télécharge **aucun** Chromium / Lightpanda — il utilise le navigateur déjà sur la machine
- monte le **vrai user data dir** — toutes tes connexions actuelles sont dispo sans étape de login scriptée
- s'attache via puppeteer-extra → bénéficie des **30+ stealth patches** maintenus par la communauté
- garde tes **extensions installées** (uBlock Origin, 1Password, Dashlane, etc.)

C'est le profil "I just want it to work like my actual browser" — au prix d'une dépendance Windows + Chrome installé.

---

## 2. Architecture

```
                 bunlight CLI
                      |
                      v
       findChromeBinary()  ----->  C:\Program Files\Google\Chrome\Application\chrome.exe
       resolveDefaultProfileDir() -> C:\Users\<user>\AppData\Local\Google\Chrome\User Data
                      |
                      v
       Bun.spawn([chrome.exe, "--remote-debugging-port=N",
                  "--user-data-dir=<path>",
                  "--profile-directory=Default",
                  "--no-first-run", "--no-default-browser-check"])
                      |
                      v
       fetch http://127.0.0.1:N/json/version  -->  { webSocketDebuggerUrl: "ws://..." }
                      |
                      v
       puppeteer-core .connect({ browserWSEndpoint })
                      |
                      v
       puppeteer-extra.use(StealthPlugin())
       puppeteer-extra.use(AnonymizeUaPlugin())
       puppeteer-extra.use(AdblockerPlugin())   ← optionnel
                      |
                      v
       Browser instance prête à driver
```

---

## 3. Module API (`@aphrody-code/bunlight/profiles/real-browser`)

### 3.1 `launchRealBrowser(opts)`

```ts
import { launchRealBrowser } from "@aphrody-code/bunlight/profiles/real-browser";

const handle = await launchRealBrowser({
  // executablePath : auto-détecté sur Windows (chrome.exe)
  // userDataDir    : auto-détecté (%LOCALAPPDATA%\Google\Chrome\User Data)
  profileDirectory: "Default",         // ou "Profile 1", "Guest Profile"
  port: undefined,                     // ephemeral si non spécifié
  headless: false,                     // true → --headless=new
  stealth: true,                       // puppeteer-extra-plugin-stealth
  adblock: false,                      // puppeteer-extra-plugin-adblocker
  anonymizeUa: true,                   // strip "HeadlessChrome" de l'UA
  extraArgs: ["--start-maximized"],    // flags Chrome supplémentaires
  readyTimeoutMs: 15_000,              // timeout debugger
});

console.log("PID :", handle.pid);
console.log("WS  :", handle.wsEndpoint);

const page = await handle.browser.newPage();
await page.goto("https://github.com/notifications");
// → tu vois tes vraies notifs (cookies du profil sont là)

await handle.close(); // détache puppeteer + kill chrome.exe
```

### 3.2 `findChromeBinary()`

```ts
import { findChromeBinary } from "@aphrody-code/bunlight/profiles/real-browser";

const exe = await findChromeBinary();
// "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
// ou null si ni Chrome ni Edge ni Brave ni Chromium installé
```

Search order :
1. `BUNLIGHT_CHROME_PATH` env-var
2. `C:\Program Files\Google\Chrome\Application\chrome.exe` (canonical)
3. `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` (32-bit Chrome)
4. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (per-user install)
5. Microsoft Edge (`msedge.exe`)
6. Brave (`brave.exe`)
7. Chromium (`chromium`)
8. macOS `.app` bundles si `BUNLIGHT_REAL_BROWSER_ANYHOST=1`
9. Linux `/usr/bin/google-chrome*` si idem

### 3.3 `resolveDefaultProfileDir()`

```ts
import { resolveDefaultProfileDir } from "@aphrody-code/bunlight/profiles/real-browser";

const dir = resolveDefaultProfileDir();
// Windows : "C:\\Users\\yohan\\AppData\\Local\\Google\\Chrome\\User Data"
// macOS   : "~/Library/Application Support/Google/Chrome"
// Linux   : "~/.config/google-chrome"
```

### 3.4 `inspectChromeProfile(userDataDir, profileDirectory)`

Renvoie les paths SQLite/files standard d'un profil Chrome :

```ts
const paths = inspectChromeProfile(
  resolveDefaultProfileDir(),
  "Default"
);
// {
//   cookieJarPath:    ".../Default/Network/Cookies",
//   historyDbPath:    ".../Default/History",
//   loginDataDbPath:  ".../Default/Login Data",
//   sessionsDir:      ".../Default/Sessions",
// }
```

Combinable avec `bun:sqlite` pour lire cookies/history en read-only **après** que Chrome ait fermé (les SQLite sont locked pendant que Chrome tourne).

```ts
import { Database } from "bun:sqlite";

const db = new Database(paths.cookieJarPath, { readonly: true });
const rows = db.query<{ host_key: string; name: string; encrypted_value: Buffer }, []>(
  "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%github.com%'"
).all();
```

NB : `encrypted_value` est chiffré par Windows DPAPI — il faut décoder via [Chromium's `OSCrypt::DecryptString`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/os_crypt_win.cc) ou un module Rust comme [`rookie`](https://github.com/thewh1teagle/rookie) (cross-platform cookie reader). Pour des flows scriptés, mieux vaut **utiliser le profil via launchRealBrowser** que d'extraire les cookies bruts.

---

## 4. Subcommand CLI (`bunlight real-browser`)

| Action | Effet |
|---|---|
| `inspect` | Print paths résolus (chrome.exe, user data, SQLite). Aucun spawn. |
| `profiles` | List les sub-profils dans User Data dir (lit `Local State`). |
| `launch` | Spawn Chrome + attache puppeteer + exit (ou `--keep-alive`). |

Flags identiques à l'API TS (cf. §3.1) — voir `bunlight real-browser --help`.

### Exemples

```powershell
# Voir où Chrome est, sans lancer
bunlight real-browser inspect --json

# Lister les profils (Default, "Yohan", "Travail", "Guest Profile")
bunlight real-browser profiles

# Lancer headless avec adblock
bunlight real-browser launch --headless --adblock

# Override profile + extra-arg
bunlight real-browser launch \
  --profile-directory "Profile 1" \
  --extra-arg "--lang=fr-FR" \
  --extra-arg "--window-size=1440,900" \
  --keep-alive

# Lancer + capter le ws endpoint depuis un autre script
bunlight real-browser launch --json --keep-alive | jq -r '.wsEndpoint'
```

---

## 5. Integration avec agent-browser (default engine Chrome sur Windows)

Le fork `aphrody-code/agent-browser` (branch `windows`) expose le mode "use my real Chrome" :

```powershell
# Auto-detect : sur Windows --engine défaut = chrome (= cette discovery path)
agent-browser open https://github.com/notifications

# Explicit
agent-browser --engine chrome `
  --executable-path "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir "C:\Users\yohan\AppData\Local\Google\Chrome\User Data" `
  --profile-directory Default `
  open https://github.com

# Pipe through bunlight real-browser pour stealth + adblock
agent-browser --engine bunlight --profile real-browser open https://example.com
```

Quand `--engine bunlight --profile real-browser` est sélectionné, agent-browser invoque `bunlight serve --profile real-browser` qui à son tour launch Chrome + applique les plugins puppeteer-extra. Le tout reste un seul handshake CDP → l'agent voit un browser comme n'importe quel autre.

---

## 6. Sécurité et privacy

`real-browser` lance ton vrai Chrome avec un debugger socket TCP local. Implications :

1. **Toute application avec accès à 127.0.0.1:port peut piloter ton browser** — y compris envoyer des messages, lire des emails, accéder aux extensions.
2. Le port n'est **pas authentifié** (CDP ne supporte pas auth nativement). On utilise un port éphémère pour réduire la surface, mais ce n'est pas suffisant en multi-user.
3. **Ne pas activer `BUNLIGHT_REAL_BROWSER_ANYHOST=1` en production**. C'est un escape hatch dev — sur un VPS ou serveur partagé, n'importe quel autre user pourrait se connecter au socket.
4. Les **mots de passe stockés dans Chrome** restent dans le keychain Windows DPAPI ; ils ne sont pas exposés directement par le CDP (sauf via les pages qui les autofill). Les sites peuvent toujours les lire via les form autofill flows normaux.
5. Sur un **profil partagé entre humain et agent**, l'agent peut altérer ton historique, marquer des messages comme lus, supprimer des onglets, etc. Recommandé : créer un sous-profil dédié (`bunlight real-browser launch --profile-directory "Bunlight"`) au lieu de toucher `Default`.

---

## 7. Pièges connus

### 7.1 Chrome déjà ouvert avec ce profil

Si Chrome tourne déjà avec `Default`, `--remote-debugging-port` est silencieusement ignoré (Chrome multi-instance protection). Workarounds :
- Fermer Chrome complètement (vérifier dans Task Manager).
- Utiliser un sous-profile (`--profile-directory "Bunlight"`).
- Cloner `User Data` dans `%TEMP%\bunlight-chrome-profile-N\` pour avoir un user data dir indépendant qui repart d'un fresh state mais peut être pré-rempli.

### 7.2 Extensions managed by enterprise policy

Sur un poste managé par Group Policy / MDM, certaines extensions sont auto-installées et chargées même avec `--disable-extensions-except=`. C'est attendu — bunlight ne combat pas la policy.

### 7.3 `Cookies` SQLite locked

Quand Chrome tourne, le fichier `Default/Network/Cookies` est lock (Windows file locking). Pour `inspectChromeProfile()` + lecture SQLite, fermer Chrome d'abord, ou copier le fichier vers un backup et lire la copie.

### 7.4 puppeteer-core / puppeteer-extra non installés

`launchRealBrowser` lazy-load les modules `puppeteer-core`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `puppeteer-extra-plugin-anonymize-ua`, `puppeteer-extra-plugin-adblocker`. S'ils ne sont pas dans `node_modules`, l'attache fonctionne quand même mais sans stealth (le wrapper try/catch ignore les imports manquants).

Pour activer la stack complète :

```bash
bun add puppeteer-core puppeteer-extra \
        puppeteer-extra-plugin-stealth \
        puppeteer-extra-plugin-anonymize-ua \
        puppeteer-extra-plugin-adblocker
```

### 7.5 Antivirus

Certains AV (Bitdefender, Kaspersky) injectent dans chrome.exe et brisent CDP. Si `bunlight real-browser launch` timeout au discovery, désactiver l'AV temporairement ou whitelister `chrome.exe`.

---

## 8. Tests

Tests unitaires du module : `test/profiles/real-browser.test.ts` (à venir, branch `windows`).

Tests CLI : `test/cli/real-browser.test.ts` — couvre les 3 actions (inspect/profiles/launch) avec un fake chrome.exe path. Les tests `launch` sont skip sur CI Linux quand `BUNLIGHT_REAL_BROWSER_ANYHOST` n'est pas set.

---

## 9. Roadmap

- [ ] Helper `extractCookies()` qui lit `Cookies` SQLite + decrypt via DPAPI (Windows) / Keychain (macOS) / libsecret (Linux).
- [ ] Helper `extractHistory()` (lecture pure SQLite, pas de chiffrement).
- [ ] Profile snapshot/restore — cloner `User Data` dans `%TEMP%` puis restaurer.
- [ ] Support `--engine chrome` direct dans agent-browser sans passer par bunlight.
- [ ] Auto-spawn d'un xvfb-style virtual display sur Linux pour `--headless` invisible.

---

## 10. Références

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Chromium command-line switches](https://peter.sh/experiments/chromium-command-line-switches/)
- [puppeteer-core](https://pptr.dev/api/puppeteer.puppeteernode.connect)
- [puppeteer-extra](https://github.com/berstend/puppeteer-extra)
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [puppeteer-extra-plugin-anonymize-ua](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-anonymize-ua)
- [puppeteer-extra-plugin-adblocker](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-adblocker)
- [Chrome User Data Directory](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md)
- [DPAPI cookie decryption (rookie)](https://github.com/thewh1teagle/rookie)
