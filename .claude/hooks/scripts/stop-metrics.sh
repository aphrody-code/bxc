#!/bin/bash
# Stop hook: appends a one-line metrics record to .claude/bunlight-metrics.log
# in the current project. Captures the session id and the stop timestamp.

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
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

mkdir -p "$cwd/.claude" 2>/dev/null || exit 0
log_file="$cwd/.claude/bunlight-metrics.log"
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"timestamp\":\"$ts\",\"session_id\":\"$session_id\",\"event\":\"session_stop\"}" >> "$log_file"

exit 0
