# Phase 1 — Coverage CDP

**Statut** : `pending` (bloqué par Phase 0)
**Agents** : 6 en parallèle (`cdp-page`, `cdp-dom-a11y`, `cdp-input`, `cdp-network-fetch-io`, `cdp-target-browser-tracing`, `cdp-emulation-security`)
**Durée estimée** : ~6h en wall-clock parallèle
**Sub-spec par agent** : `02a-`, `02b-`, `02c-`, `02d-`, `02e-`, `02f-`

## Objectif global

Implémenter les ~45 RPC manquantes dans bunlight serve pour que `agent-browser --engine bunlight` fonctionne sur toutes les commandes user-facing (snapshot a11y, find, click, fill, screenshot, network HAR, etc.).

## Pré-requis

Phase 0 terminée : `src/cdp/domains/<X>.ts` × 16 existent, dispatcher refactoré.

## Découpage en 6 agents

| Agent | Domains | Fichiers cibles |
|---|---|---|
| `cdp-page` | Page.* | `src/cdp/domains/Page.ts` |
| `cdp-dom-a11y` | DOM.* + Accessibility.* | `src/cdp/domains/{DOM,Accessibility}.ts` |
| `cdp-input` | Input.* | `src/cdp/domains/Input.ts` |
| `cdp-network-fetch-io` | Network.* + Fetch.* + IO.* | `src/cdp/domains/{Network,Fetch,IO}.ts` |
| `cdp-target-browser-tracing` | Target.* + Browser.* + Tracing.* + Runtime extras | `src/cdp/domains/{Target,Browser,Runtime,Tracing}.ts` |
| `cdp-emulation-security` | Emulation.* + Security.* | `src/cdp/domains/{Emulation,Security}.ts` |

**Aucun overlap de fichiers** entre les 6 agents → vrai parallélisme. Voir sub-specs pour détails par agent.

## Convention par agent

Chaque agent :
1. Lit `00-context.md` + son sub-spec `02X-*.md` + `~/bunmium/CLAUDE.md`.
2. Update `~/bunmium/bunlight/docs/plan-optimization/status.json` → `in_progress`.
3. Implémente les methods dans son fichier scoped uniquement.
4. Ajoute `bunlight/test/cdp/domains/<X>.test.ts` avec tests pour chaque method ajoutée.
5. Vérifie : `cd ~/bunmium/bunlight && bun test test/cdp/` passe.
6. Vérifie : `bun test` global passe sans regression sur les ~344 tests existants.
7. Update `bunlight/docs/CDP-COVERAGE.md` (passe les no en OK pour les RPC qu'il a implémentés en static).
8. Marque sa task tasks.json comme `completed`.
9. Append row dans `~/bunmium/state.md §4`.
10. Update status.json → `completed`.

## Cible globale Phase 1

- Profile **static** : ≥80 methods working (vs 25 avant).
- Profile **fast/stealth/max** : delegation au backend (Lightpanda/patchright/Camoufox) — ne modifie pas le code domain handler, mais l'échec doit retourner CDPError clean.
- Profile **http** : la plupart des methods retournent CDPError « not supported in http profile » avec message clair.
- 0 regression sur les ~344 tests existants.
- ~80 nouveaux tests unitaires CDP (10-15 par agent).

## Tests

```bash
cd ~/bunmium/bunlight
bun test                                  # tout
bun test test/cdp/domains/Page.test.ts    # par agent
bun test test/cdp/                        # toute la suite Phase 1
```
