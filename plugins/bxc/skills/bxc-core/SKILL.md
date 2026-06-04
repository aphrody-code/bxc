---
name: bxc Core
description: This skill should be used when the user asks to work on bxc (or similar Bun + Rust FFI native browser/X/Grok/agent engine projects), "bxc stack", "zero-spawn", native X client, Grok xAI high-level, bxc-mcp, scraper packages, rust-bridge FFI, autopilot, CLAUDE.md rules, cross-platform Bun/Rust builds, or needs patterns from the bxc monorepo adapted to other projects.
version: 0.1.0
---

# bxc — Zero-Spawn Native Browser Engine for Agents (toolkit)

bxc is a production-grade, cross-platform (Linux/macOS/Windows) "zero-spawn" navigation engine for AI agents: Bun runtime + Rust cdylib FFI (lol_html, html5ever, V8 bindings, X GraphQL client, For-You ranking algo port) + Zig DOM history in some components. No Chromium spawn for most workloads.

The `bxc` plugin provides reusable skills, dedicated sub-agents, commands, hooks, and MCP integration so any project can adopt the same architecture, patterns, and quality bars (bxc* naming, scoped testing, native keyless clients, agentic Grok+X loops, monorepo scrapers, autopilot).

## Core Principles (always follow)
- **Naming**: Every identifier, binary, doc, crate, package must use `bxc*` prefix. Rebrand is final — never reintroduce old names.
- **Test scope**: Always `bun test test/ packages/ src/` (or more specific). Never bare `bun test` (it discovers vendor/mcp-sdk and produces noise/failures).
- **Zero keys where possible**: Prefer SUPER_GROK_TOKEN / ~/.grok/auth.json for xai, cookie `auth_token+ct0` for X (via XSession). No paid API keys for core flows.
- **Native first**: Use the real @aphrody/x XClient and @aphrody/xai Chat + XTools for agentic flows instead of external APIs.
- **FFI discipline**: Rust cdylibs (bxc-rust-bridge) for hot paths (DOM, ranking, lol_html). Workspace rusqlite 0.37 for sqlite links. Build with `bun run build:linux` or cargo --release.
- **Cross-platform**: Bun works everywhere. Rust produces .so / .dylib / .dll. Provide notes/scripts for all three OS.
- **MCP exposure**: The bxc-native-mcp (in src/mcp/server.ts) exposes tools; extend with registerTool + Zod. Build to dist/standalone/bxc-mcp.
- **Autonomy**: The autopilot.sh + monitors + subagents pattern for continuous verify/build/docs.

## Quick Project Layout (for new or ported projects)
```
my-bxc-project/
├── src/                  # TS API, CLI, MCP server (Elysia or standalone)
├── packages/             # Monorepo scraper workspaces (@aphrody/<name>)
├── rust-bridge/          # FFI crates (x-client, x-algorithm, bxc-rust-bridge cdylib)
├── .claude/              # skills, agents (or load via bxc plugin)
├── CLAUDE.md             # project rules (test scope, naming, etc.)
├── MEGA-PLAN.md          # high-level roadmap
└── scripts/              # bxc-control.sh, autopilot.sh, build-standalone.ts
```

See the full bxc repo for canonical examples.

Use the other bxc-* skills for deep work on specific layers.

## Common Commands (adapt per project)
- `bun run build` — rust-bridge + standalone Bun binaries
- `bun test test/ packages/ src/` — the only safe test command
- `bun run build:mcp` — the MCP server
- `./scripts/bxc-control.sh deploy` — install to ~/.local + /usr/local + systemd (Linux)

## Portability & Cross-Platform
- Bun: `bun install`, `bun run ...`, `bun build --compile`
- Rust: workspace members in rust-bridge/Cargo.toml. Use `cargo build -p bxc-rust-bridge --release`
- For Windows: target x86_64-pc-windows-msvc, produce .dll + .exe
- For macOS: .dylib + universal if needed
- Always test the cdylib load path (BXC_RUST_BRIDGE_LIB override for dev)

Load more specific skills (bxc-rust-ffi, bxc-x-client, etc.) when the task matches their triggers.
