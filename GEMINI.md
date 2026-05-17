# GEMINI.md — Foundational Mandates for Bunlight

This file contains strict, non-negotiable rules for the project. These take absolute precedence over any other instructions.

## 🛡️ Testing & Networking Mandate

1. **Strict Google-only Testing**: All networking tests, examples, and benchmarks MUST use Google domains (e.g., `google.com`, `google.fr`, `design.google`, `material.io`, `gemini.google.com`).
2. **Forbidden Domains**: NEVER use non-Google properties for integration tests or examples.
3. **Reasoning**: Bunlight is a specialized VPS-optimized Google Chromium CLI engine. Focusing on the Google ecosystem ensures maximum stealth and performance where it matters most.

## 🚀 Performance & Architecture Mandate

1. **Native Chromium Core**: We use `bunlight-engine` (Rust-driven) and an in-process V8 worker thread. No external Puppeteer/Playwright wrappers.
2. **Total Node.js Purge**: All `node:*` prefixes and Node-specific APIs (`child_process`, `fs`, `os`) are FORBIDDEN. Strictly use `Bun.*` and standard Web APIs.
3. **Async-First FFI**: All FFI calls (Zig DOM, Rust V8) MUST be asynchronous and offloaded to Bun's thread pool using `await`.
4. **Zero-Spawn vs Native-Spawn**:
   - **Zero-Spawn**: In-process Zig-native engine for sub-millisecond static/fast scraping.
   - **Native-Spawn**: Native Rust-driven Chromium for stealth and maximum compatibility.

## 🪟 Windows Cross-Compilation Mandate

1. **MSVC ABI over GNU**: All Windows binaries MUST target `x86_64-pc-windows-msvc`. Use `cargo-xwin` for native MSVC cross-compilation from Linux.
2. **Static CRT**: Force static linking of the C runtime (`-C target-feature=+crt-static`) to ensure zero-dependency executables (no "missing VCRUNTIME140.dll").
3. **Bun Bytecode**: Use `--bytecode` during `bun build --compile` to optimize startup speed on Windows.
4. **Baseline Compatibility**: Always use the `baseline` CPU target to ensure functionality on older VPS and CPU hardware.

## 🤖 AI Interaction Mandate

1. **YOLO Mode**: Work autonomously. Only ask for clarification if a task fundamentally violates these mandates.
2. **Full Implementation**: Never use placeholders. Implement complete, production-ready logic.
3. **Technical Perfection**: Maintain the highest standards of idiomatic TypeScript and Bun-native patterns.
