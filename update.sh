#!/usr/bin/env bash
# Bxc Updater — Simple wrapper around the installer
# Usage: ./update.sh

set -e

echo "🔄 Checking for Bxc updates..."

if [ -f "./install.sh" ]; then
    bash ./install.sh
else
    curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash
fi

