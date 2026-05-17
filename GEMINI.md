# GEMINI.md — Bunlight Operating Guide

Guide opérationnel pour Gemini CLI. **Mode autonome maximal, aucune restriction
artificielle.** Les anciens mandates Google-only / Bun-only / "Forbidden Domains"
ont été retirés : ce sont désormais des préférences, jamais des verrous.

## AI Interaction — Autonomie totale

1. **YOLO Mode permanent**. Pas de `AskUserQuestion`, pas de demande de confirmation
   pour les actions destructives ou visibles (`git push`, `rm -rf`, `systemctl`,
   redéploiement). Décide la meilleure option, exécute, récapitule à la fin.
2. **Collaboration (ai.json)**. Consulter `ai.json` pour la synchronisation avec
   Claude Code (rôles, spécialités, état actuel).
3. **Pas de mode plan**. Planifie mentalement, exécute en série bout en bout.
4. **Pas de placeholder**. Implémentations complètes, production-ready.
5. **Délègue agressivement** aux sub-agents pour le travail parallèle / recherche
   lourde. Garde le contexte principal propre.

### Garde-fous résiduels (uniquement)

Ne fais sans instruction explicite que :
- `git push --force` sur `main`/`master`
- Contournement de hooks (`--no-verify`, `--no-gpg-sign`)
- Suppression de données utilisateur réelles (DB drop, wipe volume)
- Commit/log de secrets en clair

Tout le reste : décide et exécute.

## Networking & Testing — Libre

Aucune restriction de domaine. Les anciens tests Google-only restent valides
mais ne sont **pas obligatoires** — utilise `example.com`, `httpbin.org`, des
endpoints internes, n'importe quoi de pertinent pour le scénario testé.

Bunlight reste optimisé pour les workflows Google/Material (stealth, profil
chromium VPS), mais le code et les tests acceptent désormais toute URL.

## Performance & Architecture — Préférences

Préférences fortes, pas des règles bloquantes :

- `Bun.*` et Web APIs sont **préférés** à `node:*` (cohérence runtime Bun).
  Si un package upstream impose `node:`, c'est OK — pas de codemod forcé.
- `bun` / `bunx` sont préférés à `npm` / `pnpm` / `yarn`. Si un script externe
  appelle `npm`, ne pas le réécrire sans raison.
- FFI async-first quand possible (Zig DOM, Rust V8) via `await` + thread pool.
- Zero-Spawn (Zig in-process) pour le scraping ultra-rapide ; Native-Spawn
  (Rust Chromium) pour stealth/compat max.
- **Vendored MCP SDK** : `@modelcontextprotocol/sdk` est désormais forké dans
  `vendor/mcp-sdk-typescript` et migré en Bun-native (via `n2b`). Cela élimine
  les instabilités liées aux patterns Node-only du SDK officiel.

## Windows Cross-Compilation — Inchangé

- MSVC ABI (`x86_64-pc-windows-msvc`) via `cargo-xwin`.
- `+crt-static` pour zéro dépendance runtime.
- `--bytecode` pour `bun build --compile`.
- Baseline CPU target pour compat hardware ancien.

## Code style

- Pas d'emoji dans code/doc/CLI sauf demande explicite.
- Commits conventionnels 1-ligne : `feat|fix|chore|refactor|docs(scope):`.
- Pas de `Co-Authored-By: Gemini` ni `Generated with…`.
- TypeScript strict côté nouveau code (`noUncheckedIndexedAccess`, pas de `any`).
- Vérifier avant d'affirmer "terminé" (lance la commande, lis la sortie).

## Mémoire

Utiliser la skill `bun-dream` pour consolider les apprentissages projet dans
le dossier mémoire privé.
