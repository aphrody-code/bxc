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

  # 2. Kill residual bxc processes
  log "Stopping running bxc and bxc-mcp processes..."
  pkill -9 -f "bxc api" || true
  pkill -9 -f "bxc-mcp" || true
  pkill -9 -f "crawl-worker" || true

  # 3. Copy binaries (bxc to both bin dirs; bxc-mcp to both for CLI + MCP clients)
  log "Installing standalone bxc binary to /home/ubuntu/.local/bin/bxc..."
  cp "${REPO_ROOT}/dist/standalone/bxc-linux-x64" "/home/ubuntu/.local/bin/bxc"

  log "Installing standalone bxc binary to /usr/local/bin/bxc..."
  sudo cp "${REPO_ROOT}/dist/standalone/bxc-linux-x64" "/usr/local/bin/bxc"
  sudo chmod +x "/usr/local/bin/bxc"

  log "Installing standalone bxc-mcp binary to /usr/local/bin/bxc-mcp..."
  sudo cp "${REPO_ROOT}/dist/standalone/bxc-mcp" "/usr/local/bin/bxc-mcp"
  sudo chmod +x "/usr/local/bin/bxc-mcp"

  log "Installing standalone bxc-mcp binary to /home/ubuntu/.local/bin/bxc-mcp (Claude/Gemini MCP target)..."
  cp "${REPO_ROOT}/dist/standalone/bxc-mcp" "/home/ubuntu/.local/bin/bxc-mcp"
  chmod +x "/home/ubuntu/.local/bin/bxc-mcp"

  # 4. Install / refresh systemd unit files from the repo
  log "Installing systemd unit files..."
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc.service" "/etc/systemd/system/bxc.service"
  sudo cp "${REPO_ROOT}/scripts/deploy/bxc-crawler.service" "/etc/systemd/system/bxc-crawler.service"

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
