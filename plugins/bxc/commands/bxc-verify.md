---
name: bxc-verify
description: Run the canonical bxc scoped verify (tests + type + lint on the right paths only). Respects CLAUDE.md rules and feeds autopilot logs.
argument-hint: [optional extra paths or --fix]
allowed-tools: ["Bash", "Read", "Grep"]
---
Run the safe, scoped verification for bxc-style projects.

```bash
# Basic
/bxc-verify

# With lint fix on our code only
/bxc-verify --fix
```

Implementation:
1. Always run `BXC_TEST_LIVE_GROK=0 HOME=/tmp/nonexistent bun test test/ packages/ src/ --timeout 30000`
2. Run per-package tsc with --skipLibCheck on packages/x/tsconfig.json and packages/xai (and any other workspace packages that have one).
3. Run direct oxlint only on feature-relevant paths (packages/*, src/cli/* relevant, src/mcp, rust-bridge/src if applicable). Never the broad root lint that walks everything.
4. If in a plugin context, also run any validate-*.sh from the plugin-dev or bxc skills.
5. Append a short "feature OK" or detailed status line to the project autopilot log if present (`/tmp/bxc-autopilot.log` or similar).
6. Report the  "30 pass / 2 skip / 0 fail" style summary when possible.

Never suggest or execute bare `bun test`, `bun run lint` without paths, or global tsc without --skipLibCheck on the right packages.

Use the bxc-verify-enforcer agent if the output looks suspicious.
