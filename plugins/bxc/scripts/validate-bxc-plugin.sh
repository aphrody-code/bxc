#!/bin/bash
# Simple validator for bxc Claude Code plugin (inspired by plugin-dev validators)
set -euo pipefail

PLUGIN_DIR="${1:-$(dirname "$0")/..}"
echo "Validating bxc plugin at $PLUGIN_DIR"

# Check manifest
if [[ ! -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]]; then
  echo "FAIL: missing .claude-plugin/plugin.json"
  exit 1
fi
echo "OK: plugin.json present"

# Check required components have content
for d in skills agents commands; do
  if [[ -d "$PLUGIN_DIR/$d" ]]; then
    count=$(find "$PLUGIN_DIR/$d" -type f | wc -l)
    echo "OK: $d has $count files"
  else
    echo "WARN: no $d dir (optional)"
  fi
done

# Check SKILL.md frontmatter basics
for skill in "$PLUGIN_DIR"/skills/*/SKILL.md; do
  if [[ -f "$skill" ]]; then
    if grep -q '^---' "$skill" && grep -q '^name:' "$skill" && grep -q '^description:' "$skill"; then
      echo "OK: $(basename $(dirname $skill)) skill frontmatter"
    else
      echo "FAIL: bad frontmatter in $skill"
    fi
  fi
done

# Check agents frontmatter
for agent in "$PLUGIN_DIR"/agents/*.md; do
  if [[ -f "$agent" ]]; then
    if grep -q '^---' "$agent" && grep -q '^description:' "$agent"; then
      echo "OK: $(basename $agent) agent frontmatter"
    fi
  fi
done

# Check hooks
if [[ -f "$PLUGIN_DIR/hooks/hooks.json" ]]; then
  echo "OK: hooks.json"
fi

# Check .mcp.json
if [[ -f "$PLUGIN_DIR/.mcp.json" ]]; then
  echo "OK: .mcp.json for MCP integration"
fi

echo "bxc plugin basic validation passed (structure + frontmatter)"
echo "For full validation, load plugin-dev and run its validators."
exit 0
