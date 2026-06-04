---
name: bxc MCP Server
description: This skill should be used when extending or building the bxc-native-mcp (src/mcp/server.ts), adding registerTool calls with Zod schemas, versioning the server, building the standalone binary, wiring .mcp.json or gemini-extension.json, or exposing new capabilities from the bxc packages/Rust FFI as MCP tools.
version: 0.1.0
---

Core file: src/mcp/server.ts (version const at top, Elysia or raw for standalone).

Build: `bun run build:mcp` → dist/standalone/bxc-mcp (executable).

See the .mcp.json example in this plugin and the bxc-mcp-author agent.

Tools are registered with description + inputSchema (z.object). Keep results small and useful for LLMs.

The plugin itself provides an example .mcp.json that projects can adapt (using ${CLAUDE_PROJECT_ROOT} for the binary).
