#!/bin/bash
# Enforce bxc test scoping rule from CLAUDE.md
# Never run bare `bun test` (it walks vendor/mcp-sdk and fails).
# Must use `bun test test/ packages/ src/` or specific scoped paths.

set -euo pipefail

COMMAND="${1:-}"

if echo "$COMMAND" | grep -qE '^\s*bun\s+test(\s+--|$)'; then
  # bare or with flags but no path
  if ! echo "$COMMAND" | grep -qE 'bun\s+test\s+([a-zA-Z0-9_./-]+|test/|packages/|src/)'; then
    echo "ERROR: bxc rule violation - bare 'bun test' is forbidden (walks vendor/ and causes 60-140 pre-existing failures)."
    echo "Use scoped: bun test test/ packages/ src/   or specific files like packages/x/index.test.ts"
    echo "See CLAUDE.md 'Test scope' section."
    exit 2
  fi
fi

exit 0