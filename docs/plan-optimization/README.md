# Plan — Optimisation bunlight pour usage maximal dans agent-browser

Décomposition opérationnelle du plan `~/.claude/plans/imperative-spinning-pumpkin.md`. Chaque fichier est un spec auto-suffisant qu'un subagent peut lire pour exécuter sa mission.

## Index

| # | Fichier | Phase | Mission | Agents | Statut |
|---|---|---|---|---|---|
| 00 | [00-context.md](00-context.md) | — | Contexte global, baseline, fichiers critiques | — | ref |
| 01 | [01-phase-0-refactor-dispatcher.md](01-phase-0-refactor-dispatcher.md) | 0 | Refactor switch CDP en domains modulaires | 1 | in_progress |
| 02 | [02-phase-1-coverage-cdp.md](02-phase-1-coverage-cdp.md) | 1 | Overview coverage CDP | — | pending |
| 02a | [02a-cdp-page.md](02a-cdp-page.md) | 1 | Page.* (screenshot, PDF, screencast, dialogs) | 1 | pending |
| 02b | [02b-cdp-dom-a11y.md](02b-cdp-dom-a11y.md) | 1 | DOM.* + Accessibility.* | 1 | pending |
| 02c | [02c-cdp-input.md](02c-cdp-input.md) | 1 | Input.* (mouse/keyboard/touch) | 1 | pending |
| 02d | [02d-cdp-network-fetch-io.md](02d-cdp-network-fetch-io.md) | 1 | Network.* + Fetch.* + IO.* | 1 | pending |
| 02e | [02e-cdp-target-browser-tracing.md](02e-cdp-target-browser-tracing.md) | 1 | Target.* + Browser.* + Tracing.* + Runtime extras | 1 | pending |
| 02f | [02f-cdp-emulation-security.md](02f-cdp-emulation-security.md) | 1 | Emulation.* + Security.* | 1 | pending |
| 03 | [03-phase-1.5-wire-profiles.md](03-phase-1.5-wire-profiles.md) | 1.5 | Wirer stealth/max/http dans CLI serve | 1 | pending |
| 04 | [04-phase-2-performance.md](04-phase-2-performance.md) | 2 | Overview performance | — | pending |
| 04a | [04a-perf-coldstart.md](04a-perf-coldstart.md) | 2 | Cold start <50ms static, <80ms fast | 1 | pending |
| 04b | [04b-perf-memory.md](04b-perf-memory.md) | 2 | RSS daemon idle <30 MB | 1 | pending |
| 04c | [04c-perf-latency-bench.md](04c-perf-latency-bench.md) | 2 | AX cache + bench harness comparatif | 1 | pending |
| 05 | [05-phase-3-stealth-e2e.md](05-phase-3-stealth-e2e.md) | 3 | Overview E2E stealth | — | pending |
| 05a | [05a-e2e-prod-sites.md](05a-e2e-prod-sites.md) | 3 | E2E suite 6 sites prod via agent-browser | 1 | pending |
| 05b | [05b-bunlight-skill-author.md](05b-bunlight-skill-author.md) | 3 | Skill bunlight + auto-escalation | 1 | pending |
| 06 | [06-phase-4-distribution.md](06-phase-4-distribution.md) | 4 | Overview distribution | — | pending |
| 06a | [06a-dist-standalone.md](06a-dist-standalone.md) | 4 | Multi-platform standalone executable | 1 | pending |
| 06b | [06b-dist-install-cmd.md](06b-dist-install-cmd.md) | 4 | bunlight install command + postinstall | 1 | pending |
| 99 | [99-runbook.md](99-runbook.md) | — | Execution runbook + verification | — | ref |
| — | [status.json](status.json) | — | Live status par phase/agent | — | live |

## Workflow d'exécution

```
Phase 0 (1 agent, séquentiel obligatoire ~1h)
  ↓
Phase 1 (6 agents //) + Phase 1.5 (1 agent //) — 7 agents en parallèle ~6h
  ↓
Phase 2 (3 agents //) ~3-4h
  ↓
Phase 3 (2 agents //) + Phase 4 (2 agents //) — 4 agents en parallèle ~3h
```

**Total** : 15 agents, ~10h en série, ~6-7h avec parallélisme massif.

## Conventions

- Chaque agent lit son spec `XX-...md` + `00-context.md` + `~/bunmium/CLAUDE.md` + `~/bunmium/bunlight/CLAUDE.md`.
- Update `status.json` à `in_progress` au démarrage, `completed` ou `blocked` à la fin.
- Update `~/bunmium/tasks.json` (claim, complete, notes).
- Append row dans `~/bunmium/state.md §4` à la fin.

## Contraintes globales (rappel CLAUDE.md)

- **Bun-native obligatoire** : `Bun.file`, `Bun.spawn`, `Bun.serve`, `Bun.$`, `Bun.Cookie`, `Bun.Glob`, `Bun.gunzipSync`, `bun:sqlite`, `bun:ffi`, `bun:test`. Pas de `node:fs`/`node:child_process`/`node:http` sauf justif.
- **TypeScript strict** : pas de `any`, utiliser `unknown` + narrowing.
- **Pas d'emojis** dans code/doc/output. **Pas de double-dash** `--` dans markdown — emdash `—` ou rewrite.
- **Tests** : `bun test`, jamais skip silencieusement (loguer la raison).
- **Git** : commits `feat(area):`/`fix(area):`/`chore:`, pas de `cookies/private`, pas de `--no-verify`.
