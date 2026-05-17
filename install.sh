#!/usr/bin/env bash
# Bunlight Installer — Production-ready standalone binary installer
# Usage: curl -fsSL https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.sh | bash

set -e

REPO="aphrody-code/bunlight"
BINARY_NAME="bunlight"
INSTALL_DIR="$HOME/.local/bin"

# 1. Detect Environment
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
    x86_64)  ARCH_SUFFIX="x64" ;;
    aarch64|arm64) ARCH_SUFFIX="arm64" ;;
    *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
    linux)   OS_SUFFIX="linux" ;;
    darwin)  OS_SUFFIX="darwin" ;;
    *) echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac

TARGET="bunlight-${OS_SUFFIX}-${ARCH_SUFFIX}"

echo "⚡️ Installing Bunlight for ${OS_SUFFIX}-${ARCH_SUFFIX}..."

# 2. Get Version
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_RELEASE" ]; then
    echo "⚠️  Could not detect latest release via GitHub API. Falling back to v0.1.0."
    LATEST_RELEASE="v0.1.0"
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST_RELEASE/$TARGET"

# 3. Download & Install
mkdir -p "$INSTALL_DIR"
TMP_FILE=$(mktemp)

echo "📥 Downloading $DOWNLOAD_URL..."
if ! curl -L -o "$TMP_FILE" "$DOWNLOAD_URL"; then
    echo "❌ Error: Failed to download $DOWNLOAD_URL. Ensure the release exists."
    exit 1
fi

mv "$TMP_FILE" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"

echo "✅ Bunlight $LATEST_RELEASE successfully installed to $INSTALL_DIR/$BINARY_NAME"

# 4. PATH Check
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "⚠️  Warning: $INSTALL_DIR is not in your PATH."
    echo "Please add this to your .bashrc, .zshrc, or .profile:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# 5. Developer Runtime Check (Optional but recommended for Bunlight)
if command -v bun &> /dev/null; then
    echo ""
    echo "💎 Bunlight is optimized for Bun Canary."
    echo "To switch to Canary: bun upgrade --canary"
fi

echo ""
echo "🚀 Try running: bunlight --version"
echo "📖 Documentation: https://github.com/$REPO"

