# Bunlight Native Gemini Extension Development Guide

Welcome to the Bunlight Native Gemini CLI Extension! This extension provides deep, native integration between the Gemini CLI and the high-performance, Zero-Spawn Bunlight Chromium engine.

## Overview

This extension is built utilizing the official `@modelcontextprotocol/sdk` to securely expose native tools and APIs to the Gemini CLI. It follows all official MCP best practices:

- **Strict Schema Definitions:** Uses `zod` for rigorous parameter validation.
- **Robust Transport:** Leverages `StdioServerTransport` for secure communication.
- **Local Native Capabilities:** By linking directly to our Rust and Zig components, we avoid slow Node.js abstractions.

## Key Features

1. **SQLite Memory Tuning**
   - **Tool:** `tune_memory_sqlite`
   - **Details:** Replaces generic flat-file memory management with `bun:sqlite` for high-speed CRUD operations, enabling massive-scale vector lookups.

2. **Native Vision API Integration**
   - **Tool:** `vision_analyze`
   - **Details:** Instructs Bunlight to take native CDP screenshots and parse visual context directly via local models, completely bypassing the cloud.

3. **Massive Subagent Scraping**
   - **Tool:** `start_scraping_subagent`
   - **Details:** Triggers the Bunlight 24-worker/5656-page concurrent queue natively to perform massive Google searches and audits in the background.

4. **Auto-Detect Native Skills**
   - **Tool:** `auto_detect_skills`
   - **Details:** Scans the extension workspace dynamically for prebuilt Agent Skills (e.g., `rust-native-scanner`).

## Directory Structure

```text
packages/bunlight-extension/
├── gemini-extension.json      # Extension manifest and MCP execution commands
├── package.json               # Defines dependencies (MCP, Zod)
├── tsconfig.json              # Bun-native TS config
├── server.ts                  # Core MCP Stdio server
├── DEVELOPMENT.md             # This file
└── skills/                    # Dynamically loaded Agent Skills
    └── rust-native-scanner/   # Example: A 0-error Oxlint compliant native Rust scanner
```

## Setup & Testing

1. **Installation:**
   From the extension directory, run:
   ```bash
   bun install
   ```

2. **Validating the Schema:**
   Ensure zero TypeScript errors by running:
   ```bash
   bun run tsc --noEmit
   ```

3. **Running the Rust Skill Scanner:**
   Compile and run the scanner natively:
   ```bash
   bun run skills/rust-native-scanner/scripts/build-rust-skill.ts
   cargo run --manifest-path skills/rust-native-scanner/Cargo.toml -- scan
   ```

## Design Philosophy

- **Zero-Spawn Mandate:** Everything is handled natively via `Bun` or `Rust`. We do not spawn unmanaged Puppeteer instances.
- **Agent Interoperability:** Tools are designed to be explicitly consumable by LLMs via highly descriptive schemas.
- **Graceful Error Handling:** Handled via Zod schemas and explicit MCP error envelopes.
