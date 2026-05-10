# AGENTS.md — Bunlight

Instructions pour les agents Claude qui travaillent sur `~/bunmium/bunlight/`.

> Ce fichier est la reference agents pour Bunlight. Il remplace l'ancien fichier partiel.
> Derniere mise a jour : 2026-05-10 (vague 5).

---

## Quick context

- Bunlight = Bun + Lightpanda + zigquery — browser automation production-grade
- Version : `0.1.0-alpha.0` (npm `@bunmium/bunlight`, prepa publication en cours)
- Workspace parent : `~/bunmium/` (voir `~/bunmium/CLAUDE.md`)
- Plugin Claude : marketplace-ready 0.2.0 (`.claude/` + `.claude-plugin/`)

---

## Avant de coder

1. Lire `~/bunmium/CLAUDE.md` (regles workspace — Bun-native, strict, no emoji)
2. Lire `~/bunmium/bunlight/CLAUDE.md` (regles Bunlight + inventaire complet)
3. Lire `~/bunmium/state.md` §2.1 (status global + vagues agents)
4. Lire `~/bunmium/tasks.json` (backlog — verifier in_progress avant de claim)

---

## Stack technique

| Couche | Technologie |
|---|---|
| Runtime | Bun >= 1.3.0 (peerDep) |
| Langage | TypeScript strict (`tsconfig.json` `strict: true`) |
| Tests | `bun:test` uniquement |
| Storage | `bun:sqlite` (`src/queue/RequestQueue.ts`, `src/storage/`) |
| HTTP | `Bun.serve`, `fetch` global, `Bun.file`, `Bun.$` |
| FFI | `bun:ffi` (zigquery cdylib, curl-impersonate cdylib) |
| Browser fast | Lightpanda binary (CDP via WebSocket loopback) |
| Browser stealth | patchright (Chromium patches) |
| Browser max | Camoufox v135 (Firefox fork) + CapSolver |
| Detection | wappalyzergo Go binary (3000+ techs) |
| Linting | Biome (`biome.json`) |
| CI | GitHub Actions (`.github/workflows/test.yml`, `lint.yml`, `release.yml`) |

---

## Profiles

| Profile | Transport | JS | TLS FP | Anti-bot | Latence | CF bypass |
|---|---|---|---|---|---|---|
| `static` | StaticDomTransport (zigquery FFI) | Non | Non | Non | < 5ms | ~10% |
| `fast` | SocketPairTransport (Lightpanda CDP) | Oui | Non | Non | ~120ms | ~55% |
| `http` | curl-impersonate FFI | Non | Chrome116 / FF135 / Safari18_0 | Non | ~100ms | ~55% |
| `stealth` | patchright (Chromium) | Oui | Non | Oui | ~800ms | ~80% |
| `max` | Camoufox v135 + CapSolver | Oui | Non | Oui + Turnstile | ~1500ms | ~95% |

Decision tree : `docs/PROFILES.md`.

---

## Structure du projet

