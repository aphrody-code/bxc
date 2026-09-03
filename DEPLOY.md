# Bxc — deployment guide (VPS & agents)

Canonical deploy path for **bxc** on a Linux VPS (Ubuntu 26.04). Pair with [`../aphrody/DEPLOY.md`](../aphrody/DEPLOY.md) for the shared agent stack (MCP, Grok, Claude).

**Snapshot:** 2026-06-03 · repo `aphrody-code/bxc`

---

## What gets deployed

| Artifact | Build | Install paths | Runtime |
| --- | --- | --- | --- |
| **bxc** CLI | `bun run build:linux` → `dist/standalone/bxc-linux-x64` | `~/.local/bin/bxc`, `/usr/local/bin/bxc` | `bxc.service` (CDP `:9222`) |
| **bxc-mcp** | `bun run build:mcp` → `dist/standalone/bxc-mcp` | `~/.local/bin/bxc-mcp`, `/usr/local/bin/bxc-mcp` | MCP stdio (Claude / Grok / aphrody `mcp.json`) |
| **Dev CLI** | `bin/bxc` (Bun wrapper) | Symlink `~/.local/bin/bxc` → `~/bxc/bin/bxc` | Ad-hoc / CI |

**Do not** copy a stale wrapper into `~/.local/bin` without symlinking to `~/bxc/bin/bxc` — agents expect the repo wrapper to pick up workspace changes.

---

## Installation en une commande

Le VPS se déploie depuis les sources (`bxc-control.sh`, plus bas). Pour une
machine qui n'a pas le dépôt — poste de travail, second serveur, CI — une seule
commande suffit :

```bash
# Linux / macOS — pose ~/.local/bin/bxc + ~/.config/bxc/config.json, puis vérifie
curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash

# Épingler une version / choisir la destination
BXC_VERSION=v0.8.0 BXC_INSTALL_DIR=/usr/local/bin \
  curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash
```

```powershell
# Windows 11 — pose %USERPROFILE%\.bxc\bin\bxc.exe + %APPDATA%\bxc\config.json
irm https://raw.githubusercontent.com/aphrody-code/bxc/main/install.ps1 | iex
```

Mise à jour, sur les deux plateformes :

```bash
bxc self-update --check   # compare seulement, n'écrit rien
bxc self-update           # remplace le binaire de la cible courante
```

`self-update` interroge la dernière release `aphrody-code/bxc`, choisit l'asset
correspondant à `process.platform`/`process.arch` (binaire nu d'abord, archive
en repli) et remplace le fichier par `rename` atomique.

> **Sur le VPS, préférer `bxc-control.sh deploy`** : `self-update` ne touche
> qu'un binaire, il ne rafraîchit ni `bxc-mcp`, ni les unités systemd, ni
> `/usr/local/bin`. Utiliser `self-update` sur le VPS remplacerait
> `~/.local/bin/bxc` sans que `bxc.service` (qui pointe sur `/usr/local/bin`)
> ne bouge — les deux copies divergeraient silencieusement.

**Portabilité Windows** : la station de travail obtient la CLI et le serveur
MCP. Les daemons (`bxc.service`, `bxc-crawler`, purges X, wonderbot) restent
Linux — ils reposent sur systemd et sur `SIGTERM`. Détail des écarts et de ce
qui reste à valider : [`CROSS-PLATFORM.md`](CROSS-PLATFORM.md).

---

## Prerequisites

```bash
# Bun >= 1.3.14
command -v bun && bun --version

# Optional: Rust for x-cli / rust-bridge
source ~/.cargo/env 2>/dev/null || true
```

Redis (`127.0.0.1:6379`) and SQLite under `~/bxc/data/` are used when MCP env vars point there (via aphrody `mcp.json`).

---

## One-shot deploy (recommended on VPS)

```bash
cd ~/bxc
bun install
./scripts/bxc-control.sh build    # build:linux + build:mcp
./scripts/bxc-control.sh deploy   # install bins + systemd + logs
./scripts/bxc-control.sh status
```

`deploy` will:

