#!/usr/bin/env bash
#
# Copyright 2026 aphrody-code
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# bxc-control.sh — Unified manager script for bxc FFI, standalone builds,
# systemd services, MCP deploy, and SSH tunnel automation on the VPS.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly REPO_ROOT

usage() {
  cat <<EOF
Bxc control toolbelt.

Usage: ${0##*/} <command> [options]

Commands:
  build             Rebuild Rust cdylib and Bun standalone binaries
  backup            Perform local monorepo backup (zstd + gitbundle)
  deploy            Deploy the updated standalone binaries and restart systemd service
  status            Check systemd service status and active bxc processes
  logs              Tail bxc service api / error logs
  tunnel            Manage SSH tunnel (start | stop | status)
  help              Show this help menu

EOF
}

log() {
  printf '[bxc-control] %s\n' "$*"
}

error() {
  printf '[error] %s\n' "$*" >&2
}

build_all() {
  log "Building native Rust FFI cdylib and Standalone Linux/Windows binaries..."
  cd "${REPO_ROOT}"
  bun run build:linux
  bun run build:mcp
}

backup_all() {
  log "Initiating full repository backup..."
  bash "${REPO_ROOT}/scripts/backup-bxc.sh"
}

deploy_all() {
  log "Deploying bxc Standalone and MCP server..."
  
  # 1. Stop service
  log "Stopping systemd services..."
  sudo systemctl stop bxc || true
  sudo systemctl stop bxc-crawler || true
  sudo systemctl stop bxc-scheduler || true

  # 2. Kill residual bxc processes
  log "Stopping running bxc and bxc-mcp processes..."
  pkill -9 -f "bxc api" || true
  pkill -9 -f "bxc-mcp" || true
  pkill -9 -f "crawl-worker" || true

  # 3. Copy binaries (bxc to both bin dirs; bxc-mcp to both for CLI + MCP clients)
  #
  # Sur ce VPS la prod EST le checkout : /usr/local/bin/bxc est un wrapper bash
  # qui exec `bun src/cli/index.ts`, et ~/.local/bin/bxc un symlink vers
  # bin/bxc du depot. Ecraser ces cibles par le standalone de 291 Mo casse le
  # modele documente dans DEPLOY.md — le checkout ne serait plus ce qui tourne,
  # et l'auto-update horaire mettrait a jour du code que plus rien n'execute.
  # On ne remplace donc une cible que si c'est deja un binaire, ou si
  # BXC_DEPLOY_BINARY=1 le demande explicitement.
  install_bxc_cli() { # $1=chemin cible  $2=prefixe sudo ("" ou "sudo")
    local target="$1" sudo_cmd="${2:-}"
    if [ "${BXC_DEPLOY_BINARY:-0}" != "1" ] && { [ -L "$target" ] || head -c2 "$target" 2>/dev/null | grep -q '#!'; }; then
      log "  · $target est un wrapper/symlink vers le checkout — conserve (BXC_DEPLOY_BINARY=1 pour forcer le binaire)"
      return
    fi
    log "Installing standalone bxc binary to ${target}..."
    # --remove-destination : `cp` suit les liens symboliques, sans quoi on
    # ecraserait la cible du lien (bin/bxc du depot) au lieu du lien lui-meme.
    ${sudo_cmd} cp --remove-destination "${REPO_ROOT}/dist/standalone/bxc-linux-x64" "$target"
    ${sudo_cmd} chmod +x "$target"
  }
  install_bxc_cli "/home/ubuntu/.local/bin/bxc"
  install_bxc_cli "/usr/local/bin/bxc" sudo

  log "Installing standalone bxc-mcp binary to /usr/local/bin/bxc-mcp..."
  sudo cp --remove-destination "${REPO_ROOT}/dist/standalone/bxc-mcp" "/usr/local/bin/bxc-mcp"
  sudo chmod +x "/usr/local/bin/bxc-mcp"

  log "Installing standalone bxc-mcp binary to /home/ubuntu/.local/bin/bxc-mcp (Claude/Gemini MCP target)..."
  cp --remove-destination "${REPO_ROOT}/dist/standalone/bxc-mcp" "/home/ubuntu/.local/bin/bxc-mcp"
  chmod +x "/home/ubuntu/.local/bin/bxc-mcp"

  # 4. Install / refresh systemd unit files from the repo
  log "Installing systemd unit files..."
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc.service" "/etc/systemd/system/bxc.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-crawler.service" "/etc/systemd/system/bxc-crawler.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-auto-update.service" "/etc/systemd/system/bxc-auto-update.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-auto-update.timer" "/etc/systemd/system/bxc-auto-update.timer"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-scheduler.service" "/etc/systemd/system/bxc-scheduler.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-watchdog.service" "/etc/systemd/system/bxc-watchdog.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-watchdog.timer" "/etc/systemd/system/bxc-watchdog.timer"

  # 5. Correct log ownerships
  log "Aligning log permissions..."
  sudo mkdir -p /var/log/bxc
  sudo chown -R ubuntu:ubuntu /var/log/bxc

  # 6. Reload systemd config
  log "Reloading systemd daemon..."
  sudo systemctl daemon-reload

  # 7. Start services (API + 24/7 crawler worker)
  log "Starting systemd services..."
  sudo systemctl start bxc
  sudo systemctl enable --now bxc-crawler || sudo systemctl restart bxc-crawler
  sudo systemctl enable --now bxc-scheduler || sudo systemctl restart bxc-scheduler
  # Le timer, pas le service : bxc-auto-update.service et bxc-watchdog.service
  # sont des oneshot declenches. `enable` sur le service seul le lancerait au
  # boot et plus jamais.
  sudo systemctl enable --now bxc-auto-update.timer
  sudo systemctl enable --now bxc-watchdog.timer

  # 8. Print status
  systemctl status bxc --no-pager || true
  systemctl status bxc-crawler --no-pager || true
}

check_status() {
  log "Active Bxc systemd service status:"
  systemctl status bxc || true
  
  log "Running Bxc processes:"
  ps aux | grep -i bxc | grep -v grep || echo "No bxc processes running."
}

view_logs() {
  log "Tailing API and Error Logs (Press Ctrl+C to stop)..."
  tail -f /var/log/bxc/api.log /var/log/bxc/error.log
}

manage_tunnel() {
  local cmd="${1:-status}"
  case "${cmd}" in
    start)
      log "Starting SSH Tunnel to VPS (SOCKS5 + Port Forwards)..."
      if ssh -fN vps-tunnel; then
        log "SSH Tunnel started successfully."
      else
        error "Failed to start SSH Tunnel. Check ~/.ssh/config."
      fi
      ;;
    stop)
      log "Stopping SSH Tunnel..."
      pkill -f "ssh -fN vps-tunnel" || pkill -f "ssh vps-tunnel" || true
      log "SSH Tunnel stopped."
      ;;
    status)
      log "Checking SSH Tunnel connection..."
      if ssh -o ConnectTimeout=3 vps-tunnel true 2>/dev/null; then
        log "SSH Tunnel: Connected and Active."
      else
        error "SSH Tunnel: Offline / Connection Refused."
      fi
      ;;
    *)
      error "Unknown tunnel command: ${cmd}. Available: start | stop | status"
      exit 1
      ;;
  esac
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"
  shift

  case "${cmd}" in
    build) build_all ;;
    backup) backup_all ;;
    deploy) deploy_all ;;
    status) check_status ;;
    logs) view_logs ;;
    tunnel) manage_tunnel "${1:-status}" ;;
    help|--help|-h) usage ;;
    *)
      error "Unknown command: ${cmd}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
