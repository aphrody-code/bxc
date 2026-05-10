# CLAUDE.md — Bunlight

Snapshot complet de l'état du projet Bunlight au **2026-05-10**.

> Bunlight = fusion **Bun + Lightpanda + zigquery** — browser automation production-grade en ~50 KB cdylib + sub-process Lightpanda + 5 profiles anti-bot.

---

## 1. Mission

Construire une lib JS/TS browser automation qui combine :
- **Performance Bun** (runtime + bundler + test)
- **Vitesse Lightpanda** (browser headless 10× plus rapide que Chrome headless)
- **Sécurité TLS curl-impersonate** (Chrome/FF/Safari fingerprint)
- **Stealth max** (Camoufox v135 + patchright + CapSolver)
- **DOM ultra-rapide** (zigquery cdylib via `bun:ffi`)

Cible : `import { Browser } from "bun:browser"` — eventually un builtin Bun.

---

## 2. Stack & couches

```
                    ┌──────────────────────────────────────────┐
                    │  Browser API (src/api/browser.ts)        │
                    │  newPage({ profile: ... }) → Page        │
                    └─────────┬────────────────────────────────┘
                              │
        ┌────────────┬────────┼────────┬─────────────┬──────────────┐
        ▼            ▼        ▼        ▼             ▼              ▼
   profile=static  fast    http     stealth        max         (custom)
   zigquery       Light-   curl-    patchright    Camoufox     wired in
   cdylib         panda    impers.  Chromium      Firefox 135  newPage
   (in-proc)      sub-proc FFI      patches       + CapSolver
   <5ms,50KB      ~120ms   ~100ms   ~800ms        ~1500ms
   10% CF         55% CF   55% CF   80% CF        95% CF
```

**Profile auto-routing** via `src/router/challenge-detect.ts` + `src/router/framework-strategy.ts` (consomme `src/detect.ts` Wappalyzer).

---

## 3. Inventaire complet

### Code source `src/` (14 328 lignes TS au total avec tests)
- `api/browser.ts` — Singleton + Page + HttpPage + StealthProfilePage + MaxProfilePage
- `cli/serve.ts` — `bunlight serve --cdp-port N --profile P` (684 lignes)
- `transport/{InProc,SocketPair,StaticDom}Transport.ts` — 3 transports CDP
- `ffi/curl-impersonate.ts` (782) — TLS-fingerprint HTTP client (lexiforest v1.5.6, 34 profiles)
- `ffi/zigquery.ts` (434) — cdylib bindings (`liblightpanda_dom.so`, 1.7 MB)
- `profiles/{static,fast,stealth,max,full}/` — 5 backends
- `profiles/{humanize,fingerprint}.ts` — Bezier mouse, fingerprint generation
- `captcha/capsolver.ts` (332) — Turnstile/reCAPTCHA/hCaptcha solver (mock if no API key)
- `cookies/{cookie-loader,cookie-injector}.ts` — Multi-format (Playwright/CDP/Netscape) → CDP `Network.setCookies` + http profile Cookie header
- `pool/{Page,Auto-scaled,Proxy,Session}Pool.ts` — concurrency dynamique, proxy round-robin/sticky, session jars
- `queue/RequestQueue.ts` — `bun:sqlite` PENDING/LOCKED/DONE/FAILED state machine, dead-letter queue
- `storage/{Dataset,KeyValueStore}.ts` — append-only JSONL via `Bun.file().writer()`, dual-backend KV (sqlite < 64KiB, blob > 64KiB)
- `utils/{sitemap,robots}.ts` — XML parser + RFC 9309 robots.txt
- `detect.ts` — Wappalyzer `wappalyzergo` go binary (3000+ tech)
- `router/{challenge-detect,framework-strategy}.ts` — auto-routing intelligent

### Tests `test/` (11 fichiers)
- `zigbridge-smoke.test.ts` — 8 tests cdylib FFI ✅
- `transport.test.ts` — InProcessTransport
- `integration/spa-fast.test.ts` — 10 tests SPAs (HN, React, Nuxt, Next, Svelte, **rosegriffon.fr**, **azalee.rosegriffon.fr**) ✅
- `integration/curl-impersonate.test.ts` — 13 tests TLS fingerprints + CF basic bypass ✅
- `integration/static-zigquery.test.ts` — 9 tests Wikipedia/GitHub ✅
- `integration/detect.test.ts` — 20 tests Wappalyzer (incl. rosegriffon) ✅
- `integration/cookie-inject-challonge.test.ts` — 12 tests challonge.com auth ✅
- `integration/stealth-cloudflare.test.ts` — 14 pass + 2 skip (Chromium not installed)
- `integration/max-turnstile.test.ts` — 12 pass + 2 skip (Firefox not installed)
- `integration/pool-concurrent.test.ts` — pool 100+ pages
- `integration/crawlee-patterns.test.ts` — 49 tests Crawlee patterns ✅

