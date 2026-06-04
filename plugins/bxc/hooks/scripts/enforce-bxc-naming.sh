#!/bin/bash
# Enforce bxc* naming for new code/docs/binaries per CLAUDE.md
# The rebrand is complete — do not reintroduce old project naming.

set -euo pipefail

FILE_PATH="${1:-}"

# Check for common old names that should be bxc*
if echo "$FILE_PATH" | grep -qiE '(zero.spawn|aphrody.browser|old-project-name)'; then
  echo "WARNING: bxc naming rule - prefer 'bxc*' for identifiers, files, binaries, docs."
  echo "See CLAUDE.md 'Nommage'."
fi

# For new files in src/ or packages/ or rust-bridge, suggest bxc- prefix if not already
if [[ "$FILE_PATH" =~ (src/|packages/|rust-bridge/) ]] && [[ ! "$FILE_PATH" =~ bxc ]]; then
  BASENAME=$(basename "$FILE_PATH")
  if [[ ! "$BASENAME" =~ ^bxc ]]; then
    echo "INFO: bxc convention - consider prefixing new components with 'bxc' (e.g. bxc-my-feature.ts) for consistency."
  fi
fi

exit 0