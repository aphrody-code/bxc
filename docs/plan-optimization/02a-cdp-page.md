# 02a — Agent `cdp-page`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 1.5-2h
**Bloque** : aucun (parallèle aux 5 autres Phase 1 agents + Phase 1.5)
**Bloqué par** : Phase 0

## Mission

Étoffer `bunlight/src/cdp/domains/Page.ts` avec les methods `Page.*` que bunlight n'implémente pas encore et qu'agent-browser appelle.

## Read-first

1. `~/bunmium/CLAUDE.md`
2. `~/bunmium/bunlight/CLAUDE.md`
3. `~/bunmium/bunlight/docs/plan-optimization/00-context.md`
4. `~/bunmium/bunlight/src/cdp/domains/Page.ts` (créé par Phase 0 avec les methods existantes — `navigate`, `getFrameTree` + 8 stubs)
5. `~/bunmium/bunlight/src/cdp/types.ts` (interfaces)
6. `~/bunmium/bunlight/src/transport/StaticDomTransport.ts` (pour comprendre `pageBySession`, `emitEvent`)

## Scope strict

**Touche uniquement** :
- `bunlight/src/cdp/domains/Page.ts`
- `bunlight/test/cdp/domains/Page.test.ts` (à créer)
- `bunlight/docs/CDP-COVERAGE.md` (lignes Page.* uniquement)

**NE TOUCHE PAS** : autres domains, transports, profiles, serve.ts.

## Methods à implémenter

| Method | Profile static | Profile fast/stealth/max | Profile http |
|---|---|---|---|
| `Page.captureScreenshot` | Render HTML → image via headless lib (e.g., satori + resvg) ou retourner CDPError "static profile cannot screenshot, use fast/stealth/max" | Delegate au backend | CDPError "not supported" |
| `Page.printToPDF` | Idem screenshot — render via lib ou CDPError | Delegate | CDPError |
| `Page.reload` | Re-fetch URL, ré-emit lifecycle events | Delegate | Re-fetch via curl-impersonate |
| `Page.setDocumentContent` | Replace `page.rawHtml` + re-parse zigquery | Delegate | Replace HTML buffer |
| `Page.startScreencast` | CDPError "static profile cannot screencast" | Delegate (Page.screencastFrame events) | CDPError |
| `Page.stopScreencast` | No-op si pas démarré, sinon stop | Delegate | No-op |
| `Page.screencastFrameAck` | No-op | Delegate | No-op |
| `Page.removeScriptToEvaluateOnNewDocument` | Tracking par identifier, no-op si absent | Delegate | No-op |

## Events à émettre

Pour les events ci-dessous, déjà partiellement gérés (`Page.frameNavigated`, `Page.lifecycleEvent`), il faut compléter :

- `Page.domContentEventFired` — fire après parsing HTML, sessionId scoped
- `Page.loadEventFired` — fire après tous les sub-resources fetch (en static : juste après domContentEventFired puisqu'il n'y a pas de fetch)
- `Page.javascriptDialogOpening` — pour eval qui trigger alert/confirm/prompt (en static : pas de JS exec, donc jamais émis)
- `Page.javascriptDialogClosed` — idem
- `Page.downloadWillBegin` — quand `Page.navigate` détecte un Content-Disposition: attachment
- `Page.downloadProgress` — fire pendant download
- `Page.screencastFrame` — fire avec base64 frame quand startScreencast actif (en static : jamais)

## Tests à créer

`bunlight/test/cdp/domains/Page.test.ts` :

```ts
import { test, expect } from "bun:test";
import { PageHandler } from "../../../src/cdp/domains/Page.ts";

const mockCtx = {
  pageBySession: (sid) => ({ sessionId: sid, frameId: "f1", url: "...", rawHtml: "..." }),
  emitEvent: (e) => emittedEvents.push(e),
  transport: null,
};

test("Page.captureScreenshot in static profile returns CDPError", async () => {
  // …
});

test("Page.reload re-fetches URL and emits lifecycle", async () => {
  // …
});

// 1 test par method ajoutée + 1 par event qui doit être émis
```

Cible : 12-15 tests pour Page.*.

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/Page.test.ts  # tous pass
bun test                                # 0 regression
```

## Mise à jour CDP-COVERAGE.md

Pour chaque method que tu implémentes en static, passe la ligne `Page.X | no → OK` (ou `stub → OK` si c'était un stub).

## Done condition

- `Page.ts` étoffé avec les 8 methods listées
- 12-15 tests passent
- `bun test` global pass sans regression
- CDP-COVERAGE.md mis à jour pour Page.*
- task tasks.json `cdp-page` (à créer si manque) marquée `completed`
- Append `~/bunmium/state.md §4`
- Update `status.json` 02a → `completed`
