# chrome-utils — tools à installer pour parser, driver et auditer Chrome

> Branche : `windows`. Mise à jour : 2026-05-10. Cible Chrome 147+ (App-Bound Encryption).
> Compagnon de [`PROFILES-WINDOWS.md`](./PROFILES-WINDOWS.md) et [`CHROME-USER-DATA-PARSING.md`](./CHROME-USER-DATA-PARSING.md).

Liste complète et opinionée des outils utilisables pour interagir avec Chrome installé localement (driver, extract cookies/history/sessions, audit forensics, build Windows). Une commande d'install par outil, un quick-start et un cas d'usage typique.

---

## TL;DR — la stack minimum

```bash
# 1. Bunlight (notre repo) — driver Chrome local + extractors CDP intégrés
bun add @aphrody-code/bunlight   # GitHub Packages
bun add @rosegriffon/bunlight    # npm public

# 2. Puppeteer + extras — drive un Chrome existant via CDP
bun add puppeteer-core puppeteer-extra \
  puppeteer-extra-plugin-stealth \
  puppeteer-extra-plugin-anonymize-ua \
  puppeteer-extra-plugin-adblocker

# 3. agent-browser CLI — auto-discover Chrome + drive depuis terminal
bun add @aphrody-code/agent-browser   # ou installer le binary natif
```

Sur Windows natif tu rajoutes :

```powershell
winget install Oven-sh.Bun Git.Git LLVM.LLVM Rustlang.Rustup zig.zig
winget install --id Microsoft.VisualStudio.2022.BuildTools `
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

C'est suffisant pour 90% des cas d'usage (drive Chrome, extract cookies via CDP, scraper, build Windows).

Pour de la **forensics** offline (Chrome fermé) :

```bash
pip install pyhindsight   # 1422⭐ DFIR — dump XLSX/JSONL exhaustif
```

---

## 1. Outils Node.js / Bun (drive Chrome via CDP)

### 1.1 Bunlight (notre repo)

```bash
bun add @aphrody-code/bunlight        # scope GitHub Packages
bun add @rosegriffon/bunlight         # scope npm public
```

Le bundle inclut :
- `bunlight serve --cdp-port 9222 --profile <static|fast|http|stealth|max|real-browser>`
- `bunlight real-browser launch|inspect|profiles|cookies|history|bookmarks`
- `bunlight scrape <url>`, `bunlight mirror <url> <out-dir>`, `bunlight challonge`
- API TS : `import { Browser } from "@aphrody-code/bunlight"`
- API real-browser : `import { launchRealBrowser } from "@aphrody-code/bunlight/profiles/real-browser"`

Quick-start :

```ts
import { launchRealBrowser, extractCookiesViaCdp } from "@aphrody-code/bunlight/profiles/real-browser";

const handle = await launchRealBrowser({ profileDirectory: "Default" });
const cookies = await extractCookiesViaCdp(handle);
console.log(`Got ${cookies.length} decrypted cookies`);
await handle.close();
```

### 1.2 puppeteer-core (driver CDP officiel)

```bash
bun add puppeteer-core
```

```ts
import puppeteer from "puppeteer-core";
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://127.0.0.1:9222/devtools/browser/...",
});
```

Pas de Chromium bundlé — utilisé pour s'attacher à un Chrome existant.

### 1.3 puppeteer (avec Chromium bundlé)

```bash
bun add puppeteer
```

À éviter sur Windows ; préférer `puppeteer-core` + Chrome local installé.

### 1.4 puppeteer-extra + plugins

```bash
bun add puppeteer-extra \
  puppeteer-extra-plugin-stealth \
  puppeteer-extra-plugin-anonymize-ua \
  puppeteer-extra-plugin-adblocker \
  puppeteer-extra-plugin-recaptcha \
  puppeteer-extra-plugin-block-resources
```

```ts
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
```

`puppeteer-extra-plugin-stealth` corrige ~30 points de détection (navigator.webdriver, chrome runtime, plugins, languages, permissions, WebGL fingerprints, etc.).

### 1.5 patchright-core (Playwright stealth fork)

```bash
bun add patchright-core
```

Drop-in replacement de `playwright-core` avec patches stealth maintenus par la communauté patchright. Plus moderne que puppeteer-extra-stealth pour certains cas.

