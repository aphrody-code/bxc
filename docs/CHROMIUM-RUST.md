# Chromium / Chrome — l'écosystème Rust complet

> Branche : `windows`. Mise à jour : 2026-05-10. Cible Chrome 147+ (ABE).
> Compagnon de [`CHROME-UTILS.md`](./CHROME-UTILS.md).

Catalog ciblé Rust : crates pour driver Chromium via CDP, embed CEF, parser le User Data dir, bypass App-Bound Encryption Chrome 127+, et cross-compile vers Windows. Avec install + quick-start + verdict (qui marche en 2026, qui est mort).

---

## TL;DR — la stack Rust recommandée

```toml
# Cargo.toml
[dependencies]
# 1. Driver CDP haut niveau (recommandé)
chromiumoxide = { version = "0.9", features = ["tokio-runtime"] }

# 2. Parser SQLite local (history, bookmarks, cookies offline)
rusqlite = { version = "0.32", features = ["bundled"] }

# 3. Cookies cross-platform (DPAPI/Keychain/libsecret) pre-Chrome-127
rookie = "0.5"

# 4. Cross-compile Windows
# (binary tool, pas Cargo dep)
# cargo install --locked cargo-xwin

# 5. Async runtime
tokio = { version = "1", features = ["full"] }
futures = "0.3"
```