```
bunlight/
  src/
    api/browser.ts              - API publique : Browser.newPage(), Page
    cli/serve.ts                - CLI `bunlight serve --cdp-port N --profile P` (684 LOC)
    transport/
      StaticDomTransport.ts     - profile static (zigquery in-proc)
      SocketPairTransport.ts    - profile fast (Lightpanda CDP WS)
      InProcessTransport.ts     - futur builtin bun:browser
    ffi/
      curl-impersonate.ts       - TLS fingerprint HTTP (782 LOC, 34 profiles)
      zigquery.ts               - DOM queries cdylib (434 LOC)
    profiles/
      static/, fast/, stealth/, max/, full/
      humanize.ts               - Bezier mouse, scroll, delays
      fingerprint.ts            - fingerprint generation
    captcha/capsolver.ts        - Turnstile/reCAPTCHA/hCaptcha (mock si no API key)
    cookies/
      cookie-loader.ts          - Playwright/CDP/Netscape formats
      cookie-injector.ts        - injection CDP Network.setCookies
    pool/
      PagePool.ts               - concurrence bounded, LRU eviction
      AutoscaledPool.ts         - concurrence adaptive
      ProxyPool.ts              - rotation proxy par session/requete
      SessionPool.ts            - session jars persistants
    queue/RequestQueue.ts       - bun:sqlite state machine (PENDING/LOCKED/DONE/FAILED)
    storage/
      Dataset.ts                - append-only JSONL (Bun.file().writer())
      KeyValueStore.ts          - dual backend (sqlite < 64KiB, blob > 64KiB)
    throttling/
      RateLimiter.ts            - token bucket par domaine (taches #13)
      robots.ts                 - Crawl-delay parsing
    recorder/
      HarRecorder.ts            - enregistrement CDP messages en .har
      HarReplayer.ts            - replay deterministe sans reseau
    stats/
      Statistics.ts             - metriques runtime
      dashboard.ts              - dashboard Bun.serve (tache #11)
    utils/sitemap.ts            - XML parser auto-discovery
    utils/robots.ts             - RFC 9309 robots.txt
    detect.ts                   - wappalyzergo wrapper (20 tests)
    router/
      challenge-detect.ts       - detecte CF/Akamai/DataDome
      framework-strategy.ts     - suggestProfile() par framework
    helpers/                    - enqueueLinks + misc (tache #12)
  test/
    unit/                       - bun test, no spawn, no network
    integration/                - spawn Lightpanda, reseau, skip si absent
  examples/
    05-puppeteer-zero-spawn.ts
    06-stealth-cloudflare.ts
    07-max-turnstile-solver.ts
    08-massive-crawl.ts
    showcase/                   - HN 1000 crawler (tache #4)
  docs/                         - 22 fichiers (voir section Docs)
  vendor/
    zigquery-wrapper/zig-out/lib/liblightpanda_dom.so  (1.7 MB)
    curl-impersonate/libcurl-impersonate-chrome.so.4.8.0  (2.5 MB)
    camoufox/                   - Firefox 135 fork stealth
    wappalyzergo/wappalyzergo-cli  (Go binary)
  forks/bun/                    - fork Bun pour bun:browser builtin (NE PAS toucher sans raison)
  dist/standalone/bunlight-linux-x64  (96.2 MB, standalone exe)
  .claude/                      - plugin Claude (agents, commands, skills, hooks, mcp)
  .claude-plugin/               - metadata marketplace
  .github/workflows/            - test.yml + lint.yml + release.yml + dependabot.yml
  cookies/private/              - NE JAMAIS COMMIT (cf_clearance, sessions)
  bin/bunlight                  - entrypoint CLI
  package.json                  - @bunmium/bunlight 0.1.0-alpha.0
  biome.json                    - linting/formatting
  tsconfig.json                 - TypeScript strict
```

---

## Tests

```bash
# Tous les tests (unit + integration si binaires presents)
bun test

# Unit uniquement
bun test test/unit/

# Integration (reseau + binaires requis)
bun test test/integration/

# Un fichier specifique
bun test test/integration/curl-impersonate.test.ts

# Pattern
bun test --testPathPattern=pool
```

Resultats actuels (2026-05-10) : ~150+ pass, 0 fail, ~6 skip conditionnels (Chromium/Firefox non installes).

Regles :
- Toujours `bun test`, jamais jest/vitest/mocha.
- Tests network : skip si probe `https://example.com` echoue, avec `logSkip("reason")`.
- Tests binary : skip si binaire absent + log clair.
- Jamais skip silencieux.

---

## Plugin Claude Code

Le plugin est dans `.claude/` + `.claude-plugin/`. Version 0.2.0, marketplace-ready.

### Agents (8)

| Agent | Fichier | Role |
|---|---|---|
| bunlight-scraper | `.claude/agents/bunlight-scraper.md` | Scraping URL unique |
| bunlight-crawler | `.claude/agents/bunlight-crawler.md` | Crawling multi-URL + queue |
| bunlight-debugger | `.claude/agents/bunlight-debugger.md` | Debug transport/profile |
| bunlight-cookie-extractor | `.claude/agents/bunlight-cookie-extractor.md` | Extraction cookies navigateur |
| bunlight-test-runner | `.claude/agents/bunlight-test-runner.md` | Execution suite de tests |
| bunlight-profile-router | `.claude/agents/bunlight-profile-router.md` | Recommandation profile |
| bunlight-bench-runner | `.claude/agents/bunlight-bench-runner.md` | Benchmarks comparatifs |
| bunlight-publisher | `.claude/agents/bunlight-publisher.md` | Publication npm |

### Commands (8)