1. `systemctl stop` `bxc` + `bxc-crawler`
2. Kill stray `bxc` / `bxc-mcp` / `crawl-worker` processes
3. Copy `dist/standalone/bxc-linux-x64` → `/usr/local/bin/bxc` and `~/.local/bin/bxc`
4. Copy `dist/standalone/bxc-mcp` → `/usr/local/bin/bxc-mcp` and `~/.local/bin/bxc-mcp`
5. Refresh `/etc/systemd/system/bxc-crawler.service` from `scripts/deploy/`
6. `daemon-reload`, start **bxc** + enable **bxc-crawler**

Unit files (source of truth):

- [`scripts/deploy/bxc.service`](scripts/deploy/bxc.service) — `bxc serve --cdp-port 9222 --auto-profile`
- [`scripts/deploy/bxc-crawler.service`](scripts/deploy/bxc-crawler.service) — `bxc crawl-worker --profile fast`

Install units once (if missing):

```bash
sudo cp ~/bxc/scripts/deploy/bxc.service /etc/systemd/system/
sudo cp ~/bxc/scripts/deploy/bxc-crawler.service /etc/systemd/system/
sudo mkdir -p /var/log/bxc && sudo chown ubuntu:ubuntu /var/log/bxc
sudo systemctl daemon-reload
sudo systemctl enable --now bxc.service bxc-crawler.service
```

---

## Agent-only deploy (no systemd)

For MCP/CLI without 24/7 crawler:

```bash
cd ~/bxc
bun install
bun run build:mcp
install -m 755 dist/standalone/bxc-mcp ~/.local/bin/bxc-mcp
ln -sf ~/bxc/bin/bxc ~/.local/bin/bxc
bxc --version
bxc-mcp --help 2>&1 | head -3
```

Sync MCP config with aphrody:

```bash
bash ~/aphrody/scripts/vps-sync-agent-stack.sh
```

---

## Unified stack (bxc + aphrody)

```bash
bash ~/aphrody/scripts/vps-deploy-bxc-aphrody.sh
```

Builds bxc MCP, aphrody Rust CLI/MCP, runs `vps-sync-agent-stack.sh`, optional yoyo hub. Does **not** replace `bxc-control.sh deploy` for systemd — run both when you need daemons + Rust CLI.

---

## systemd operations

| Action | Command |
| --- | --- |
| Status | `systemctl status bxc bxc-crawler` |
| Stop (free RAM) | `sudo systemctl stop bxc bxc-crawler` |
| Disable boot | `sudo systemctl disable bxc bxc-crawler` |
| Logs | `tail -f /var/log/bxc/api.log /var/log/bxc/crawler.log` |
| Restart after deploy | `sudo systemctl restart bxc` |

---

## Purges autonomes X (optionnel)

Deux purges indépendantes, même architecture :

| Unité | Rôle |
| --- | --- |
| `bxc-x-unfollow.service` | vide la liste d'abonnements, non-mutuels d'abord |
| `bxc-x-purge-tweets.service` | supprime tweets/réponses/médias sous le seuil de likes, moins likés d'abord |
| `bxc-x-purge-doctor.timer` | surveille et répare **les deux**, toutes les 10 min |

Chaque daemon dort lui-même à travers les fenêtres de 15 min et le plafond de
24 h — `--per-window 8` étale les 400/jour sur ~12 h au lieu d'une rafale de
2 h 30. Files et budgets glissants vivent dans
`~/.aphrody/x-unfollow-<handle>.json` et `~/.aphrody/x-purge-tweets-<handle>.json`,
donc un redémarrage ne rejoue rien et ne peut pas provoquer de rafale.

**Auto-retry.** `Restart=on-failure` + `RestartSec=120`, sans plafond de
redémarrages (`StartLimitIntervalSec=0`) : kill, OOM, coupure réseau, série de
5xx — ça repart. Deux exceptions volontaires : `SuccessExitStatus=130` (arrêt
propre sur SIGTERM, journal à jour) et `RestartPreventExitStatus=77`
(credentials rejetés — relancer ne répare rien, et marteler X avec un cookie
mort est le meilleur moyen de faire flaguer le compte).

**Auto-fix.** `bxc-x-purge-doctor` (`scripts/x-purge-doctor.sh`) tourne en root
toutes les 10 min. Il teste la session **une fois** puis applique à chaque
purge installée (une unité absente est ignorée, pas signalée) :

