# 04c — Agent `perf-latency-bench`

**Phase** : 2
**Subagent type** : `performance-engineer`
**Durée estimée** : 2h

## Mission

(1) Cache AX tree pour `Accessibility.getFullAXTree` <3 ms en static. (2) Créer le bench harness `agent-browser-engine.bench.ts` qui compare chrome, lightpanda, bunlight.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/Accessibility.ts` (créé en Phase 1.02b)
3. `bunlight/benchmarks/runner.ts` (bench existant, modèle)
4. `bunlight/benchmarks/results/2026-05-10.md` (résultats existants)
5. agent-browser CLI : `~/bunmium/agent-browser/cli/target/release/agent-browser --help`

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/Accessibility.ts` (AX cache)
- `bunlight/benchmarks/agent-browser-engine.bench.ts` (à créer)
- `bunlight/benchmarks/results/<date>-engine-comparison.md` (à créer après run)

**NE TOUCHE PAS** : autres CDP domains.

## Tâche 1 — AX cache

`Accessibility.getFullAXTree` est appelée par `agent-browser snapshot` et peut être appelée 10+ fois par session. Le coût zigquery + AX tree builder peut être de 5-20 ms par call. Cache avec invalidation sur navigation.

```ts
// Dans Accessibility.ts
const axCache = new Map<string, { tree: AXNode[]; loaderId: string }>();

export const AccessibilityHandler: DomainHandler = async (method, params, ctx) => {
  if (!method.startsWith("Accessibility.")) return null;

  switch (method) {
    case "Accessibility.getFullAXTree": {
      const { sessionId } = params as { sessionId?: string } & any;
      const page = ctx.pageBySession(sessionId);
      const cached = axCache.get(sessionId);
      if (cached && cached.loaderId === page.loaderId) {
        return { nodes: cached.tree };
      }
      const tree = buildAXTree(page); // expensive
      axCache.set(sessionId, { tree, loaderId: page.loaderId });
      return { nodes: tree };
    }
    // ...
  }
};
```

Invalidation : la cache key inclut `loaderId`. Quand `Page.navigate` se termine, `loaderId` change, donc la cache est implicitement invalidée à la prochaine `getFullAXTree`.

Bonus : cache hit doit rester <0.5 ms. Cache miss target <5 ms (pour des pages HN/Wikipedia size).

## Tâche 2 — Bench harness

`bunlight/benchmarks/agent-browser-engine.bench.ts` :

```ts
import { spawn } from "bun";

const ENGINES = ["chrome", "lightpanda", "bunlight"];
const SCENARIOS = [
  { name: "open-snapshot-close", url: "https://news.ycombinator.com" },
  { name: "open-screenshot", url: "https://example.com" },
  { name: "open-click-snapshot", url: "https://example.com" },
];

const ITERATIONS = 30;

interface Sample {
  engine: string;
  scenario: string;
  coldStartMs: number;
  totalMs: number;
  peakRssMb: number;
}

const samples: Sample[] = [];

for (const engine of ENGINES) {
  for (const scenario of SCENARIOS) {
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = Bun.nanoseconds();
      const proc = spawn({
        cmd: [
          "agent-browser", "--engine", engine,
          "open", scenario.url,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      const coldStart = (Bun.nanoseconds() - t0) / 1e6;

      // Run scenario actions, capture timings
      // ... (snapshot, screenshot, click via additional agent-browser calls)
      // ... (read /proc/<pid>/status for RSS at peak — need separate monitor process)

      const totalMs = (Bun.nanoseconds() - t0) / 1e6;
      samples.push({
        engine, scenario: scenario.name,
        coldStartMs: coldStart,
        totalMs,
        peakRssMb: 0, // measured separately
      });

      // close any persistent daemon
      spawn({ cmd: ["agent-browser", "close"] });
    }
  }
}

// Aggregate p50, p95, mean, stddev per engine × scenario
// Write to benchmarks/results/<today>-engine-comparison.md
```

Bench complet : ~3 min run. Output markdown avec tables comparatives.

## Critère de succès

- AX cache hit <0.5 ms p50, miss <5 ms p50.
- Bench harness produit `benchmarks/results/<date>-engine-comparison.md` montrant :
  - bunlight cold start ≤ Chrome cold start
  - bunlight RSS ≤ Chrome RSS
  - bunlight latency p50 par commande comparable à Chrome (à 20% près)

## Done condition

- AX cache implémenté + tests (`test/cdp/domains/Accessibility.test.ts` ajouts)
- Bench harness commité
- Run de référence commité dans `benchmarks/results/`
- state.md §4
- status.json 04c → `completed`
