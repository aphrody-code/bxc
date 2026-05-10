# Parsing the Chrome User Data dir — Chrome 147+ playbook

> Branche : `windows`. Mise à jour : 2026-05-10. Cible Chrome 147 stable (sortie 2026-04-07, milestone post-App-Bound-Encryption).
> Compagnon de [`PROFILES-WINDOWS.md`](./PROFILES-WINDOWS.md).

---

## TL;DR — quel outil pour quoi

| Besoin | Chrome OUVERT (CDP) | Chrome FERMÉ (SQLite) |
|---|---|---|
| **Cookies** (déchiffrés) | `extractCookiesViaCdp(handle)` — CDP `Network.getAllCookies` (pas d'ABE/DPAPI à gérer) | [`rookie`](https://github.com/thewh1teagle/rookie) Rust 352⭐ ou [`browser_cookie3`](https://github.com/borisbabic/browser_cookie3) Python 1039⭐ ou [`chrome-cookies-secure`](https://github.com/bertrandom/chrome-cookies-secure) Node ; tous gèrent DPAPI mais **pas encore App-Bound Encryption** (Chrome 127+) → résultat partiel |
| **History** | CDP `Database.executeSQL` ou page navigation à `chrome://history/` | `extractHistoryFromSqlite()` — SQLite `urls` table, lecture directe non chiffrée |
| **Bookmarks** | `JSON.parse(<page>.evaluate(...))` ou CDP | `extractBookmarks()` — JSON file (pas de lock) |
| **Login data (passwords)** | CDP `PasswordManager.*` API (limité) | Chiffré DPAPI + ABE — non extractible sans process spawn dans chrome.exe context |
| **Sessions / open tabs** | CDP `Target.getTargets` | SNSS (binary pickle format) ; pas d'outil simple |
| **Extensions** | CDP `Extensions.*` | `Preferences` JSON (lecture trivial) |
| **Forensics complet** | n/a | [`hindsight`](https://github.com/RyanDFIR/hindsight) Python 1422⭐ — dump exhaustif (history, cookies, downloads, autofill, login data, prefs, GAIA, omnibox, archived history…) |

**Recommandation bunlight** : faire 100% via CDP en gardant Chrome attaché (cf. `launchRealBrowser`). Pour l'analyse offline (audit), `hindsight`.

---

## 1. App-Bound Encryption Chrome 127+ — pourquoi tout a changé

### 1.1 Avant Chrome 127

Cookie value chiffré uniquement par DPAPI Windows (per-user). N'importe quel programme tournant comme l'utilisateur pouvait décrypter en appelant `CryptUnprotectData()`. Tools historiques (`browser_cookie3`, `chrome-cookies-secure`, `rookie`) reposaient sur ça.

### 1.2 Depuis Chrome 127 (2026-07)

Google a ajouté **App-Bound Encryption (ABE)** par-dessus DPAPI :

```
plaintext  ──> DPAPI(ABE_master_key) ──> AES-256-GCM ──> ciphertext stocké dans Cookies SQLite
                       ^
                       |
              process identity check : seul chrome.exe (ou un process avec
              "ChromeAppBoundEncryptionService" COM access) peut décrypter
```

Conséquence : `browser_cookie3` & cie ne marchent plus en lecture directe sur Chrome 127+. Ils renvoient soit des erreurs, soit des valeurs ciphertext, soit des cookies obsolètes (avant 127).

Réf : [chromium.googlesource.com/.../app_bound_encryption_provider.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/app_bound_encryption_provider_win.cc).

### 1.3 Bypass connus

Trois approches publiquement documentées :

1. **CDP** (le plus propre) : attacher à chrome.exe via `--remote-debugging-port`, appeler `Network.getAllCookies`. Chrome décrypte côté serveur, retourne plaintext. **C'est ce que real-browser bunlight utilise**. Aucun "bypass" — c'est l'API publique.
2. **DLL injection / process hollowing** : injecter dans chrome.exe pour appeler `OSCrypt::DecryptString` depuis le bon contexte. Demande admin, antivirus-signal, fragile entre versions Chrome.
3. **chrome-privless-encryption** ([thewh1teagle/chrome-privless-encryption](https://github.com/thewh1teagle/chrome-privless-encryption)) : PoC qui combine remote debugging + privilege bypass pour extraire cookies sans admin. Effectivement la même idée que CDP, mais packagé pour audit/red-team.

`real-browser` bunlight = approche 1, version production-ready.

---

## 2. CDP cookie extraction — code prêt à l'emploi

```ts
import { launchRealBrowser, extractCookiesViaCdp } from "@aphrody-code/bunlight/profiles/real-browser";

const handle = await launchRealBrowser({ profileDirectory: "Default" });
try {
  const cookies = await extractCookiesViaCdp(handle);
  console.log(`Got ${cookies.length} cookies (decrypted by Chrome)`);
  for (const c of cookies.filter((x) => x.domain.endsWith("github.com"))) {
    console.log(`  ${c.name}=${c.value.slice(0, 20)}...  (HttpOnly=${c.httpOnly})`);
  }
} finally {
  await handle.close();
}
```

Filtrage par domaine côté CDP (plus rapide pour gros profils) :

```ts
import { extractCookiesForDomainsViaCdp } from "@aphrody-code/bunlight/profiles/real-browser";

const cookies = await extractCookiesForDomainsViaCdp(handle, [
  "https://github.com",
  "https://app.example.com",
]);
```

CDP retourne le shape complet : `name`, `value`, `domain`, `path`, `expires`, `size`, `httpOnly`, `secure`, `session`, `sameSite`, `priority`, `sourceScheme`, `sourcePort`, `partitionKey`.

---

## 3. Chrome 147 considerations

### 3.1 Local Network Access (LNA) restrictions

Chrome 147 ([release notes](https://developer.chrome.com/release-notes/147)) introduit des restrictions LNA pour :
- **WebSockets** vers adresses locales : prompt utilisateur
- **WebTransport** vers réseau local : prompt
- **Service Workers** `WindowClient.navigate()` : prompt

**Impact sur real-browser** : aucun. Le CDP debugger socket est ouvert par chrome.exe lui-même (pas par une page web), donc pas affecté par LNA.

**Sites scrapés** : si une page web tente de fetch `http://192.168.1.x/...`, ça déclenche un prompt. À éviter via headers ou HTTPS public.

### 3.2 Web Printing API + WebNN origin trial

Pas d'impact data-extraction.

### 3.3 Format SQLite

Le schéma `Cookies` SQLite n'a pas changé en 147 (seulement les colonnes `source_scheme`, `source_port`, `is_same_party` ajoutées en versions précédentes). `extractHistoryFromSqlite()` et `extractBookmarks()` continuent de marcher.

---

## 4. Catalog des outils tiers (par stack)

### 4.1 Rust

| Outil | Stars | Force | Limite |
|---|---|---|---|
| [thewh1teagle/rookie](https://github.com/thewh1teagle/rookie) | 352 | Cross-platform (Windows DPAPI + macOS Keychain + Linux libsecret), one-shot binary, FFI Python+Node | Pas encore d'ABE Chrome 127+ support (issue ouverte) |
| [chris124567/cookie-monster](https://github.com/chris124567/cookie-monster) (search bench) | n/a | Sample fortement orienté red-team, pas maintenu | n/a |

Best for: Linux/macOS hosts où Chrome n'est pas attaché. Sur Chrome 127+ Windows, prefer CDP.

### 4.2 Python

| Outil | Stars | Force | Limite |
|---|---|---|---|
| [obsidianforensics/hindsight](https://github.com/RyanDFIR/hindsight) | 1422 | **Forensics complet** : history, cookies, downloads, autofill, login data, prefs, archived history, GAIA, omnibox shortcuts. Output XLSX/SQLite/JSONL. CLI + GUI. | Lecture offline obligatoire (Chrome fermé). ABE cookies ciphertext only. |
| [borisbabic/browser_cookie3](https://github.com/borisbabic/browser_cookie3) | 1039 | Cookies cross-browser (Chrome/Firefox/Edge/Brave), DPAPI/Keychain/libsecret intégré | Pas d'ABE Chrome 127+ → cookies post-127 illisibles |
| [bertrandom/chrome-cookies-secure](https://github.com/bertrandom/chrome-cookies-secure) | n/a | Macros AppleScript-style pour Mac | macOS+Linux only, no Windows |

Best for: forensics/audit batch, Chrome déjà fermé. **`hindsight`** est le standard de facto en DFIR.

### 4.3 Node.js

| Outil | Force |
|---|---|
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Driver CDP officiel, attache à Chrome existant via `connect()` |
| [puppeteer-extra](https://github.com/berstend/puppeteer-extra) + plugins | Stealth/anonymize-ua/adblocker (déjà intégré dans real-browser bunlight) |
| [chrome-cookies-secure](https://www.npmjs.com/package/chrome-cookies-secure) | Cookies Chrome via API directe (pas d'ABE bypass) |
| [chromedp/chromedp](https://github.com/chromedp/chromedp) (Go, mentionné par contraste) | Equivalent Go, pas Node |

Best for: drive Chrome existant (CDP). Cookie extract via `Network.getAllCookies` comme bunlight le fait déjà.

### 4.4 Hybrid / red-team

| Outil | Note |
|---|---|
| [thewh1teagle/chrome-privless-encryption](https://github.com/thewh1teagle/chrome-privless-encryption) | PoC ABE bypass via Remote Debugging Protocol sans admin. Documenté pour OSS audit, pas pour exfiltration malveillante. |
| [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) | CLI léger pour drive Chrome existant via CDP. Inspiration directe pour bunlight `real-browser`. |

---

## 5. CDP commands utiles (cheatsheet)

Toutes ces commandes s'exécutent via `cdp.send(...)` après attache :

| Command | Usage |
|---|---|
| `Network.getAllCookies` | Tous cookies du profil (déchiffrés) |
| `Network.getCookies { urls }` | Cookies d'un domaine spécifique |
| `Network.setCookie { ... }` | Inject un cookie (utile pour test) |
| `Storage.getCookies { browserContextId }` | Cookies d'un browser context (incognito) |
| `Storage.clearCookies` | Wipe cookies |
| `Storage.getStorageKeyForFrame` | Storage key pour DOMStorage |
| `DOMStorage.getDOMStorageItems` | localStorage / sessionStorage |
| `IndexedDB.requestDatabaseNames` | Liste IDB databases |
| `IndexedDB.requestData` | Dump IDB content |
| `Cache.requestCachedResponse` | Service Worker cache |
| `Page.captureScreenshot` | Screenshot full / clip |
| `Browser.getVersion` | Sanity check |
| `Target.getTargets` | Liste tabs/pages ouverts |

Référence complète : [Context7 `/chromedevtools/devtools-protocol`](https://context7.com/chromedevtools/devtools-protocol) (TypeScript types)
ou [debugger-protocol-viewer](https://chromedevtools.github.io/devtools-protocol/).

---

## 6. SQLite schema reference (Chrome 147)

### 6.1 `Cookies` (path: `<profile>/Network/Cookies`)

```sql
CREATE TABLE cookies (
  creation_utc INTEGER NOT NULL,
  host_key TEXT NOT NULL,                -- domain, e.g. ".github.com"
  top_frame_site_key TEXT NOT NULL,      -- partition key
  name TEXT NOT NULL,
  value TEXT NOT NULL,                   -- empty when encrypted_value is set
  encrypted_value BLOB DEFAULT '',       -- DPAPI + AES-GCM (Chrome 127+ ABE)
  path TEXT NOT NULL,
  expires_utc INTEGER NOT NULL,
  is_secure INTEGER NOT NULL,
  is_httponly INTEGER NOT NULL,
  last_access_utc INTEGER NOT NULL,
  has_expires INTEGER NOT NULL,
  is_persistent INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  samesite INTEGER NOT NULL,
  source_scheme INTEGER NOT NULL,
  source_port INTEGER NOT NULL,
  is_same_party INTEGER NOT NULL,
  last_update_utc INTEGER NOT NULL,
  source_type INTEGER NOT NULL,
  has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (host_key, top_frame_site_key, name, path, source_scheme, source_port)
);
```

Decrypt `encrypted_value` :
- **Avant Chrome 127** : DPAPI `CryptUnprotectData(blob)` puis AES-GCM avec key du local state.
- **Chrome 127+** : ne marche plus depuis l'extérieur de chrome.exe. Use CDP.

### 6.2 `History` (path: `<profile>/History`)

```sql
CREATE TABLE urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url LONGVARCHAR,
  title LONGVARCHAR,
  visit_count INTEGER DEFAULT 0 NOT NULL,
  typed_count INTEGER DEFAULT 0 NOT NULL,
  last_visit_time INTEGER NOT NULL,      -- microseconds since 1601-01-01 UTC
  hidden INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  url INTEGER NOT NULL,                  -- FK to urls.id
  visit_time INTEGER NOT NULL,
  from_visit INTEGER,                    -- referrer visit
  external_referrer_url LONGVARCHAR,
  transition INTEGER DEFAULT 0 NOT NULL,
  segment_id INTEGER,
  visit_duration INTEGER DEFAULT 0 NOT NULL,
  incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
  opener_visit INTEGER,
  originator_cache_guid TEXT,
  originator_visit_id INTEGER,
  ...
);
```

Convert Chrome timestamp → JS Date :
```ts
function chromeTsToDate(ts: number): Date {
  // microseconds since 1601-01-01 UTC -> milliseconds since epoch
  return new Date(ts / 1000 - 11644473600_000);
}
```

### 6.3 `Login Data` (path: `<profile>/Login Data`)

```sql
CREATE TABLE logins (
  origin_url VARCHAR NOT NULL,
  action_url VARCHAR,
  username_element VARCHAR,
  username_value VARCHAR,
  password_element VARCHAR,
  password_value BLOB,                   -- DPAPI + ABE (post-127)
  ...
);
```

Pas de bypass propre. CDP n'expose pas les passwords stockés (par design).

### 6.4 `Bookmarks` (JSON, path: `<profile>/Bookmarks`)

```json
{
  "checksum": "<md5>",
  "roots": {
    "bookmark_bar": { "id": "1", "type": "folder", "name": "...", "children": [...] },
    "other":        { "id": "2", "type": "folder", "name": "Other Bookmarks", "children": [...] },
    "synced":       { "id": "3", "type": "folder", "name": "Mobile Bookmarks", "children": [...] }
  },
  "sync_metadata": "..."
}
```

Chaque enfant : `{ id, type: "folder"|"url", name, url?, date_added, date_modified, children? }`.

### 6.5 `Local State` (JSON, path: `<userDataDir>/Local State`)

Master key chiffrée pour les cookies, listing des profils, prefs globales.

```json
{
  "os_crypt": {
    "encrypted_key": "<DPAPI(...)>",
    "audit_enabled": false,
    "encrypted_app_bound_key": "<DPAPI(...)>"   // Chrome 127+
  },
  "profile": {
    "info_cache": {
      "Default":   { "name": "Person 1", "user_name": "yohan@..." },
      "Profile 1": { "name": "Travail",  "user_name": "..." }
    },
    "last_active_profiles": ["Default"],
    ...
  }
}
```

---

## 7. Patterns d'usage (recipes)

### 7.1 Audit cookies par domaine

```ts
const handle = await launchRealBrowser({ headless: true });
try {
  const cookies = await extractCookiesViaCdp(handle);
  const byDomain = new Map<string, number>();
  for (const c of cookies) {
    byDomain.set(c.domain, (byDomain.get(c.domain) ?? 0) + 1);
  }
  const top = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [d, n] of top) console.log(`${n.toString().padStart(4)}  ${d}`);
} finally {
  await handle.close();
}
```

### 7.2 Migrer login session vers test environment

```ts
// 1. Extract from real Chrome
const handle = await launchRealBrowser({ headless: true });
const cookies = await extractCookiesForDomainsViaCdp(handle, ["https://app.example.com"]);
await handle.close();

// 2. Inject into a fresh fast/static profile for E2E tests
const ghost = await loadGhostProfile();
const browser = await ghost.launchGhostBrowser();
const ctx = await browser.createBrowserContext();
await ctx.setCookies(...cookies);
```

### 7.3 Backup history avant changement de machine

```ts
const history = await extractHistoryFromSqlite(undefined, "Default", 100_000);
await Bun.write("history-backup.jsonl", history.map((h) => JSON.stringify(h)).join("\n"));
```

(Pré-condition : Chrome fermé.)

### 7.4 Forensics complet

Aucune raison de réimplémenter `hindsight`. Pour un dump XLSX/JSONL exhaustif :

```bash
# Install one-shot
pip install pyhindsight

# Dump current profile
hindsight --input "C:\Users\yohan\AppData\Local\Google\Chrome\User Data\Default" \
          --format jsonl \
          --output ~/audit-2026-05-10
```

---

## 8. Roadmap bunlight `real-browser`

- [x] CDP cookie extract (`extractCookiesViaCdp`, `extractCookiesForDomainsViaCdp`)
- [x] SQLite history reader (`extractHistoryFromSqlite`)
- [x] Bookmarks JSON parser (`extractBookmarks`)
- [ ] CDP localStorage / sessionStorage extractor (via `DOMStorage.*`)
- [ ] CDP IndexedDB dump (`IndexedDB.requestData`)
- [ ] Profile snapshot/restore (clone User Data dir into temp, restore on session end)
- [ ] hindsight wrapper (`bunlight real-browser forensics --output dir`)
- [ ] Chrome 147 LNA prompt automation (`Network.setAcceptedEncodings` ne couvre pas, à mapper)

---

## 9. Sources

- [Chrome 147 release notes](https://developer.chrome.com/release-notes/147)
- [Chromium DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Context7 chromedevtools/devtools-protocol](https://context7.com/chromedevtools/devtools-protocol) (TypeScript types)
- [Context7 pasky/chrome-cdp-skill](https://context7.com/pasky/chrome-cdp-skill) (CLI design inspiration)
- [Chromium source: app_bound_encryption_provider_win.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/app_bound_encryption_provider_win.cc)
- [thewh1teagle/rookie](https://github.com/thewh1teagle/rookie) — Rust cookie reader
- [thewh1teagle/chrome-privless-encryption](https://github.com/thewh1teagle/chrome-privless-encryption) — ABE bypass PoC
- [obsidianforensics/hindsight](https://github.com/RyanDFIR/hindsight) — Python DFIR tool 1422⭐
- [borisbabic/browser_cookie3](https://github.com/borisbabic/browser_cookie3) — Python cookies cross-browser
- [bertrandom/chrome-cookies-secure](https://github.com/bertrandom/chrome-cookies-secure) — Node/macOS
- [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) — CLI direct CDP
- [Chrome Releases blog](https://chromereleases.googleblog.com/)
- [Phoronix: Chrome 147 Stable Released](https://www.phoronix.com/news/Chrome-147-Stable-Released)
