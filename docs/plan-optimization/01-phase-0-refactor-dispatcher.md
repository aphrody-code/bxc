# Phase 0 — Refactor CDP dispatcher en domains modulaires

**Statut** : `in_progress` (agent dispatché 2026-05-10, voir `status.json`)
**Agents** : 1 — `cdp-dispatcher-refactor` (`typescript-pro`)
**Durée estimée** : ~1h
**Bloque** : Phase 1 (les 6 agents Phase 1 se marchent dessus sans le refactor)

## Mission

Refactor le switch monolithique CDP dispatcher de bunlight en 16 fichiers modulaires par domain. Sans aucune regression.

## Pourquoi maintenant ?

Le dispatcher actuel est un `switch (method)` de ~395 lignes dans `src/transport/StaticDomTransport.ts:377-771`. Si 6 agents Phase 1 ajoutent chacun ~10 cases, ils créent 6 conflits de merge sur le même switch. Le refactor préalable casse ce risque.

## Read-first

1. `~/bunmium/CLAUDE.md` (workspace global)
2. `~/bunmium/bunlight/CLAUDE.md` (rules bunlight)
3. `00-context.md` (ce dossier)
4. `~/bunmium/bunlight/src/transport/StaticDomTransport.ts` (l'objet du refactor)

## Scope strict

**Touche uniquement** :
- `bunlight/src/transport/StaticDomTransport.ts` (refactor)
- `bunlight/src/cdp/types.ts` (création)
- `bunlight/src/cdp/domains/*.ts` × 16 (création)
- `bunlight/docs/CDP-COVERAGE.md` (création)
- Tests existants : ne pas modifier sauf si absolument nécessaire pour adapter à la nouvelle structure (préférer adapter le wrapper plutôt que les tests).

**NE TOUCHE PAS** :
- `src/cli/serve.ts` (Phase 1.5)
- `src/api/browser.ts`
- `src/profiles/*`
- `src/transport/SocketPairTransport.ts`
- `src/transport/InProcessTransport.ts` (sauf si l'interface `CDPHandler` doit y être déplacée)

## Livrables précis

### 1. `bunlight/src/cdp/types.ts`

```ts
import type { InProcessTransport } from "../transport/InProcessTransport.ts";

export interface DispatchContext {
  pageBySession(sessionId: string): PageState;
  emitEvent(event: { method: string; sessionId: string; params: unknown }): void;
  transport: InProcessTransport;
  // … toute autre dep utilisée par les handlers du switch original
}

export type CDPHandlerResult<T = unknown> = T | null;
//                                              ↑ null = "ce domain ne gère pas, essaie le suivant"

export type DomainHandler = (
  method: string,
  params: unknown,
  ctx: DispatchContext
) => Promise<CDPHandlerResult<unknown>>;

export class CDPError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = "CDPError";
  }
}

export interface PageState {
  sessionId: string;
  frameId: string;
  loaderId: string;
  url: string;
  rawHtml: string;
  // … réutiliser le type existant de StaticDomTransport
}
```

### 2. `bunlight/src/cdp/domains/<X>.ts` × 16

Pour chaque `<X>` ∈ `{Page, Target, Browser, DOM, Runtime, Network, Emulation, Security, Accessibility, Input, Fetch, IO, Tracing, Audits, Performance, Log}` :

```ts
import type { DomainHandler } from "../types.ts";

export const PageHandler: DomainHandler = async (method, params, ctx) => {
  if (!method.startsWith("Page.")) return null;
  switch (method) {
    case "Page.navigate": {
      // … MIGRE le code AS-IS depuis StaticDomTransport.ts:377-771
      const { url } = params as { url: string };
      const page = ctx.pageBySession(/* sessionId */);
      // …
      return { frameId: page.frameId, loaderId };
    }
    // … autres methods Page.*
    default:
      return null; // method commence par Page. mais pas reconnue
  }
};
```

**Règles de migration** :
- Pour les methods déjà implémentées : migre le code AS-IS, sans changement comportemental.
- Pour les domains entièrement absents (Accessibility, Input, Fetch, IO, Tracing, Audits, Performance, Log) : crée le fichier avec un handler qui return `null` pour tout. Sera étoffé en Phase 1.
- Préfixe matching : si le method ne commence pas par `<X>.`, return `null` immédiatement (fast path).

### 3. `bunlight/src/transport/StaticDomTransport.ts` modifié

```ts
import {
  PageHandler, TargetHandler, BrowserHandler, DOMHandler,
  RuntimeHandler, NetworkHandler, EmulationHandler, SecurityHandler,
  AccessibilityHandler, InputHandler, FetchHandler, IOHandler,
  TracingHandler, AuditsHandler, PerformanceHandler, LogHandler,
} from "../cdp/domains/index.ts";

const DOMAIN_HANDLERS = [
  PageHandler, TargetHandler, BrowserHandler, DOMHandler,
  RuntimeHandler, NetworkHandler, EmulationHandler, SecurityHandler,
  AccessibilityHandler, InputHandler, FetchHandler, IOHandler,
  TracingHandler, AuditsHandler, PerformanceHandler, LogHandler,
];

// Dans la classe :
handle: CDPHandler = async (method, params, sessionId) => {
  const ctx: DispatchContext = {
    pageBySession: (sid) => this.#pageBySession(sid),
    emitEvent: (event) => this.#emitEvent(event),
    transport: this,
    // …
  };

  for (const handler of DOMAIN_HANDLERS) {
    const result = await handler(method, params, ctx);
    if (result !== null) return result;
  }

  throw new CDPError(`Method not implemented: "${method}"`, -32601);
};
```

### 4. `bunlight/src/cdp/domains/index.ts` (barrel)

```ts
export { PageHandler } from "./Page.ts";
export { TargetHandler } from "./Target.ts";
// … 16 lignes
```

### 5. `bunlight/docs/CDP-COVERAGE.md`

Matrice 97 RPC × 5 profiles avec status pré-Phase-1.

Format :

```markdown
# CDP Coverage Matrix

Source des 97 RPC : `~/bunmium/bunlight/docs/plan-optimization/00-context.md` section "Côté agent-browser".

| Domain.Method | static | fast | stealth | max | http |
|---|---|---|---|---|---|
| Accessibility.enable | no | deleg | deleg | deleg | no |
| Accessibility.getFullAXTree | no | deleg | deleg | deleg | no |
| Browser.close | OK | deleg | deleg | deleg | no |
| Browser.getVersion | OK | deleg | deleg | deleg | OK |
…
```

Légende :
- OK working
- stub stub no-op (returns {})
- no not implemented (CDPError -32601)
- deleg delegated to underlying transport (Lightpanda/patchright/Camoufox)

### 6. Tests passent identiquement

Avant : `cd /home/ubuntu/bunmium/bunlight && bun test 2>&1 | tail -20` → noter count.
Après refactor : même count, même status.

## Verification

```bash
cd /home/ubuntu/bunmium/bunlight
bun test 2>&1 | tail -20  # même résultat qu'avant
ls src/cdp/domains/ | wc -l  # = 17 (16 domains + index.ts)
wc -l src/cdp/types.ts src/cdp/domains/*.ts  # comparer aux ~395 lignes du switch original
```

## Done condition

- 16 fichiers `src/cdp/domains/<X>.ts` créés
- `src/cdp/types.ts` créé
- `src/cdp/domains/index.ts` (barrel) créé
- `src/transport/StaticDomTransport.ts` switch supprimé, remplacé par boucle sur DOMAIN_HANDLERS
- `docs/CDP-COVERAGE.md` créé (matrice 97 × 5)
- `bun test` : 0 regression (count avant = count après, status avant = status après)
- `~/bunmium/tasks.json` task #3 marquée `completed`
- Append row dans `~/bunmium/state.md §4` :
  ```
  | cdp-dispatcher-refactor | Phase 0 refactor | done — 16 domains, 0 regression |
  ```
- Update `bunlight/docs/plan-optimization/status.json` Phase 0 → `completed`
