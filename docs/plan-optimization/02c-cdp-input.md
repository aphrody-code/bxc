# 02c — Agent `cdp-input`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 1h

## Mission

Créer `bunlight/src/cdp/domains/Input.ts` avec les 4 methods Input.* totalement absentes aujourd'hui. Critique pour click/fill/type d'agent-browser.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/Input.ts` (Phase 0 stub vide)
3. `bunlight/src/transport/SocketPairTransport.ts` (pour comprendre comment forward au Lightpanda CDP)

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/Input.ts`
- `bunlight/test/cdp/domains/Input.test.ts`
- `bunlight/docs/CDP-COVERAGE.md` (lignes Input.*)

## Methods à implémenter

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Input.dispatchKeyEvent` | CDPError "static profile has no input layer, use fast/stealth/max for keyboard input" | Forward au transport sous-jacent (Lightpanda CDP) | CDPError "no JS in http" |
| `Input.dispatchMouseEvent` | CDPError | Forward | CDPError |
| `Input.dispatchTouchEvent` | CDPError | Forward | CDPError |
| `Input.insertText` | CDPError | Forward | CDPError |

## Pattern delegation pour fast/stealth/max

Le transport sous-jacent (Lightpanda subprocess via `SocketPairTransport`, ou patchright/Camoufox bridge) gère ces RPC nativement. La logique :

```ts
export const InputHandler: DomainHandler = async (method, params, ctx) => {
  if (!method.startsWith("Input.")) return null;

  const profile = ctx.transport.profile; // ou via ctx
  switch (profile) {
    case "static":
      return Promise.reject(new CDPError(
        `Input.${method.split(".")[1]} not available in static profile (no JS engine, no input layer). Use --profile fast or stealth.`,
        -32601
      ));

    case "fast":
    case "stealth":
    case "max":
      // Forward via le transport — devrait déjà fonctionner si le transport bridge bien les CDP messages.
      // Implementation note : le forwarding est géré par le proxy WebSocket dans SocketPairTransport,
      // donc en théorie InputHandler return null pour ces profiles, ce qui fait throw CDPError -32601 dans le dispatcher,
      // sauf que le transport intercepte avant. Vérifier le flow.
      return null; // Le transport proxy va forward directement

    case "http":
      return Promise.reject(new CDPError(
        `Input.${method.split(".")[1]} not supported in http profile (no JS engine).`,
        -32601
      ));

    default:
      return null;
  }
};
```

**Note importante** : si le transport `SocketPairTransport` (fast) intercepte déjà tous les messages CDP avant qu'ils arrivent au dispatcher InProcessTransport, alors InputHandler.return null suffit pour fast/stealth/max. Sinon, il faut explicitement appeler `ctx.transport.proxyToBackend(method, params)`. À vérifier dans le code de Phase 0.

## Tests à créer

`test/cdp/domains/Input.test.ts` :

- `Input.dispatchKeyEvent` en static → throw CDPError -32601 avec message contenant "static profile"
- `Input.dispatchMouseEvent` en static → idem
- `Input.dispatchTouchEvent` en static → idem
- `Input.insertText` en static → idem
- `Input.dispatchKeyEvent` en http → throw CDPError "no JS in http"
- En fast/stealth/max → mock le transport, vérifie que le forward est appelé OU que return null

8 tests.

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/Input.test.ts
bun test
```

## Done

- Input.ts complet (4 methods)
- 8 tests pass
- CDP-COVERAGE.md mis à jour
- task `completed`
- state.md §4
- status.json 02c → `completed`