**Total : ~150+ tests, 0 fail, ~6 skip conditionnels**

### Vendor (binaires externes téléchargés)
- `vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so` (1.7 MB) — DOM cdylib zigquery
- `vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0` (2.5 MB) — TLS fingerprint
- `vendor/camoufox/` — Firefox 135 fork stealth (~30 fichiers, libxul, NSS, omni.ja)
- `vendor/wappalyzergo/wappalyzergo-cli` (Go binary) — framework detection

### Fork Bun (`forks/bun/`)
- Patchs `HardcodedModule.zig` + `ModuleLoader.zig` pour exposer `bun:browser` builtin
- `src/js/bun/browser.ts` (28 KB) — implémentation builtin
- `test/js/bun/browser/browser.test.ts`
- Codegen Bun validé (`ResolvedSourceTag.zig` contient `@"bun:browser" = 512`)
- Build complet pas exécuté (long) mais syntaxe Zig validée
- Commit `a0bf70d` dans le fork

### agent-browser fork (`/home/ubuntu/bunmium/agent-browser/`)
- Engine `bunlight` ajouté (cli/src/native/cdp/bunlight.rs, 983 lignes)
- 30 unit tests + 5 integration tests pass
- `cargo build --release` propre, `cargo fmt`/`clippy` clean
- Branch `feat/bunlight-engine` prête pour PR upstream

### Plugin Claude Code (`.claude-plugin/` + `.claude/`)
- `plugin.json` (marketplace metadata)
- 4 agents : scraper, crawler, debugger, cookie-extractor (+4 en cours par maximizer : test-runner, profile-router, bench-runner, publisher)
- Skill `bunlight/` : SKILL.md + 8 references (api, profiles, detect, cookies, pool, queue, dataset/cookbook, troubleshooting)
- 4 commands slash : init, scrape, crawl, detect (+4 en cours : test, bench, cookie-import, doctor)
- Hooks (en cours par maximizer)
- MCP server `bunlight-mcp` (en cours par maximizer)

### Benchmarks (`benchmarks/`)
- `targets/urls-100.json` — 100 URLs catégorisées (static, spa incl. rosegriffon, cloudflare, turnstile, ecommerce)
- 6 runners : bunlight-static, bunlight-fast, fetch-native, cheerio, jsdom, puppeteer, playwright
- 4 scenarios : static-simple, spa-react, cloudflare-basic, parallel-100
- `results/2026-05-10.{json,md}` — vrais chiffres mesurés

### Docs (`docs/`) — 15 fichiers
- `AGENTS-SKILLS-BEST-PRACTICES.md` (707 lignes, 35 sources GitHub)
- `BENCHMARKS.md` — méthodologie + résultats honnêtes
- `BUN-NATIVE-AUDIT.md` — migration node:* → Bun-native
- `CRAWLEE-PATTERNS.md` — 12 patterns Crawlee, 6 implémentés
- `CURL-IMPERSONATE.md` — 34 profiles supportés
- `FRAMEWORK-DETECTION.md` — wappalyzergo + suggestStrategy
- `PROFILES.md` — decision tree des 4 profiles
- `PROFILE-{FAST,STEALTH,MAX}-RESULTS.md` — résultats par profile
- `ANTI-BOT-STACK.md` — stack 2026 (lexiforest, patchright, camoufox, capsolver)
- `PHASE1-{CDYLIB,STATUS}.md` + `LICENSING.md` + `ZIG-DEPS-MAP.md`

---

## 4. Règles strictes

