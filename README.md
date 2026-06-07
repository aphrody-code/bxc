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
  - [𝕏 bxc x — Native X / Twitter Client](#-bxc-x--native-x--twitter-client)
- [📦 Monorepo Packages](#-monorepo-packages)
- [📦 Installation](#-installation)
- [🚢 Deployment (VPS)](#-deployment-vps)
- [⚙️ Native Engine & Portability](#-native-engine--portability)
- [🛠️ API Reference](#-api-reference)
  - [Library Usage](#library-usage)
  - [Google Atlas Integration](#google-atlas-integration)
  - [🌘 Autonomous Crawler & Search Engine](#-autonomous-crawler--search-engine)
- [🏆 WBO Metagame Tracker & Standings Dashboard](#-wbo-metagame-tracker--standings-dashboard)
- [📊 Benchmarks](#-benchmarks)
- [🏗️ Architecture Summary (for LLMs)](#-architecture-summary-for-llms)
- [🧩 Gemini CLI Extension](#-gemini-cli-extension)
- [🤝 Contributing & Community](#-contributing--community)

---

## 🤖 AI Agent Intelligence
Bxc is designed for high-concurrency agentic workflows. It solves the "Heavy Browser" problem by moving the DOM and network layers directly into the Bun runtime memory space.

### 🧩 MCP Server & AI Plugins Capabilities
Bxc ships with a native, unified **Model Context Protocol (MCP)** server (`src/mcp/server.ts`, version synced with release). AI agents can use it to:
* **`tune_memory_sqlite`**: Structured project memory storage (faster than text).
* **`bxc_scrape_markdown`**: Convert any URL to clean GFM Markdown.
* **`bxc_detect_frameworks`**: Deep tech-stack analysis (Wiz, Angular, React, etc.).
* **`bxc_keyword_search`**: Fast ranked full-text keyword search across crawled pages using FTS5 index.
* **`bxc_semantic_search`**: Ranked semantic similarity search on all crawled web pages using cosine similarity.
* **`bxc_cdp_evaluate`**: Execute sandboxed JavaScript in a high-stealth environment.
* **`bxc_search`**: Powerful Google Web Search with rich snippet options.
* **`bxc_google_fetch`**: Fetches markdown and structured metadata (JSON-LD, OG, Meta tags).
* **`bxc_wbo_rankings` / `bxc_wbo_metagame`**: Query WBO player rankings and Beyblade X metagame stats.
* **`bxc_recon`**: Full one-shot URL reconnaissance (CDN, headers, frameworks, CSS selectors sample, assets).
* **`bxc_mirror`**: Download and mirror a complete site layout locally.
* **`bxc_challonge`**: Extract a structured typed snapshot of any Challonge tournament page.
* **`bxc_worldbeyblade`**: Full forum automation (check status, get profile, thread, subforum post list, private message inbox & sending).
* **`bxc_x_client`**: Native X / Twitter client (cookie auth, no API key) — fetch a profile, a user's tweets, search the Latest timeline, trending news, or resolve the authenticated account. Also supports `rank`/`foryou` for local X For You style ranking (from xai-org/x-algorithm).
* **`bxc_x_algorithm_rank`**: Direct access to the local ranking pipeline (filters + weighted scorer + diversity).
* **`bxc_xpro_deck`**: X Pro Gryphon decks (`ViewerAccountSync`, create/remove deck) + Radar keyword search (`querySource: radar`) — see [`packages/x/docs/X_PRO.md`](packages/x/docs/X_PRO.md).
* **Unified Browser Tools**: Persistent browser automation primitives (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_evaluate`, `browser_wait_for`, `browser_screenshot`, `browser_close`).
* **Specialized Scrapers**: Exposes Bxc's advanced stealth crawlers directly as tools (`bxc_fut_price`, `bxc_fut_player`, `bxc_voiranime_search`, `bxc_voiranime_info`, `bxc_voiranime_resolve`, `bxc_xcom_profile`).

### 🧠 AI-Ready Plugin for Claude / Grok / Agy (Recommended)
See `packages/xai/examples/grok-x-agent.ts` for a complete runnable example of native X + Grok agent loop (part of docs/examples item 7).
All old direct "bxc" MCP entries and the legacy "bxc" skill have been removed from Claude Code, Grok Build, and Agy/antigravity-cli configs (in favor of the unified plugin below).

The **unified bxc plugin** (built using the official `plugin-dev` toolkit from anthropics/claude-code) is the AI-ready integration:

- Location (in this repo): `plugins/bxc/`
- 8 skills with progressive disclosure + strong triggers (bxc-core, rust-ffi, x-client, grok-xai, mcp-server, scraper, autopilot, docs)
- 6 dedicated sub-agents (bxc-rust-ffi-engineer, bxc-mcp-author, bxc-x-grok-architect, bxc-scraper-creator, bxc-verify-enforcer, bxc-crossplat-builder)
- Slash commands, event hooks (enforce scoped tests `bun test test/ packages/ src/`, bxc* naming, vendor protection)
- MCP server wiring example (`.mcp.json`)
- Fully documented cross-platform (Bun + Rust cdylib for linux-x64, mac universal, win msvc)
- **Generic / reusable**: The entire `plugins/bxc/` (or its components) can be dropped into *any* Bun + Rust-FFI + native X/Grok + MCP + scraper + agent project. See `plugins/bxc/README.md` "How to Adapt to Another Project".

**Install**:
- Claude Code: `--plugin-dir /path/to/bxc/plugins/bxc` or `cp -r plugins/bxc ~/.claude/plugins/bxc`
- Grok Build: add to `~/.grok/config.toml` [plugins].paths or copy to installed-plugins dir
- Agy/antigravity-cli: `cp -r plugins/bxc ~/.gemini/antigravity-cli/plugins/bxc` ; update mcp/plugins config

The plugin ships its own `validate-bxc-plugin.sh` and follows plugin-dev best practices. After install, the skills/agents load automatically for bxc-related tasks.

See `plugins/bxc/README.md` (and the reference `plugins/plugin-dev-reference/`) for details. This is the "AI ready" layer on top of the core CLI/MCP.

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
| `bxc mirror` | `bxc mirror <url> <out-dir>` | Download and mirror a complete site layout locally (supports recursion, filters, proxy, auth, and HAR). |
| `bxc challonge`| `bxc challonge <url>` | Snapshot a Challonge tournament page. |
| `bxc fut` | `bxc fut <action> <url>` | FIFA Ultimate Team player price (`price` / FUTBin) or stats (`player` / FUTGG). |
| `bxc voiranime`| `bxc voiranime <action> <arg>` | VoirAnime streaming search (`search`), info (`info`), or embed resolver (`resolve`). |
| `bxc google` | `bxc google <action> <arg>` | Google Ecosystem client for search (`search`), mandate audit (`open`), or mass audit (`audit`). |
| `bxc xcom` | `bxc xcom profile <username>` | X.com profile scraper (supports `--screenshot` and `--ai-extract`). |
| `bxc x` | `bxc x <action> [args]` | Native X/Twitter client via cookie auth — `profile`, `tweets`, `search`, `news`, `whoami`. |
| `bxc har` | `bxc har record <url> <out.har>` | Record HTTP Archive (use `--profile max` for X Pro / SPA). |
| `bxc grok` | `bxc grok <action> [args]` | xAI API (`chat`, `models`, `tts`, `stt`, `whoami`) — **no `XAI_API_KEY`** when `~/.grok/auth.json` exists (`grok login`). |
| `bxc worldbeyblade` | `bxc worldbeyblade <action>` | worldbeyblade.org automation tools (profile, thread, PMs). |
| `bxc cookies` | `bxc cookies <action>` | Cookie jar management tools. |
| `bxc har` | `bxc har <action> <url> <out.har>`| HAR (HTTP Archive) recorder/replayer. |
| `bxc api` | `bxc api` | Run Bxc as an HTTP JSON API (REST + GraphQL). |
| `bxc crawl-worker`| `bxc crawl-worker [opts]`| Runs the persistent recursive crawler worker 24/7. |
| `bxc install` | `bxc install` | Downloads native dependencies (Lightpanda). |
| `bxc chrome` | `bxc chrome <action>` | Native Chromium management. |

### ⚙️ Command Profiles

Every standard content command (`scrape`, `recon`, `mirror`, `challonge`, `har`, `fut`, `voiranime`, `google`) supports the `--profile` option:
* **`static`**: Extremely fast in-process HTML parser & DOM engine (no JS).
* **`fast`**: Lightpanda WebAssembly browser engine executing JS.
* **`http`**: TLS-fingerprinted direct requests bypassing DOM rendering entirely.
* **`stealth`**: Injected ghost-patched browser profile to bypass Turnstile / Cloudflare.
* **`max`**: Automatic multi-transport fallback pipeline (falls back through static/http/stealth until success).

**Exit codes** (stable for agent control flow): `0` success · `1` bad usage ·
`65` data/runtime error · `70` internal error · `130` interrupted. Errors are
written to `stderr` as `[error] <message>`; data to `stdout`.

### 📂 `bxc mirror` — Recursive Site Mirroring & Archiver

Downloads a complete site layout concurrently using `curl-impersonate` FFI and Bun's event loop, rewriting links locally.

```bash
# Recursively mirror up to 50 pages from a site with a Chrome 131 fingerprint, generating a session.har
bxc mirror https://example.com/ ./dist-mirror --recursive --max-pages 50 --har ./session.har
```

Options:
* `--recursive`: Enable multi-page recursive crawl.
* `--max-pages <N>`: Maximum HTML pages to crawl.
* `--max-depth <N>`: Maximum recursion depth.
* `--compress`: Write gzip `.gz` sidecars for all text assets.
* `--discover-hidden`: Parse sitemaps and `robots.txt` automatically.
* `--resolve-subdomains`: Scrape/resolve subdomains.
* `--allowed-domains <list>` / `--excluded-domains <list>`: Domain filters.
* `--allowed-paths <list>` / `--excluded-paths <list>`: Path prefix filters.
* `--no-parent`: Do not ascend to parent directory during crawl.
* `--no-host-directories`: Skip creating host folders for same-origin assets.
* `--delay-ms <N>`: Add sleep delay between page crawls.
* `--har <path>`: Archive all network transactions in a modern HTTP Archive (.har) format.
* `--proxy <url>` / `--proxy-auth <user:pass>`: HTTP/SOCKS5 proxy settings.
* `--auth <user:pass>`: Basic authentication credentials.
* `--http-version <1.0|1.1|2.0|3.0>`: Force HTTP version.
* `--verbose`: Enable verbose FFI libcurl connection tracing.

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

### ⚽ `bxc fut` — FIFA Ultimate Team Scraper
Extracts live price data and statistics.
```bash
# Get player price from FUTBin
bxc fut price "https://www.futbin.com/26/player/1042/cristiano-ronaldo" --profile max

# Get detailed player stats from FUTGG
bxc fut player "https://www.fut.gg/players/20801-cristiano-ronaldo/" --profile static
```

### 📺 `bxc voiranime` — VoirAnime Streaming Scraper
Interacts with the popular French streaming directory (WordPress wp-manga based).
```bash
# Search for anime (e.g. "inazuma")
bxc voiranime search "inazuma eleven"

# Extract series metadata and episodes slug
bxc voiranime info "inazuma-eleven-go-chrono-stone-vostfr"

# Resolve direct media stream URL from iframe embeds (e.g. vidmoly, filemoon)
bxc voiranime resolve "https://vidmoly.to/embed-xyz"
```

### 🛡️ `bxc google` — Google Properties Auditor
Audits frontend assets, CDNs, and Google Front End (GFE) compliance, enforcing the mandate guard.
```bash
# Perform organic Google search with smart-routing rules
bxc google search "stealth browser engine"

# Visit account or properties with mandate audit
bxc google open "https://accounts.google.com" --profile stealth

# Audit massive list of Google subdomains concurrently
bxc google audit "https://mail.google.com" "https://docs.google.com" "https://drive.google.com"
```

### 🐦 `bxc xcom` — X.com Scraper
Scrapes Twitter profiles cleanly without needing active developer API accounts.
```bash
# Scrape public info and print markdown
bxc xcom profile elonmusk

# Scrape profile with visual screenshot and local AI info extraction
bxc xcom profile elonmusk --screenshot --ai-extract
```

### 𝕏 `bxc x` — Native X / Twitter Client
A full GraphQL + REST client for X's private web API, authenticated with an
`auth_token` + `ct0` cookie pair (no developer portal, no API key). Backed by the
pure-TypeScript [`@aphrody/x`](./packages/x) package and a parallel Rust
crate (`rust-bridge/crates/x-client`) exposed over FFI (`bxc_x_user_*`). Includes local port of the X For You ranking algorithm (see `rust-bridge/crates/x-algorithm` + `bxc_x_algorithm_rank`).

See [packages/x/README.md](packages/x/README.md) for complete, readable documentation (core features, algo, X + Grok synergy, CLI, MCP, production notes, examples).

```bash
# Resolve the authenticated account
bxc x whoami

# Fetch a public profile (followers, bio, id...)
bxc x profile elonmusk

# Fetch a user's recent tweets
bxc x tweets elonmusk --count 40

# Search the Latest timeline / trending news
bxc x search "browser automation" --count 20
bxc x news --count 10

# Local X For You style re-ranking (integrated from xai-org/x-algorithm)
bxc x rank --from search "rust" --count 15
bxc x foryou --count 10
```

Auth resolution order: `--cookie "auth_token=...; ct0=..."` > session file >
`X_AUTH_TOKEN` / `X_CT0` environment variables.

### 🤖 `bxc grok` — xAI API (keyless with Grok CLI)

Uses the **same OIDC JWT** as Grok Build (`~/.grok/auth.json` after `grok login`).
No `XAI_API_KEY` required. Falls back to `XAI_API_KEY` when set.

```bash
bxc grok whoami
bxc grok models
bxc grok chat "Summarize zero-spawn browsers in one sentence"
bxc grok chat "Hi" --model grok-4 --stream
bxc grok tts "Hello" --output /tmp/hello.mp3
bxc grok raw GET /models
```

Library: `@aphrody/xai` (see [packages/xai/README.md](packages/xai/README.md) for complete docs: high-level Chat, XTools, integration, SuperGrok, etc.) · MCP: `bxc_grok_chat`, `bxc_grok_models`, `bxc_grok_whoami`.

---

## 📦 Monorepo Packages

Every targeted scraper ships as a standalone, individually-versioned package
under the `@aphrody` scope (published to npm):

| Package | Description |
| :--- | :--- |
| [`@aphrody/bxc`](./package.json) | The full Zero-Spawn engine, CLI, and MCP server. |
| [`@aphrody/x`](./packages/x) | Headless X / Twitter client (GraphQL + REST, cookie auth). See [packages/x/README.md](packages/x/README.md) for complete docs: core features, local For You algo (x-algorithm port), X + Grok synergy via XTools, CLI, MCP, examples, production notes. |
| [`@aphrody/xai`](./packages/xai) | xAI Grok REST client (high-level fluent Chat like xai-sdk-python: `createChat`/`append`/`sample`/`stream`/`executeToolCalls`/`sampleStructured`, reasoning_effort, structured outputs, XTools for native X tool fulfillment + auto-dispatch) + SUPER_GROK_TOKEN (gratuite/keyless). Deep native X combo via @aphrody/x for agentic use. See [packages/xai/README.md](packages/xai/README.md) for complete, readable docs (auth, high-level, integration, low-level, MCP, API ref, production). |
| [`@aphrody/challonge`](./packages/challonge) | Challonge tournament bracket scraper. |
| [`@aphrody/fut`](./packages/fut) | FIFA Ultimate Team (FUTBin / FUT.GG) price & stats. |
| [`@aphrody/voiranime`](./packages/voiranime) | VoirAnime catalog search & embed resolver. |
| [`@aphrody/worldbeyblade`](./packages/worldbeyblade) | WBO forum automation & metagame. |
| [`@aphrody/xcom`](./packages/xcom) | X.com profile markdown/screenshot scraper. |
| [`@aphrody/zukan`](./packages/zukan) | Inazuma Eleven character database scraper. |

---

## 📦 Installation

### Linux / macOS
```bash
# Global install (recommended)
curl -fsSL https://raw.githubusercontent.com/aphrody-code/bxc/main/install.sh | bash

# As a library
bun add @aphrody/bxc
```

### Windows 11 (PowerShell One-Liner)
```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/aphrody-code/bxc/main/scripts/install-bxc.ps1 | iex"
```

### Windows 11 Development / Packaging
If you are developing or building Bxc on Windows 11, you can automate setup, build, and packaging using the scripts below:

* **Install Prerequisites via WinGet**:
  ```powershell
  .\scripts\install-deps-windows.ps1
  ```
* **Build Bxc**:
  ```powershell
  .\scripts\build-windows.ps1
  ```
* **Package and Deploy (WinGet & MSIX)**:
  ```powershell
  .\scripts\deploy-windows.ps1
  ```

---

## 🚢 Deployment (VPS)

Full guide: **[`DEPLOY.md`](DEPLOY.md)** (systemd, MCP, `bxc-control.sh`, clean rebuild, ports).

```bash
cd ~/bxc && bun install
./scripts/bxc-control.sh build && ./scripts/bxc-control.sh deploy
```

Shared agent stack with aphrody: `bash ~/aphrody/scripts/vps-sync-agent-stack.sh` · memory: [`~/aphrody/docs/agent-stack/DEPLOY.md`](../aphrody/docs/agent-stack/DEPLOY.md).

---

## ⚙️ Native engine & portability

Bxc's fast paths (CSS selectors, native HTML→Markdown) are backed by a Rust
cdylib. Build it once from source:

```bash
bun run build:linux          # Rust cdylib + standalone binary (Linux)
# or just the FFI library:
cargo build -p bxc-rust-bridge --release   # → rust-bridge/target/release/libbxc_rust_bridge.{so,dylib,dll}
```

**You don't need the Rust toolchain to get started.** When using the compiled standalone binaries (built via `bun scripts/build-standalone.ts`), all native dependencies (`libbxc_rust_bridge`, `libcurl-impersonate`, and the `lightpanda` browser binary) are **embedded directly** in the single executable file.

At runtime:
- On first use, Bxc **automatically extracts** these embedded binaries to `~/.bxc/bin/` with proper executable permissions.
- Dynamic libraries are loaded (`dlopen`-ed) from this directory, making the standalone binary 100% self-contained, portable, and zero-install.
- When running from source, the libraries are still loaded lazily from their dev paths (`rust-bridge/target/...` and `vendor/...`).
- You can override these paths at any time using the environment variables `BXC_RUST_BRIDGE_LIB`, `LIBCURL_IMPERSONATE_PATH`, or `BXC_LIGHTPANDA_PATH`.

- Importing the engine **never crashes** when a `.so` is absent.
- `page.markdown()` and `bxc scrape --markdown` fall back to a
  **dependency-free pure-JS** HTML→Markdown converter (script/style stripped for
  clean, low-token output).
- Paths that genuinely require the native engine (CSS selector queries) surface
  an **actionable error** telling you exactly how to build it — never a cryptic
  FFI stack trace.

### 🛠️ VPS Administration & Automation (`bxc-control`)

See **[`DEPLOY.md`](DEPLOY.md)**. Quick reference:

```bash
./scripts/bxc-control.sh status     # systemd + processes
./scripts/bxc-control.sh deploy     # binaries + restart bxc + bxc-crawler
./scripts/bxc-control.sh logs       # /var/log/bxc/*.log
./scripts/bxc-control.sh backup     # zstd + git bundle
./scripts/bxc-control.sh tunnel     # SSH tunnel status
```

---

## 🛠️ API Reference

### Library Usage
```typescript
import { Browser } from "@aphrody/bxc";

const page = await Browser.newPage({ profile: "stealth" });
await page.goto("https://example.com");
const content = await page.content(); // HTML
const markdown = await page.markdown(); // GFM Markdown
await page.close();
```

### Google Atlas Integration
```typescript
import { google } from "@aphrody/bxc/google";

// Auto-detects local TLD and switches to native Google Smart Routing
const { page } = await google.open("https://www.google.com/search?q=bxc+engine");
```

### 🌘 Autonomous Crawler & Search Engine

Bxc includes a 24/7 background worker queue, FTS5 keyword indexing, sitemap XML extraction, and proxy rotation for persistent recursive scraping:

```typescript
import { BxcClient } from "@aphrody/bxc/sdk";

const client = new BxcClient({ endpoint: "http://localhost:3000" });

// Search crawled database natively
const keywordResults = await client.searchKeyword("Artificial Intelligence");
const semanticResults = await client.searchSemantic("Machine Learning");
```

To run a persistent crawling worker daemon on your VPS:
```bash
bxc crawl-worker --allowed-domains "news.ycombinator.com" --proxy-pool "http://proxy1.com,http://proxy2.com" https://news.ycombinator.com
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
