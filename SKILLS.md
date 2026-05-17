# SKILLS.md

Guide to Bxc skills for AI agents. This file indexes all skills loaded natively via the Gemini CLI Extension.

When Gemini CLI loads the Bxc extension (`packages/bxc-extension/`), it auto-discovers native skills via the `auto_detect_skills` MCP tool. 

The extension ships the following native Zero-Spawn components:

- **1 MCP Server** (`bxc-mcp`): Compiled via Bun, exposing high-performance tools natively over stdio JSON-RPC.
- **SQLite Memory**: The `tune_memory_sqlite` tool manages long-term memory via a high-performance `bun:sqlite` database.
- **Vision API**: The `vision_analyze` tool parses native CDP screenshots using local/remote models.
- **Subagent Delegation**: The `start_scraping_subagent` offloads massive crawls to the 24-worker queue.
- **Native CDP**: `bxc_cdp_snapshot`, `bxc_cdp_evaluate`, and `bxc_cdp_logs` bypass Puppeteer entirely for direct V8 interactions.

## Usage

When working on a Bxc-related task, the Gemini CLI will automatically invoke these MCP tools. 

For advanced integrations, look at the dynamically loaded skills in `packages/bxc-extension/skills/`.

### Example Skills

| Skill | Path | Description |
|---|---|---|
| `rust-native-scanner` | `packages/bxc-extension/skills/rust-native-scanner` | High-performance codebase validation and Oxlint verification via native Rust binary. |

## Notes for plugin developers

- **Extension Path**: `packages/bxc-extension`
- **MCP Server Binary**: `bxc-mcp` (Built via `bun build --compile`)
- **Testing**: Run `bun test` in the extension directory to validate the SQLite and Zod environments.
- **Trigger keywords**: "bxc", "browser automation", "scraping", "native cdp", "sqlite memory"
- **Allowed tools**: The system operates autonomously using native Gemini tools (`replace`, `write_file`, `run_shell_command`).

All capabilities are Bun + Lightpanda native by design. The "No Node.js" and "Google-only networking" patterns sont des préférences fortes, plus des mandates bloquants — voir `GEMINI.md`.