### 1.6 chrome-cookies-secure (Node, simple cookie extract)

```bash
bun add chrome-cookies-secure
```

```ts
import { getCookies } from "chrome-cookies-secure";
getCookies("https://example.com", "puppeteer", (err, cookies) => {
  console.log(cookies);
});
```

Limites : macOS/Linux only, pas d'ABE Chrome 127+.

### 1.7 chrome-cdp-skill (CLI léger CDP)

```bash
git clone https://github.com/pasky/chrome-cdp-skill ~/chrome-cdp
cd ~/chrome-cdp && bun install
~/chrome-cdp/bin/cdp [tab-id] navigate https://example.com
~/chrome-cdp/bin/cdp [tab-id] evalraw "Network.getAllCookies" "{}"
```

Utile pour scripts shell rapides quand on a déjà Chrome ouvert avec `--remote-debugging-port`.

### 1.8 agent-browser (notre fork)

```bash
# Via npm
npm i -g @aphrody-code/agent-browser
# Ou binary direct
curl -L https://github.com/aphrody-code/agent-browser/releases/latest/download/agent-browser-linux-x64 -o /usr/local/bin/agent-browser
chmod +x /usr/local/bin/agent-browser
```

```bash
agent-browser doctor
agent-browser open https://github.com/notifications        # default = chrome on Windows
agent-browser --engine bunlight --profile real-browser open https://example.com
```

---

## 2. Outils Python (forensics + cookie extract offline)

### 2.1 pyhindsight (DFIR Chrome forensics) — 1422⭐

```bash
pip install pyhindsight                    # ou: pipx install pyhindsight
```

```bash
hindsight --input "C:\Users\yohan\AppData\Local\Google\Chrome\User Data\Default" \
          --format jsonl \
          --output ./audit-2026-05-10
```

Dump complet : history, cookies, downloads, autofill, login data, prefs, archived history, GAIA, omnibox shortcuts, network actions, search terms. Chrome doit être **fermé**.

GUI dispo : `hindsight_gui.py`. Output XLSX/SQLite/JSONL.

### 2.2 browser_cookie3 — 1039⭐

```bash
pip install browser-cookie3
```

```python
import browser_cookie3
import requests

cj = browser_cookie3.chrome(domain_name="github.com")
r = requests.get("https://github.com/notifications", cookies=cj)
```

Cross-browser (Chrome / Firefox / Edge / Brave / Opera). Limites : pas encore d'ABE Chrome 127+ → cookies post-127 illisibles.

### 2.3 chromedb (lecture history Python)

```bash
pip install chromedb
```

Pure Python SQLite reader pour `History`, `Bookmarks`, `Top Sites`, `Login Data`. Pas de decrypt.

### 2.4 pychrome (CDP client Python)

```bash
pip install pychrome
```

```python
import pychrome
browser = pychrome.Browser(url="http://127.0.0.1:9222")
tab = browser.new_tab()
tab.start()
tab.Network.enable()
tab.Page.navigate(url="https://example.com")
tab.wait(5)
cookies = tab.Network.getAllCookies()
```

Équivalent puppeteer-core en Python.

---

## 3. Outils Rust

### 3.1 rookie (cookie reader cross-platform) — 352⭐

```bash
cargo install rookie
# ou
pip install rookiepy
# ou
npm i rookie-node
```

```rust
use rookie::chrome;

let cookies = chrome(Some(vec!["github.com".to_string()]))?;
for c in cookies {
    println!("{}={}", c.name, c.value);
}
```

DPAPI Windows + Keychain macOS + libsecret Linux. ABE Chrome 127+ : pas encore (issue ouverte upstream).

### 3.2 chrome-cookies-rs (search bench)

```bash
cargo install --git https://github.com/<author>/chrome-cookies-rs
```

Plusieurs forks publics ; pas de leader clair.

### 3.3 chromiumoxide (Rust CDP client)

```toml
# Cargo.toml
[dependencies]
chromiumoxide = { version = "0.6", features = ["tokio-runtime"] }
```

```rust
use chromiumoxide::Browser;

let (browser, mut handler) = Browser::connect("ws://127.0.0.1:9222/...").await?;
let page = browser.new_page("https://example.com").await?;
let cookies = page.get_cookies().await?;
```

Équivalent puppeteer-core en Rust. Bien maintenu (foncé sur fantoccini/CDP).

