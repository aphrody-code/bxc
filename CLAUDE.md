# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@aphrody-code/bunlight` — VPS-optimized Google Chromium CLI engine. Monorepo Turborepo. Read `GEMINI.md` for foundational mandates.

## Mission

High-performance browser automation for the Google ecosystem. Features:
- **Native Chromium Core**: Rust-driven `bunlight-engine` (no Puppeteer/Playwright).
- **In-Process V8**: Fast, non-blocking execution via worker threads.
- **Zero-Spawn**: Zig-native engine for ultra-fast DOM-only scraping.
- **Async-First FFI**: Sub-millisecond latency via Bun thread pool.
- **Stealth**: Built-in bypasses for modern anti-bot stacks.

## Profiles

| Profile | Engine | JS | Latency | Usage |
|---|---|---|---|---|
| `static` | Zig-native DOM | No | ~5ms | Ultra-fast HTML scraping |
| `fast` | In-process V8 | Yes | ~50ms | Dynamic content, SPA |
| `stealth` | Native Chromium | Yes | ~500ms | Anti-bot bypass (Google optimized) |
| `max` | Chromium + Solvers | Yes | ~1200ms | Hard challenges (Turnstile/reCAPTCHA) |

## Commandes

```bash
bun run build          # turbo run build
bun test               # turbo run test (Google-only domains)
bun run lint           # turbo run lint (oxlint)
bun run typecheck      # tsc --noEmit
bunlight chrome fetch  # Download native chromium core
bunlight chrome launch # Launch native chromium instance
bunlight serve --profile stealth # Start stealth proxy
```

## Règles strictes

- **Bun-only Mandate**: Total purge of Node.js. NO `node:*` prefixes. NO `child_process`, `fs`, or `os`. Use `Bun.*` and Web APIs exclusively.
- **Google-only Mandate**: ALL integration tests and examples MUST use Google-owned domains.
- **Async-First**: All heavy FFI and I/O MUST be `await`ed and offloaded to Bun's thread pool.
- **TypeScript strict**: `strict: true`, no `any`, explicit types.
- **No Emojis**: In code, documentation, or CLI output.
- **Commits**: `feat(area):`, `fix(area):`, `chore:`.

## Pièges

- **Node.js Legacy**: Watch out for accidental `node:` imports or global Node APIs.
- **Sync FFI**: Synchronous FFI calls block the Bun event loop; always use async variants.
- **Non-Google Tests**: Tests on non-Google domains will fail or be flagged in CI.
