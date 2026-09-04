---
name: bxc-verify
description: Run the canonical scoped bxc verification for tests, TypeScript and lint without walking vendored MCP code.
metadata:
  short-description: Verify bxc changes safely.
---

Use the narrowest relevant checks. The default bxc test scope is:

```sh
bun test test/ packages/ src/ --path-ignore-patterns vendor/**
```

Run targeted TypeScript checks and targeted `oxlint` paths for the changed
feature. Never invoke bare `bun test` or an unscoped root lint that discovers
`vendor/mcp-sdk-typescript/`. If the plugin validator is present, validate the
plugin after changing its manifest or skills. Summarize pass, skip and failure
counts and include the exact commands used.
