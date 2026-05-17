# Build Windows — Stack complète bunlight + lightpanda + agent-browser

> Cible : Windows x64 (et ARM64 best-effort) sans WSL, sans MSYS2, sans Cygwin.
> Toolchain : Windows-native via winget OU cross-compilation depuis Linux/macOS.
> Maintainer : @aphrody-code, @yohan971.

---

## TL;DR — la voie la plus rapide

| Projet | Hôte recommandé | Commande one-shot |
|---|---|---|
| **bunlight** (Bun TS) | Linux/macOS | `bun scripts/build-windows.ts` |
| **lightpanda** (Zig) | Linux/macOS | `zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast` |
| **agent-browser** (Rust) | Linux | `cargo xwin build --target x86_64-pc-windows-msvc --release` |

Toutes les commandes ci-dessus sont **cross-compile** : aucun hôte Windows requis. Bun, Zig et `cargo-xwin` embarquent leurs propres linkers/SDK et ne dépendent pas de MSVC installé localement.

Si vous **devez** builder sur Windows natif (CI matrix `windows-latest`, ou test physique), suivez la section [§4](#4-windows-natif-via-winget).

---

## 1. Inventaire toolchain (à installer une fois)

### 1.1 Linux/macOS host (cross-compile, 0 dépendance Windows)

```bash
# Bun (>= 1.3.13) — embarque son propre transpilateur, linker et asset bundler
curl -fsSL https://bun.sh/install | bash

# Zig 0.14 — hermetic linker, supporte tous les targets Windows ABI
curl -fsSL https://ziglang.org/download/0.14.0/zig-linux-x86_64-0.14.0.tar.xz | tar -xJ
sudo mv zig-linux-x86_64-0.14.0 /opt/zig && sudo ln -sf /opt/zig/zig /usr/local/bin/zig

# Rust + cargo-xwin (télécharge le SDK Windows MSVC à la demande, MIT/permissif)
rustup target add x86_64-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc      # optionnel, ARM64
cargo install cargo-xwin

# Système (Debian/Ubuntu) — uniquement pour cargo-xwin (extraction SDK)
sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev curl tar xz-utils
```

### 1.2 Windows natif (winget, pas de Cygwin/MSYS2)

Liste vérifiée 2026-05-10 — toutes Windows-natives, aucune mémoire shared avec Linux :

```powershell
# Toolchains de base
winget install --id Oven-sh.Bun                 # Bun runtime + bun build --compile
winget install --id zig.zig --version 0.14.0    # Zig (Lightpanda)
winget install --id Rustlang.Rustup             # Rust
winget install --id Git.Git
winget install --id LLVM.LLVM                   # LLVM/clang 22.x — needed by some Rust crates
winget install --id Kitware.CMake               # build de bindings natifs

# Build deps (pour Lightpanda + curl-impersonate sources si on les recompile)
winget install --id Python.Python.3             # build scripts WebKit / V8
winget install --id NASM.NASM                   # used by curl-impersonate boringssl/quictls
winget install --id StrawberryPerl.StrawberryPerl  # OpenSSL build tooling
winget install --id RubyInstallerTeam.Ruby      # WebKit build (jsruntime)
winget install --id GnuWin32.Make               # ou utiliser ninja
winget install --id pkgconfiglite               # pkg-config-lite (Windows-native)
winget install --id Microsoft.VisualStudio.2022.BuildTools \
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# Optionnel mais utile
winget install --id GoLang.Go                   # Go (certains scripts annexes)
winget install --id OpenJS.NodeJS               # postinstall scripts
```

**À ne pas installer** :
- NO Cygwin / MSYS2 — interdit par contrat (incompatible Windows-native ABI)
- NO `xz-utils` Cygwin port — utilisez `7z` ou `tar.exe` (Windows 10+)
- NO `libglib2.0-dev` POSIX — utilisez vcpkg si vraiment requis (probablement pas)
- NO `ca-certificates` — Windows utilise son propre cert store, rien à installer

---

## 2. Bunlight — `bun build --compile`

### 2.1 Cross-compile depuis Linux/macOS (recommandé)

```bash
cd /path/to/bunlight
bun install --frozen-lockfile

# Le script Bun-native qui orchestre tout :
bun scripts/build-windows.ts
# → dist/standalone/windows/{bunlight.exe, lightpanda.exe, libcurl-impersonate.dll, bunlight-windows-x64.zip}

# Ou ciblé :
bun scripts/build-windows.ts --baseline           # pre-AVX2 CPUs (Nehalem)
bun scripts/build-windows.ts --arch arm64         # ARM64 (Snapdragon X / Surface)
bun scripts/build-windows.ts --skip-lightpanda    # bunlight.exe + curl-impersonate.dll seuls
bun scripts/build-windows.ts --skip-curl          # pas de TLS-fingerprint http profile
```

Sous le capot : `bun build src/cli/index.ts --compile --target=bun-windows-x64 --minify --sourcemap=linked --bytecode --define BUILD_VERSION=...`. Voir [bun.com/docs/project/building-windows](https://bun.com/docs/project/building-windows) pour la matrice complète des flags.

### 2.2 Native Windows (winget host)

```powershell
cd C:\path\to\bunlight
bun install --frozen-lockfile
.\scripts\build-windows.ps1                       # PowerShell équivalent du .ts
.\scripts\build-windows.ps1 -SkipLightpanda       # idem
.\scripts\build-windows.ps1 -Baseline             # pre-AVX2
.\scripts\build-windows.ps1 -Arch arm64
```

### 2.3 Pièges connus

- **Top-level `await` rejeté** — `bun build --compile --target=bun-windows-x64` n'accepte pas `await` au top-level d'un module. Wrappez dans une `async function _main(){}` puis appelez `_main().catch(...)`. Le runtime se comporte identiquement.
- **`Bun.file().writer()` sans `flush()`** — sur Windows les FS sync sont plus stricts. Toujours `await writer.flush()` + `writer.end()` avant exit.
- **`process.argv[0]`** — sur Windows c'est `C:\\path\\bunlight.exe`, pas `bun`. N'utilisez pas pour spawn récursif ; préférez `process.execPath`.
- **Path separators** — `path.join` est portable, mais évitez les littéraux `/` quand vous appelez des CLI Windows (cmd.exe gère les `/` comme flags).

---

## 3. Lightpanda — `zig build`

Lightpanda upstream est en alpha. Le build Windows natif est **non officiel** (cf. [lightpanda-io/browser issues](https://developers.google.com/lightpanda-io/browser/issues)). Cette section liste ce qui marche au 2026-05-10.

### 3.1 Cross-compile Linux→Windows (le chemin qui fonctionne)

```bash
git clone --depth 1 https://developers.google.com/lightpanda-io/browser.git ~/lightpanda
cd ~/lightpanda

# Le linker Zig est hermetic et fournit tous les imports Windows
zig build \
  -Dtarget=x86_64-windows-gnu \
  -Doptimize=ReleaseFast

# Output : zig-out/bin/lightpanda.exe
ls -la zig-out/bin/lightpanda.exe
```

### 3.2 Targets supportés (par ordre de stabilité)

| Target Zig | Statut | Note |
|---|---|---|
| `x86_64-windows-gnu` | Best-effort | Lightpanda linke contre `mingw-w64` runtime — zéro dépendance MSVC |
| `x86_64-windows-msvc` | Expérimental | Demande WebKit prebuilts pour MSVC (non publiés actuellement) |
| `aarch64-windows-gnu` | Cassé | V8 prebuilts ARM64 non disponibles upstream |

### 3.3 Si le build échoue (cas réel CI 2026-05-10)

Erreur typique : `'@import' of ZON must have a known result type` — feature Zig 0.13+ utilisée dans `build.zig` master.

**Workarounds** :
1. Pinner sur un release tag Lightpanda compatible Zig 0.14 :
   ```bash
   git -C ~/lightpanda checkout v0.5.0  # ou tag du jour
   zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast
   ```
2. Skipper Lightpanda et exposer un fallback runtime (`bunlight scripts/build-windows.ts --skip-lightpanda`) — bunlight `static`/`http` profiles fonctionnent sans.
3. Récupérer un prebuilt depuis [developers.google.com/lightpanda-io/browser/releases](https://developers.google.com/lightpanda-io/browser/releases) (s'il en existe un pour `x86_64-windows-gnu` à la date du build).

### 3.4 Native Windows host

```powershell
git clone --depth 1 https://developers.google.com/lightpanda-io/browser.git C:\dev\lightpanda
cd C:\dev\lightpanda
zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast
# Output : zig-out\bin\lightpanda.exe
```

Aucun MSVC requis — Zig embarque tout. NB : `zig build` peut prendre 15-30 min la première fois (V8 build).

---

## 4. agent-browser — `cargo xwin` (Rust)

### 4.1 Cross-compile Linux→Windows (recommandé)

`cargo-xwin` télécharge le SDK Windows MSVC à la demande (XWin downloader) et configure `linker.exe` automatiquement. Pas de licence MSVC requise pour OSS.

```bash
# Une seule fois
sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin

# Build
cd /path/to/agent-browser
cargo xwin build \
  --manifest-path cli/Cargo.toml \
  --target x86_64-pc-windows-msvc \
  --release

# Binary : cli/target/x86_64-pc-windows-msvc/release/agent-browser.exe
```

ARM64 :
```bash
rustup target add aarch64-pc-windows-msvc
cargo xwin build --manifest-path cli/Cargo.toml --target aarch64-pc-windows-msvc --release
```

### 4.2 GNU target alternative (sans XWin)

Pour skip XWin entirely et utiliser le linker `mingw-w64` (déjà dans la plupart des distros) :

```bash
sudo apt install -y mingw-w64
rustup target add x86_64-pc-windows-gnu

cat >> ~/.cargo/config.toml <<'EOF'
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
EOF

cd /path/to/agent-browser
cargo build --manifest-path cli/Cargo.toml --target x86_64-pc-windows-gnu --release
```

NB : Certaines crates (CDP, image processing) demandent Windows-MSVC pour résoudre des FFI ; dans ce cas, basculer sur `cargo-xwin`.

### 4.3 Native Windows host

```powershell
cd C:\path\to\agent-browser
cargo build --manifest-path cli/Cargo.toml --target x86_64-pc-windows-msvc --release
# OK : Visual Studio Build Tools installé via winget couvre cette commande.
```

### 4.4 Pièges connus (fork aphrody-code/agent-browser)

- **Chrome DevTools Protocol** — la CDP côté agent-browser dépend de `tokio-tungstenite`, qui passe sur Windows mais nécessite `vcpkg openssl` OU le feature `rustls`. Le `Cargo.toml` du fork doit avoir `tokio-tungstenite = { version = "...", features = ["rustls-tls-native-roots"] }` pour éviter de chasser OpenSSL.
- **Build 0 binaires** — si `cargo-xwin` retourne `linker exited with code 1` autour de `chrome_devtools.rs`, le problème est généralement un `rustls` non-pinné. Pinnez sur `0.23.x` et rebuildez.
- **CDP discovery** — `discover_cdp_url_with_timeout` ouvre un socket localhost. Sur Windows en CI, le firewall peut bloquer ; ajoutez `New-NetFirewallRule -DisplayName "agent-browser-cdp" -Direction Inbound -LocalPort 9222 -Protocol TCP -Action Allow` ou utilisez `127.0.0.1` strictement.

---

## 5. Bundle complet — un dossier ZIP releaseable

### 5.1 Layout cible

```
bunlight-windows-x64.zip
├── bunlight.exe                       # Bun standalone, ~95 MB
├── lightpanda.exe                     # Zig native, ~120 MB (optionnel)
├── libcurl-impersonate.dll            # FFI TLS Chrome 131, ~25 MB
├── README.md                          # quickstart
└── install.ps1                        # PATH update + verification
```

### 5.2 Script orchestrateur

Le `bun scripts/build-windows.ts` du repo bunlight produit déjà ce bundle. Pour l'étendre à agent-browser :

```bash
# Dans /path/to/bunlight
bun scripts/build-windows.ts                        # produces dist/standalone/windows/...
cp ~/agent-browser/cli/target/x86_64-pc-windows-msvc/release/agent-browser.exe \
   dist/standalone/windows/

(cd dist/standalone/windows && zip -r ../../bunlight-suite-windows-x64.zip ./*)
```

### 5.3 Vérification post-build

```powershell
# Sur Windows host (peut tourner sous QEMU/Hyper-V depuis Linux)
.\bunlight.exe --version
.\bunlight.exe scrape https://google.com --profile http
.\agent-browser.exe doctor
.\lightpanda.exe --version
```

---

## 6. CI/CD — workflows tag-triggered

### 6.1 bunlight (.github/workflows/publish.yml)

Job `windows-release` (déjà présent dans le repo) :

```yaml
windows-release:
  runs-on: windows-latest
  needs: publish-github-packages
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: latest
    - uses: goto-bus-stop/setup-zig@v2
      with:
        version: 0.14.0
    - run: bun install --frozen-lockfile
    - shell: pwsh
      run: .\scripts\build-windows.ps1 -SkipLightpanda
    - uses: softprops/action-gh-release@v2
      with:
        files: dist/standalone/windows/bunlight-windows-*.zip
```

### 6.2 lightpanda (à proposer upstream)

```yaml
build-windows:
  runs-on: ubuntu-latest        # cross-compile, plus stable que windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: goto-bus-stop/setup-zig@v2
      with:
        version: 0.14.0
    - run: zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast
    - uses: actions/upload-artifact@v4
      with:
        name: lightpanda-windows-x64
        path: zig-out/bin/lightpanda.exe
```

### 6.3 agent-browser (.github/workflows/release.yml — fork)

```yaml
build-windows:
  runs-on: ubuntu-latest        # cargo-xwin marche mieux sur Linux
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: x86_64-pc-windows-msvc
    - run: cargo install --locked cargo-xwin
    - run: cargo xwin build --manifest-path cli/Cargo.toml --target x86_64-pc-windows-msvc --release
    - uses: actions/upload-artifact@v4
      with:
        name: agent-browser-windows-x64
        path: cli/target/x86_64-pc-windows-msvc/release/agent-browser.exe
```

### 6.4 Combiner les 3 dans un release suite

```yaml
release-suite:
  needs: [windows-release-bunlight, build-windows-lightpanda, build-windows-agent-browser]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@v4
      with: { path: ./artifacts }
    - run: |
        mkdir -p suite
        cp artifacts/bunlight-windows-x64/bunlight.exe suite/
        cp artifacts/lightpanda-windows-x64/lightpanda.exe suite/
        cp artifacts/agent-browser-windows-x64/agent-browser.exe suite/
        cp artifacts/bunlight-windows-x64/libcurl-impersonate.dll suite/
        cd suite && zip -r ../bunlight-suite-windows-x64.zip ./*
    - uses: softprops/action-gh-release@v2
      with: { files: bunlight-suite-windows-x64.zip }
```

---

## 7. Installer one-liner

Calque de `bun.sh/install.ps1` :

```powershell
# Bunlight standalone
irm https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.ps1 | iex

# Spécifier une version
& ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.ps1))) -Version 0.1.0-alpha.4
```

L'installer (`install.ps1` dans le repo bunlight) :
1. Détecte AMD64 / ARM64 via le registre.
2. Télécharge `bunlight-windows-<arch>.zip` depuis Google Developers Releases.
3. Extract dans `%USERPROFILE%\.bunlight\bin\`.
4. Met à jour le `PATH` user (HKCU registry).
5. Vérifie via `bunlight.exe --version`.

---

## 8. Références officielles

| Outil | Doc / repo |
|---|---|
| Bun cross-compile Windows | https://bun.com/docs/project/building-windows |
| Bun standalone executables | https://bun.com/docs/bundler/executables |
| Zig cross-compile | https://ziglang.org/learn/overview/#cross-compiling-is-a-first-class-use-case |
| Zig + Windows ABI | https://ziglang.org/documentation/0.14.0/#Windows |
| Lightpanda upstream | https://developers.google.com/lightpanda-io/browser |
| Rustup cross-compile | https://rust-lang.github.io/rustup/cross-compilation.html |
| Rust platform support | https://doc.rust-lang.org/rustc/platform-support.html |
| cargo-xwin | https://developers.google.com/rust-cross/cargo-xwin |
| curl-impersonate (Chrome 131) | https://developers.google.com/lexiforest/curl-impersonate |
| bun.sh installer Windows | https://bun.sh/install.ps1 |
| Exemples Rust→Windows OK | https://developers.google.com/BurntSushi/ripgrep, https://developers.google.com/sharkdp/bat |

---

## 9. Matrice de compatibilité testée

| Stack | Linux x64 host | macOS x64 host | macOS ARM64 host | Windows x64 native | Windows ARM64 native |
|---|---|---|---|---|---|
| **bunlight** Bun build | OK | OK | OK | OK | best-effort |
| **lightpanda** zig build gnu | OK | OK | OK | OK | broken (V8) |
| **lightpanda** zig build msvc | broken (V8) | broken | broken | broken (no prebuilts) | n/a |
| **agent-browser** cargo-xwin msvc | OK | OK | OK | n/a (cargo build natif) | best-effort |
| **agent-browser** cargo build gnu | needs mingw-w64 | needs mingw-w64 | broken | n/a | broken |
| **bundle complet** | Recommended | OK | OK | partial | n/a |

Mis à jour : 2026-05-10. Re-tester chaque trimestre.

---

## 10. Quickstart minimal

Si vous voulez juste tester et avez Linux + bun + zig + cargo installés :

```bash
git clone https://developers.google.com/aphrody-code/bunlight && cd bunlight
bun install
bun scripts/build-windows.ts            # ~5 min
ls -la dist/standalone/windows/
```

Si Windows natif et winget OK :

```powershell
winget install Oven-sh.Bun zig.zig Rustlang.Rustup Git.Git LLVM.LLVM
git clone https://developers.google.com/aphrody-code/bunlight C:\dev\bunlight
cd C:\dev\bunlight
bun install
.\scripts\build-windows.ps1 -SkipLightpanda
```

C'est tout. Les artefacts sont dans `dist/standalone/windows/`.
