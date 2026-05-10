# 02d — Agent `cdp-network-fetch-io`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 2-2.5h (le plus gros agent Phase 1)

## Mission

Implémenter Network.* (8 methods + 4 events), Fetch.* (6 methods + 2 events), IO.* (2 methods) dans `bunlight/src/cdp/domains/{Network,Fetch,IO}.ts`. Critique pour `agent-browser network har`, `agent-browser cookies`, et l'interception de requests.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/{Network,Fetch,IO}.ts` (Phase 0 stubs)
3. `bunlight/src/recorder/HarRecorder.ts` (pour réutiliser logic HAR)
4. `bunlight/src/ffi/curl-impersonate.ts` (pour http profile)

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/{Network,Fetch,IO}.ts`
- `bunlight/test/cdp/domains/{Network,Fetch,IO}.test.ts`
- `bunlight/docs/CDP-COVERAGE.md`
- Si nécessaire : `bunlight/src/cdp/types.ts` pour ajouter `RequestState`, `ResponseState` types.

## Methods Network.* à implémenter

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Network.enable` | return {} (était stub) | Delegate | return {} |
| `Network.clearBrowserCookies` | Clear in-memory cookie jar | Delegate | Clear in-memory |
| `Network.emulateNetworkConditions` | No-op (static profile fait pas de fetch) | Delegate | Apply throttle si possible côté curl-impersonate |
| `Network.getAllCookies` | Return cookie jar contents | Delegate | Return jar |
| `Network.getCookies` | Return cookies filtered par urls param | Delegate | Idem |
| `Network.getResponseBody` | Lookup requestId → body cached pendant le fetch | Delegate | Idem |
| `Network.setCookies` | Add to jar | Delegate | Add to jar |
| `Network.setExtraHTTPHeaders` | Store, applique sur next navigate | Delegate | Idem |

## Events Network.* à émettre

Pendant `Page.navigate` :
- `Network.requestWillBeSent` (avant fetch) — params: requestId, request{url, method, headers}, timestamp
- `Network.responseReceived` (après response headers) — params: requestId, response{status, headers, mimeType}
- `Network.loadingFinished` (après body complet) — params: requestId, encodedDataLength
- `Network.loadingFailed` (sur erreur) — params: requestId, errorText, type

Implementation : wrapper le fetch dans `pageBySession.navigate()` pour émettre les events. En static : 1 request principal, en http : idem mais via curl-impersonate.

## Methods Fetch.* à implémenter

Tous nouveaux (Fetch.* est totalement absent en bunlight aujourd'hui).

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Fetch.enable` | Active interception (store filter patterns) | Delegate | Active |
| `Fetch.disable` | Disable | Delegate | Disable |
| `Fetch.continueRequest` | Resume request avec headers/body éventuellement modifiés | Delegate | Resume |
| `Fetch.failRequest` | Abort avec errorReason | Delegate | Abort |
| `Fetch.fulfillRequest` | Mock response (responseCode, headers, body base64) | Delegate | Mock |
| `Fetch.continueWithAuth` | Auth credentials response | Delegate | Auth |

Events `Fetch.*` :
- `Fetch.requestPaused` — fire quand un request matche les filtres et attend continue/fail/fulfill
- `Fetch.authRequired` — fire sur 401 si Authorization absent

En static : Fetch.* n'a de sens que si on fait un fetch (Page.navigate). Pendant ce fetch, intercepter les filtres et fire requestPaused. Répondre en stockant la promesse de continue/fail/fulfill.

## Methods IO.* à implémenter

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `IO.read` | Lire un stream (utilisé pour `Page.printToPDF` body large) | Delegate | Idem |
| `IO.close` | Close stream handle | Delegate | Idem |

Implem : in-memory map streamHandle → Buffer, read renvoie chunks de 65536 bytes, EOF quand position >= length, close supprime de la map.

## Tests à créer

`test/cdp/domains/Network.test.ts` (15 tests), `Fetch.test.ts` (10 tests), `IO.test.ts` (4 tests).

Couvre : cookie jar opérations, request/response events sur Page.navigate, Fetch interception (mock response, abort), IO read chunks.

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/{Network,Fetch,IO}.test.ts
bun test
```

## Done

- 3 fichiers étoffés
- ~30 nouveaux tests pass
- CDP-COVERAGE.md mis à jour
- task `completed`
- state.md §4
- status.json 02d → `completed`
