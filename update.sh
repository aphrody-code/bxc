#!/usr/bin/env bash
# Bunlight Updater — Simple wrapper around the installer
# Usage: ./update.sh

set -e

echo "🔄 Checking for Bunlight updates..."

if [ -f "./install.sh" ]; then
    bash ./install.sh
else
    curl -fsSL https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.sh | bash
fi

