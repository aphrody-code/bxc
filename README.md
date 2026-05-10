# Bunlight

> **Bun + Lightpanda fusionnés.** Un browser engine in-process dans Bun, accessible via `import { Browser } from "bun:browser"`. Zéro spawn, zéro WebSocket, zéro CDP par-dessus TCP.

[![status](https://img.shields.io/badge/status-WIP-orange)](./MEGA-PLAN.md)
[![runtime](https://img.shields.io/badge/runtime-Bun_1.3+-black)](https://bun.com)
[![browser](https://img.shields.io/badge/browser-Lightpanda-blueviolet)](https://github.com/lightpanda-io/browser)

```ts
import { Browser } from "bun:browser";

await using page = await Browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());           // "Example Domain"
console.log(await page.$("h1")?.textContent()); // "Example Domain"
```

Le tout : un seul process, un seul binaire, sub-millisecond latency entre JS et browser engine.

---

## Installation

### Global (recommended)

```bash
npm install -g @aphrody-code/bunlight
bunlight install                  # downloads Lightpanda (~100 MB, required)
bunlight install --with-chromium  # + Chrome for Testing (~300 MB, for stealth profile)
bunlight install --with-camoufox  # + Camoufox v135 (~1.9 GB, for max profile — prompts)
bunlight install --all            # everything
```

The `postinstall` script runs automatically on `npm install` and downloads Lightpanda.
To also download Chromium or Camoufox during install, set the env var before installing:

```bash
BUNLIGHT_INSTALL_PROFILES=stealth npm install -g @aphrody-code/bunlight
BUNLIGHT_INSTALL_PROFILES=all BUNLIGHT_NO_PROMPT=1 npm install -g @aphrody-code/bunlight
```

### Standalone executable (no Node/Bun required)

```bash
curl -L https://github.com/aphrody-code/bunlight/releases/latest/download/bunlight-linux-x64 \
  -o /usr/local/bin/bunlight
chmod +x /usr/local/bin/bunlight
bunlight install
```

Available platforms: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.

### Environment overrides

| Variable | Default | Description |
|---|---|---|
| `BUNLIGHT_VENDOR_DIR` | `~/.bunlight/vendor` | Override binary install directory |
| `LIGHTPANDA_RELEASE_TAG` | `nightly` | Lightpanda release tag to download |
| `LIGHTPANDA_DOWNLOAD_URL` | (auto) | Override Lightpanda download URL directly |
| `BUNLIGHT_NO_AUTOINSTALL` | `0` | Set to `1` to skip postinstall entirely |
| `BUNLIGHT_NO_PROMPT` | `0` | Set to `1` to suppress Camoufox size confirmation |
| `BUNLIGHT_INSTALL_PROFILES` | (none) | Comma-separated extra profiles: `stealth`, `max`, `all` |

---

## Pourquoi

Bun et Lightpanda sont tous les deux écrits en Zig, tous les deux plus rapides que Node + Chrome dans leur catégorie. Pourtant, pour les piloter ensemble il faut aujourd'hui :

1. spawn un process Lightpanda (`lightpanda serve`)
2. ouvrir un WebSocket sur `127.0.0.1:9222`
3. parler CDP en JSON par-dessus
4. gérer le lifecycle, les leaks, les retries

C'est **lent** (~5 ms par appel), **fragile** (process leak, port collision, race au boot), et **redondant** : on a déjà 2 runtimes Zig, pourquoi 2 processes ?

Bunlight unifie le tout : Lightpanda devient un **module builtin de Bun** (`bun:browser`), comme `bun:sqlite` ou `bun:redis`. Un seul process, function calls directs, FinalizationRegistry pour le cleanup.

---

## Modes

| Mode | Surface | Performance | Use case |
|---|---|---|---|
| `Browser.parse(html)` | DOM/CSS query, no JS exec | ~µs | scraping HTML statique, SSR pages, RSS, sitemaps |
| `Browser.newPage()` | DOM + JS exec via V8 sub-process | ~ms | SPAs, JS challenges, dynamic content |
| `Browser.transport()` | `ConnectionTransport` Puppeteer-compat | varies | drop-in replacement de Chrome headless dans tes scripts existants |

---

## Compat Puppeteer (zero-spawn)

```ts
import puppeteer from "puppeteer-core";
import { Browser } from "bun:browser";

const browser = await puppeteer.connect({
  transport: Browser.transport()  // ← in-process, no WS
});

const page = await browser.newPage();
await page.goto("https://example.com");
// Tout ton code Puppeteer existant marche.
```

## Stealth pour Cloudflare / Akamai / DataDome

**Note:** `puppeteer-extra-plugin-stealth` est obsolète (abandonné juillet 2024, détecté en 2026). Bunlight intègre directement le stack stealth de référence 2026 :

| Couche | Lib utilisée | Statut |
|---|---|---|
| TLS fingerprint | [`lexiforest/curl-impersonate`](https://github.com/lexiforest/curl-impersonate) (Chrome 99-133, Firefox 144+, Safari 17/18) via `bun:ffi` | actif 2026-05 |
| HTTP/2 frame fingerprint | [`bogdanfinn/tls-client`](https://github.com/bogdanfinn/tls-client) (Akamai bypass) | actif 2026-05 |
| Browser stealth (Playwright) | [`patchright`](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — patches `Runtime.Enable`, isolated worlds, Console API | 3.1k stars, push 2026-04 |
| Browser stealth (Firefox) | [`camoufox v135 stable`](https://github.com/daijro/camoufox) — patches C++ navigator/WebGL/Canvas/fonts | 8.1k stars, push 2026-05 |
| Fingerprint generation | [`browserforge`](https://github.com/daijro/browserforge) — headers + navigator + WebGL cohérents | 1.1k stars |
| Captcha solver Turnstile | [CapSolver](https://www.capsolver.com) `AntiTurnstileTaskProxyLess` (~85-90% success, $0.8/1k) | active |
| Auto-routing pattern | inspiré de [`Scrapling`](https://github.com/D4Vinci/Scrapling) — escalade automatique selon challenge détecté | active |

```ts
import { Browser } from "bun:browser";

await using page = await Browser.newPage({
  profile: "auto",                                  // démarre fast, escalade sur challenge
  escalate: true,
  fingerprint: { source: "browserforge", os: "linux", browser: "chrome", version: 130 },
  proxy: { rotation: "per-session", pool: process.env.PROXY_POOL },
  captcha: { provider: "capsolver", token: process.env.CAPSOLVER_TOKEN },
  humanize: { mouse: true, scroll: true },
});

await page.goto("https://protected-site.com");
```

Cf. [`docs/PROFILES.md`](./docs/PROFILES.md) pour les 4 profils et leurs trade-offs.

---

## Status

**Work in progress.** Voir [MEGA-PLAN.md](./MEGA-PLAN.md) pour la roadmap détaillée (7 phases).

| Phase | Statut |
|---|---|
| 0 — Audit & bootstrap | done |
| 1 — `liblightpanda.so` cdylib (DOM-only) | in progress |
| 2 — `bun:ffi` integration (NPM `@aphrody-code/bunlight`) | pending |
| 3 — Builtin `bun:browser` (fork Bun) | pending |
| 4 — V8 in thread / IPC pour exec JS | pending |
| 5 — CDP server natif in-process | pending |
| 6 — Standalone executable | pending |
| 7 — Upstream PR / public fork | pending |

---

## Architecture

```
   ┌─────────────────────────────────────────┐
   │              bunlight                   │
   │  ┌───────────────┐   ┌───────────────┐  │
   │  │  JSC (main)   │   │  V8 (browser) │  │
   │  │  - user code  │   │  - page eval  │  │
   │  │  - Bun.serve  │   │  - DOM events │  │
   │  └──────┬────────┘   └────┬──────────┘  │
   │         │  Zig bridge (in-process)      │
   │  ┌──────▼──────────────────▼─────────┐  │
   │  │  DOM / CSS / HTML / Network       │  │
   │  │  (Lightpanda Zig core, statique)  │  │
   │  └───────────────────────────────────┘  │
   │                                         │
   │  Single binary, no spawn for static     │
   └─────────────────────────────────────────┘
```

---

## Develop

Voir [MEGA-PLAN.md](./MEGA-PLAN.md) section "Phases".

```bash
# Phase 1 — produire la cdylib DOM-only
cd /home/ubuntu/bunmium/bunlight
bun scripts/build-lightpanda-static.ts

# Phase 3 — fork Bun + bun:browser builtin
bun scripts/build-bun-fork.ts
./build/debug/bun-debug -e 'import { Browser } from "bun:browser"; console.log(Browser.version())'
```

---

## Benchmarks

Measured 2026-05-10, Bun 1.3.14, Linux x64, 12 cores, against a local mock server.
See [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md) for full methodology, raw data, and caveats.

### Static HTML parsing (localhost mock, p50)

| Runner | p50 latency | Peak RSS | Notes |
|--------|-------------|----------|-------|
| `fetch-native` (Bun) | 0 ms | 67 MB | No parsing, raw download |
| `bunlight-static` | **2 ms** | 67 MB | In-process CDP + DOM API |
| `cheerio` + fetch | ~1-3 ms | ~75 MB | (not measured, standard estimate) |
| `jsdom` + fetch | ~5-20 ms | ~100 MB | (not measured, standard estimate) |

bunlight-static adds ~2 ms vs raw fetch for the CDP dispatch overhead. For real URLs
where network RTT dominates (>20 ms), this difference is negligible.

### SPA rendering (localhost mock, p50, JS execution comparison)

| Runner | p50 latency | SPA content rendered | Peak RSS |
|--------|-------------|---------------------|----------|
| `fetch-native` | 0 ms | No (skeleton only) | 78 MB |
| `bunlight-static` | 1 ms | No (skeleton only) | 67 MB |
| `bunlight-fast` (Lightpanda) | **64 ms** | **Yes** | **76 MB** |
| Chromium headless (estimate) | ~400-800 ms | Yes | ~200 MB |

bunlight-fast is the only lightweight runner that executes SPA JavaScript. Cold start
(fresh Lightpanda process) is ~120-300 ms; warm path (process reuse) is ~50-100 ms per navigate.

### Real SPA sites (from integration tests, fresh process per page)

| Site | goto (ms) | Content (KB) | RSS (MB) |
|------|-----------|-------------|----------|
| HackerNews | 707 | 34.3 | 66.3 |
| react.dev | 156 | 265.8 | 69.4 |
| nuxt.com | 130 | 310.1 | 70.3 |
| nextjs.org | 123 | 280.4 | 71.1 |
| svelte.dev | 300 | 87.6 | 71.9 |

5/5 SPAs rendered successfully. 48/48 integration tests pass.

### Cloudflare bypass (honest estimates, NOT measured locally)

| Profile | Bypass rate | Cold start | Notes |
|---------|-------------|------------|-------|
| `static` / `fast` | 0% | <10 ms / ~150 ms | Detected by IUAM challenge |
| `stealth` (patchright) | ~60-80% | ~800 ms | Patches `Runtime.Enable` |
| `max` (Camoufox) | ~90-95% | ~1500 ms | C++ patches, Turnstile solver |

Running the benchmark:

```bash
bun run benchmark
# or single scenario:
bun benchmarks/run-all.ts --scenario spa-react
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full release history following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

---

## Publishing

Bunlight is published as `@aphrody-code/bunlight` to both **GitHub Packages** and **npm public registry**.

| Registry | Install command |
|---|---|
| GitHub Packages | `npm install @aphrody-code/bunlight --registry https://npm.pkg.github.com` |
| npm public | `npm install @aphrody-code/bunlight` |

To publish a new release from your machine:

```bash
# Requires GH_TOKEN (GitHub PAT with packages:write) and NPM_TOKEN
bun scripts/publish.ts patch   # bump patch, tag, publish both registries
bun scripts/publish.ts minor
bun scripts/publish.ts major
```

CI publishes automatically on `git push --tags`. See [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) for full token setup, workflow details, and troubleshooting.

---

## License

MIT. Lightpanda est AGPL-3.0 — Bunlight le link statiquement, donc le binaire final est sous AGPL-3.0 si distribué. Voir [LICENSE](./LICENSE) et [docs/LICENSING.md](./docs/LICENSING.md) pour les détails.

---

## AI Agents & Claude Code Plugin

Bunlight is AI-agent-friendly. Use it with Claude Code via the `/bunlight:*` skill namespace or the Bunlight CLI.

### Install for Claude Code

**Option 1: Load from disk (development)**
```bash
claude --plugin-dir ./bunlight
```

**Option 2: Install from npm (future)**
```bash
/plugin install bunlight
```

**Option 3: Copy skills to ~/.claude**
```bash
cp -r .claude/skills/bunlight ~/.claude/skills/
cp -r .claude/agents/*.md ~/.claude/agents/
```

### Available skills

Once loaded, trigger with `/bunlight:*`:

- `/bunlight:browser-basics` — Core API intro
- `/bunlight:profiles` — Decision tree for 5 profiles
- `/bunlight:detect` — Framework detection
- `/bunlight:cookies` — Cookie injection & auth
- `/bunlight:pool` — Concurrent page pools
- `/bunlight:queue` — Resumable crawling
- `/bunlight:cookbook` — 10 production recipes
- `/bunlight:troubleshooting` — Error solutions

### Available agents

AI agents for autonomous task execution:

- `bunlight-scraper` — Write a scraper for a URL
- `bunlight-crawler` — Build a massive crawler
- `bunlight-debugger` — Debug failing scrapers
- `bunlight-cookie-extractor` — Extract & manage cookies

### Quick start for Claude Code users

Ask Claude Code:

> "Write me a Bunlight scraper for https://example.com"

Claude will:
1. Load `/bunlight:profiles` to choose the best profile
2. Load `/bunlight:cookbook` for production patterns
3. Generate & test the scraper
4. Save to `examples/`

Or ask for a massive crawl:

> "Crawl 1000 URLs from urls.txt with auto-resume"

Claude will:
1. Build a RequestQueue-backed crawler
2. Set up graceful shutdown & monitoring
3. Save as `crawl.ts`
4. Walk you through running it

### AGENTS.md & SKILLS.md

For detailed instructions:
- [`AGENTS.md`](./AGENTS.md) — Code style, testing, phases
- [`SKILLS.md`](./SKILLS.md) — Skill index & discovery
- [`.claude/`](./.claude/) — Plugin definition

---

## Help & support

| Resource | Description |
|---|---|
| [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) | Step-by-step fixes for the 10 most common errors (binary not found, CDP timeout, FFI load failure, cookie injection issues, crash recovery) |
| [`docs/FAQ.md`](./docs/FAQ.md) | 15+ questions covering architecture choices, profile selection, Puppeteer/Crawlee comparison, storage, memory budgets, licensing, and captcha solving |
| [`docs/PROFILES.md`](./docs/PROFILES.md) | Full decision tree for choosing between `static`, `fast`, `http`, `stealth`, and `max` profiles |
| [`docs/CURL-IMPERSONATE.md`](./docs/CURL-IMPERSONATE.md) | 34 TLS fingerprint profiles supported by lexiforest v1.5.6 |
| [`docs/ANTI-BOT-STACK.md`](./docs/ANTI-BOT-STACK.md) | Full 2026 anti-bot stack (curl-impersonate, patchright, camoufox, capsolver) |
| [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md) | Measured latency and memory figures across 100 URLs and 6 runners |

If you hit an issue not covered here, open a GitHub issue with:

1. The error message and full stack trace
2. The profile you are using (`static`, `fast`, `http`, `stealth`, `max`)
3. Output of `vendor/lightpanda/lightpanda --version` (for profile `fast`)
4. Output of `bun --version`
