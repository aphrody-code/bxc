---
name: bxc-build
description: Cross-platform build for the full bxc stack (Rust cdylibs + Bun standalone binaries + MCP server). Handles linux/mac/win notes.
argument-hint: [--linux|--mac|--win|--all]
allowed-tools: ["Bash"]
---
Typical:
bun run build:linux
bun run build:mcp

For full:
- cargo build -p bxc-rust-bridge --release (and other crates)
- bun run build (the root script that orchestrates rust-bridge + msvc + standalone)
- bun run build:mcp

The command prints the artifacts and reminds about BXC_RUST_BRIDGE_LIB for dev overrides.

Use bxc-crossplat-builder agent for complex platform work.