`/bunlight-init`, `/bunlight-scrape`, `/bunlight-crawl`, `/bunlight-detect`,
`/bunlight-test`, `/bunlight-bench`, `/bunlight-cookie-import`, `/bunlight-doctor`

### Skill

`Skill("bunlight")` - SKILL.md + 10 references :
`api`, `browser-basics`, `profiles`, `detect`, `cookies`, `pool`, `queue`, `storage`, `cookbook`, `troubleshooting`

### Hooks (4)

- `pre-bash-bun-native` : warn npm/yarn/node en CLI
- `post-write-no-emoji` : bloque emoji dans .md
- `session-start-status` : injecte status Bunlight au demarrage
- `stop-metrics` : resume metriques a la fin

### MCP server

`bunlight-mcp` (Bun-native TS dans `.claude/mcp/bunlight-mcp/`)
4 tools : `bunlight_scrape`, `bunlight_detect`, `bunlight_extract_cookies`, `bunlight_pool_run`

---

## Regles strictes

### Code

- Bun-native obligatoire. Voir tableau dans `~/bunmium/CLAUDE.md` §3.1.
- TypeScript strict (`strict: true`), jamais `any` (utiliser `unknown` + narrowing).
- Imports avec extension explicite : `import { x } from "./module.ts"`.
- Pas d'emojis dans code, doc, output.
- Pas de double-dash (`--`) dans la doc — emdash (`—`) ou rewrite.

Exceptions documentees :
- `node:zlib.brotliDecompressSync` : Bun n'expose pas encore l'equivalent.

### Git

- Format commit : `feat(bunlight): subject`, `fix(bunlight): subject`, `chore: subject`.
- NE JAMAIS commit :
  - `cookies/private/*` (cf_clearance, session_production)
  - `vendor/*` sans raison documentee
  - `forks/bun/` (fork upstream Bun)
  - `node_modules/`, `dist/` (sauf release explicite)

### Performance

- `Bun.write` atomique (sendfile Linux) — preferer a writeFile + rename.
- `Bun.file().writer()` pour append-only logs (Dataset.ts).
- `bun:sqlite` avec `using` statements pour cleanup auto.
- `Bun.gunzipSync` / `Bun.inflateSync` / `Bun.zstdDecompressSync` (sync, zero alloc).

---

## Quick commands

```bash
# Status
bun test --bail

# CLI
~/bunmium/bunlight/bin/bunlight serve --cdp-port 9222 --profile fast

# Build standalone
bun scripts/build-standalone.ts

# Lint
bun run lint

# Benchmarks
bun benchmarks/run-all.ts

# Plugin Claude
ls ~/bunmium/bunlight/.claude/{agents,commands,skills,hooks,mcp}/
```

---

## Navigation rapide

| Je veux... | Je regarde |
|---|---|
| L'API publique | `src/api/browser.ts` + `.claude/skills/bunlight/references/api.md` |
| Choisir un profile | `docs/PROFILES.md` + `.claude/skills/bunlight/references/profiles.md` |
| Bypass Cloudflare basic | `docs/CURL-IMPERSONATE.md` (profile http chrome116) |
| Bypass CF Managed Challenge | `docs/PROFILE-STEALTH-RESULTS.md` |
| Bypass Turnstile | `docs/PROFILE-MAX-RESULTS.md` |
| Detecter framework | `src/detect.ts` + `docs/FRAMEWORK-DETECTION.md` |
| Cookies persistants | `src/cookies/` + `cookies/private/<domain>.json` |
| Pool 1000+ pages | `src/pool/AutoscaledPool.ts` + `src/queue/RequestQueue.ts` |
| Crawler resumable | `src/queue/RequestQueue.ts` (bun:sqlite) |
| Sitemap auto-discovery | `src/utils/sitemap.ts` + `src/utils/robots.ts` |
| Rate limiting | `src/throttling/RateLimiter.ts` + `docs/RATE-LIMITING.md` |
| HAR recording/replay | `src/recorder/` + `docs/HAR-RECORDER.md` |
| Enqueue links | `src/helpers/enqueueLinks.ts` + `docs/ENQUEUE-LINKS.md` |
| Statistics + dashboard | `src/stats/` + `docs/STATISTICS.md` |
| Standalone executable | `dist/standalone/bunlight-linux-x64` + `docs/STANDALONE.md` |
| CI GitHub Actions | `.github/workflows/` + `docs/CI.md` |
| Migration node:* | `docs/BUN-NATIVE-AUDIT.md` |
| Benchmarks | `benchmarks/results/2026-05-10.md` + `docs/BENCHMARKS.md` |
| Fork Bun builtin | `forks/bun/BUNLIGHT-PATCHES.md` |
| PR agent-browser | `~/bunmium/agent-browser/PR-DESCRIPTION.md` |
| Best practices plugin | `docs/AGENTS-SKILLS-BEST-PRACTICES.md` |
| Publishing npm | `PUBLISHING.md` (racine bunlight) |
| Dependencies audit | `docs/DEPS-AUDIT.md` |
| Troubleshooting | `docs/TROUBLESHOOTING.md` + `.claude/skills/bunlight/references/troubleshooting.md` |

