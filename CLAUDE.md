# CLAUDE.md

Contexte projet identique à `@GEMINI.md` (mêmes règles, mêmes garde-fous,
mêmes préférences code). Lis-le, puis reviens ici pour les ajouts Claude-spec.

## Surface Claude Code (`.claude/`)

| Type | Fichier | Trigger |
|---|---|---|
| Hook PreToolUse | `.claude/settings.json` | Block toute Read/Edit/Write sur `.env*` |
| Hook PostToolUse | `.claude/settings.json` | `oxlint --fix` auto sur `*.ts` à la racine |
| Agent | `.claude/agents/rust-ffi-reviewer.md` | Diffs touchant `rust-bridge/`, `src/rust/`, `src/zig-bridge/`, `src/ffi/` |
| Agent | `.claude/agents/bunlight-scrape-debugger.md` | Scraper bloqué (403/429/captcha/empty) |
| Skill | `.claude/skills/scraper-recipe/SKILL.md` | `/scraper-recipe` — user-only, génère scraper Zod+Dataset |
| Skill | `.claude/skills/gemma-bench/SKILL.md` | `/gemma-bench` — user-only, bench + diff baseline |

## Commands

```bash
bun run build      # rust-bridge cargo + scripts/build-standalone.ts + Windows MSVC
bun run dev        # bun --watch src/serverless/standalone.ts
bun run test       # bun test (58 fichiers test/**)
bun run lint       # oxlint src test examples scripts
bun run format     # biome format --write .
bun run typecheck  # tsc --noEmit (strict)
bun run bench      # bun benchmarks/run-all.ts
bun run clean      # scripts/cleanup.ts
```

Sous-packages : `cd packages/api && bun run dev` (Elysia + Drizzle),
`cd packages/llm-extract && bun run bench` (Gemma 4), voir leur CLAUDE.md.

## Gotchas spécifiques

- **Pas de `.env`** : `.env.example` seul tracké, le hook PreToolUse refuse toute
  ouverture de `.env`. Demander à l'utilisateur de patcher manuellement.
- **FFI async-first** : tout appel natif passe par `await` + thread pool Bun.
  Le sub-agent `rust-ffi-reviewer` audit ce point — l'invoquer proactivement
  sur les diffs FFI.
- **Gemma `-t 8`** : sweet spot mesuré. `-t 12` régresse (bandwidth DRAM).
  La skill `/gemma-bench` détecte les régressions.
- **`bunlight-memory.sqlite`** à la racine + dans `packages/bunlight-extension/`
  ne sont PAS tracked-friendly — laisser non-staged.
