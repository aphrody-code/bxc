# 04 — Phase 2 — Performance

**Statut** : `pending` (bloqué par Phase 1 + 1.5 done)
**Agents** : 3 en parallèle (`perf-coldstart`, `perf-memory`, `perf-latency-bench`)
**Durée estimée** : ~3-4h

## Objectif global

Battre Chrome/Lightpanda sur cold start, RSS daemon idle, latency par commande. Établir un bench harness comparatif `chrome | lightpanda | bunlight` reproductible.

## Cibles précises

| Cible | Avant | Après | Comment | Agent |
|---|---|---|---|---|
| Cold start `bunlight serve --profile static` | 2-5 ms (mais boot Bun + serve dominant ~150 ms) | <50 ms wall-clock incl. boot Bun | Lazy-load profiles via `await import()`, port `Bun.serve` bound avant les imports lourds | `perf-coldstart` |
| Cold start `bunlight serve --profile fast` | 120-140 ms | <80 ms | Pre-spawn pool de Lightpanda subprocess en background, drop redundant handshakes | `perf-coldstart` |
| Idle RSS daemon (any profile) | 67-76 MB | <30 MB | Audit imports, jamais charger un profile inutilisé, weak refs sur ZigDoc, GC explicite après navigation | `perf-memory` |
| Latency `DOM.getFullAXTree` profile=static | n/a (pas implémenté) | <3 ms | Cache AX tree par sessionId, invalidation sur Page.frameNavigated | `perf-latency-bench` |
| Latency p50 `Page.navigate` profile=fast | 64 ms | <50 ms | Tuning du proxy WebSocket Lightpanda | `perf-latency-bench` |

## Bench harness

`bunlight/benchmarks/agent-browser-engine.bench.ts` (à créer par `perf-latency-bench`) :
- Lance `agent-browser --engine X` (X ∈ chrome, lightpanda, bunlight) sur les mêmes scénarios :
  - open https://news.ycombinator.com
  - snapshot -i
  - screenshot
  - click @e1
  - close
- Mesure cold start (time depuis spawn jusqu'à premier commande terminée), latency par commande, peak RSS via `/proc/<pid>/status`.
- 50 itérations par engine, calcul p50/p95/mean/stddev.
- Output dans `benchmarks/results/<date>-engine-comparison.md`.

## Critères de succès

- Tous les chiffres ci-dessus atteints (mesurables via le bench harness).
- Bench harness commité avec une run de référence dans `benchmarks/results/`.
- 0 regression fonctionnel : tous tests Phase 1 passent toujours.
