#!/bin/bash
# PreToolUse hook for Bash: reminds Claude to prefer Bun-native APIs when running test/build commands.
# Activates only inside Bunlight projects (detected by package.json containing "@bunmium/bunlight"
# or the working directory containing a .claude/skills/bunlight/ directory).

set -euo pipefail

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')

# Quick exit: not a Bunlight project context.
if [[ -z "$cwd" ]]; then
  exit 0
fi
if ! { grep -q '@bunmium/bunlight' "$cwd/package.json" 2>/dev/null \
    || [[ -d "$cwd/.claude/skills/bunlight" ]] \
    || [[ -d "$cwd/src/api" && -f "$cwd/src/api/browser.ts" ]]; }; then
  exit 0
fi

# Detect Node-stdlib-flavored or non-Bun commands the user might be about to run.
warn=""
if [[ "$cmd" =~ (^|\ )(npm|pnpm|yarn)(\ |$) ]]; then
  warn="Bunlight rule: use 'bun' instead of npm/pnpm/yarn (bun add, bun install, bun run, bun test)."
elif [[ "$cmd" =~ (^|\ )node(\ |$) ]]; then
  warn="Bunlight rule: use 'bun' instead of 'node' for executing scripts (bun run <file>)."
elif [[ "$cmd" =~ (^|\ )(jest|vitest|mocha)(\ |$) ]]; then
  warn="Bunlight rule: tests must use 'bun test' (Bun's native runner). Avoid Jest/Vitest/Mocha."
fi

if [[ -n "$warn" ]]; then
  jq -n --arg msg "$warn" '{
    "hookSpecificOutput": { "permissionDecision": "ask" },
    "systemMessage": $msg
  }'
  exit 0
fi

# No issues detected.
exit 0
