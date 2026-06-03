# SKILLS.md

Guide to Bxc skills for AI agents. This file indexes all skills loaded natively via the Gemini CLI Extension.

When Gemini CLI loads the Bxc extension (wired via `gemini-extension.json`), it connects to the `bxc-mcp` MCP server (`/usr/local/bin/bxc-mcp`, defined under `mcpServers.bxc`) and auto-discovers native skills from the repo-root `skills/` directory.

The extension ships the following native Zero-Spawn components:

- **1 MCP Server** (`bxc-mcp`): Compiled via Bun from `src/mcp/server.ts`, exposing high-performance tools natively over stdio JSON-RPC.
- **SQLite Memory**: The `tune_memory_sqlite` tool manages long-term memory via a high-performance `bun:sqlite` database.
- **Vision API**: The `vision_analyze` tool parses native CDP screenshots using local/remote models.
- **Subagent Delegation**: The `start_scraping_subagent` offloads massive crawls to the 24-worker queue.
- **Native CDP**: `bxc_cdp_snapshot`, `bxc_cdp_evaluate`, and `bxc_cdp_logs` bypass Puppeteer entirely for direct V8 interactions.

## Usage

When working on a Bxc-related task, the Gemini CLI will automatically invoke these MCP tools.

Skills are discovered (via `src/ai/skills.ts`, guarded by `existsSync`) from, in order: `.gemini/skills/` then the repo-root `skills/` directory.

### Skills

| Skill | Path | Description |
|---|---|---|
| `rust-native-scanner` | `skills/rust-native-scanner` | High-performance codebase validation and Oxlint verification via native Rust binary. |
| `bxc-api` | `skills/bxc-api` | Browser automation API usage. |
| `bxc-detect` | `skills/bxc-detect` | Framework / fingerprint detection. |
| `bxc-recon` | `skills/bxc-recon` | URL reconnaissance and data extraction. |
| `bxc-scrape` | `skills/bxc-scrape` | Markdown / structured scraping. |
| `bxc-wbo` | `skills/bxc-wbo` | WorldBeyblade metagame / standings tracking. |

## Notes for plugin developers

- **MCP wiring**: `gemini-extension.json` (`mcpServers.bxc` → `/usr/local/bin/bxc-mcp`).
- **MCP Server Source**: `src/mcp/server.ts`.
- **MCP Server Binary**: `bxc-mcp` (built via `bun run build:mcp`, i.e. `bun build ./src/mcp/server.ts --compile`).
- **Skills directory**: repo-root `skills/`.
- **Trigger keywords**: "bxc", "browser automation", "scraping", "native cdp", "sqlite memory".
- **Allowed tools**: The system operates autonomously using native Gemini tools (`replace`, `write_file`, `run_shell_command`).

All capabilities are Bun + Lightpanda native by design. The "No Node.js" and "Google-only networking" patterns sont des préférences fortes, plus des mandates bloquants — voir `GEMINI.md`.
