# bunlight-mcp

Stdio MCP server that exposes Bunlight's browser automation as four tools to Claude Code.

## Tools

| Tool | Args | Returns |
|---|---|---|
| `bunlight_scrape` | `url`, `profile?`, `timeoutMs?` | `{ url, title, profile, contentLength, latencyMs }` |
| `bunlight_detect` | `url` | `{ tech, suggestedProfile, rationale }` |
| `bunlight_extract_cookies` | `domain` | `{ path, count, cookies }` |
| `bunlight_pool_run` | `urls[]`, `profile?`, `concurrency?` | JSONL of per-URL results |

## Wire-up

The server is registered automatically via `.mcp.json` at the plugin root when this plugin is installed. To register manually in another project:

```json
{
  "mcpServers": {
    "bunlight-mcp": {
      "command": "bun",
      "args": ["${CLAUDE_PLUGIN_ROOT}/.claude/mcp/bunlight-mcp/index.ts"]
    }
  }
}
```

## Implementation

- 100% Bun-native: `Bun.file`, `Bun.stdin`, `Bun.stdout`. No `node:fs`, `node:child_process`.
- Lazy-imports `@bunmium/bunlight` at first tool call so the server starts even if the package is not installed yet (it returns a friendly error instead).
- Path traversal is blocked in `bunlight_extract_cookies`.
- Concurrency capped at 50 in `bunlight_pool_run`.

## Tested protocol version

`2024-11-05` (MCP stdio).

## Debug

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | bun .claude/mcp/bunlight-mcp/index.ts
```