### Code
- **Bun-native obligatoire** : `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`, `Bun.$`, `Bun.Cookie`, `Bun.Glob`, `Bun.gunzipSync`, `Bun.zstdDecompressSync`, `Bun.password`, `bun:sqlite`, `bun:ffi`, `bun:test`. **PAS de `node:fs`/`node:child_process`/`node:http`** sauf justif (e.g., `node:zlib.brotliDecompressSync` — pas d'équivalent Bun à ce jour).
  - Sources autoritatives : https://bun.com/docs/runtime/bun-apis, https://bun.com/docs/runtime/web-apis, https://bun.com/docs/runtime/globals
- **TypeScript strict** : `strict: true`, pas de `any`, types exportés.
- **Pas d'emojis** dans code, doc, output (rule Anthropic agent-browser).
- **Pas de `--` dashes** dans la doc — emdash `—` ou rewrite.
- **kebab-case** pour CLI flags, file names dans `.claude/`.

### Tests
- `bun test` (jamais jest/vitest).
- Tests integration → `test/integration/<name>.test.ts`.
- Network tests skip si offline (probe https://example.com HEAD).
- Binary-dependent tests skip si binaire absent + log clair.
- **NE JAMAIS commit dans `cookies/private/`** (gitignored, contient cf_clearance/session_production).

### Git
- Commits clairs : `feat(area): subject`, `fix(area): subject`, `chore: ...`.
- **NE JAMAIS toucher** `forks/bun/` (fork upstream Bun) ni `vendor/*` sans raison documentée.

### Performance
- `Bun.write` est atomique (sendfile sur Linux) — préférer à writeFile + rename.
- `Bun.file().writer()` pour append-only logs (`Dataset.ts`).
- `bun:sqlite` avec `using` statements pour cleanup auto.
- Décompression : `Bun.gunzipSync` / `Bun.inflateSync` / `Bun.zstdDecompressSync` (sync, zero alloc) ; brotli → `node:zlib.brotliDecompressSync` (Bun n'expose pas encore).

---

## 5. Comment naviguer le projet

| Tu veux… | Va voir |
|---|---|
| Comprendre l'API publique | `src/api/browser.ts` + `.claude/skills/bunlight/references/api.md` |
| Choisir un profile | `docs/PROFILES.md` + `.claude/skills/bunlight/references/profiles.md` |
| Bypass Cloudflare basic | `docs/CURL-IMPERSONATE.md` (profile `http` chrome131) |
| Bypass CF Managed Challenge | `docs/PROFILE-STEALTH-RESULTS.md` (patchright + browserforge) |
| Bypass Turnstile | `docs/PROFILE-MAX-RESULTS.md` (camoufox + capsolver) |
| Détecter framework site | `src/detect.ts` + `docs/FRAMEWORK-DETECTION.md` |
| Cookies persistants/login | `src/cookies/` + `cookies/private/<domain>.json` |
| Pool 1000+ pages | `src/pool/PagePool.ts` + `src/queue/RequestQueue.ts` |
| Crawler resumable | `src/queue/RequestQueue.ts` (bun:sqlite) |
| Sitemap auto-discovery | `src/utils/sitemap.ts` + `src/utils/robots.ts` |
| Fork Bun + builtin | `forks/bun/BUNLIGHT-PATCHES.md` |
| PR vers agent-browser | `/home/ubuntu/bunmium/agent-browser/PR-DESCRIPTION.md` |
| Best practices plugin | `docs/AGENTS-SKILLS-BEST-PRACTICES.md` |
| Migration node→Bun | `docs/BUN-NATIVE-AUDIT.md` |

---

## 6. Récap chronologique des phases (livrées)

| # | Phase | Status | Livrable clé |
|---|---|---|---|
| 0 | Audit Lightpanda + Bun architecture | ✅ | `MEGA-PLAN.md` |
| 1 | cdylib DOM-only via zigquery | ✅ | `liblightpanda_dom.so` 1.7 MB, 20 symboles C ABI |
| 1.5 | `_into` wrappers BlString FFI | ✅ | 8/8 tests |
| 2 | Browser API + 3 transports | ✅ | `src/api/browser.ts` 509 lignes |
| 3 | Profile fast (Lightpanda sub-process) | ✅ | 5 SPAs scraped, 64-707ms goto |
| 3.5 | Profile http (curl-impersonate FFI) | ✅ | 13/13 tests, JA4 Chrome131 validé |
| 4 | Profile stealth (patchright + browserforge) | ✅ | 14 pass + 2 skip Chromium |
| 5 | Profile max (Camoufox v135 + CapSolver) | ✅ | 12 pass + 2 skip Firefox |
| 6 | Auto-routing + framework detection | ✅ | wappalyzergo Go binary, 20/20 detect tests |
| 7 | Cookie injection multi-format | ✅ | 12/12 challonge.com tests |
| 8 | Brotli decompression fix | ✅ | `node:zlib.brotliDecompressSync` |
| 9 | Crawlee patterns (RequestQueue, Pool, Sitemap, robots, Dataset, KV) | ✅ | 49/49 tests |
| 10 | Migration Bun-native | ✅ | 12 fichiers, 140/140 tests |
| 11 | CLI `bunlight serve --cdp-port` | ✅ | 684 lignes |
| 12 | Fork agent-browser + engine `bunlight` | ✅ | branch `feat/bunlight-engine`, PR-ready |
| 13 | Fork Bun + `bun:browser` builtin | ✅ | codegen validé, build long en attente |
| 14 | Benchmarks 100 URLs × 6 runners | ✅ | `benchmarks/results/2026-05-10.md` |
| 15 | Plugin Claude (agents/skills/commands) | ✅ | 18 fichiers initiaux |
| 16 | Best practices research GitHub | ✅ | `docs/AGENTS-SKILLS-BEST-PRACTICES.md` 707 lignes |

### Plugin Claude — final state
- **8 agents** : scraper, crawler, debugger, cookie-extractor, test-runner, profile-router, bench-runner, publisher
- **8 commands slash** : init, scrape, crawl, detect, test, bench, cookie-import, doctor
- **Skill** : SKILL.md + 10 references (api, browser-basics, profiles, detect, cookies, pool, queue, storage, cookbook, troubleshooting)
- **4 hooks** : pre-bash-bun-native (warn npm/yarn/node), post-write-no-emoji (block emoji in .md), session-start-status, stop-metrics
- **MCP server** : `bunlight-mcp` (Bun-native TS) expose 4 tools : `bunlight_scrape`, `bunlight_detect`, `bunlight_extract_cookies`, `bunlight_pool_run`
- **plugin.json** : semver 0.2.0, SPDX MIT, marketplace-ready, `.claude-plugin/README.md`
- **14 best practices fixes** appliqués (model+color frontmatter, argument-hint, Claude-instructions style, Style B examples)

---

## 7. Cibles de test prod

Tests integration ciblent en priorité :
- **HackerNews**, **React.dev**, **Nuxt.com**, **Next.js**, **Svelte.dev** (SPA classiques)
- **rosegriffon.fr**, **azalee.rosegriffon.fr** (Next.js prod custom CDN)
- **wikipedia.org**, **github.com** (static)
- **nowsecure.nl**, **www.cloudflare.com** (CF basic)
- **challonge.com/fr/B_TS5** (anti-bot + cookies persistants)
- **tls.peet.ws** (JA4 fingerprint validation)

---

## 8. Points d'attention

- **`bunlight serve` CLI** existe (`src/cli/serve.ts`) mais profile=fast est le plus mature ; static partiellement implémenté (CDP minimal), stealth/max throw "not implemented in CLI mode".
- **Pas de socketpair vrai** : Lightpanda n'accepte pas fd / AF_UNIX, Bun n'expose pas `socketpair(2)` → fallback CDP-WebSocket loopback dans `SocketPairTransport`.
- **Camoufox / Patchright Chromium / Firefox** : binaires pas auto-installés (run `bunx patchright install chromium firefox` manuellement) — tests skip proprement.
- **CapSolver** : mock par défaut si `CAPSOLVER_API_KEY` absent — tests passent en mock mode.
- **curl-impersonate v1.5.6** : profiles différents de v1.1 (e.g., `safari18_0` pas `safari18`). Doc `docs/CURL-IMPERSONATE.md` liste les 34 valides.

---

## 9. Roadmap restante (TODO)

- [ ] Build complet du fork Bun (`forks/bun/`) + test E2E `bun:browser` (long, ~30 min)
- [ ] Push `agent-browser` sur GitHub + ouverture PR upstream
- [ ] Publication npm `@bunmium/bunlight` (alpha 0.1.0)
- [ ] Standalone executable `bun build --compile`
- [ ] Webcrawler example complet (1000 URLs avec autoescalation + dedup)
- [ ] Wirer impit-client (Apify Rust TLS) en alternative à curl-impersonate (HTTP/3)
- [ ] Stagehand-style AI scraper (déduit selectors avec LLM)

---

## 10. Pour les agents Claude qui lisent ce fichier

1. **Lis d'abord** `AGENTS.md` à la racine pour les rules code.
2. **Charge le skill** : `Skill("bunlight")` puis va dans `references/<topic>.md`.
3. **Quand tu codes** :
   - Bun-native first (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`, `Bun.$`).
   - TypeScript strict.
   - Pas d'emojis, pas de `--`.
   - Tests `bun test` obligatoires.
4. **Quand tu débugges** : `bunlight-debugger` agent + `references/troubleshooting.md`.
5. **Quand tu scrapes** : `bunlight-scraper` agent + `references/cookbook.md`.
6. **Quand tu publies** : suivre `AGENTS.md` rule "git" (commits structurés).
