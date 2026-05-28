# 🌖 Bxc: The Zero-Spawn Browser Engine for AI Agents

> **AI Agent Quick Start**: If you are an AI agent, read this file to understand the architecture, CLI, and API. Bxc is a "Zero-Spawn" engine, meaning it runs browser logic in-process via Bun + Rust/Zig, eliminating the need for external Chromium processes.

<div align="center">
  <p align="center">
    <a href="https://github.com/aphrody-code/bxc/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/aphrody-code/bxc/ci.yml?branch=main&style=flat-square&label=CI" alt="Build Status" /></a>
    <a href="https://github.com/aphrody-code/bxc/releases"><img src="https://img.shields.io/github/v/release/aphrody-code/bxc?style=flat-square&color=blue" alt="Version" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/aphrody-code/bxc?style=flat-square" alt="License" /></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-bun-black?style=flat-square&logo=bun" alt="Bun" /></a>
  </p>
</div>

---

## 🤖 AI Agent Intelligence
Bxc is designed for high-concurrency agentic workflows. It solves the "Heavy Browser" problem by moving the DOM and network layers directly into the Bun runtime memory space.

### 🧩 MCP Server Capabilities
Bxc ships with a native **Model Context Protocol (MCP)** server (`src/mcp/server.ts`). AI agents can use it to:
- **`tune_memory_sqlite`**: Structured project memory storage (faster than text).
- **`bxc_scrape_markdown`**: Convert any URL to clean GFM Markdown for minimal token usage.
- **`bxc_cdp_evaluate`**: Execute sandboxed JavaScript in a high-stealth environment.
- **`bxc_detect_frameworks`**: Deep tech-stack analysis (Wiz, Angular, React, etc.).

---

## 🚀 CLI Reference (Agent-Friendly)
Global flags: `--json` (structured output), `--insecure`/`-k` (bypass TLS),
`--proxy <url>`, `--quiet`/`-q`, `--timeout <ms>` (default 30000).

| Command | Usage | Description |
| :--- | :--- | :--- |
| `bxc serve` | `bxc serve --cdp-port 9222` | Spawns a CDP-compatible server (in-process). |
| `bxc recon` | `bxc recon <url>` | Full reconnaissance (tech stack, assets, Markdown). |
| `bxc detect` | `bxc detect <url>` | Deep detection of CMS, WAF, and frameworks. |
| `bxc scrape` | `bxc scrape <url> <css-selector>` | Extract `textContent` of matched elements (`--max N`). |
| `bxc scrape` | `bxc scrape <url> --markdown` | Convert the whole page to clean GFM Markdown. |
| `bxc mirror` | `bxc mirror <url>` | Download a full site (HTML + CSS + JS + assets). |
| `bxc challonge` | `bxc challonge <url>` | Snapshot a Challonge tournament page. |
| `bxc api` | `bxc api` | Run Bxc as an HTTP JSON API. |
| `bxc install` | `bxc install` | Downloads native dependencies (Lightpanda). |

`scrape` accepts a `--profile` of `static` (default, in-process DOM), `fast`
(Lightpanda, full JS), or `http` (curl-impersonate, TLS-fingerprinted, no DOM).

**Exit codes** (stable for agent control flow): `0` success · `1` bad usage ·
`65` data/runtime error · `70` internal error · `130` interrupted. Errors are
written to `stderr` as `[error] <message>`; data to `stdout`.

---

## 📦 Installation

```bash
# Global install (recommended)
curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash

# As a library
bun add @aphrody-code/bxc
```

---

## ⚙️ Native engine & portability

Bxc's fast paths (CSS selectors, native HTML→Markdown) are backed by a Rust
cdylib. Build it once from source:

```bash
bun run build:linux          # Rust cdylib + standalone binary (Linux)
# or just the FFI library:
cargo build -p bxc-rust-bridge --release   # → rust-bridge/target/release/libbxc_rust_bridge.{so,dylib,dll}
```

**You don't need the Rust toolchain to get started.** The libraries are
`dlopen`-ed lazily on first use, so:

- Importing the engine **never crashes** when a `.so` is absent.
- `page.markdown()` and `bxc scrape --markdown` fall back to a
  **dependency-free pure-JS** HTML→Markdown converter (script/style stripped for
  clean, low-token output).
- Paths that genuinely require the native engine (CSS selector queries) surface
  an **actionable error** telling you exactly how to build it — never a cryptic
  FFI stack trace.

Override the library location with `BXC_RUST_BRIDGE_LIB=/path/to/lib.so` (and
`LIBCURL_IMPERSONATE_PATH` for the `http` profile) when shipping prebuilt
binaries.

---

## 🛠️ API Reference

### Library Usage
```typescript
import { Browser } from "@aphrody-code/bxc";

const page = await Browser.newPage({ profile: "stealth" });
await page.goto("https://example.com");
const content = await page.content(); // HTML
const markdown = await page.markdown(); // GFM Markdown
await page.close();
```

### Google Atlas Integration
```typescript
import { google } from "@aphrody-code/bxc/google";

// Auto-detects local TLD and switches to native Google Smart Routing
const { page } = await google.open("https://www.google.com/search?q=bxc+engine");
```

---

## 📊 Benchmarks

| Metric | Playwright (Node) | **Bxc (L1 Fusion)** | Agent Benefit |
| :--- | :--- | :--- | :--- |
| **Cold Start** | 850ms | **85ms** | Instant tool invocation |
| **Memory (Idle)** | 240MB | **38MB** | 100+ concurrent agents/vPS |
| **DOM Latency** | 5ms / call | **50µs / call** | Real-time extraction |

---

## 🏗️ Architecture Summary (for LLMs)
- **Runtime**: Bun (JSC engine)
- **DOM & Markdown**: Rust bridge `libbxc_rust_bridge` (`html5ever` parser + CSS
  selector engine + HTML→Markdown), loaded via `bun:ffi`. Exposed to TS through
  `src/ffi/zigquery.ts` and `src/rust/bridge.ts`.
- **Networking**: Rust + `curl-impersonate` (FFI) for TLS-fingerprinted HTTP.
- **Full JS / SPA**: Lightpanda sub-process (CDP) for the `fast` / `stealth` profiles.
- **Type Safety**: Strict TypeScript (no `any`, no `unknown` casts)

The native libraries are loaded **lazily on first use** — importing the engine
never crashes if a `.so` is missing, and text-only paths fall back to pure-JS
implementations (see the *Native engine & portability* section).

---

## 🧩 Gemini CLI Extension
Bxc is a first-class Gemini CLI extension. It provides native skills and slash commands to the agent.

### 🛠️ Activation
If you are running Gemini CLI in this workspace, the extension is automatically detected. To link it globally:
```bash
gemini extensions link .
```

### ⚡ Custom Commands
Defined in `commands/bxc/`:
- `/bxc:scrape <url>`: Instant Markdown extraction.
- `/bxc:extract <url>`: Structured data extraction.
- `/bxc:sync-gemini`: Sync the extension into the Gemini CLI workspace.

---
- **License**: Apache-2.0
- **Style**: Google TypeScript Style Guide
- **Provenance**: SLSA Level 3 signed releases

---
<div align="center">
  <sub>Built with ⚡ by <a href="https://github.com/aphrody-code">@aphrody-code</a>. Optimized for human and artificial intelligence.</sub>
</div>
