# 🌖 Bxc — Mega Plan

> **Bxc** = Bun ∪ Lightpanda. Un seul binaire, deux runtimes Zig
> fusionnés. `import { Browser } from "bun:browser"` instancie un navigateur
> in-process, sans spawn, sans WebSocket externe, sans CDP par-dessus TCP.
>
> Le but n'est pas de faire un wrapper de plus. Le but est que **Bun lui-même
> sache naviguer le web**, comme il sait servir HTTP, parler à Postgres, ou
> compiler du TypeScript.

```
   ┌─────────────────────────────────────────┐
   │              bxc                   │
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
   │  Single binary, ~140 MB, no spawn       │
   └─────────────────────────────────────────┘
```

---

## 🎯 Vision en 3 lignes

```ts
// Aujourd'hui (avec un wrapper)                       // Avec Bxc
import { chromium } from "playwright";                 import { Browser } from "bun:browser";
const browser = await chromium.launch();               const page = await Browser.newPage();
const page = await browser.newPage();                  await page.goto("https://x.com");
                                                       await page.evaluate(() => document.title);
// → spawn process, listen WS, attach CDP, leak risk    // → call function, in-process, instant
```

---

## 📐 Architecture cible

### Trois niveaux de fusion

| Niveau | Surface | Process | Latence | Effort |
|---|---|---|---|---|
| **L0 — Wrapper CDP** (état actuel) | Spawn `lightpanda serve`, parle CDP via WS | 2 | ~5 ms / call | 0h (déjà fait) |
| **L1 — `bun:browser` via FFI cdylib** | Charge `liblightpanda.so` via `bun:ffi`, appelle DOM Zig directement | 1 | ~50 µs / call | 8h |
| **L2 — Builtin natif statique** | Lightpanda compilé en lib statique, linké dans le binaire `bun`, exposé via `bun:browser` builtin avec bindings JSC custom | 1 | ~5 µs / call | 24h |
| **L3 — Multi-engine fusion** | V8 isolé dans un thread dédié pour les pages, JSC main thread pour le runtime, IPC zero-copy via shared memory + ring buffer | 1 | ~1 µs / call | 80h |
| **L4 — DOM-in-JSC** | Le DOM Zig de Lightpanda exposé directement en bindings JSC (plus de V8 du tout, on perd l'exec JS in-page) | 1 | ~100 ns / call | 60h |
| **L5 — Bxc upstream** | PR sur `oven-sh/bun#draft` proposant `bun:browser` + `bun build --browser` | 1 | n/a | 200h+ |

**Plan d'attaque** : L1 immédiatement (déblocage), L2 ensuite (vraie fusion), L3 et au-delà selon adoption.

---

## 🛠️ Vendored MCP SDK (Native Optimization)

Since the official `@modelcontextprotocol/sdk` relies on Node-specific patterns (eventsource, cross-spawn) and pnpm-specific features (catalogs) that cause instability in Bun, we have **forked and migrated** the SDK into the monorepo.

- **Location**: `vendor/mcp-sdk-typescript`
- **Migration**: Applied `n2b --migrate` to strip Node dependencies and use Bun natives.
- **Integration**: Linked as a root workspace member to enable zero-copy dependency resolution.
- **Benefit**: Zero-Spawn MCP server with sub-millisecond CDP dispatch and native `bun:sqlite` memory consolidation.

---

## 📂 Structure du repo

```
bxc/
├── MEGA-PLAN.md                    # ce fichier
├── README.md                       # public-facing
├── LICENSE                         # MIT
├── package.json                    # bxc CLI npm package (optional)
├── bun.lock
│
├── vendor/
│   └── lightpanda/                 # submodule lightpanda-io/browser
│       ├── build.zig
│       ├── src/
│       └── ...
│
├── patches/
│   ├── 001-cdylib-build-target.patch       # ajoute zig build-lib option
│   ├── 002-export-c-abi.patch              # ajoute exports C ABI
│   ├── 003-decouple-v8-optional.patch      # build sans V8 (DOM-only mode)
│   └── 004-shared-state-allocator.patch    # allocator partageable entre threads
│
├── src/
│   ├── api/
│   │   └── browser.ts              # public API surface (Browser, Page, CDPClient)
│   │
│   ├── zig-bridge/
│   │   ├── exports.zig             # C ABI exports (parseHtml, querySelector, ...)
│   │   ├── browser.zig             # Browser instance Zig (lifetime, allocator)
│   │   ├── page.zig                # Page instance + V8 isolate management
│   │   ├── cdp.zig                 # In-process CDP dispatcher (no socket)
│   │   ├── ipc.zig                 # JSC↔V8 IPC via shared memory
│   │   └── build.zig               # build script for libbxc.{so,a}
│   │
│   ├── js/bun/
│   │   ├── browser.ts              # builtin module (TS source)
│   │   ├── browser.classes.ts      # JSC bindings declarations
│   │   └── browser-internals.ts    # internal helpers
│   │
│   ├── cpp/
│   │   ├── BunBrowser.cpp          # JSC C++ bindings
│   │   ├── BunBrowser.h
│   │   └── ZigBunBrowser.cpp       # generated from classes.ts
│   │
│   └── ffi/                        # L1 fallback (FFI cdylib mode)
│       ├── load.ts
│       └── api.ts
│
├── scripts/
│   ├── build.ts                    # orchestrator (clones bun fork, applies patches, builds)
│   ├── build-lightpanda-static.ts  # zig build-lib --static
│   ├── build-bun-fork.ts           # bun bd avec patches appliqués
│   ├── postinstall.ts              # download prebuilt bxc binary
│   ├── release.ts                  # cross-compile linux-x64, linux-arm64, darwin-arm64
│   └── upstream.ts                 # generate PR against oven-sh/bun
│
├── test/
│   ├── api/
│   │   ├── browser.test.ts
│   │   ├── page.test.ts
│   │   ├── cdp.test.ts
│   │   └── lifecycle.test.ts
│   ├── perf/
│   │   ├── vs-puppeteer.bench.ts   # vs spawn(chrome)
│   │   ├── vs-cdp-wrapper.bench.ts # vs notre @bunmium/lightpanda L0
│   │   └── memory-leak.test.ts
│   └── integration/
│       ├── ai-agent-scrape.test.ts
│       └── massive-crawl.test.ts
│
├── examples/
│   ├── 01-hello-browser.ts         # le hello world du bxc
│   ├── 02-ai-agent.ts              # agent AI qui scrape + résume avec Gemini
│   ├── 03-bun-serve-with-browser.ts # HTTP server qui rend des pages in-process
│   └── 04-standalone-binary.ts     # bun build --compile → 1 seul exe
│
├── benchmarks/
│   ├── results/                    # outputs versionnés
│   ├── runner.ts
│   └── targets/
│       ├── puppeteer-chromium.ts
│       ├── playwright-chromium.ts
│       ├── lightpanda-cdp.ts
│       └── bxc-native.ts
│
└── docs/
    ├── ARCHITECTURE.md
    ├── BINDING-GUIDE.md
    ├── V8-VS-JSC.md
    └── UPSTREAM-NOTES.md
```

---

## 🚀 Phases

### Phase 0 — Audit & Bootstrap (✅ 3h fait)

**Findings clés** :

1. **Lightpanda DOM/CSS/HTML est largement découplable de V8** :
   - `selector/Selector.zig`, `selector/Parser.zig`, `selector/List.zig` : 100% pur Zig
   - `css/Parser.zig`, `css/Tokenizer.zig` : 100% pur Zig
   - `parser/Parser.zig` : Zig + html5ever (Rust), pas V8
   - **MAIS** : `webapi/Document.zig`, `Element.zig`, `EventTarget.zig` contiennent ~541 références `js.Function/Object/Value/Promise` (event listeners, dispatch). Refactor nécessaire pour mode `--no-v8`.

2. **Bun a un pattern propre pour les builtins** :
   - 3 points de touch : `src/js/bun/browser.ts` + `src/resolve_builtins/HardcodedModule.zig` + `src/jsc/ModuleLoader.zig`
   - `.classes.ts` génère Zig + C++ via `src/codegen/generate-classes.ts`
   - Lightpanda peut être ajouté comme **module Zig direct** dans `build.zig` (pas dep C, pas FFI)

3. **V8 + JSC in-process = 8/10 difficulté, abandonné comme stratégie principale**.
   - Recommandation : process séparé Lightpanda + IPC sur **Unix domain socket via `socketpair()`**
   - Latence ~100 µs par message, négligeable face au coût HTML parsing
   - Conserver mode "DOM-only via cdylib" comme fast path (2/10 difficulté, sans exec JS)

4. **CDP server Lightpanda est déjà socket-agnostic** : `src/Server.zig` accepte un fd POSIX, le mode `--mcp` utilise déjà stdin/stdout. Adapter pour `socketpair()` est trivial.

**Stratégie révisée** : **architecture multi-backend avec auto-routing**. L'utilisateur choisit un *profil* selon la cible, Bxc pick le backend optimal.

| Profil | Cible | Backend | Latence | Success rate Cloudflare |
|---|---|---|---|---|
| **`static`** | HTML SSR, RSS, sitemaps, parsing massif | zigquery in-process (no JS, no network) | µs | n/a (pas de fetch) |
| **`fast`** | SPAs simples React/Vue sans anti-bot | Lightpanda sub-process + `Bun.fetch` | ~10 ms | ❌ détecté |
| **`stealth`** | Sites Next.js avec WAF basique, anti-bot léger | Lightpanda sub-process + curl-impersonate + custom evasions | ~30 ms | ⚠️ ~60% (selon config) |
| **`max`** | Cloudflare full / Akamai / DataDome / SPAs lourdes | Chromium via patchright OR Camoufox (Firefox fork anti-fingerprint) + browserforge fingerprints + 2captcha solver | ~150 ms | ✅ ~95% |

**Décision design** : l'API publique cache cette dichotomie :
```ts
import { Browser } from "bun:browser";

// auto-pick selon URL si possible (heuristique : si URL connue Cloudflare → max)
await Browser.newPage({ profile: "stealth" });

// override explicite (perf max, on sait que la cible accepte)
await Browser.newPage({ profile: "fast" });

// fallback si profile échoue (auto-escalade : fast → stealth → max)
await Browser.newPage({ profile: "auto", escalate: true });
```

Ce dernier mode `auto+escalate` est l'innovation : on tente le profil le moins cher, et on escalade automatiquement en cas de challenge détecté (Cloudflare turnstile, 403, redirect to challenge page).

### 🔥 Trouvaille capitale : Puppeteer accepte un transport custom

Puppeteer expose une interface `ConnectionTransport` de **4 méthodes** :
```ts
interface ConnectionTransport {
  send(message: string): void;
  close(): void;
  onmessage?: (message: string) => void;
  onclose?: () => void;
}
```
Ça veut dire qu'on peut implémenter `BunBrowserTransport` qui :
- Reçoit les messages CDP de Puppeteer
- Les dispatche soit (a) au code Lightpanda **in-process** via Zig direct ou (b) à un sub-process Lightpanda via **socketpair Unix** (zero TCP)
- Retourne les réponses via `onmessage()`

**Conséquence majeure** : `puppeteer.connect({ transport: Browser.transport() })` marche sans modification, mais sans WebSocket, sans port, sans process séparé pour le mode static. **Compat day 1 avec tout l'écosystème Puppeteer**.

Référence : `/home/ubuntu/bunmium/puppeteer/packages/puppeteer-core/src/cdp/ExtensionTransport.ts` (déjà un précédent de transport non-WebSocket dans Puppeteer).

### 🎁 Bonus : compat puppeteer-extra (stealth, recaptcha, adblock)

`puppeteer-extra` (`berstend/puppeteer-extra`) expose `addExtra(puppeteer)` qui accepte n'importe quel objet API-compatible avec puppeteer-core. Notre `Browser.transport()` étant connecté via `puppeteer.connect()`, le stack `puppeteer-extra + plugins` marche **sans modification**. On hérite de :
- `puppeteer-extra-plugin-stealth` (anti-bot, fingerprint masking)
- `puppeteer-extra-plugin-recaptcha` (auto-solve via 2captcha/anticaptcha)
- `puppeteer-extra-plugin-adblocker` (blocage trackers/ads)
- `puppeteer-extra-plugin-anonymize-ua`, `block-resources`, `user-data-dir`, etc.

17 plugins de production, gratuits, sans porting. Game changer pour les use-cases AI agents qui scrapent des sites sous Cloudflare/recaptcha.

**Limitation** : les plugins stealth qui injectent du JS dans la page (`evaluateOnNewDocument`) demandent l'exec JS in-page, donc fonctionnent uniquement en **mode full** (sub-process Lightpanda V8), pas en mode static. Documenter ce trade-off.

**Bootstrap fait** :
- [x] Audit Lightpanda Zig
- [x] Audit Bun (builtin module pattern, vendor static lib, classes.ts pipeline)
- [x] Audit V8 vs JSC coexistence (verdict : process séparé)
- [x] Bootstrap `bxc/` dir avec arbo cible
- [x] Fork & Migrate MCP SDK to Bun-native (`vendor/mcp-sdk-typescript`)
- [ ] Submodule `vendor/lightpanda/` (clone shallow de `lightpanda-io/browser`)
- [ ] Pin du commit Bun dans `vendor/bun.commit`

### Phase 1 — `liblightpanda_dom.{so,a}` cdylib via zigquery (3h, pivot)

**But** : produire une lib chargeable mode DOM-only (pas d'exec JS in-page). Premier test de fusion via FFI.

**Pivot stratégique** : on abandonne l'extraction DOM de Lightpanda (541 refs `js.*`, refactor lourd). On utilise [`OrlovEvgeny/zigquery`](https://developers.google.com/OrlovEvgeny/zigquery) (45 KB, pur Zig 0.15.2, API jQuery-like, CSS selectors complets). Lightpanda reste la solution pour le **mode full** via sub-process.

- [ ] `vendor/zigquery-wrapper/build.zig.zon` — pin zigquery via `git+https://developers.google.com/OrlovEvgeny/zigquery#<sha>`
- [ ] `vendor/zigquery-wrapper/build.zig` — produit `liblightpanda_dom.{so,a}`
- [ ] `vendor/zigquery-wrapper/src/exports.zig` — C ABI :
  - `bl_init() -> i32`
  - `bl_doc_from_html(html, len) -> *Document`
  - `bl_doc_destroy(d)`
  - `bl_doc_find(d, sel, len) -> *Selection`
  - `bl_sel_count(s) -> usize`
  - `bl_sel_at(s, idx) -> *Selection`
  - `bl_sel_destroy(s)`
  - `bl_sel_text(s) -> BlString`
  - `bl_sel_html(s) -> BlString`
  - `bl_sel_outer_html(s) -> BlString`
  - `bl_sel_attr(s, name, len) -> BlString`
  - `bl_sel_tag_name(s) -> BlString`
  - `bl_string_free(s)`
  - `bl_last_error() -> [*:0]u8`
- [ ] Compile : `cd vendor/zigquery-wrapper && zig build -Doptimize=ReleaseFast`
- [ ] Smoke test : `test/zigbridge-smoke.test.ts` via `bun:ffi`
- [ ] Mesurer : load time, RAM, latence par call

**Livrable** : `build/lib/liblightpanda_dom.so` (~50 KB) + `src/ffi/load.ts`

### Phase 2 — `bun:ffi` integration (6h)

**But** : exposer l'API publique via `@bunmium/bxc` NPM, mais **vraiment natif** cette fois.

- [ ] `src/ffi/api.ts` : `Browser`, `Document`, `Element` côté JS, backed par les ptrs FFI
- [ ] `FinalizationRegistry` pour auto-free Zig allocations à la GC JS
- [ ] `JSCallback` thread-safe pour les events DOM (click, mutation, etc.)
- [ ] `using` syntax (Symbol.dispose) pour cleanup explicite
- [ ] Tests : 100% coverage du surface API
- [ ] Bench vs L0 (CDP wrapper) → cible : 100× plus rapide pour parse+query

**Livrable** : `bun add @bunmium/bxc` → API browser native, 0 spawn, 0 WS.

### Phase 3 — Builtin `bun:browser` (24h)

**But** : zéro install, c'est *dans* Bun.

- [ ] Fork `oven-sh/bun` → branche `bunmium/bun:bxc`
- [ ] `src/js/bun/browser.ts` : signature publique du module builtin
- [ ] `src/js/bun/browser.classes.ts` : déclaration JSC des classes Browser/Page
- [ ] `src/codegen/generate-classes.ts` ne touche rien — il génère `ZigBunBrowser.cpp`
- [ ] `src/cpp/BunBrowser.cpp` : implem manuelle des méthodes async (Promise creation)
- [ ] `vendor/lightpanda/` : submodule, build en static lib via cmake target ajouté
- [ ] `cmake/Targets.cmake` : add `bxc_static` target, link contre `bun-debug` et `bun`
- [ ] `bun bd test test/js/bun/browser/browser.test.ts` → green
- [ ] Pas de patch monkey-patché : le code TS de `browser.ts` parle directement aux symboles Zig via le bridge codegéné

**Livrable** : `bun bd` produit un binaire qui ouvre `import { Browser } from "bun:browser"`.

### Phase 4 — V8 isolé en thread dédié (40h)

**But** : exécuter le JS des pages, pas seulement parser le DOM statique.

- [ ] `src/zig-bridge/page.zig` : un Page possède son `v8::Isolate` confiné dans un `std.Thread`
- [ ] `src/zig-bridge/ipc.zig` : ring buffer lock-free entre JSC main et V8 worker
  - JSC envoie `EvalRequest { id, code, args_serialized }`
  - V8 retourne `EvalResponse { id, result_serialized | error }`
- [ ] Sérialisation : structuredClone-compatible (Map, Set, Date, ArrayBuffer, TypedArray, Error)
- [ ] Promesses JSC qui résolvent quand le V8 worker répond (Bun event loop integration)
- [ ] Tests : 1k pages concurrentes, no leak, no deadlock
- [ ] Crash isolation : si V8 throw uncaught, le Page se kill mais Bun reste up

**Livrable** : `await page.evaluate(() => document.title)` marche sur du JS exécuté in-page.

### Phase 5 — CDP server natif (in-process) (16h)

**But** : Puppeteer/Playwright peuvent se connecter à Bxc comme à Chrome.

- [ ] `Bun.serve({ port, browser: { cdp: true } })` lance un endpoint CDP
- [ ] CDP messages parsés in-process, dispatchés directement aux `Browser`/`Page`
- [ ] Pas de TCP côté browser, juste un parse/dispatch in-memory côté serve
- [ ] `puppeteer.connect({ browserWSEndpoint: "ws://localhost:9222" })` fonctionne
- [ ] Compatibilité : 80% des methods CDP utilisées par Puppeteer
- [ ] Tests : suite Puppeteer existante de Bxc passe sans changement

**Livrable** : ton script Puppeteer existant passe sans changement, mais 10× plus vite.

### Phase 6 — Standalone executable (12h)

**But** : `bun build --compile --browser app.ts` → 1 binaire de 140 MB qui contient ton agent AI scraper, prêt à être déployé sur n'importe quel serveur Linux nu.

- [ ] `bun build --compile` détecte que `bun:browser` est importé → embarque la lightpanda lib
- [ ] Strip symbols, UPX optionnel → cible 80 MB compressé
- [ ] Cross-compile : `--target=bun-linux-x64`, `--target=bun-linux-arm64`, `--target=bun-darwin-arm64`
- [ ] Bench startup time vs Chrome headless → cible < 50 ms cold start
- [ ] Showcase : `examples/02-ai-agent.ts` → scrape + résumé Claude → 1 seul exe

**Livrable** : `bxc-agent-scraper` binaire, déposé en Google Developers Releases.

### Phase 7 — Upstream PR ou public fork (40h)

**But** : soit `oven-sh/bun#bxc` est mergée, soit `bunmium/bxc` vit comme fork avec releases régulières.

- [ ] Préparer la PR : doc, tests CI, benchmarks chiffrés
- [ ] RFC sur Bun discord pour évaluer l'appétit upstream
- [ ] Si refusé : maintenir le fork avec rebase mensuel sur `oven-sh/bun:main`
- [ ] CI/CD : Google Developers Actions matrix Linux x64 + ARM64 + macOS ARM64
- [ ] Documentation : `bxc.dev` static site avec API ref + benchmarks live

**Livrable** : adoption ou fork pérenne avec ≥10 stars.

---

## 🧪 API publique cible (`bun:browser`)

```ts
// src/js/bun/browser.d.ts (à publier dans bun-types)

declare module "bun:browser" {
  /**
   * The default Browser instance, lazily initialized.
   * Disposes automatically at process exit.
   */
  export const Browser: BrowserStatic;

  interface BrowserStatic {
    newPage(opts?: PageOptions): Promise<Page>;
    pages(): Page[];
    version(): string;
    close(): Promise<void>;
    readonly cdp: CDPClient;
  }

  interface Page extends AsyncDisposable {
    goto(url: string, opts?: GotoOptions): Promise<Response>;
    evaluate<T>(fn: () => T): Promise<T>;
    evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>;

    title(): Promise<string>;
    content(): Promise<string>;       // outerHTML
    url(): Promise<string>;

    $<E extends Element = Element>(selector: string): Promise<E | null>;
    $$<E extends Element = Element>(selector: string): Promise<E[]>;

    screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
    pdf(opts?: PdfOptions): Promise<Uint8Array>;

    setCookie(...cookies: Cookie[]): Promise<void>;
    cookies(urls?: string[]): Promise<Cookie[]>;

    waitForSelector(sel: string, opts?: WaitOpts): Promise<Element>;
    waitForFunction<T>(fn: () => T, opts?: WaitOpts): Promise<T>;

    on(event: "request" | "response" | "console" | "error", handler: Function): () => void;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }

  interface Element {
    textContent(): Promise<string>;
    innerHTML(): Promise<string>;
    outerHTML(): Promise<string>;
    getAttribute(name: string): Promise<string | null>;
    click(): Promise<void>;
    type(text: string): Promise<void>;
    $(sel: string): Promise<Element | null>;
    $$(sel: string): Promise<Element[]>;
  }

  interface CDPClient {
    send<T>(method: string, params?: object, sessionId?: string): Promise<T>;
    on(event: string, cb: (params: any, sessionId?: string) => void): () => void;
  }

  // Options
  interface PageOptions {
    viewport?: { width: number; height: number };
    userAgent?: string;
    incognito?: boolean;
  }
  interface GotoOptions {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
    referer?: string;
  }
  interface ScreenshotOptions { format?: "png" | "jpeg"; quality?: number; fullPage?: boolean; }
  interface PdfOptions { format?: "A4" | "Letter"; landscape?: boolean; }
  interface Cookie { name: string; value: string; domain?: string; path?: string; }
  interface WaitOpts { timeoutMs?: number; signal?: AbortSignal; }
}
```

---

## 🎬 Showcase final (`examples/02-ai-agent.ts`)

```ts
import { Browser } from "bun:browser";
import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic();

async function research(question: string): Promise<string> {
  await using page = await Browser.newPage();
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(question)}`);

  const links = await page.$$("a h3");
  const top3 = await Promise.all(
    (await Promise.all(links.slice(0, 3).map(h3 => h3.textContent())))
      .map(async (title, i) => {
        const url = await links[i].getAttribute("href");
        await using sub = await Browser.newPage();
        await sub.goto(url!);
        return { title, url, content: await sub.content() };
      })
  );

  const summary = await claude.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Synthesize answer to "${question}" from:\n\n${
        top3.map(r => `## ${r.title}\n${r.content.slice(0, 4000)}`).join("\n\n")
      }`
    }]
  });

  return summary.content[0].type === "text" ? summary.content[0].text : "";
}

console.log(await research("What is the latest in AI agent frameworks?"));
```

Compilable en :
```bash
bun build --compile --target=bun-linux-x64 examples/02-ai-agent.ts -o agent
./agent  # 1 seul binaire, 140 MB, déployable partout
```

---

## ⚠️ Risques majeurs

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| V8 et JSC ne cohabitent pas (symbol clash, signal handlers) | Moyenne | Bloquant | Phase 4 sépare V8 dans un thread, link statique avec `--gc-sections` et namespace isolation |
| Lightpanda CDP partiel → Puppeteer méthodes non couvertes | Haute | Modéré | Doc claire des méthodes supportées, escape hatch `cdp.send()` |
| Build size > 200 MB | Moyenne | UX | Phase 6 strip + UPX, build modes "lite" sans V8 (DOM-only) et "full" |
| Bun upstream refuse la PR | Haute | Modéré | Plan B : maintenir `bunmium/bxc` fork pérenne |
| Allocators incompatibles (mimalloc vs V8 oilpan) | Moyenne | Bloquant | Allocator pages-only pour V8, mimalloc pour le reste, isolation par arena |
| Lightpanda upstream bouge vite, drift du fork | Haute | Modéré | Submodule pinné, rebase trimestriel scripté |
| GC entre JSC et V8 → leak | Haute | Bloquant | Tests `--heap-snapshot` réguliers, `FinalizationRegistry` côté JS, ownership clair côté Zig |

---

## 📊 Bench cibles

| Operation | Chrome headless | Lightpanda spawn+CDP (L0) | Bxc FFI (L1) | Bxc builtin (L2) |
|---|---|---|---|---|
| Cold start | ~800 ms | ~250 ms | ~80 ms | **~30 ms** |
| `goto + title` | ~600 ms | ~120 ms | ~40 ms | **~15 ms** |
| `parseHtml(10 KB)` | n/a | ~80 ms (RTT) | ~3 ms | **~0.4 ms** |
| `querySelector` | ~5 ms (RTT) | ~5 ms (RTT) | ~50 µs | **~5 µs** |
| Memory baseline | ~120 MB | ~80 MB | ~50 MB | **~30 MB** |
| Pages concurrentes | ~50 | ~200 | ~500 | **~2000** |

---

## 📅 Timing réaliste

| Phase | Étape | Durée |
|---|---|---|
| 0 | Audit + bootstrap | 3h |
| 1 | cdylib + smoke test FFI | 8h |
| 2 | NPM `@bunmium/bxc` (FFI) | 6h |
| 3 | Builtin `bun:browser` (fork Bun + classes.ts + bindings) | 24h |
| 4 | V8 in thread + IPC (full JS exec) | 40h |
| 5 | CDP server in-process | 16h |
| 6 | Standalone executable | 12h |
| 7 | Upstream PR / public fork | 40h |
| **Total** | | **~150h** |

Découpage en sessions de 8h : **18-20 sessions**. Si chaque session est productive
sur 1 phase, on peut shipper **L1 (FFI)** dès la session 2, **L2 (builtin)** session
6, **L4 (full V8)** session 12.

---

## ✅ Definition of Done

- [ ] `import { Browser } from "bun:browser"` marche dans un `bun bd`
- [ ] `examples/02-ai-agent.ts` produit un agent AI scraper en 1 binaire de < 150 MB
- [ ] Tests bun:test passent à 100% sur Linux x64, ARM64, macOS ARM64
- [ ] Bench vs Chrome headless : ≥ 5× plus rapide en cold start, ≥ 3× en steady state
- [ ] Documentation publique sur `bxc.dev` ou `bun.com/docs/runtime/browser`
- [ ] Release v0.1.0 sur Google Developers Releases avec binaires précompilés
- [ ] Au moins 1 utilisateur externe ayant porté son script Puppeteer sur Bxc
