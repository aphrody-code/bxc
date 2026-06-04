# bxc — Claude Code Plugin

Complete, cross-platform toolkit for developing and maintaining **bxc-style projects**: Bun + Rust FFI (cdylib for DOM/FFI/X/algorithms), native keyless X/Twitter client (`@aphrody/x`), keyless Grok/xAI high-level client with native X tool calling (`@aphrody/xai`), bxc-native-mcp server, monorepo scraper packages, stealth crawling, and autonomous autopilot loops.

**Designed to be reusable**: The patterns, skills, agents, and commands are generalized so any project that wants "zero-spawn native browser/X/Grok/agent engines" can adopt them (or the whole plugin).

## Installation (for Claude Code)

```bash
# From source (development / inside the bxc repo or a similar project)
/plugin install --local /path/to/this/bxc

# Or copy/symlink the `bxc/` directory into your ~/.claude/plugins/ or use
# claude --plugin-dir /path/to/bxc
```

Once enabled, the skills load on relevant triggers, agents are available, commands appear as `/bxc:*`, hooks enforce rules, and `.mcp.json` (or inline) can start the bxc MCP.

## What's Included

### Skills (auto-activating, progressive disclosure)
- `bxc-core` — philosophy, layout, common commands, cross-platform matrix, naming & test scoping rules.
- `bxc-rust-ffi` — cdylib authoring, rusqlite workspace rules, tokio-in-FFI, lol_html, cross-platform builds.
- `bxc-x-client` — native X (cookie GraphQL+REST), catalog sync, local For-You ranking (x-algorithm port), store/FTS, stealth.
- `bxc-grok-xai` — high-level fluent Chat (createChat/append/sample/stream/executeToolCalls/sampleStructured), XTools for native fulfillment, SuperGrok keyless, tool loops.
- `bxc-mcp-server` — extending bxc-native-mcp (registerTool + Zod), build to standalone, stdio/SSE, tool naming.
- `bxc-scraper` — monorepo package pattern for new scrapers (fut, voiranime, worldbeyblade style), CLI integration.
- `bxc-autopilot` — the loop (verify + lint scoped + log feeding + subagents), monitors, continuous operation.
- `bxc-docs` — writing high-quality SKILL.md, agents, commands following plugin-dev + bxc conventions.

Each skill has references/ and examples/ for depth.

### Dedicated Sub-Agents
- `bxc-rust-ffi-engineer`
- `bxc-mcp-author`
- `bxc-x-grok-architect`
- `bxc-scraper-creator`
- `bxc-verify-enforcer` (the guardian of scoped tests, bxc* naming, vendor protection)
- `bxc-skill-crafter`
- `bxc-crossplat-builder`

Invoke with "use the bxc-rust-ffi-engineer agent to ..." or let Claude Code pick them.

### Commands
- `/bxc-verify` — the only safe verify (scoped test + tsc + oxlint on feature paths only + log)
- `/bxc-new-scraper <name>` — scaffold a new packages/<name> following the monorepo conventions
- `/bxc-build` — rust + bun standalone + mcp
- `/bxc-deploy-mcp` — build and install the MCP binary + update systemd / paths
- `/bxc-catalog-sync` — X catalog / bundle discovery
- `/bxc-help` — quick reference to the bxc way

### Hooks (enforcement)
- PreToolUse on Bash: block bare `bun test`
- PreToolUse on Write/Edit: bxc* naming reminders + vendor protection

### MCP Integration
Example `.mcp.json` for the bxc-native-mcp (stdio). The actual binary lives in the target project (`dist/standalone/bxc-mcp` or `bun src/mcp/server.ts` for dev). The plugin documents how to wire it for any bxc-like project.

## Cross-Platform
- **Bun**: first-class on Linux, macOS, Windows.
- **Rust cdylib**: produce the right artifact per OS and load it with platform detection or `BXC_RUST_BRIDGE_LIB`.
- All paths in the plugin use `${CLAUDE_PLUGIN_ROOT}` (or `${CLAUDE_PROJECT_ROOT}` for project-specific binaries).
- Skills and agents contain explicit notes for Windows (msvc, .dll/.exe) and macOS (universal dylib).

## How to Adapt to Another Project
1. Copy the `bxc/` plugin directory (or install from a future marketplace release).
2. Rename/customize the plugin name in `.claude-plugin/plugin.json` if you want multiple variants.
3. Generalize or delete bxc-specific MCP / binary paths in `.mcp.json`.
4. Keep the skills and agents — they are written to be useful for "any Bun + Rust FFI + native social + keyless LLM agent project".
5. Update your own `CLAUDE.md` (or equivalent) to reference the bxc rules (test scope, naming, etc.).
6. Use `/bxc-verify` (or adapt the command) and the verify-enforcer agent from day 1.

## Relationship to the bxc Repository
This plugin was extracted and generalized from the canonical https://github.com/aphrody-code/bxc implementation (as of 2026).

The bxc repo itself uses (or can use) this plugin for its own development, plus its own local `.claude/skills/bxc` and `.agents/skills`.

## Contributing / Extending
- Add new skills under `skills/xxx/SKILL.md` (follow progressive disclosure + strong trigger description).
- Add agents under `agents/`.
- Add commands under `commands/`.
- Update hooks if you have new enforcement needs.
- Always test with the bxc-verify-enforcer and the scoped verify command.
- Keep everything portable with `${CLAUDE_PLUGIN_ROOT}`.

See the reference `plugins/plugin-dev-reference/` (copied from anthropics/claude-code) for the authoritative patterns this plugin follows.

## License
Apache-2.0 (same as bxc).

---

**Status**: 0.1.0 — initial extraction from bxc + generalization. Tests (30 pass scoped) + structure validated. Ready for use inside bxc and similar projects.
