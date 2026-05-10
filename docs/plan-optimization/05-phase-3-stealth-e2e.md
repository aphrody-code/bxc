# 05 — Phase 3 — Stealth E2E proof

**Statut** : `pending` (bloqué par Phase 2)
**Agents** : 2 en parallèle (`e2e-prod-sites`, `bunlight-skill-author`)
**Durée estimée** : ~2-3h

## Objectif global

Démontrer que `agent-browser --engine bunlight --profile {stealth,max,http,fast,static}` fonctionne sur les sites prod réels qui défient les bots habituels (Cloudflare, DataDome, Turnstile, JA4 detection).

Produire un skill agent-browser dédié `bunlight` qui apprend aux LLMs à choisir le bon profile et à utiliser `--auto-profile`.

## Sub-agents

- `e2e-prod-sites` (06a) — la suite E2E sur 6 sites cibles
- `bunlight-skill-author` (06b) — le SKILL.md + l'auto-escalation

## Sites cibles

| Cible | Profile | Critère pass |
|---|---|---|
| `news.ycombinator.com` | static | snapshot non-vide en <50 ms |
| `react.dev` | fast | snapshot avec contenu React rendered (h1, code blocks) |
| `rosegriffon.fr` + `azalee.rosegriffon.fr` | fast | login state + 200 response |
| `challonge.com/fr/B_TS5` | stealth | bypass Cloudflare Managed Challenge, 200 |
| `nowsecure.nl` | max | CreepJS score ≤ 30 (non-bot) |
| `tls.peet.ws/api/all` | http | JA4 ressemble à Chrome 144 (`t13d1517h2_8daaf6152771_b1ff8ab2d16f`) |

## Critères de succès Phase 3

- ≥4/6 sites E2E pass via `agent-browser --engine bunlight`
- `bunlight serve --auto-profile` fonctionnel
- Skill `bunlight/.claude/skill-data/bunlight/SKILL.md` complet et triggerwords pertinents
