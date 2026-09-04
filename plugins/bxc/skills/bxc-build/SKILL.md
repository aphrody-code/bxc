---
name: bxc-build
description: Build the bxc Rust bridge, Bun standalone binaries, and native MCP server when a bxc project needs a release or cross-platform artifact.
metadata:
  short-description: Build bxc and its MCP artifacts.
---

Build only the requested targets. Typical commands are:

```sh
bun run build:win
bun run build:mcp:win
```

For a full release, use the repository's `bun run build` workflow and verify the
generated artifacts under `dist/standalone/`. On Windows, the MCP executable is
`dist/standalone/bxc-mcp-windows-x64.exe`; the global MCP command is `bxc-mcp`.

Keep Rust and Bun versions aligned with the repository manifests. Report the
exact artifact paths and run a version or MCP initialize smoke test after a
successful build.
