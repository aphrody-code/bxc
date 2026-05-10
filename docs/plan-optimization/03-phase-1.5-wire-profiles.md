# 03 — Phase 1.5 — Wirer stealth/max/http dans CLI serve

**Statut** : `pending` (peut démarrer en parallèle de Phase 1, après Phase 0)
**Subagent type** : `typescript-pro`
**Durée estimée** : 2-2.5h

## Mission

`src/cli/serve.ts` ligne 27-31 throw « not implemented in CLI mode » pour profiles `stealth` et `max`. Profile `http` n'a pas d'entrée CLI du tout. Wirer les 3.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cli/serve.ts` (l'objet du wiring)
3. `bunlight/src/profiles/stealth/index.ts` (backend patchright existant)
4. `bunlight/src/profiles/max/index.ts` (backend Camoufox existant)
5. `bunlight/src/api/browser.ts` (HttpPage class — backend curl-impersonate)
6. `bunlight/src/transport/SocketPairTransport.ts` (pattern de proxy WebSocket vers backend, pour s'en inspirer)

## Scope strict

**Touche** :
- `bunlight/src/cli/serve.ts` (modifs)
- `bunlight/src/transport/PatchrightProxyTransport.ts` (nouveau, optionnel — pour bridger patchright vers WebSocket bunlight serve)
- `bunlight/src/transport/CamoufoxProxyTransport.ts` (idem pour Camoufox)
- `bunlight/src/transport/HttpProfileTransport.ts` (nouveau — CDP server qui mappe Page.navigate → ImpersonatedClient.fetch + DOM.* via zigquery)
- `bunlight/test/profile-wiring.test.ts` (à créer)

**NE TOUCHE PAS** : `src/cdp/domains/*` (Phase 1), `src/transport/{StaticDomTransport,SocketPairTransport,InProcessTransport}.ts`.

## Wiring profile=stealth

Dans `src/cli/serve.ts`, ligne 27-31, remplacer le throw par :

```ts
case "stealth": {
  const { launch } = await import("../profiles/stealth/index.ts");
  const browser = await launch({ /* options from CLI */ });
  // browser instance patchright a déjà un CDP endpoint via .cdpUrl ou similaire
  const transport = new PatchrightProxyTransport(browser);
  return startServeWithTransport(transport, port, host);
}
```

Création `src/transport/PatchrightProxyTransport.ts` :
- Implémente l'interface `InProcessTransport`
- Bridge tous les CDP messages vers le CDP endpoint patchright (qui lui-même est un Chromium CDP)
- Pattern similar à `SocketPairTransport` mais sur l'URL CDP de patchright (récupéré via `browser.wsEndpoint()` ou équivalent)

## Wiring profile=max

Idem stealth mais avec `src/profiles/max/index.ts` (Camoufox/Firefox via patchright avec executablePath).

```ts
case "max": {
  const { launch } = await import("../profiles/max/index.ts");
  const browser = await launch({ /* options */ });
  const transport = new CamoufoxProxyTransport(browser);
  return startServeWithTransport(transport, port, host);
}
```

Si Camoufox n'est pas installé, exit propre avec message « Camoufox binary not found — run `bunlight install --with-camoufox` ».

## Wiring profile=http

Profile mode dégradé. CDP server qui ne supporte que :
- `Page.navigate` → fetch via `src/ffi/curl-impersonate.ts` `ImpersonatedClient.fetch(url)`
- `DOM.*` → parse la HTML response via zigquery (réutilise `StaticDomTransport.parseHtml`)
- Tous les autres CDP methods → CDPError -32601 « not supported in http profile (HTTP-only, no JS engine, no input layer) »

```ts
case "http": {
  const { ImpersonatedClient } = await import("../ffi/curl-impersonate.ts");
  const client = new ImpersonatedClient({ /* default chrome131 */ });
  const transport = new HttpProfileTransport(client);
  return startServeWithTransport(transport, port, host);
}
```

Création `src/transport/HttpProfileTransport.ts` (~200-300 LOC) :
- Implémente la même interface que `StaticDomTransport`
- Page.navigate → `await client.fetch(url)` → store rawHtml dans page state, parse via zigquery
- DOM.* → délègue à zigquery comme StaticDomTransport
- Autres methods → throw CDPError

## Tests

`bunlight/test/profile-wiring.test.ts` (5 tests, 1 par profile) :

```ts
import { test, expect } from "bun:test";
import { spawn } from "bun";

for (const profile of ["static", "fast", "stealth", "max", "http"]) {
  test(`bunlight serve --profile ${profile} boots and exposes /json/version`, async () => {
    const proc = spawn({
      cmd: ["bun", "run", "src/cli/serve.ts", "serve",
            "--cdp-port", "0", "--profile", profile],
      cwd: "/home/ubuntu/bunmium/bunlight",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for "Listening on port N" log
    const port = await readPortFromOutput(proc);

    // Probe /json/version
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.webSocketDebuggerUrl).toMatch(/^ws:\/\//);

    // Connect WebSocket and send Browser.getVersion
    const ws = new WebSocket(body.webSocketDebuggerUrl);
    await new Promise(resolve => ws.onopen = resolve);
    ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
    const reply = await new Promise<string>(r => ws.onmessage = e => r(e.data));
    const parsed = JSON.parse(reply);
    expect(parsed.id).toBe(1);
    expect(parsed.result?.product).toBeDefined();

    proc.kill();
    await proc.exited;
  });
}
```

Skip stealth/max si patchright/camoufox absent (loguer la raison).

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/profile-wiring.test.ts
bun test  # 0 regression sur les autres tests
# Manuel :
bun run src/cli/serve.ts serve --cdp-port 9222 --profile http &
curl http://127.0.0.1:9222/json/version
kill %1
```

## Done

- 5 profiles boot OK via CLI
- 3 transports proxy créés (Patchright, Camoufox, Http)
- 5 tests profile-wiring pass (ou skip avec raison loguée)
- task tasks.json `wire-profiles` `completed`
- state.md §4
- status.json 03 → `completed`
