# CLAUDE.md — packages/api

Contexte identique à `@GEMINI.md`. Tout ce qui suit s'ajoute / précise pour Claude.

## Rappel critique

- **Entry point réel** : `src/index.ts` (Elysia `.listen(PORT ?? 3000)`).
  `index.ts` à la racine du package est un stub `bun init` — NE PAS lancer.
- **`reflect-metadata`** importé en tête (`src/index.ts`, `ScrapeResolver.ts`) :
  obligatoire avant tout décorateur Type-GraphQL.
- **`ScrapeResolver` instancie `new BunlightDB()` au chargement du module** →
  SQLite créé dès l'import, pas au premier appel.
- **`generate:types`** nécessite le serveur up sur `:3000` (fetch `/swagger/json`).
- **`tsconfig.json`** : `strict: false` ici (exception). Typer proprement quand même.

## Commands

```bash
bun run dev          # bun --watch src/index.ts
bun run start        # prod
bun run build        # tsc --noEmit
bun run typecheck    # idem
bun run db:push      # drizzle-kit push -> data/bunlight.sqlite
bun run generate:types  # openapi-typescript depuis :3000/swagger/json (serveur up)
```

## Couplage volontaire

Browser lib importée en relatif profond : `../../../src/api/browser.ts`
(pas de dépendance npm sur bunlight). `tsconfig.json` `include` ajoute `../../src`.