| Constat | Réparation |
| --- | --- |
| binaire absent ou périmé | alerte (rebuild manuel requis) |
| session X rejetée | resync depuis `~/.bxc/cookies/xcom.json`, sinon arrêt des daemons + alerte |
| journal illisible | replanification (`--refresh`) |
| file vide | arrêt + `disable` du daemon |
| unité en `failed` | `reset-failed` puis `start` |
| daemon arrêté, file non vide | `start` |
| aucune progression depuis 25 h | `restart` |

```bash
# 1. Vérifier les plans (lecture seule, aucune mutation)
bxc x unfollow
bxc x purge-tweets --max-likes 1000

# 2. Installer
sudo install -m755 ~/bxc/scripts/x-purge-doctor.sh /usr/local/bin/bxc-x-purge-doctor
sudo install -m644 ~/bxc/scripts/deploy/bxc-x-unfollow.service     /etc/systemd/system/
sudo install -m644 ~/bxc/scripts/deploy/bxc-x-purge-tweets.service /etc/systemd/system/
sudo install -m644 ~/bxc/scripts/deploy/bxc-x-purge-doctor.service /etc/systemd/system/
sudo install -m644 ~/bxc/scripts/deploy/bxc-x-purge-doctor.timer   /etc/systemd/system/
sudo install -d -m 0700 -o ubuntu -g ubuntu /var/log/bxc   # les journaux nomment le compte et le contenu supprime
sudo systemctl daemon-reload

# 3. Activer ce dont tu as besoin (les deux sont independantes)
sudo systemctl enable --now bxc-x-unfollow.service
sudo systemctl enable --now bxc-x-purge-tweets.service
sudo systemctl enable --now bxc-x-purge-doctor.timer

# 4. Suivre
systemctl status bxc-x-unfollow.service bxc-x-purge-tweets.service
tail -f /var/log/bxc/x-unfollow.log /var/log/bxc/x-purge-tweets.log
tail -f /var/log/bxc/x-purge-doctor.log
jq '.queue | length' ~/.aphrody/x-*.json

# Diagnostic sans rien changer
sudo /usr/local/bin/bxc-x-purge-doctor --dry-run
sudo /usr/local/bin/bxc-x-purge-doctor --dry-run --only tweets
```

Arrêt : `sudo systemctl disable --now bxc-x-purge-doctor.timer <unite>`
(désactiver le doctor aussi, sinon il relance le daemon au tick suivant). Les
files sont conservées — réactiver reprend exactement où ça s'était arrêté.

---

## Clean rebuild

```bash
cd ~/bxc
sudo systemctl stop bxc bxc-crawler 2>/dev/null || true
killall -TERM bxc bxc-mcp 2>/dev/null || true
bun run clean          # removes node_modules, dist, .turbo, logs
bun install
./scripts/bxc-control.sh build
./scripts/bxc-control.sh deploy
```

---

## Health checks

```bash
bxc --version
curl -sS http://127.0.0.1:9222/json/version 2>/dev/null | head -c 200 || echo "CDP not up (start bxc.service)"
command -v bxc-mcp && echo "bxc-mcp ok"
```

MCP smoke: see GEMINI.md `/test-mcp` or Claude plugin checklist.

---

## Ports & conflicts

| Port | Service |
| --- | --- |
| **9222** | bxc CDP (`bxc serve`) |
| **8790** | yoyo hub (optional, aphrody script) |
| **8082** | Python `aphrody serve` (`/opt/aphrody`) — **not** Rust CLI |

---

## See also

- [`README.md`](README.md) — CLI reference
- [`CLAUDE.md`](CLAUDE.md) — Claude Code specifics
- [`GEMINI.md`](GEMINI.md) — Gemini / autonomy
- [`~/aphrody/docs/agent-stack/README.md`](../aphrody/docs/agent-stack/README.md) — shared MCP matrix
- [`~/awesome-grok-build/docs/VPS_AI_UNIFY.md`](../awesome-grok-build/docs/VPS_AI_UNIFY.md) — Grok + global VPS memory