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
Bxc ships with a native **Model Context Protocol (MCP)** server. AI agents can use it to:
- **`tune_memory_sqlite`**: Structured project memory storage (faster than text).
- **`scrape_to_markdown`**: Convert any URL to clean GFM Markdown for minimal token usage.
- **`evaluate_js`**: Execute sandboxed JavaScript in a high-stealth environment.
- **`detect_frameworks`**: Deep tech-stack analysis (Wiz, Angular, React, etc.).

---

## 🚀 CLI Reference (Agent-Friendly)
All commands support `--json` for structured output and `--insecure` for bypassing TLS issues.

| Command | Usage | Description |
| :--- | :--- | :--- |
| `bxc serve` | `bxc serve --cdp-port 9222` | Spawns a CDP-compatible server (in-process). |
| `bxc recon` | `bxc recon <url>` | Full reconnaissance (tech stack, assets, Markdown). |
| `bxc detect` | `bxc detect <url>` | Deep detection of CMS, WAF, and frameworks. |
| `bxc scrape` | `bxc scrape <url> --markdown` | Instant HTML-to-Markdown conversion. |
| `bxc install` | `bxc install` | Downloads native dependencies (Lightpanda). |

---

## 📦 Installation

```bash
# Global install (recommended)
curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash

# As a library
bun add @aphrody-code/bxc
```

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
- **DOM**: Native Zig core (`liblightpanda_dom`)
- **Networking**: Rust + `curl-impersonate` (FFI)
- **Type Safety**: Strict TypeScript (no `any`, no `unknown` casts)

---

## 🧩 Gemini CLI Extension
Bxc is a first-class Gemini CLI extension. It provides native skills and slash commands to the agent.

### 🛠️ Activation
If you are running Gemini CLI in this workspace, the extension is automatically detected. To link it globally:
```bash
gemini extensions link .
```

### ⚡ Custom Commands
- `/bxc:scrape <url>`: Instant markdown extraction.
- `/skills`: Access `bxc-recon`, `bxc-scrape`, and `bxc-detect`.

---
- **License**: Apache-2.0
- **Style**: Google TypeScript Style Guide
- **Provenance**: SLSA Level 3 signed releases

---
<div align="center">
  <sub>Built with ⚡ by <a href="https://github.com/aphrody-code">@aphrody-code</a>. Optimized for human and artificial intelligence.</sub>
</div>
