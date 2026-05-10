# 99 — Runbook d'exécution

Comment lancer, suivre, vérifier chaque phase.

## Pré-requis

- Bun 1.x installé (`bun --version`)
- `~/bunmium/agent-browser/cli/target/release/agent-browser` build OK
- `~/bunmium/bunlight/` repo clean (`git status`)

## Lancement par phase

### Phase 0 — séquentiel obligatoire

```bash
# Dispatch via Agent tool dans Claude
# subagent_type: typescript-pro
# Lit : ~/bunmium/bunlight/docs/plan-optimization/01-phase-0-refactor-dispatcher.md
# Wait completion (~1h)
```

Critère go-no-go : `cd ~/bunmium/bunlight && bun test` 0 regression. Sinon stop, debug.

### Phase 1 + 1.5 — 7 agents en parallèle

Après Phase 0 done, lancer les 7 dans un seul message :

- `cdp-page` lit `02a-cdp-page.md`
- `cdp-dom-a11y` lit `02b-cdp-dom-a11y.md`
- `cdp-input` lit `02c-cdp-input.md`
- `cdp-network-fetch-io` lit `02d-cdp-network-fetch-io.md`
- `cdp-target-browser-tracing` lit `02e-cdp-target-browser-tracing.md`
- `cdp-emulation-security` lit `02f-cdp-emulation-security.md`
- `wire-profiles` lit `03-phase-1.5-wire-profiles.md`

`run_in_background: true` pour chacun. Attendre les 7 notifications de completion.

### Phase 2 — 3 agents en parallèle

- `perf-coldstart` lit `04a-perf-coldstart.md`
- `perf-memory` lit `04b-perf-memory.md`
- `perf-latency-bench` lit `04c-perf-latency-bench.md`

### Phase 3 + 4 — 4 agents en parallèle

- `e2e-prod-sites` lit `05a-e2e-prod-sites.md`
- `bunlight-skill-author` lit `05b-bunlight-skill-author.md`
- `dist-standalone` lit `06a-dist-standalone.md`
- `dist-install-cmd` lit `06b-dist-install-cmd.md`

## Verification globale après toutes les phases

```bash
cd ~/bunmium/bunlight
bun test                                    # tous tests pass
bun run scripts/measure-coldstart.ts        # cold start <50/80
bun run scripts/measure-rss.ts              # RSS <30/50
bun run benchmarks/agent-browser-engine.bench.ts  # bunlight ≤ Chrome
bun run scripts/build-standalone.ts          # 4 executables produits

# Golden path manuel via agent-browser
~/bunmium/agent-browser/cli/target/release/agent-browser \
  --engine bunlight --profile fast \
  open https://news.ycombinator.com
~/bunmium/agent-browser/cli/target/release/agent-browser snapshot -i
~/bunmium/agent-browser/cli/target/release/agent-browser screenshot /tmp/hn.png
~/bunmium/agent-browser/cli/target/release/agent-browser close
```

## Suivi temps réel

```bash
# Status des agents en background
ls /tmp/claude-1000/-home-ubuntu-bunmium/*/tasks/ 2>/dev/null

# Status des tasks
jq '.tasks[] | "\(.id) | \(.status) | \(.title)"' ~/bunmium/tasks.json

# Status par phase
cat ~/bunmium/bunlight/docs/plan-optimization/status.json | jq .
```

## Rollback

Si une phase casse tout :

```bash
cd ~/bunmium/bunlight
git status                       # voir les modifs
git diff                          # diff des changes
git stash                        # ranger pour debug
bun test                         # re-vérifier état pré-phase
git stash pop                    # restaurer si besoin de re-debug
```

## Resume après crash session

L'état est dans :
- `status.json` (par phase)
- `~/bunmium/tasks.json` (par task)
- git status (les changes commitées par les agents précédents survivent)

Reprendre depuis la dernière phase non-complete via le runbook ci-dessus.
