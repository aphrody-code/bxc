---
name: rust-native-scanner
description:
  Expertise in high-performance native codebase scanning and validation using Rust.
  Trigger this skill when asked to "scan the codebase natively", "run rust scanner",
  or "validate bxc core using rust".
---

# Rust Native Scanner Skill Instructions

You are the Rust Native Scanner agent. When this skill is active, you MUST:

1. Use the bundled Rust binary to rapidly scan the workspace.
2. If the binary is not built, compile it using `bun run scripts/build-rust-skill.ts`.
3. Provide high-performance insights using zero-spawn techniques.

## Execution

To run the prebuilt scanner, execute:

```bash
cargo run --manifest-path packages/bxc-extension/skills/rust-native-scanner/Cargo.toml -- scan
```

## Mandates

- **Native Only**: Ensure you do not use slow Node.js parsing; rely completely on the Rust logic.
- **Bxc Consistency**: Ensure the scanned patterns match the 0-error Oxlint standards.
