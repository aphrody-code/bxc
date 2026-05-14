#!/bin/bash
# SessionStart hook: prints Bunlight plugin status when Claude Code opens a Bunlight project.
# Reports: bunlight version, default profile, lightpanda binary status, presence of bunlight.local.md.

set -euo pipefail

input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd // empty')

# Only run inside Bunlight projects.
if [[ -z "$cwd" ]]; then
  exit 0
fi
if ! { grep -q '@bunmium/bunlight' "$cwd/package.json" 2>/dev/null \
    || [[ -d "$cwd/.claude/skills/bunlight" ]] \
    || [[ -d "$cwd/src/api" && -f "$cwd/src/api/browser.ts" ]]; }; then
  exit 0
fi

# Discover bunlight version from package.json (devDeps or deps).
version=$(jq -r '
  ( .version // empty ) // empty
  | if . == null or . == "" then "unknown" else . end
' "$cwd/package.json" 2>/dev/null || echo "unknown")

# Default profile from .claude/bunlight.local.md if present.
default_profile="fast"
local_settings="$cwd/.claude/bunlight.local.md"
if [[ -f "$local_settings" ]]; then
  fm=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$local_settings")
  parsed=$(echo "$fm" | grep '^defaultProfile:' | sed 's/defaultProfile: *//' | sed 's/^"\(.*\)"$/\1/' || true)
  if [[ -n "$parsed" ]]; then
    default_profile="$parsed"
  fi
fi

# Lightpanda binary detection.
lp_bin="${LIGHTPANDA_BIN:-}"
lp_status="not found"
if [[ -n "$lp_bin" && -x "$lp_bin" ]]; then
  lp_status="ok at $lp_bin"
elif command -v lightpanda >/dev/null 2>&1; then
  lp_status="ok on PATH"
fi

settings_status="absent"
if [[ -f "$local_settings" ]]; then
  settings_status="present"
fi

msg="Bunlight plugin loaded. Project: $version. Default profile: $default_profile. Lightpanda: $lp_status. .claude/bunlight.local.md: $settings_status."

jq -n --arg msg "$msg" '{ "systemMessage": $msg }'
exit 0
