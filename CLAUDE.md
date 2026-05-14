# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@aphrody-code/bunlight` — moteur de browser automation production-grade fusionnant **Bun** + **Lightpanda** + **zigquery**. Monorepo Turborepo. Lis `AGENTS.md` à la racine pour les règles code détaillées.

Sous-dossier du monorepo `~/vps` — voir `~/vps/CLAUDE.md` pour le contexte VPS global (commits FR 1 ligne, gitignore `*.md`, Bun obligatoire).

## Mission

Lib JS/TS browser automation combinant : perf Bun (runtime/bundler/test), vitesse Lightpanda (headless ~10× Chrome), TLS curl-impersonate (fingerprint Chrome/FF/Safari), stealth (Camoufox + patchright + CapSolver), DOM ultra-rapide (zigquery cdylib via `bun:ffi`). Cible long terme : `import { Browser } from "bun:browser"` builtin.

## Les 5 profiles

`Browser.newPage({ profile })` route vers un backend. Auto-routing via `src/router/{challenge-detect,framework-strategy}.ts` (consomme `src/detect.ts` Wappalyzer).

| Profile | Backend | Latence | Usage |
|---|---|---|---|
| `static` | zigquery cdylib in-process (`liblightpanda_dom.so`) | ~5ms | HTML statique, DOM-only |
| `fast` | Lightpanda sub-process (CDP) | ~120ms | SPA classiques |
| `http` | curl-impersonate FFI | ~100ms | bypass Cloudflare basic |
| `stealth` | patchright Chromium | ~800ms | CF Managed Challenge |
| `max` | Camoufox FF135 + CapSolver | ~1500ms | Turnstile / reCAPTCHA |

## Commandes

```bash
bun run build          # turbo run build
bun test               # turbo run test (test/ + test/integration/)
bun test:all           # bun test direct (tout l'arbre)
bun run lint           # turbo run lint (oxlint — PAS Biome, cf. piège)
bun run typecheck      # tsc --noEmit
bun run build:cdylib   # recompile liblightpanda_dom.so (zigquery)
bun run build:fork     # build le fork Bun (forks/bun/, long ~30min)
bun run build:exe      # standalone executable
bun run api:dev        # serveur Elysia (cf. packages/api/CLAUDE.md)
bun run bench          # benchmarks/runner.ts
```

## Architecture `src/`

- `api/` — `Browser` singleton + `Page`/`HttpPage` (interface `AnyPage`), `BrowserContext`, `Frame`, `Locator` (auto-waiting, `@semantic:` IA).
- `transport/` — 3 transports CDP : `InProc`, `SocketPair`, `StaticDom`.
- `ffi/` — `curl-impersonate.ts` (TLS fingerprint, lexiforest), `zigquery.ts` (cdylib DOM bindings).
- `profiles/` — 5 backends + `humanize.ts` (Bezier mouse) + `fingerprint.ts`.
- `router/` — auto-routing challenge/framework.
- `pool/` `queue/` `storage/` — concurrence (PagePool, proxy, sessions), `RequestQueue` (`bun:sqlite` state machine), Dataset/KV append-only.
- `captcha/` — CapSolver (mock si pas de `CAPSOLVER_API_KEY`).
- `cookies/` — loader/injector multi-format (Playwright/CDP/Netscape).
- `recorder/` — `TraceRecorder` (Zstd, HAR, DOM).
- `detect.ts` — Wappalyzer via binaire Go `wappalyzergo`.
- `cli/serve.ts` — `bunlight serve --cdp-port N --profile P`.
- Couches transverses : `ai/`, `python/` (bridge FFI `bun_python` + `uv`), `rust/` (rust-bridge), `google/`, `next/`, `mirror/`, `serverless/`, `plugin/`.

Vendor (binaires téléchargés, ne pas committer) : `vendor/zigquery-wrapper/` (cdylib), `vendor/curl-impersonate/`, `vendor/camoufox/`, `vendor/wappalyzergo/`.

## Règles strictes

- **Bun-native obligatoire** : `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`, `Bun.$`, `Bun.Cookie`, `Bun.Glob`, `bun:sqlite`, `bun:ffi`, `bun:test`. PAS de `node:fs`/`node:child_process`/`node:http` sauf justif documentée (ex. `node:zlib.brotliDecompressSync` — pas d'équivalent Bun).
- **TypeScript strict** (`strict: true`), pas de `any`, types exportés.
- **Pas d'emojis** dans code/doc/output. Pas de `--` dans la doc (emdash `—`).
- **Tests** : `bun test` uniquement. Integration → `test/integration/<name>.test.ts`. Skip propre si offline ou binaire absent.
- **Ne jamais committer** : `cookies/private/` (gitignored — `cf_clearance`, sessions), `*.node`/`.so` (binaires), `forks/bun/` et `vendor/*` à ne pas toucher sans raison documentée.
- Commits : `feat(area):` / `fix(area):` / `chore:`.

## Pièges

- **`AGENTS.md` dit "Linting: Biome"** — stale. Le lint réel est `oxlint` (`bun run lint` / `lint:fix`).
- **Pas de vrai socketpair** : Lightpanda n'accepte pas fd/AF_UNIX, Bun n'expose pas `socketpair(2)` → `SocketPairTransport` fallback en CDP-WebSocket loopback.
- **Binaires stealth pas auto-installés** : `bunx patchright install chromium firefox` à la main — les tests `stealth`/`max` skippent proprement sinon.
- **CapSolver mock** par défaut si `CAPSOLVER_API_KEY` absent.
- **curl-impersonate v1.5.6** : noms de profiles différents de v1.1 (`safari18_0` pas `safari18`). Liste valide dans `docs/CURL-IMPERSONATE.md`.
- **CLI `bunlight serve`** : `fast` est le profile le plus mature ; `static` partiel (CDP minimal), `stealth`/`max` throw "not implemented in CLI mode".
- **cdylib zigquery** : `vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so` doit exister avant les tests `static`/zigbridge — `bun run build:cdylib` si absent.

## Docs détaillées (`docs/`)

`PROFILES.md` (decision tree), `CURL-IMPERSONATE.md` (34 profiles TLS), `FRAMEWORK-DETECTION.md`, `CRAWLEE-PATTERNS.md`, `ANTI-BOT-STACK.md`, `BENCHMARKS.md`, `BUN-NATIVE-AUDIT.md`. Skill Claude Code `bunlight` : `Skill("bunlight")` → `references/<topic>.md`.
