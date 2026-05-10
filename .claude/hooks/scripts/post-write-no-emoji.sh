#!/bin/bash
# PostToolUse hook for Write/Edit: enforces Bunlight's no-emoji rule on .md files.
# Reports a system message if the just-written file contains emoji codepoints.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')

# Only check .md files inside Bunlight projects.
if [[ -z "$file_path" || "$file_path" != *.md ]]; then
  exit 0
fi
if [[ -z "$cwd" ]]; then
  exit 0
fi
if ! { grep -q '@bunmium/bunlight' "$cwd/package.json" 2>/dev/null \
    || [[ -d "$cwd/.claude/skills/bunlight" ]] \
    || [[ -d "$cwd/src/api" && -f "$cwd/src/api/browser.ts" ]]; }; then
  exit 0
fi

# Check for emoji codepoints (broad Unicode ranges for symbols and emoji).
if [[ -f "$file_path" ]]; then
  if LC_ALL=C grep -lP "[\xF0\x9F].|[\xE2][\x98-\x9E].|[\xE2][\xAC-\xAD]." "$file_path" >/dev/null 2>&1; then
    msg="Bunlight rule violated: $file_path contains emoji codepoints. Bunlight docs and code are emoji-free. Please remove."
    jq -n --arg msg "$msg" '{
      "systemMessage": $msg
    }' >&2
    exit 2
  fi
fi

exit 0
