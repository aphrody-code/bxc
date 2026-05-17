---
description: Audite et met à jour TOUS les CLAUDE.md du repo selon les recommandations officielles Anthropic. Détecte les divergences avec l'état réel du projet (commands obsolètes, fichiers déplacés, sections manquantes, doublons) et applique des fixes ciblés.
argument-hint: "[scope optionnel : root | packages | all (défaut: all)]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# /sync-claude — audit + update CLAUDE.md selon les guidelines Anthropic

Tu vas faire un audit COMPLET puis appliquer des updates ciblés sur les `CLAUDE.md`
du repo. Scope = `$ARGUMENTS` (défaut `all`).

## Principes officiels Anthropic (à respecter ABSOLUMENT)

Source : https://docs.claude.com/en/docs/claude-code/memory et le blog
"Best practices for Claude Code".

1. **Concise et human-readable** — dense > verbeux. CLAUDE.md fait partie du
   prompt système : chaque ligne coûte des tokens à chaque tour.
2. **Actionable** — toute commande documentée doit être copy-paste ready.
   Pas de "you might want to" ni de "consider running". Verbe à l'impératif.
3. **Project-specific** — pas de best practices génériques (TypeScript strict
   est un détail projet, "use TypeScript correctly" est du bruit).
4. **Non-obvious gotchas first** — ce que le code ne révèle pas en lecture
   directe : ordre de chargement, side-effects, contraintes hardware, etc.
5. **Sections recommandées** (utiliser SEULEMENT celles qui apportent) :
   `Commands` · `Architecture` · `Key Files` · `Code Style` · `Environment` ·
   `Testing` · `Gotchas` · `Workflow`. Pas de remplissage.
6. **DRY via `@path`** — la syntaxe `@GEMINI.md` importe un autre fichier au
   chargement. Préférer ça à la duplication de doc.
7. **Pas de duplication entre niveaux** — CLAUDE.md package ne répète pas
   CLAUDE.md racine. Il ne contient QUE le delta propre au package.

## Étape 1 — Discovery

Trouve tous les CLAUDE.md du projet (exclure `vendor/`, `node_modules/`,
`vendor/mcp-sdk-typescript/`) :

```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/vendor/*/CLAUDE.md" 2>/dev/null
```

Filtre selon `$ARGUMENTS` :
- `root` → seul `./CLAUDE.md`
- `packages` → seuls `./packages/*/CLAUDE.md`
- `all` (défaut) → tout

## Étape 2 — Capture l'état RÉEL du projet

Pour chaque CLAUDE.md à auditer, capture la vérité terrain :

```bash
# scripts dispo (commands à documenter)
jq -r '.scripts | keys[]' package.json  # ou ./packages/X/package.json

# layout réel (sections Architecture / Key Files)
ls -la src/ packages/ scripts/ benchmarks/ 2>/dev/null

# tests et leur point d'entrée
find test -name '*.test.ts' | head -5

# entry points réels (vs stubs)
grep -l "Bun.serve\|\.listen(\|export default" src/*.ts packages/*/src/*.ts 2>/dev/null

# état git pour repérer les fichiers récemment renommés/supprimés
git log --diff-filter=D --name-only --pretty=format: -20 | sort -u
git log --diff-filter=R --name-status -10
```

## Étape 3 — Diff conceptuel CLAUDE.md vs réel

Pour CHAQUE CLAUDE.md, liste explicitement :

### A. Obsolescences à supprimer
- Commands listées qui n'existent plus dans `package.json`
- Fichiers cités qui n'existent plus (résolus via `ls`)
- Imports/modules disparus
- Mandates retirés des `GEMINI.md` / `ai.json` mais encore présents ici
- Sections devenues du bruit (info maintenant évidente, etc.)

### B. Manques à ajouter
- Nouveaux scripts `package.json` non documentés
- Nouveaux dossiers `src/` significatifs sans mention
- Nouveaux pièges découverts récemment (commits récents, fichiers `*.md` annexes)
- Hooks `.claude/settings.json` non listés
- Skills/agents `.claude/` non recensés

### C. Duplications à factoriser
- Sections identiques dans plusieurs CLAUDE.md → extraire dans le parent
- Doc dupliquée avec `GEMINI.md` voisin → remplacer par `@GEMINI.md`

### D. Violations de style
- Phrases verbeuses (>2 lignes pour 1 info) → compacter
- Best practices génériques → supprimer
- "you may want to" / "consider" → impératif

## Étape 4 — Présente le rapport

Format strict, un bloc par fichier :

```
### ./CLAUDE.md
- OBSOLESCENCE : ligne X — `bun run frobnicate` n'existe plus dans package.json
- MANQUE : aucun mention de `.claude/commands/refresh-claude-md.md` ajouté
- DUPLICATION : section "Bun-only mandate" identique à GEMINI.md → remplacer par @
- STYLE : ligne 42 — 4 lignes pour une info qui tient en 1
```

Score qualité après fix prévu : A/B/C/D/F.

## Étape 5 — Apply en autonomie

Mode autonome maximal global → applique direct via `Edit`, PAS de demande de
confirmation. Préserve l'ordre des sections existantes. Privilégie `Edit` ciblé
plutôt que `Write` complet (sauf refonte > 50% du fichier).

Après chaque edit : Re-read seulement si le linter a reformaté (hook
PostToolUse oxlint).

## Étape 6 — Commit

Un seul commit conventionnel, message 1-ligne + body court :

```
docs(claude): refresh CLAUDE.md — sync avec l'état projet

- racine : retire X obsolète, ajoute Y, factorise Z via @GEMINI.md
- packages/A : ajoute commands B, supprime piège C résolu
- ...
```

Vérifie avant d'affirmer "terminé" :
```bash
git diff HEAD~1 -- '**/CLAUDE.md' | wc -l
```

## Contraintes dures (ne JAMAIS faire)

- Ne JAMAIS ajouter une section "Best Practices" générique
- Ne JAMAIS dupliquer info entre CLAUDE.md parent et enfant
- Ne JAMAIS commenter "what" (le code le dit) — seulement "why" non-obvious
- Ne JAMAIS toucher aux CLAUDE.md vendored (`vendor/mcp-sdk-typescript/CLAUDE.md`,
  `vendor/gemma/sources/llama.cpp/CLAUDE.md`) — out of scope
- Ne JAMAIS gonfler un fichier > 80 lignes. Si plus de contenu nécessaire,
  splitter via références (`refs/X.md`) ou pointer vers DEVELOPMENT.md
