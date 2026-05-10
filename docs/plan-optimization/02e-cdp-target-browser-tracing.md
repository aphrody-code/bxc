# 02e — Agent `cdp-target-browser-tracing`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 2h

## Mission

Étoffer `Target.*` (1 method manquante + events détachés), `Browser.*` (4 methods + 2 events), `Tracing.*` (rien n'existe — 2 methods + 2 events), Runtime extras (`addBinding` + 2 events) dans `bunlight/src/cdp/domains/{Target,Browser,Runtime,Tracing}.ts`.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/{Target,Browser,Runtime,Tracing}.ts`
3. `bunlight/src/transport/StaticDomTransport.ts` (Target.* methods existantes)

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/{Target,Browser,Runtime,Tracing}.ts`
- `bunlight/test/cdp/domains/{Target,Browser,Runtime,Tracing}.test.ts`
- `bunlight/docs/CDP-COVERAGE.md`

## Methods à implémenter

### Target.* (1 manquante + events)
| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Target.createBrowserContext` | Return new contextId synthétique | Delegate | Return contextId |
| `Target.detachFromTarget` | Cleanup session, emit detachedFromTarget | Delegate | Idem |
| `Target.getTargets` | Return liste des targets actifs | Delegate | Idem |

Events à émettre :
- `Target.detachedFromTarget` — sur close/detach
- `Target.targetInfoChanged` — quand URL change (Page.frameNavigated)

### Browser.* (4 manquantes + events)
| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Browser.getWindowForTarget` | Return windowId synthétique + bounds default {x:0,y:0,width:1280,height:720,windowState:"normal"} | Delegate | Idem |
| `Browser.grantPermissions` | Store permissions in jar (no-op fonctionnel) | Delegate | Store |
| `Browser.setDownloadBehavior` | Store config `downloadPath`, applique sur Page.downloadWillBegin | Delegate | Store |
| `Browser.setContentsSize` | Store viewport, applique au prochain navigate | Delegate | Store |

Events :
- `Browser.downloadProgress` — fire pendant download (state: inProgress, completed, canceled)
- `Browser.downloadWillBegin` — fire avant download (suggestedFilename, url, guid)

### Runtime.* (1 method + 2 events)
| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Runtime.addBinding` | Store binding name (no JS exec en static, donc binding jamais déclenché). En fast/etc : Lightpanda support. | Delegate | Store |

Events :
- `Runtime.consoleAPICalled` — en static : jamais. Fast/etc : forward.
- `Runtime.exceptionThrown` — idem.

### Tracing.* (TOUT à créer)
| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Tracing.start` | Store config + start time | Delegate | No-op |
| `Tracing.end` | Emit final dataCollected + tracingComplete | Delegate | No-op |

Events :
- `Tracing.dataCollected` — en static : fire avec un trace minimal (page navigation events, layout, paint synthétiques) en fin de Tracing.end. Réel CDP envoie en streaming, on fait en batch.
- `Tracing.tracingComplete` — fire à end, params: dataLossOccurred=false.

Tracing en static = niveau "useful enough for agent-browser profiler command" — pas une vraie performance trace, mais un buffer de events synthétiques.

## Tests à créer

`test/cdp/domains/Target.test.ts` (8 tests), `Browser.test.ts` (10 tests), `Runtime.test.ts` (4 tests), `Tracing.test.ts` (6 tests).

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/{Target,Browser,Runtime,Tracing}.test.ts
bun test
```

## Done

- 4 fichiers étoffés
- ~28 tests pass
- CDP-COVERAGE.md mis à jour
- task `completed`
- state.md §4
- status.json 02e → `completed`