---

## Docs index

22 fichiers dans `docs/` :

- `PROFILES.md` — decision tree des 5 profiles
- `BENCHMARKS.md` — methodologie + resultats mesures
- `BUN-NATIVE-AUDIT.md` — migration node:* -> Bun-native
- `CRAWLEE-PATTERNS.md` — 12 patterns Crawlee implementes
- `CURL-IMPERSONATE.md` — 34 profiles TLS supportes
- `FRAMEWORK-DETECTION.md` — wappalyzergo + suggestStrategy
- `ANTI-BOT-STACK.md` — stack anti-bot 2026
- `CI.md` — GitHub Actions workflows + dependabot
- `DEPS-AUDIT.md` — audit dependances
- `ENQUEUE-LINKS.md` — helper enqueueLinks
- `HAR-RECORDER.md` — recorder/replayer HAR
- `POSTINSTALL.md` — auto-download Lightpanda binary
- `PUBLISHING.md` (racine bunlight) — publication npm @bunmium/bunlight
- `RATE-LIMITING.md` — rate limit par domaine
- `STANDALONE.md` — executable standalone (96.2 MB)
- `STATISTICS.md` — metriques runtime + dashboard
- `TROUBLESHOOTING.md` — erreurs frequentes
- `PHASE1-CDYLIB.md`, `PHASE1-STATUS.md` — historique phase 1
- `PROFILE-FAST-RESULTS.md`, `PROFILE-STEALTH-RESULTS.md`, `PROFILE-MAX-RESULTS.md` — resultats par profile
- `LICENSING.md` — MIT vs AGPL clarification
- `ZIG-DEPS-MAP.md` — map dependances Zig

---

## Points d'attention (bugs connus)

- `StaticDomTransport` non concurrent-safe : > 1 page parallele sur le singleton cause CDP id collisions (fix en cours tache #8 `agent-phase1-static-transport`).
- `bunlight serve` CLI : profile=fast mature, profile=static partiel, stealth/max throw "not implemented in CLI mode".
- Lightpanda n'accepte pas AF_UNIX/socketpair : fallback CDP-WebSocket loopback dans `SocketPairTransport`.
- Chromium/Firefox non installes par defaut : tests stealth/max skippent proprement.
- CapSolver : mock par defaut si `CAPSOLVER_API_KEY` absent.
- curl-impersonate v1.5.6 : profils differents de v1.1 (ex : `safari18_0` pas `safari18`). Voir `docs/CURL-IMPERSONATE.md`.

---

## Roadmap (taches ouvertes)

| # | Tache | Priorite | Status |
|---|---|---|---|
| 1 | Build complet fork Bun + bun:browser E2E | medium | pending |
| 2 | Push agent-browser GitHub + PR upstream | low | pending (blocked by #1) |
| 4 | Showcase HN 1000 URLs crawler | medium | in_progress |
| 5 | impit-client (Apify Rust TLS) vs curl-impersonate | low | in_progress |
| 6 | Stagehand-style AI scraper (LLM selectors) | low | pending |
| 7 | Publication npm 0.1.0-alpha.0 | medium | in_progress |
| 8 | Fix StaticDomTransport race condition | high | in_progress |
| 10 | Marketplace publish claude plugin | low | pending |
| 12 | enqueueLinks helper | low | in_progress |
| 13 | Rate limit per-domain | medium | in_progress |
| 14 | HAR recorder/replayer | low | pending |

Voir `~/bunmium/tasks.json` pour details complets.
