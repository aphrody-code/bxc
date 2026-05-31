# GEMINI.md — Bxc Operating Guide (Extreme Autonomy)

Bxc is the definitive "Zero-Spawn" browser engine for the AI-First era. It fuses the **Bun** runtime with a high-performance **Zig DOM** core and **Rust V8** bindings.

## Project Overview

- **Purpose:** Provide native, in-process browser navigation with sub-millisecond latency for AI agents, eliminating the overhead of external Chromium processes.
- **Main Technologies:**
  - **Runtime:** Bun (>= 1.3.14)
  - **FFI Layer:** Rust (lol_html) & Zig (historical/deprecated)
  - **Build System:** Turborepo
  - **Memory:** Native SQLite Tuning (`tune_memory_sqlite`)
  - **Extension:** `bxc-gemini` (Native MCP Server)
  - **Linting/Formatting:** Oxlint (performance) & Biome (consistency)

## AI Interaction — Deep Think & YOLO

1. **Absolute Autonomy**: Follow the mandate in `feedback__full_autonomy.md`. Zero human in the loop. You have 100% autonomy for destructive actions, shell commands, and deployments.
2. **Deep Think Protocol**: For any task requiring >3 tool calls or architectural refactoring, you MUST use `mcp_sequentialthinking` first.
3. **Native Extension**: Use the **`bxc-gemini`** MCP extension for memory tuning, vision analysis, and CDP snapshots.
4. **No Placeholders**: Always deliver complete, production-ready implementation.

## Building and Running

| Command | Description |
|---------|-------------|
| `bun run build` | Full Build: Rust-bridge + Windows MSVC + Standalone |
| `bun run build:linux` | Native Linux build (Rust cdylib + standalone) |
| `bun run build:win` | Windows Cross-compile (via cargo-xwin) |
| `bun run dev` | Run standalone serverless handler in watch mode |
| `bun run bench` | Execute performance benchmarks (p50/p95 latency) |
| `bun run clean` | Wipe all caches, logs, and build artifacts |
| `bxc-wbo-sync` | Alias to download and sync Wayback WBO standings |
| `bxc-wbo-analyst` | Alias to update WBO metagame metrics / synergies |
| `bxc-wbo-dashboard` | Alias to start the interactive Elysia server |

## Dedicated Scrapers & Verticals

| CLI Command | Target & Description |
|-------------|----------------------|
| `bxc fut` | Scrapes FUT prices from FUTBin and statistics from FUTGG. |
| `bxc voiranime` | Searches VoirAnime streams and resolves iframe streaming embeds (vidmoly, filemoon, etc.). |
| `bxc google` | Google ecosystem smart auditor, GFE compliance check, and mandate client. |
| `bxc xcom` | Scrapes public X.com (Twitter) profiles to markdown snapshots and screenshots. |
| `bxc worldbeyblade` | Scrapes, synchronizes, and parses WBO standings and player rankings. |

## Testing and Quality

- **Commands:**
  - `bun test test/` — Executes all core engine unit & integration tests.
  - `bun run test:google` — Validates Google Atlas and Smart Routing.
  - `bun run test:rust` — Validates Rust FFI bridge stability.
  - `/test-mcp` — **Native MCP Health Check** (Verification of native tool integrity).
  - `bun run lint` — Runs `oxlint` across all source directories.
  - `bun run typecheck` — Strict `tsc --noEmit`.
  - `bun run format` — Runs Biome formatter.

## Performance & Architecture

- **Bun-Native First**: Use `Bun.*` and Web APIs over `node:*`.
- **Zero-Spawn**: Favor in-process scraping over `child_process`.
- **Async FFI**: Native calls must be non-blocking using `await` + Bun thread pool.
- **SQLite Persistence**: Store cross-session project facts using `tune_memory_sqlite`.

## Code Style

- **Conventional Commits**: 1-line `feat|fix|chore|refactor|docs(scope):`.
- **TS Strict**: `noUncheckedIndexedAccess`, no `any`.
- **Headers**: Include Apache-2.0 license header in new files.

## Mémoire

Consolidate learnings into the private memory folder using the **`bun-dream`** skill and update the SQLite memory tuning database after every major milestone.
