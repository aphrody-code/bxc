# 05c — Agent `e2e-challonge` (pivot user 2026-05-10)

**Phase** : 3
**Subagent type** : `typescript-pro`
**Durée estimée** : 2h (création + run 130 probes)

## Pivot user

Le 2026-05-10, le user a redirigé l'objectif Phase 3 E2E :

> "désormais les tests sont dans un usecase primordial : `~/vps/packages/rpb-challonge/`"

Le package `@rose-griffon/challonge` v2.0.0 (workspace `~/vps/`) est le vrai consommateur prod de bunlight. Il scrape Challonge.com via 3 transports :

| Transport rpb-challonge | Implementation actuelle | Mapping bunlight |
|---|---|---|
| `src/scraper.ts` (779 LOC) | puppeteer-extra + StealthPlugin | profile=`stealth` (patchright) ou `max` (Camoufox) |
| `src/transports/curl-impersonate.ts` (499 LOC) | curl-impersonate Chrome 131 subprocess | profile=`http` (FFI same .so) |
| `src/transports/htmlrewriter.ts` (741 LOC) | `Bun.HTMLRewriter` streaming | profile=`static` (zigquery + HTMLRewriter) |

Bunlight doit être validé contre les patterns Challonge réels.

## Mission

Créer une suite E2E qui valide bunlight contre 9 patterns × 5 profiles × 3 slugs/users → 130 probes. Le test démontre quels profiles bunlight sont production-ready pour remplacer chaque transport rpb-challonge.

## Patterns testés

| # | URL pattern | Transport rpb-challonge | Catégorie |
|---|---|---|---|
| 1 | `https://challonge.com/{slug}` | scraper.ts | `tournament-html` |
| 2 | `https://challonge.com/{slug}.json` | reverse.ts (curl) | `bracket-json` |
| 3 | `https://challonge.com/{slug}/module` | htmlrewriter.ts | `module` |
| 4 | `https://challonge.com/{slug}/log` | scraper.ts | `match-log` |
| 5 | `https://challonge.com/{slug}/standings` | scraper.ts | `standings` |
| 6 | `https://challonge.com/{slug}/participants` | scraper.ts | `participants` |
| 7 | `https://challonge.com/users/{username}` | scraper.ts | `user-profile` |
| 8 | `https://challonge.com/fr/users/{username}/tournaments` | scraper.ts | `user-tournaments` |
| 9 | `https://challonge.com/fr/communities/sunafterthereign` | scraper.ts | `community-satr` |

## Slugs réels échantillonnés

- Tournois : `B_TS5` (le + récent), `T_SS1` (demo), `B_TS4`
- Users : `sunafterthereign`, `wild_breakers`

## Profiles bunlight testés

- `static` (zigquery FFI) — pour pages HTML simples
- `fast` (Lightpanda CDP) — pour pages JS-heavy
- `http` (curl-impersonate FFI Chrome 131) — bypass CF basic
- `stealth` (patchright Chromium) — skip si binaire absent
- `max` (Camoufox Firefox 135) — skip si binaire absent

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`
2. `~/vps/packages/rpb-challonge/src/{api,scraper,reverse}.ts`
3. `~/vps/packages/rpb-challonge/src/transports/{curl-impersonate,htmlrewriter}.ts`
4. `~/bunmium/bunlight/test/e2e/helpers.ts` (probe + report writer existants)

## Livrables

1. `~/bunmium/bunlight/test/e2e/challonge-fixtures.ts` (230 LOC)
   - `CHALLONGE_SLUGS`, `CHALLONGE_USERS`, `CHALLONGE_PATTERNS`, `isCloudflareWall()`
2. `~/bunmium/bunlight/test/e2e/challonge-crawl.e2e.test.ts` (697 LOC)
   - 5 `describe` (un par profile) × 1 `test` (matrix sequentielle)
   - Throttle 4s entre requêtes (≤ 15 req/min Challonge)
   - Skip propre stealth/max si Chromium/Firefox absents
   - Report writer auto à `afterAll`
3. `~/bunmium/bunlight/test/e2e/results/<date>-challonge.md`
   - Per-profile summary table
   - Pattern × profile matrix
   - CF wall analysis
   - Recommandations rpb-challonge (transport → profile mapping)
   - Failures non-CF (debug)

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/e2e/challonge-crawl.e2e.test.ts
```

Pass condition : ≥1 profile pass sur chaque pattern OU bloqué proprement par CF wall (constat documenté).

## Done condition

- 2 fichiers créés (fixtures + test)
- 1 report markdown généré dans `test/e2e/results/`
- status.json `phase-3.agents` enrichi avec `e2e-challonge` → completed
- state.md §4 row Vague 10

## Constat clé

Si CF Managed Challenge bloque static/fast/http systématiquement, le test confirme que rpb-challonge a raison d'utiliser puppeteer-extra-stealth (mapping vers profile=stealth/max). Ce n'est PAS un échec — c'est une validation de l'architecture rpb-challonge actuelle, et la preuve que bunlight stealth/max sont les profiles production-ready pour Challonge.
