#!/usr/bin/env bash
# bxc — mise à jour Linux / macOS.
#
#   ./update.sh            met à jour si une release plus récente existe
#   ./update.sh --check    compare seulement, n'écrit rien
#
# Chemin nominal : `bxc self-update`, qui compare la version locale à la
# dernière release GitHub et ne remplace le binaire que si nécessaire.
# Repli : réexécuter install.sh quand `bxc` n'est pas encore sur le PATH.

set -euo pipefail

if command -v bxc >/dev/null 2>&1; then
  exec bxc self-update "$@"
fi

echo "bxc n'est pas sur le PATH — installation via install.sh" >&2

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/install.sh" ]; then
  exec bash "$SCRIPT_DIR/install.sh"
fi

exec bash -c 'curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash'
