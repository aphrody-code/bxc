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

## 📋 Table of Contents
- [🤖 AI Agent Intelligence](#-ai-agent-intelligence)
  - [🧩 MCP Server Capabilities](#-mcp-server-capabilities)
- [🚀 CLI Reference (Agent-Friendly)](#-cli-reference-agent-friendly)
  - [🔍 bxc search — Google Web Search](#-bxc-search--google-web-search)
- [📦 Installation](#-installation)
- [⚙️ Native Engine & Portability](#-native-engine--portability)
- [🛠️ API Reference](#-api-reference)
  - [Library Usage](#library-usage)
  - [Google Atlas Integration](#google-atlas-integration)
- [🏆 WBO Metagame Tracker & Standings Dashboard](#-wbo-metagame-tracker--standings-dashboard)
- [📊 Benchmarks](#-benchmarks)
- [🏗️ Architecture Summary (for LLMs)](#-architecture-summary-for-llms)
- [🧩 Gemini CLI Extension](#-gemini-cli-extension)
- [🤝 Contributing & Community](#-contributing--community)

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
| `bxc search` | `bxc search <query> [--json\|--markdown]` | Google Web Search → clean organic results. |
| `bxc mirror` | `bxc mirror <url>` | Download a full site (HTML + CSS + JS + assets). |
| `bxc challonge` | `bxc challonge <url>` | Snapshot a Challonge tournament page. |
| `bxc api` | `bxc api` | Run Bxc as an HTTP JSON API. |
| `bxc install` | `bxc install` | Downloads native dependencies (Lightpanda). |

`scrape` accepts a `--profile` of `static` (default, in-process DOM), `fast`
(Lightpanda, full JS), or `http` (curl-impersonate, TLS-fingerprinted, no DOM).

**Exit codes** (stable for agent control flow): `0` success · `1` bad usage ·
`65` data/runtime error · `70` internal error · `130` interrupted. Errors are
written to `stderr` as `[error] <message>`; data to `stdout`.

### 🔍 `bxc search` — Google Web Search

Returns clean organic results (title, URL, snippet) parsed from the stable
`udm=14` "Web" view. Renders as text (default), `--json`, or `--markdown`.

```bash
bxc search "bun runtime" --num 5
bxc search rust async --json
bxc search "actualité ia" --hl fr --gl FR --markdown
bxc search "who invented javascript" --rich   # + featured snippet / PAA / related
```

Options: `--num <N>`, `--page <N>` / `--start <N>`, `--hl <lang>`, `--gl <region>`,
`--domain <host>`, `--safe`, `--rich`, `--transport auto|fetch|ghost|http`.

**Authentication**: when `~/.bxc/cookies/google.json` exists (a Google cookie
jar in Playwright/CDP JSON format), `bxc search` uses it automatically for
logged-in results and fewer challenges. Override with `--cookies <path>`, or
force anonymous with `--no-auth`. The default transport is a native `fetch`
(no extra binaries); `ghost` (Lightpanda) and `http` (curl-impersonate) are
used as fallbacks if a response looks blocked.

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

## 🏆 WBO Metagame Tracker & Standings Dashboard

Bxc comes integrated with a dedicated, Wayback-backed scraping and analytics framework for the **World Beyblade Organization (WBO)**. It bypasses Cloudflare bot protection, parses player standings, evaluates parts metagame metrics (Average Weighted Podium Scores), and serves a premium, glassmorphic dashboard locally.

```bash
# 1. Fetch snapshot listings
bun run scripts/fetch_rankings_cdx.ts

# 2. Download the HTML archives
bun run scripts/fetch_all_rankings.ts

# 3. Parse standings and metagame rankings
bun run scripts/parse_rankings_all.ts

# 4. Start the interactive dashboard
bun run server:start
```

* Navigate to the **interactive dashboard** at `http://localhost:3000/` to explore the rankings, top synergies, and competitive decks dynamically.
* Leverage native MCP tools like `bxc_wbo_rankings` and `bxc_wbo_metagame` directly in your AI agent workflows.

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

## 🤝 Contributing & Community
We welcome contributions to Bxc! Feel free to report issues, suggest new features, or submit pull requests.

- 📖 **Documentation Portal**: [GitHub Pages Website](https://aphrody-code.github.io/bxc/)
- 💻 **Contributing Guidelines**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 📝 **License**: [Apache-2.0](./LICENSE)
- 🎨 **Code Style**: Google TypeScript Style Guide
- 🔒 **Provenance**: SLSA Level 3 signed releases

* **Star this repository** to show your support!
* **Submit issues** for bug reports or feature requests.
* **Join the discussion** to help shape the future of Zero-Spawn browser automation.

---
<div align="center">
  <sub>Built with ⚡ by <a href="https://github.com/aphrody-code">@aphrody-code</a>. Optimized for human and artificial intelligence.</sub>
</div>
