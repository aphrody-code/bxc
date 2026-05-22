<!-- SPDX-License-Identifier: Apache-2.0 -->
# bxc — configuration & hardware tuning

bxc se configure par variables d'environnement (et options CLI). Sans config,
il détecte le matériel et applique des défauts agressifs ; tout est
surchargeable pour rester portable VPS/CI.

## SPA-crash fallback → ton vrai Chrome + profil

Quand le moteur léger (`static`/`http`) n'arrive pas à rendre une SPA (crash
moteur ou résultat vide), `bxc scrape` **rebascule automatiquement sur ton
Chrome installé**, avec un profil connecté (sessions/cookies réels + JS complet).

```bash
# défaut : fallback activé, profil "Profile 5"
bxc scrape https://app.spa.example "div.result"

# choisir le profil Chrome de fallback
bxc scrape <url> <sel> --chrome-profile "Profile 5"

# forcer directement le vrai Chrome
bxc scrape <url> <sel> --profile max

# désactiver le fallback
bxc scrape <url> <sel> --no-fallback
```

Résolution du profil : `--chrome-profile` → `$BXC_CHROME_PROFILE` → `"Profile 5"`.

> **Gotcha** : lancer le vrai Chrome contre ton `User Data` échoue si une
> instance Chrome **tourne déjà** sur ce profil (le nouveau process ouvre juste
> un onglet et sort sans ouvrir le port debug). bxc le détecte et te le dit.
> Solutions : fermer ce Chrome, ou attacher une instance déjà lancée en remote
> debug via `BXC_BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/...`.

## Variables d'environnement

| Variable | Rôle | Défaut |
|----------|------|--------|
| `BXC_CHROME_BIN` / `CHROME_PATH` | binaire Chrome | auto-détection (Program Files / LOCALAPPDATA) |
| `BXC_USER_DATA_DIR` | racine du profil Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data` (Windows) |
| `BXC_CHROME_PROFILE` | `--profile-directory` | `Default` (transport) / `Profile 5` (fallback scrape) |
| `BXC_BROWSER_WS_ENDPOINT` | attacher un Chrome déjà lancé (au lieu de spawn) | — |
| `BXC_GPU` | `on`/`off` accélération GPU | `on` desktop, `off` Linux headless |
| `BXC_ANGLE_BACKEND` | backend ANGLE Windows | `d3d11` (NVIDIA) |
| `BXC_V8_HEAP_MB` | `--max-old-space-size` (Mo) | ~50 % RAM, plafonné 4096 |
| `BXC_CONCURRENCY` | concurrence par défaut du pool | nb de cœurs |

## Tuning matériel automatique

`src/config/hardware.ts` détecte cœurs / RAM / OS / GPU et en dérive :

- **Flags GPU Chrome** (`chromeGpuFlags`) : sur Windows + NVIDIA →
  `--enable-gpu --ignore-gpu-blocklist --enable-gpu-rasterization
  --enable-zero-copy --enable-features=CanvasOopRasterization
  --use-angle=d3d11`. Sur Linux headless → `--disable-gpu`.
- **Heap V8** (`chromeJsFlags`) : `--js-flags=--max-old-space-size=<~50% RAM>`
  (16 Go → **4096 Mo**), passé à Chrome au lancement.
- **Concurrence** (`defaultConcurrency`) : l'`AutoscaledPool` démarre à la
  valeur = nb de cœurs (8) au lieu de 1, puis autoscale selon charge/RSS.

Exemple sur la machine de référence (Windows 11, i7 8c, 16 Go, NVIDIA) :

```
bxc hardware: 8 cores, 15.8 GB RAM, win32, GPU on (angle=d3d11);
              V8 heap 4096 MB, concurrency 8
```

VPS/CI headless : `BXC_GPU=off BXC_V8_HEAP_MB=1024 BXC_CONCURRENCY=4`.
