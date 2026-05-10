# 04a — Agent `perf-coldstart`

**Phase** : 2
**Subagent type** : `performance-engineer`
**Durée estimée** : 1.5h

## Mission

Réduire le cold start de `bunlight serve` à <50 ms pour static, <80 ms pour fast.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cli/serve.ts` (entry point — c'est ici que tout se joue)
3. `bunlight/src/transport/{StaticDomTransport,SocketPairTransport}.ts`
4. `bunlight/src/profiles/{stealth,max}/index.ts` (NE DOIVENT PAS être chargés en static profile)
5. `bunlight/benchmarks/runner.ts` (bench existant pour mesurer)

## Scope strict

**Touche** :
- `bunlight/src/cli/serve.ts`
- `bunlight/src/profiles/index.ts` (probable barrel à créer/modifier)
- `bunlight/scripts/measure-coldstart.ts` (à créer pour mesurer)

**NE TOUCHE PAS** : `src/cdp/domains/*` (Phase 1), tests CDP.

## Approches concrètes

### 1. Lazy-load des profiles

Aujourd'hui `src/cli/serve.ts` importe probablement tous les profiles top-level. Mauvais pour cold start.

```ts
// AVANT (top-level imports)
import { launch as launchStealth } from "../profiles/stealth/index.ts";
import { launch as launchMax } from "../profiles/max/index.ts";

// APRÈS (dynamic imports)
async function getProfileLauncher(profile: string) {
  switch (profile) {
    case "static": return (await import("../profiles/static/index.ts")).launch;
    case "fast": return (await import("../profiles/fast/index.ts")).launch;
    case "stealth": return (await import("../profiles/stealth/index.ts")).launch;
    case "max": return (await import("../profiles/max/index.ts")).launch;
    case "http": return (await import("../profiles/http/index.ts")).launch;
  }
}
```

Gain : profile=static ne charge plus patchright (~10 MB) ni Camoufox bindings.

### 2. Bind du port avant les imports lourds

```ts
async function main() {
  const args = parseArgs(); // léger
  const port = args.cdpPort;

  // Bind PORT EN PREMIER pour que /json/version soit dispo ASAP
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: handleHttpRequest,
    websocket: {
      open: handleWsOpen,
      message: handleWsMessage,
    },
  });
  console.log(`Listening on ${port}`);

  // Charge le profile APRÈS — les premiers /json/version peuvent être servis avant
  const launch = await getProfileLauncher(args.profile);
  globalTransport = await launch(args);
}
```

Gain : la latence perçue par agent-browser engine Rust (qui poll `/json/version`) tombe.

### 3. Pre-spawn pool Lightpanda (profile=fast)

Pour fast, le bottleneck est le spawn du subprocess Lightpanda + WS handshake. Idée : maintenir un pool de 1-2 Lightpanda subprocess pré-spawnés en background, ready-to-use.

Implementation dans `src/transport/SocketPairTransport.ts` ou helper séparé `src/profiles/fast/pool.ts`.

```ts
class LightpandaPool {
  #ready: Process[] = [];
  preWarm(count = 1) {
    for (let i = 0; i < count; i++) {
      this.#ready.push(this.#spawn());
    }
  }
  async acquire(): Promise<Process> {
    if (this.#ready.length === 0) {
      return this.#spawn();
    }
    const p = this.#ready.shift()!;
    this.preWarm(1); // refill async
    return p;
  }
}
```

Gain attendu : profile=fast cold start descend sous 80 ms.

### 4. Mesure

`scripts/measure-coldstart.ts` :
```ts
for (const profile of ["static", "fast"]) {
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const t0 = Bun.nanoseconds();
    const proc = Bun.spawn({
      cmd: ["bun", "run", "src/cli/serve.ts", "serve", "--cdp-port", "0", "--profile", profile],
      stdout: "pipe",
    });
    // Lire stdout jusqu'au "Listening on <port>"
    const port = await readPortFromStdout(proc);
    // Probe /json/version jusqu'à success
    while (true) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) break;
      } catch {}
    }
    const elapsed = (Bun.nanoseconds() - t0) / 1e6;
    samples.push(elapsed);
    proc.kill();
    await proc.exited;
  }
  const sorted = samples.sort();
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`profile=${profile}: p50=${p50}ms p95=${p95}ms`);
}
```

Critère pass : profile=static p50 <50 ms, profile=fast p50 <80 ms.

## Done condition

- `bun run scripts/measure-coldstart.ts` montre p50<50/80
- `bun test` 0 regression
- Append `~/bunmium/state.md §4`
- status.json 04a → `completed`
