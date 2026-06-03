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