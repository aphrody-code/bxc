# 06 — Phase 4 — Distribution

**Statut** : `pending` (peut démarrer en parallèle de Phase 3)
**Agents** : 2 en parallèle (`dist-standalone`, `dist-install-cmd`)
**Durée estimée** : ~2-3h

## Objectif global

Faire de bunlight un produit installable one-shot sur toutes plateformes. agent-browser doit auto-détecter bunlight installé.

## Sub-agents

- `dist-standalone` (06a) — multi-platform standalone executable
- `dist-install-cmd` (06b) — `bunlight install` command + postinstall download

## Critères de succès

- `dist/standalone/bunlight-{linux-x64,linux-arm64,darwin-x64,darwin-arm64}` produits par `bun run scripts/build-standalone.ts`.
- `npm install -g @bunmium/bunlight` puis `bunlight install` télécharge tous les binaires nécessaires.
- `agent-browser --engine bunlight open https://example.com` marche sur clean install.
- README + CHANGELOG `0.2.0` complets.

## Note importante

Les agents Phase 4 ne dépendent pas du contenu de Phase 3 (skill + auto-escalation), juste du fait que les profiles sont fonctionnels (Phase 1+1.5). Donc ils peuvent paralléliser.