### 3.4 cargo-xwin (cross-compile Rust → Windows MSVC)

```bash
sudo apt install -y build-essential pkg-config libssl-dev
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin

cargo xwin build --target x86_64-pc-windows-msvc --release
```

Requis pour build agent-browser depuis Linux. Voir [`BUILD-WINDOWS.md`](./BUILD-WINDOWS.md) §4.

---

## 4. Outils Go

### 4.1 chromedp (CDP client Go)

```bash
go install github.com/chromedp/chromedp@latest
```

```go
import "github.com/chromedp/chromedp"

ctx, cancel := chromedp.NewRemoteAllocator(context.Background(), "ws://127.0.0.1:9222/...")
defer cancel()

var cookies []*network.Cookie
chromedp.Run(ctx, network.GetAllCookies().Do(...))
```

Mature, beaucoup d'exemples, bon pour scripts ops Go.

### 4.2 godet (CDP léger)

```bash
go install github.com/raff/godet@latest
```

Plus bas-niveau que chromedp.

---

## 5. CLIs natifs (winget / apt / brew)

### 5.1 Build toolchain (Windows native, pas Cygwin/MSYS2)

```powershell
# Toolchains de base
winget install --id Oven-sh.Bun
winget install --id zig.zig --version 0.14.0
winget install --id Rustlang.Rustup
winget install --id Git.Git
winget install --id LLVM.LLVM
winget install --id Microsoft.VisualStudio.2022.BuildTools `
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# Build deps natives (curl-impersonate, V8, OpenSSL build)
winget install --id Python.Python.3
winget install --id NASM.NASM
winget install --id StrawberryPerl.StrawberryPerl
winget install --id RubyInstallerTeam.Ruby
winget install --id GnuWin32.Make
winget install --id pkgconfiglite
winget install --id Kitware.CMake

# Optionnels
winget install --id GoLang.Go
winget install --id OpenJS.NodeJS
```

### 5.2 Linux (apt / dnf)

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y \
  build-essential pkg-config libssl-dev curl tar xz-utils \
  libsecret-1-dev jq sqlite3 \
  google-chrome-stable     # ou chromium-browser

# Fedora
sudo dnf install -y \
  gcc-c++ make pkgconfig openssl-devel curl xz \
  libsecret-devel jq sqlite \
  google-chrome-stable
```

Bun :
```bash
curl -fsSL https://bun.sh/install | bash
```

Zig :
```bash
sudo snap install zig --classic --beta
# ou téléchargement direct ziglang.org/download
```

### 5.3 macOS (brew)

```bash
brew install bun zig rustup-init pkg-config openssl@3 jq sqlite
brew install --cask google-chrome
rustup-init -y
```

### 5.4 Lightpanda (browser engine alternatif)

```bash
# Postinstall auto via bunlight
bun add @aphrody-code/bunlight
# → vendor/lightpanda-bin/<platform>/lightpanda

# Manuel
curl -L https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-x86_64-linux \
  -o /usr/local/bin/lightpanda && chmod +x /usr/local/bin/lightpanda
```

Pas de release Windows officielle au 2026-05-10 — voir [`LIGHTPANDA-WINDOWS.md`](./LIGHTPANDA-WINDOWS.md).

### 5.5 curl-impersonate (TLS fingerprint Chrome)

```bash
# Linux pre-built (lexiforest, fork actif de curl-impersonate)
curl -L https://github.com/lexiforest/curl-impersonate/releases/download/v1.5.6/libcurl-impersonate-v1.5.6.x86_64-linux-gnu.tar.gz \
  | tar -xz -C /usr/local/lib

# macOS
brew install curl-impersonate

# Windows DLL — automatic via bunlight scripts/build-windows.{ps1,ts}
```

Permet d'imiter le TLS fingerprint exact de Chrome 131 sans utiliser Chrome — utile pour anti-bot bypass headless.

### 5.6 chrome-debugger CLI helpers

```bash
# Linux
curl http://127.0.0.1:9222/json/version | jq

# Windows
Invoke-RestMethod http://127.0.0.1:9222/json/version | ConvertTo-Json
```

Aucun outil à installer — c'est l'API CDP standard exposée par Chrome.

---

## 6. Outils Forensics & Audit (red-team / blue-team)