**Verdict 2026-05-10** :
- `chromiumoxide` (1275⭐, [mattsse/chromiumoxide](https://github.com/mattsse/chromiumoxide)) = standard de facto. Maintenu, supporte stealth + connect existing + cookies CDP.
- `rust-headless-chrome` (28⭐) = quasi mort — ne pas adopter.
- `chrome-remote-interface-rs` (yskszk63) = OK, plus bas niveau, dernière update 2023.
- `chromium-source-rs` / direct Chromium bindings = inutile pour 99% des cas.

---

## 1. Driver CDP (Chrome DevTools Protocol)

### 1.1 chromiumoxide — RECOMMANDÉ

```bash
cargo add chromiumoxide --features tokio-runtime
cargo add tokio --features full
cargo add futures
```

[mattsse/chromiumoxide](https://github.com/mattsse/chromiumoxide) — 1275⭐, async API haut niveau, supporte tous les types CDP, launch + connect, headless + headed, stealth built-in.

#### Connect to Existing Chrome (le cas real-browser)

```rust
use chromiumoxide::browser::Browser;
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Auto-discover via HTTP, ou WS direct
    let (browser, mut handler) = Browser::connect(
        "http://127.0.0.1:9222"
    ).await?;

    let _h = tokio::spawn(async move {
        while let Some(h) = handler.next().await {
            if h.is_err() { break; }
        }
    });

    let page = browser.new_page("https://github.com/notifications").await?;
    let title = page.get_title().await?;
    println!("Title: {:?}", title);

    browser.close().await?;
    Ok(())
}
```

#### Stealth Mode (anti-bot) built-in

```rust
use chromiumoxide::browser::{Browser, BrowserConfig};

let config = BrowserConfig::builder()
    .with_head()
    .hide()                              // Disable AutomationControlled
    .build()?;

let (browser, mut handler) = Browser::launch(config).await?;
let page = browser.new_page("https://example.com").await?;
page.enable_stealth_mode().await?;       // Patch navigator.* + plugins + WebGL
```

#### Cookie Management (Chrome 127+ ABE bypass via CDP)

```rust
use chromiumoxide::cdp::browser_protocol::network::CookieParam;

let page = browser.new_page("https://github.com").await?;

// Get all cookies (Chrome decrypts ABE on its side)
let cookies = page.get_cookies().await?;
for c in &cookies {
    println!("{}={}  ({})", c.name, c.value, c.domain);
}

// Or browser-level
let all = browser.get_cookies().await?;
browser.clear_cookies().await?;
```

Doc Context7 complète : [`/mattsse/chromiumoxide`](https://context7.com/mattsse/chromiumoxide) — 43 snippets curated, 81.95/100 benchmark.

### 1.2 chrome-remote-interface-rs

```bash
cargo add chrome-remote-interface
```

[yskszk63/chrome-remote-interface-rs](https://github.com/yskszk63/chrome-remote-interface-rs) — bas niveau, port direct du chrome-remote-interface Node. Updates rares (dernière 2023). Préférer chromiumoxide.

### 1.3 rust-headless-chrome — DÉPRÉCIÉ

[atroche/rust-headless-chrome](https://github.com/atroche/rust-headless-chrome) — 28⭐ seulement. Pas maintenu. À éviter.

### 1.4 fantoccini — WebDriver alternative

```bash
cargo add fantoccini
```

[jonhoo/fantoccini](https://github.com/jonhoo/fantoccini) — 2003⭐. Utilise WebDriver protocol (pas CDP). Demande chromedriver running. Plus stable mais moins de features que CDP.

### 1.5 thirtyfour — Selenium client

```bash
cargo add thirtyfour
```

[stevepryde/thirtyfour](https://github.com/stevepryde/thirtyfour) — 1412⭐, Selenium WebDriver client complet, chrome/firefox/edge. Pour tests E2E plus que pour scraping.

---

## 2. Embed Chromium (CEF — Chromium Embedded Framework)

CEF expose Chromium comme une lib embarquable dans une app native. Pour faire du Tauri-like ou de la GUI Rust avec rendu HTML.

### 2.1 cef-rs — fork actif

```bash
cargo add cef
```

[dylanede/cef-rs](https://github.com/dylanede/cef-rs) — 62⭐, **dernière update 2026-05-08** (le plus actif). Bindings unsafe, demande CEF binaries pre-built.

### 2.2 cef-ui — bridge moderne

```bash
git clone https://github.com/hytopiagg/cef-ui ~/cef-ui
cd ~/cef-ui && cargo build --release
```

[hytopiagg/cef-ui](https://github.com/hytopiagg/cef-ui) — 30⭐, mis à jour 2026-04. Bridge plus haut niveau, builder pattern.

### 2.3 dungeonfog/cef — safe wrapper WIP

[dungeonfog/cef](https://github.com/dungeonfog/cef) — wrapper safe, encore en WIP.

### 2.4 Julusian/rust-cef — ARCHIVÉ

[Julusian/rust-cef](https://github.com/Julusian/rust-cef) — archivé 2025. Ne pas adopter.

---

## 3. WebView (Tauri ecosystem)

Pour embed un browser sans CEF (utilise le WebView natif de l'OS).

### 3.1 wry — cross-platform WebView

```bash
cargo add wry
```

[tauri-apps/wry](https://github.com/tauri-apps/wry) — 4773⭐. Wrap WebKit (macOS/Linux) + WebView2 (Windows). C'est ce que Tauri utilise.

```rust
use wry::WebViewBuilder;
let webview = WebViewBuilder::new(&window)
    .with_url("https://example.com")
    .build()?;
```

### 3.2 tao — window backend

```bash
cargo add tao
```

[tauri-apps/tao](https://github.com/tauri-apps/tao). Window/event loop pour wry.

### 3.3 webview2-rs — Microsoft Edge WebView2 (Windows-only)

```bash
cargo add webview2
```

[wravery/webview2-rs](https://github.com/wravery/webview2-rs) — 69⭐. Bindings COM Windows pour le runtime Edge WebView2 (l'Edge moderne). Demande WebView2 Runtime installé sur Windows (pré-installé Win11, à installer Win10).

---

## 4. Parser le User Data dir Chrome (lecture offline)

### 4.1 rusqlite (lecture History/Bookmarks/Cookies SQLite)

```bash
cargo add rusqlite --features bundled
```

```rust
use rusqlite::Connection;

let path = std::env::var("LOCALAPPDATA")
    .unwrap_or_default() + r"\Google\Chrome\User Data\Default\History";
let conn = Connection::open_with_flags(
    &path,
    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
)?;

let mut stmt = conn.prepare(
    "SELECT url, title, visit_count, last_visit_time FROM urls
     ORDER BY last_visit_time DESC LIMIT 100"
)?;
let rows: Vec<(String, String, i64, i64)> = stmt
    .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
    .filter_map(Result::ok)
    .collect();
```

`bundled` feature = embarque SQLite, pas besoin de libsqlite3 sur la machine.

NB : Chrome doit être fermé (lock SQLite). Pour lecture pendant que Chrome tourne, utiliser CDP via chromiumoxide.

### 4.2 rookie — cookies cross-platform pre-Chrome-127

```bash
cargo add rookie
```

[thewh1teagle/rookie](https://github.com/thewh1teagle/rookie) — 352⭐. DPAPI Windows + Keychain macOS + libsecret Linux. **NE FONCTIONNE PAS sur Chrome 127+ ABE** (issue ouverte upstream).

```rust
use rookie::chrome;
let cookies = chrome(Some(vec!["github.com".to_string()]))?;
```

Bon pour Firefox + Brave + Edge + Chrome pre-127 + macOS/Linux Chrome.

### 4.3 bypass_v20_chrome_cookies — Chrome 127+ ABE bypass (Rust)

```bash
git clone https://github.com/exiton0x/bypass_v20_chrome_cookies
cd bypass_v20_chrome_cookies && cargo build --release
```

[exiton0x/bypass_v20_chrome_cookies](https://github.com/exiton0x/bypass_v20_chrome_cookies) — **PoC Rust** pour récupérer cookies Chrome v20+ (= 127+ ABE). Utilise probablement DLL injection ou COM access. À auditer avant adoption.

### 4.4 Chrome-Cookie-Decryptor (CCD)

[1101-1/Chrome-Cookie-Decryptor](https://github.com/1101-1/Chrome-Cookie-Decryptor) — Rust, 2026-01. "Fast" decryptor. Supporte v20+. Vérifier code avant.

### 4.5 chrome_cookies (pkptzx)

[pkptzx/chrome_cookies](https://github.com/pkptzx/chrome_cookies) — Rust + Chinese docs, retrieve passwords + cookies. Audit recommandé.

### 4.6 extract-chrome-cookies

[lei4519/extract-chrome-cookies](https://github.com/lei4519/extract-chrome-cookies) — lecture SQLite (pas decrypt complet).

---

## 5. Cross-compile Rust → Windows (depuis Linux/macOS)

### 5.1 cargo-xwin — RECOMMANDÉ

```bash
sudo apt install -y build-essential pkg-config libssl-dev
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin

# Build
cargo xwin build --target x86_64-pc-windows-msvc --release
```

[rust-cross/cargo-xwin](https://github.com/rust-cross/cargo-xwin) — télécharge le SDK Windows MSVC à la demande, pas de licence MSVC requise. Standard moderne.

### 5.2 mingw-w64 (alternative GNU)

```bash
sudo apt install -y mingw-w64
rustup target add x86_64-pc-windows-gnu

# ~/.cargo/config.toml
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"

cargo build --target x86_64-pc-windows-gnu --release
```

Alternative legacy. Certaines crates demandent MSVC ; dans ce cas basculer sur cargo-xwin.

### 5.3 Native Windows (winget host)

```powershell
winget install --id Rustlang.Rustup --id Microsoft.VisualStudio.2022.BuildTools `
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
rustup default stable
rustup target add x86_64-pc-windows-msvc
cargo build --release
```

---

## 6. Crates utilitaires connexes

### 6.1 reqwest (HTTP client, useful avec CDP)

```bash
cargo add reqwest --features json,rustls-tls
```

Récupérer `/json/version` du debugger socket :

```rust
let info: serde_json::Value = reqwest::get("http://127.0.0.1:9222/json/version")
    .await?
    .json()
    .await?;
let ws = info["webSocketDebuggerUrl"].as_str().unwrap();
```

### 6.2 tokio-tungstenite (WS client bas niveau)

```bash
cargo add tokio-tungstenite --features rustls-tls-native-roots
```

Pour parler CDP directement sans chromiumoxide. **Important** : feature `rustls-tls-native-roots` pour Windows (sinon OpenSSL hell).

### 6.3 serde_json / serde

```bash
cargo add serde serde_json --features derive
```

Parser les Bookmarks JSON / Local State JSON / messages CDP.

### 6.4 keyring — secrets cross-platform

```bash
cargo add keyring
```

[hwchen/keyring-rs](https://github.com/hwchen/keyring-rs). DPAPI Windows / Keychain macOS / libsecret Linux. Utile si on veut stocker un cookie jar séparé du Chrome user.

### 6.5 sqlx (alternative à rusqlite, async)

```bash
cargo add sqlx --features sqlite,runtime-tokio,tls-rustls
```

Pour gros volumes ou queries dynamiques.

---

## 7. Comparaison sommaire

### 7.1 Driver CDP

| Crate | ⭐ | Maint. | Async | Stealth built-in | Connect existing |
|---|---|---|---|---|---|
| **chromiumoxide** | 1275 | active | tokio | Yes | Yes |
| chrome-remote-interface-rs | low | 2023 | tokio | manual | Yes |
| rust-headless-chrome | 28 | dead | sync | manual | Yes |
| fantoccini (WebDriver) | 2003 | active | tokio | n/a | n/a |
| thirtyfour (Selenium) | 1412 | active | tokio | n/a | n/a |

### 7.2 Embed Chromium (CEF)

| Crate | ⭐ | Maint. | API | Note |
|---|---|---|---|---|
| **cef-rs** (dylanede) | 62 | 2026-05 | unsafe | le plus actif |
| cef-ui (hytopiagg) | 30 | 2026-04 | builder | bridge moderne |
| cef (dungeonfog) | low | WIP | safe | en construction |
| rust-cef (Julusian) | n/a | archived 2025 | unsafe | DEAD |

### 7.3 WebView

| Crate | ⭐ | OS | Note |
|---|---|---|---|
| **wry** | 4773 | macOS+Linux+Windows | Tauri standard, prod-ready |
| webview2-rs | 69 | Windows only | Edge WebView2 COM |
| tao | n/a | cross | window backend pour wry |

### 7.4 Cookies parser

| Crate | ⭐ | Pre-127 | **Chrome 127+ ABE** | Cross-platform |
|---|---|---|---|---|
| rookie | 352 | OK | broken | Win+macOS+Linux |
| bypass_v20_chrome_cookies | n/a | n/a | OK (PoC) | Windows |
| Chrome-Cookie-Decryptor | n/a | OK | partial | Windows |
| chromiumoxide CDP | 1275 | OK | **OK** | cross |

### 7.5 Cross-compile

| Tool | Source | Note |
|---|---|---|
| **cargo-xwin** | rust-cross | RECOMMANDÉ — SDK MSVC à la demande |
| mingw-w64 | distro | alternative GNU |
| Docker `messense/cargo-xwin` | Docker Hub | hermetic CI |

---

## 8. Quick-start — script complet "Rust drive my real Chrome"

```toml
# Cargo.toml
[package]
name = "my-chrome-driver"
version = "0.1.0"
edition = "2021"

[dependencies]
chromiumoxide = { version = "0.9", features = ["tokio-runtime"] }
tokio = { version = "1", features = ["full"] }
futures = "0.3"
serde_json = "1"
```

```rust
// src/main.rs
use chromiumoxide::browser::Browser;
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Lance ton Chrome avant ce programme :
    //    chrome.exe --remote-debugging-port=9222
    //               --user-data-dir="C:\Users\yohan\AppData\Local\Google\Chrome\User Data"
    //               --profile-directory=Default
    //
    // 2. Attache
    let (browser, mut handler) = Browser::connect("http://127.0.0.1:9222").await?;
    let _drain = tokio::spawn(async move {
        while let Some(h) = handler.next().await { let _ = h; }
    });

    // 3. Ouvre une page (logged-in si la session est active dans le profil)
    let page = browser.new_page("https://github.com/notifications").await?;
    let title = page.get_title().await?;
    println!("Title: {:?}", title);

    // 4. Récupère TOUS les cookies décryptés (ABE bypass via CDP)
    let cookies = page.get_cookies().await?;
    println!("Got {} cookies", cookies.len());

    for c in cookies.iter().filter(|c| c.domain.contains("github.com")) {
        println!("  {}={}  (httpOnly={})", c.name, &c.value[..c.value.len().min(20)], c.http_only);
    }

    Ok(())
}
```

Build cross-platform :

```bash
# Linux native
cargo build --release

# Linux -> Windows (cargo-xwin)
cargo xwin build --target x86_64-pc-windows-msvc --release

# Windows native
cargo build --release    # depuis PowerShell sur Windows
```

---

## 9. Cross-references

- [Context7 chromiumoxide](https://context7.com/mattsse/chromiumoxide) — 43 snippets curated
- [`CHROME-UTILS.md`](./CHROME-UTILS.md) — catalog tools tous langages
- [`CHROME-USER-DATA-PARSING.md`](./CHROME-USER-DATA-PARSING.md) — Chrome 147 + ABE
- [`PROFILES-WINDOWS.md`](./PROFILES-WINDOWS.md) — bunlight real-browser
- [`BUILD-WINDOWS.md`](./BUILD-WINDOWS.md) — cross-compile stack complète

---

## 10. Sources

- [mattsse/chromiumoxide](https://github.com/mattsse/chromiumoxide) — 1275⭐
- [yskszk63/chrome-remote-interface-rs](https://github.com/yskszk63/chrome-remote-interface-rs)
- [atroche/rust-headless-chrome](https://github.com/atroche/rust-headless-chrome)
- [jonhoo/fantoccini](https://github.com/jonhoo/fantoccini) — 2003⭐
- [stevepryde/thirtyfour](https://github.com/stevepryde/thirtyfour) — 1412⭐
- [dylanede/cef-rs](https://github.com/dylanede/cef-rs) — 62⭐
- [hytopiagg/cef-ui](https://github.com/hytopiagg/cef-ui) — 30⭐
- [dungeonfog/cef](https://github.com/dungeonfog/cef)
- [tauri-apps/wry](https://github.com/tauri-apps/wry) — 4773⭐
- [tauri-apps/tao](https://github.com/tauri-apps/tao)
- [wravery/webview2-rs](https://github.com/wravery/webview2-rs) — 69⭐
- [thewh1teagle/rookie](https://github.com/thewh1teagle/rookie) — 352⭐
- [exiton0x/bypass_v20_chrome_cookies](https://github.com/exiton0x/bypass_v20_chrome_cookies)
- [1101-1/Chrome-Cookie-Decryptor](https://github.com/1101-1/Chrome-Cookie-Decryptor)
- [pkptzx/chrome_cookies](https://github.com/pkptzx/chrome_cookies)
- [lei4519/extract-chrome-cookies](https://github.com/lei4519/extract-chrome-cookies)
- [rust-cross/cargo-xwin](https://github.com/rust-cross/cargo-xwin)
- [hwchen/keyring-rs](https://github.com/hwchen/keyring-rs)
- [rusqlite docs](https://docs.rs/rusqlite/latest/rusqlite/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
