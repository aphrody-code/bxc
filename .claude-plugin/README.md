# Bunlight Claude Code plugin

Production-grade browser automation for Bun, packaged as a Claude Code plugin. Bunlight fuses Bun and Lightpanda into a single in-process browser engine and exposes 5 latency-tiered profiles (`static`, `fast`, `http`, `stealth`, `max`) plus pool, queue, and dataset primitives. This plugin gives Claude Code the agents, skills, commands, hooks, and MCP tools to drive Bunlight autonomously.

## What you get

- **8 agents** for the full scraping lifecycle:
  - `bunlight-scraper` — write a single-page scraper.
  - `bunlight-crawler` — design 100-1M URL crawls with auto-resume.
  - `bunlight-debugger` — diagnose failures, profile mismatches, blocks.
  - `bunlight-cookie-extractor` — capture and convert cookie jars.
  - `bunlight-test-runner` — run and patch the test suite.
  - `bunlight-profile-router` — pick the cheapest profile that succeeds.
  - `bunlight-bench-runner` — benchmark profiles head-to-head.
  - `bunlight-publisher` — cut npm releases.
- **1 skill** (`bunlight`) with 10 progressive-disclosure references.
- **8 commands**: `/bunlight-init`, `/bunlight-scrape`, `/bunlight-crawl`, `/bunlight-detect`, `/bunlight-test`, `/bunlight-bench`, `/bunlight-cookie-import`, `/bunlight-doctor`.
- **4 hooks**: PreToolUse (Bun-native API reminder on Bash), PostToolUse (no-emoji lint on Markdown writes), Stop (session metrics log), SessionStart (status banner with profile and Lightpanda binary).
- **1 MCP server** (`bunlight-mcp`) exposing 4 tools: `bunlight_scrape`, `bunlight_detect`, `bunlight_extract_cookies`, `bunlight_pool_run`.
- **1 settings template** at `.claude/bunlight.local.example.md` for per-project configuration.

## Install

The plugin auto-discovers all components when this repo is loaded as a plugin path. To use Bunlight as a runtime dependency in another project:

```bash
bun add @bunmium/bunlight
```

The MCP server starts automatically when the plugin loads. Verify with `/mcp` in Claude Code.

## Quick demo

```text
You: scrape https://example.com
Claude: [bunlight-scraper agent runs, picks profile=static]
        Wrote examples/scrape-example-com.ts
        bun examples/scrape-example-com.ts
        title: "Example Domain", contentLength: 1256, latencyMs: 3
```

## Configuration

Copy the settings template:

```bash
cp .claude/bunlight.local.example.md .claude/bunlight.local.md
```

Edit `defaultProfile`, `lightpandaPath`, `capsolverApiKey`, and other fields. The `SessionStart` hook reads this file each time Claude Code opens the project.

## Repository

Source, tests, benchmarks: <https://github.com/bunmium/bunlight>

## License

MIT for the JavaScript and TypeScript code in this plugin.

The `@bunmium/bunlight` runtime package, when statically linked against Lightpanda, falls under AGPL-3.0 due to Lightpanda's license. See `LICENSE` and `docs/LICENSING.md` in the runtime repository for details.

## Author

Bunmium. <https://github.com/bunmium>
