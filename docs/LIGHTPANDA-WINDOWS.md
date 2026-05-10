# Lightpanda Windows build — notes terrain

> Status au 2026-05-10. Lightpanda upstream est en alpha, le support Windows est non officiel.
> Ce document est complémentaire à [`BUILD-WINDOWS.md`](./BUILD-WINDOWS.md) §3.

---

## 1. Pourquoi Lightpanda Windows est compliqué

Lightpanda combine :
- **Zig** pour le runtime, le DOM, le network stack.
- **WebKit jsruntime** (V8 fork) pour l'exécution JavaScript.
- **libxml2** + **libcurl** pour le parsing HTML / fetch.

Sur Linux et macOS, le upstream publie des prebuilts WebKit/V8 hermétiques. Sur Windows, ces prebuilts n'existent pas (au 2026-05-10) ni pour `gnu` ni pour `msvc`. Le fallback est :

1. Cross-compile depuis Linux avec `zig build -Dtarget=x86_64-windows-gnu` — **fonctionne pour le runtime Zig pur**, mais V8 manque.
2. Build natif Windows MSVC avec `zig build -Dtarget=native` — demande WebKit prebuilts MSVC (absents).
3. Skip Lightpanda et exposer un Bunlight `static`/`http` only (degraded mode) — option choisie en CI bunlight.

---

## 2. Cross-compile depuis Linux (mode minimal)

Marche pour le runtime de base, échoue actuellement sur les liaisons V8 :

```bash
git clone --depth 1 https://github.com/lightpanda-io/browser.git /tmp/lightpanda
cd /tmp/lightpanda

zig build \
  -Dtarget=x86_64-windows-gnu \
  -Doptimize=ReleaseFast \
  -Dno-v8                                # FLAG HYPOTHÉTIQUE — voir §4

# Si OK : zig-out/bin/lightpanda.exe
```

Le flag `-Dno-v8` n'existe pas actuellement upstream. À soumettre comme issue/PR si on veut un mode degraded.

---

## 3. Native Windows (winget + Zig)

Sur un Windows 11 récent avec winget :

```powershell
winget install zig.zig --version 0.14.0
winget install Git.Git
winget install Microsoft.VisualStudio.2022.BuildTools `
   --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

git clone --depth 1 https://github.com/lightpanda-io/browser.git C:\dev\lightpanda
cd C:\dev\lightpanda
zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast
```

Aucun MSYS2/Cygwin requis. Zig fournit son propre linker hermetic.

NB : Le premier `zig build` peut prendre 30-60 min (compilation V8 from scratch si prebuilts absents).

---

## 4. Erreurs typiques et remédiations

### 4.1 `'@import' of ZON must have a known result type`

Zig 0.13 a introduit ZON imports. Master Lightpanda utilise potentiellement des features Zig 0.14+. Si vous êtes sur Zig 0.14 :

```bash
# Option A : pinner sur un Lightpanda release tag testé
git -C /tmp/lightpanda checkout v0.5.0

# Option B : upgrader Zig si la cible exige nightly
curl -fsSL https://ziglang.org/builds/zig-linux-x86_64-master.tar.xz | tar -xJ
sudo mv zig-linux-x86_64-master /opt/zig-master
PATH=/opt/zig-master:$PATH zig build -Dtarget=x86_64-windows-gnu
```

### 4.2 `error: unable to find dynamic system library 'WebKitJSRuntime'`

V8 prebuilt manquant. Trois options :

1. **Skip Lightpanda** côté bunlight : `bun scripts/build-windows.ts --skip-lightpanda` — bunlight `static`/`http` profiles fonctionnent sans, `fast`/`stealth`/`max` warnent au runtime.
2. **Build V8 from source** : voir [v8.dev/docs/build-from-source](https://v8.dev/docs/build-gn) — long (4-8h CPU intensives), pas recommandé pour CI.
3. **Attendre upstream** : Lightpanda team produit des prebuilts Windows. Suivre [github.com/lightpanda-io/browser/issues](https://github.com/lightpanda-io/browser/issues).

### 4.3 `LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'`

Toolchain Windows-MSVC pas correctement détectée par Zig. Workarounds :

```powershell
# Forcer le SDK path
$env:WindowsSdkDir = "C:\Program Files (x86)\Windows Kits\10"
$env:VCToolsInstallDir = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.40.33807"

zig build -Dtarget=x86_64-windows-msvc
```

Préférer `windows-gnu` qui n'a pas cette dépendance MSVC.

### 4.4 Binary fonctionne sur Windows 11 mais pas Windows 10

Lightpanda demande **Win 10 build 17763 (1809) minimum**, comme Bun. Vérifier `winver` côté target.

---

## 5. Test post-build

```powershell
.\lightpanda.exe --version
.\lightpanda.exe serve --port 9222
# Dans une autre console
curl http://127.0.0.1:9222/json/version
# Attendu: { "Browser": "Lightpanda/0.x.y", ... }
```

Bunlight CLI peut s'attacher à ce process :

```powershell
bunlight serve --cdp-port 9223 --profile fast --lightpanda-path .\lightpanda.exe
bunlight scrape https://example.com --profile fast
```

---

## 6. Roadmap upstream à surveiller

| Issue / PR | Status | Note |
|---|---|---|
| Lightpanda `aarch64-windows` | non démarré | demande V8 ARM64 prebuilts |
| Lightpanda `windows-msvc` | exploratoire | dépend du build WebKit MSVC |
| `-Dno-v8` flag (skip JS engine) | à proposer | utile pour bunlight `static` profile |
| Static linking V8 sur Windows | en cours upstream | dépend de webkit2gtk-windows team |

---

## 7. Approche pragmatique pour le release suite bunlight

Tant que Lightpanda Windows n'est pas stable upstream, le release bunlight pour Windows expose :

- `bunlight.exe` : tous les CLI subcommands sauf ceux qui demandent un browser engine.
- `libcurl-impersonate.dll` : profile `http` (Chrome 131 TLS fingerprint, anti-bot ready).
- **Pas de `lightpanda.exe`** dans le bundle Windows par défaut.
- Documentation explicite : "Profile `fast`/`stealth`/`max` requires Linux/macOS host. Windows users get `static` and `http` profiles."

Quand Lightpanda upstream publiera un prebuilt Windows, mettre à jour le bundle via `--lightpanda-ref <release-tag>`.

---

## 8. Fork-et-patch local (last resort)

Si vraiment besoin d'un Lightpanda Windows à court terme :

```bash
git clone https://github.com/lightpanda-io/browser.git ~/lightpanda-fork
cd ~/lightpanda-fork
git checkout -b windows-prebuilt-stub

# Stubber les sections V8/WebKit pour rendre le build linkable
# (voir patches/ dans le bunlight repo si on les commit un jour)

zig build -Dtarget=x86_64-windows-gnu -Doptimize=Debug
```

Le binaire produit aura les profiles JS-less seulement, mais est utile pour test CI.

---

## 9. Références

- [Lightpanda upstream](https://github.com/lightpanda-io/browser)
- [Zig cross-compile guide](https://ziglang.org/learn/overview/#cross-compiling-is-a-first-class-use-case)
- [Zig Windows ABI](https://ziglang.org/documentation/0.14.0/#Windows)
- [V8 build from source](https://v8.dev/docs/build-gn)
- [webkit-jsruntime (Lightpanda fork)](https://github.com/lightpanda-io/jsruntime)
