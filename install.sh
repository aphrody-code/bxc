#!/usr/bin/env bash
# bxc — installeur Linux / macOS, une seule commande.
#
#   curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash
#
# Ce que fait le script :
#   1. détecte OS + architecture ;
#   2. résout la dernière release de aphrody-code/bxc (ou $BXC_VERSION) ;
#   3. télécharge l'asset — binaire nu (bxc-linux-x64) ou archive
#      (bxc-linux-x64.tar.gz), les deux existent selon les releases ;
#   4. installe dans $BXC_INSTALL_DIR (défaut ~/.local/bin) ;
#   5. crée la configuration par défaut sous XDG ($XDG_CONFIG_HOME/bxc) ;
#   6. vérifie l'installation (`bxc --version`).
#
# Variables :
#   BXC_INSTALL_DIR   répertoire d'installation (défaut ~/.local/bin)
#   BXC_VERSION       tag précis (défaut : dernière release)
#   BXC_NO_CONFIG=1   ne pas écrire config.json
#   BXC_NO_VERIFY=1   ne pas exécuter `bxc --version` à la fin

set -euo pipefail

REPO="${BXC_REPO:-aphrody-code/bxc}"
BINARY_NAME="bxc"
INSTALL_DIR="${BXC_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${BXC_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/bxc}"

die() { printf 'bxc: %s\n' "$1" >&2; exit 1; }
info() { printf '==> %s\n' "$1"; }

command -v curl >/dev/null 2>&1 || die "curl est requis."
command -v tar  >/dev/null 2>&1 || die "tar est requis."

# ── 1. Plateforme ──────────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64)  ARCH_SUFFIX="x64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *) die "architecture non supportée : $ARCH" ;;
esac

case "$OS" in
  linux)  OS_SUFFIX="linux" ;;
  darwin) OS_SUFFIX="darwin" ;;
  *) die "OS non supporté : $OS (Windows : utilisez install.ps1)" ;;
esac

TARGET="bxc-${OS_SUFFIX}-${ARCH_SUFFIX}"
info "Installation de bxc pour ${OS_SUFFIX}-${ARCH_SUFFIX}"

# ── 2. Version ─────────────────────────────────────────────────────────
TAG="${BXC_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1 || true)"
fi
[ -n "$TAG" ] || die "impossible de déterminer la dernière release de $REPO (réseau ? quota API ?)"
info "Release : $TAG"

# ── 3. Téléchargement ──────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BASE="https://github.com/$REPO/releases/download/$TAG"
# Ordre : binaire nu d'abord (produit par scripts/build-standalone.ts), puis
# les archives (produites par .github/workflows/release.yml). `macos-*` est le
# nom historique des assets Darwin.
CANDIDATES="$TARGET ${TARGET}.tar.gz"
if [ "$OS_SUFFIX" = "darwin" ]; then
  CANDIDATES="$CANDIDATES bxc-macos-${ARCH_SUFFIX} bxc-macos-${ARCH_SUFFIX}.tar.gz"
fi

DOWNLOADED=""
for asset in $CANDIDATES; do
  url="$BASE/$asset"
  if curl -fsSL -o "$TMP_DIR/$asset" "$url" 2>/dev/null; then
    DOWNLOADED="$asset"
    info "Téléchargé : $url"
    break
  fi
done
[ -n "$DOWNLOADED" ] || die "aucun asset trouvé dans $TAG (essayés : $CANDIDATES)"

# ── 4. Installation ────────────────────────────────────────────────────
case "$DOWNLOADED" in
  *.tar.gz|*.tgz)
    tar -xzf "$TMP_DIR/$DOWNLOADED" -C "$TMP_DIR"
    # `head -n1` plutôt que `-print -quit` : ce dernier est absent des vieux
    # `find` BSD (macOS). `|| true` neutralise le SIGPIPE sous `pipefail`.
    SRC="$(find "$TMP_DIR" -type f -name "$BINARY_NAME" 2>/dev/null | head -n 1 || true)"
    [ -n "$SRC" ] || die "\"$BINARY_NAME\" absent de l'archive $DOWNLOADED"
    ;;
  *)
    SRC="$TMP_DIR/$DOWNLOADED"
    ;;
esac

mkdir -p "$INSTALL_DIR"
# install(1) écrit puis positionne le mode en une opération ; le fichier n'est
# jamais visible à moitié écrit sous un nom que le PATH résout déjà.
install -m 0755 "$SRC" "$INSTALL_DIR/$BINARY_NAME"
info "Installé : $INSTALL_DIR/$BINARY_NAME"

# ── 5. Configuration par défaut ────────────────────────────────────────
if [ "${BXC_NO_CONFIG:-0}" != "1" ]; then
  mkdir -p "$CONFIG_DIR"
  if [ ! -f "$CONFIG_DIR/config.json" ]; then
    cat > "$CONFIG_DIR/config.json" <<JSON
{
  "installDir": "$INSTALL_DIR",
  "releaseRepo": "$REPO",
  "lightpandaTag": "nightly",
  "timeoutMs": 30000
}
JSON
    chmod 0600 "$CONFIG_DIR/config.json"
    info "Configuration : $CONFIG_DIR/config.json"
  else
    info "Configuration existante conservée : $CONFIG_DIR/config.json"
  fi
fi

# ── 6. PATH + vérification ─────────────────────────────────────────────
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    printf '\n!! %s n'"'"'est pas dans votre PATH. Ajoutez à ~/.bashrc ou ~/.zshrc :\n' "$INSTALL_DIR"
    printf '   export PATH="%s:$PATH"\n\n' "$INSTALL_DIR"
    ;;
esac

if [ "${BXC_NO_VERIFY:-0}" != "1" ]; then
  info "Vérification"
  if "$INSTALL_DIR/$BINARY_NAME" --version; then
    info "bxc $TAG est prêt."
  else
    die "le binaire installé ne répond pas à --version"
  fi
fi

cat <<'EOS'

Pour démarrer :
  bxc --help
  bxc recon https://example.com
  bxc self-update --check      # vérifie les mises à jour sans rien écrire

Docs : https://github.com/aphrody-code/bxc
EOS