### 6.1 Hindsight GUI (forensics tout-en-un)

```bash
pip install pyhindsight[gui]
hindsight_gui.py
```

Web UI sur http://127.0.0.1:8080 — drag&drop d'un dossier User Data, dump exhaustif, export XLSX.

### 6.2 chrome-privless-encryption (ABE bypass PoC)

```bash
git clone https://github.com/thewh1teagle/chrome-privless-encryption
cd chrome-privless-encryption
pip install -r requirements.txt
python privless.py --browser chrome
```

PoC documenté pour audit. Confirme l'approche CDP comme la voie propre. **Ne pas utiliser pour exfiltration.**

### 6.3 nirsoft ChromeCookiesView (Windows GUI)

[https://www.nirsoft.net/utils/chrome_cookies_view.html](https://www.nirsoft.net/utils/chrome_cookies_view.html) — closed-source mais excellent pour audit one-shot. Free, pas d'install (portable .exe).

### 6.4 NirSoft ChromeHistoryView / ChromePass

Idem, GUI Windows. Pas de support Linux/macOS, pas en CLI scriptable.

---

## 7. Tableau récapitulatif

### 7.1 Par cas d'usage

| Besoin | Outil recommandé | Alternative |
|---|---|---|
| **Drive Chrome existant via CDP** | bunlight `real-browser` | puppeteer-core direct |
| **Stealth + bot bypass** | bunlight + puppeteer-extra plugins | patchright-core |
| **Extract cookies (Chrome 127+ ouvert)** | bunlight `extractCookiesViaCdp` | puppeteer-core `Network.getAllCookies` |
| **Extract cookies (Chrome 127+ fermé)** | (impossible sans bypass) | hindsight (ciphertext only) |
| **Extract history (Chrome fermé)** | bunlight `extractHistoryFromSqlite` | hindsight |
| **Extract bookmarks** | bunlight `extractBookmarks` | n'importe quel JSON parser |
| **Audit DFIR complet** | hindsight | bunlight + custom |
| **Build Windows depuis Linux** | bunlight `scripts/build-windows.ts` + cargo-xwin | docker image cross-compile |
| **CLI scriptable shell** | agent-browser ou chrome-cdp-skill | curl + jq sur 127.0.0.1:9222 |

### 7.2 Par stack

| Stack | Drive Chrome | Cookies | History | Forensics |
|---|---|---|---|---|
| **Bun/Node** | bunlight, puppeteer-core, puppeteer-extra | bunlight CDP, chrome-cookies-secure | bunlight bun:sqlite | (call hindsight via subprocess) |
| **Python** | pychrome | browser_cookie3 | chromedb | hindsight (gold standard) |
| **Rust** | chromiumoxide | rookie | rusqlite | (custom) |
| **Go** | chromedp, godet | (custom) | (custom) | (custom) |
| **CLI** | agent-browser, chrome-cdp-skill | bunlight cli | bunlight cli | hindsight CLI |
| **GUI** | (Chrome lui-même) | NirSoft ChromeCookiesView | NirSoft ChromeHistoryView | hindsight_gui |

### 7.3 Status ABE Chrome 127+

| Outil | DPAPI seul (pre-127) | DPAPI + ABE (127+) |
|---|---|---|
| **bunlight CDP** | OK | **OK** (Chrome decrypts) |
| puppeteer-core CDP | OK | **OK** |
| chromiumoxide CDP | OK | **OK** |
| chromedp CDP | OK | **OK** |
| chrome-cdp-skill | OK | **OK** |
| browser_cookie3 | OK | broken |
| rookie | OK | broken |
| chrome-cookies-secure | OK | broken |
| hindsight | OK (decrypt) | partial (ciphertext) |

**Règle d'or post-Chrome 127** : si tu veux des cookies déchiffrés, attache-toi à chrome.exe via CDP. Sinon tu auras du ciphertext.

---

## 8. Install one-liner par profil utilisateur

### 8.1 Dev / scraper Bun-based (Linux)

```bash
curl -fsSL https://bun.sh/install | bash
bun add @aphrody-code/bunlight puppeteer-core puppeteer-extra \
  puppeteer-extra-plugin-stealth puppeteer-extra-plugin-anonymize-ua
sudo apt install -y google-chrome-stable
```

### 8.2 Dev / scraper Bun-based (Windows)

```powershell
winget install --id Oven-sh.Bun --id Git.Git
bun add @aphrody-code/bunlight puppeteer-core puppeteer-extra `
  puppeteer-extra-plugin-stealth puppeteer-extra-plugin-anonymize-ua
# Chrome est déjà installé chez 95% des users Windows
```

### 8.3 DFIR / forensics analyst (Linux/macOS)

```bash
pip install pyhindsight browser-cookie3 chromedb pychrome
brew install jq sqlite-utils    # macOS, ou apt
```

### 8.4 Red team (audit auth flows)

```bash
git clone https://github.com/thewh1teagle/chrome-privless-encryption
git clone https://github.com/pasky/chrome-cdp-skill
bun add @aphrody-code/bunlight
pip install pyhindsight
```

### 8.5 Native Windows builder

```powershell
winget install --id Oven-sh.Bun --id zig.zig --id Rustlang.Rustup `
  --id Git.Git --id LLVM.LLVM
winget install --id Microsoft.VisualStudio.2022.BuildTools `
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
rustup target add x86_64-pc-windows-msvc
```

### 8.6 Cross-compile Linux → Windows

```bash
sudo apt install -y build-essential pkg-config libssl-dev mingw-w64
rustup target add x86_64-pc-windows-msvc x86_64-pc-windows-gnu
cargo install --locked cargo-xwin
```

---

## 9. Sources et liens cross-référencés

### Bunlight ecosystem (notre)

- [aphrody-code/bunlight](https://github.com/aphrody-code/bunlight) — repo + branches `main`/`windows`
- [aphrody-code/agent-browser](https://github.com/aphrody-code/agent-browser) — fork avec branch `windows`
- [`BUILD-WINDOWS.md`](./BUILD-WINDOWS.md) — build stack complète
- [`LIGHTPANDA-WINDOWS.md`](./LIGHTPANDA-WINDOWS.md) — Lightpanda Windows notes
- [`PROFILES-WINDOWS.md`](./PROFILES-WINDOWS.md) — profil real-browser
- [`CHROME-USER-DATA-PARSING.md`](./CHROME-USER-DATA-PARSING.md) — Chrome 147 + ABE deep dive

### Tools Node.js / Bun

- [puppeteer-core](https://github.com/puppeteer/puppeteer)
- [puppeteer-extra](https://github.com/berstend/puppeteer-extra)
- [patchright](https://github.com/Kaliiiiiiiiii/patchright)
- [bertrandom/chrome-cookies-secure](https://github.com/bertrandom/chrome-cookies-secure)
- [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill)

### Tools Python

- [obsidianforensics/hindsight](https://github.com/RyanDFIR/hindsight) — 1422⭐
- [borisbabic/browser_cookie3](https://github.com/borisbabic/browser_cookie3) — 1039⭐
- [pychrome](https://github.com/fate0/pychrome)

### Tools Rust

- [thewh1teagle/rookie](https://github.com/thewh1teagle/rookie) — 352⭐
- [chromiumoxide](https://github.com/mattsse/chromiumoxide)
- [rust-cross/cargo-xwin](https://github.com/rust-cross/cargo-xwin)

### Tools Go

- [chromedp/chromedp](https://github.com/chromedp/chromedp)
- [raff/godet](https://github.com/raff/godet)

### Browsers / engines

- [Chrome 147 release notes](https://developer.chrome.com/release-notes/147)
- [Chromium DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Lightpanda](https://github.com/lightpanda-io/browser)
- [lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate)

### Forensics / red team

- [thewh1teagle/chrome-privless-encryption](https://github.com/thewh1teagle/chrome-privless-encryption) — ABE bypass PoC
- [NirSoft ChromeCookiesView](https://www.nirsoft.net/utils/chrome_cookies_view.html)
- [Chromium app_bound_encryption_provider_win.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/app_bound_encryption_provider_win.cc)

### Build infrastructure

- [bun.com/docs/project/building-windows](https://bun.com/docs/project/building-windows)
- [bun.sh/install.ps1](https://bun.sh/install.ps1)
- [Rust cross-compile](https://rust-lang.github.io/rustup/cross-compilation.html)
- [Zig cross-compile](https://ziglang.org/learn/overview/#cross-compiling-is-a-first-class-use-case)
