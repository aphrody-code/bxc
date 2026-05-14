# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Package `api` (privé, workspace de `@aphrody-code/bunlight`) — serveur HTTP qui expose la lib Bunlight (browser automation) via **Elysia** (REST + Swagger) et **Type-GraphQL** (GraphQL Yoga), persistance **Drizzle ORM / libsql** SQLite.

Le `CLAUDE.md` parent (`packages/bunlight/CLAUDE.md`) couvre la mission Bunlight, les 5 profiles et les règles code (Bun-native, pas d'emoji). Ne pas dupliquer ici.

## Commandes

| Commande | Usage |
|---|---|
| `bun run api:dev` | Depuis la racine `packages/bunlight` — `bun --watch packages/api/src/index.ts`. |
| `bun run dev` / `start` | Depuis `packages/api/` — watch / prod. |
| `bun run typecheck` | `tsc --noEmit` (le script `build` fait la même chose, pas de bundle). |
| `bun run db:push` | `drizzle-kit push` — sync direct du schéma vers `data/bunlight.sqlite`. |
| `bun run generate:types` | `openapi-typescript` depuis `http://localhost:3000/swagger/json` → `src/types.ts`. **Le serveur doit tourner d'abord.** |

## Architecture

- **Entrée réelle = `src/index.ts`** (Elysia `.listen(PORT ?? 3000)`). Le fichier `index.ts` à la racine du package est un stub `bun init` (`Hello via Bun!`) — ne pas l'utiliser, ne pas le lancer.
- Routes : `GET /` (info), `GET /health`, `POST /api/v1/scrape` (`{ url, profile? }`), `/swagger` (doc), `/graphql` (Yoga).
- `src/graphql/resolvers/ScrapeResolver.ts` — resolver Type-GraphQL (`recentScrapes`, `health`, `scrape`). Le schéma est construit à chaud via `buildSchema({ resolvers: [...] })` dans `src/index.ts`.
- `src/db/BunlightDB.ts` — wrapper Drizzle/libsql. Crée le dossier `data/` au besoin, ouvre `file:<path>`. Path résolu via arg → `BUNLIGHT_DB_PATH` → `data/bunlight.sqlite`.
- `src/db/schema.ts` — tables `scrapes` et `cookieJars` (drizzle sqlite-core).
- La lib Browser est importée en **chemin relatif profond** vers le src racine de bunlight (`../../../src/api/browser.ts` depuis `src/index.ts`). `tsconfig.json` `include` ajoute `../../src` pour le type-check. Ce couplage est volontaire — le package api n'a pas de dépendance npm sur bunlight.

## Pièges

- **`index.ts` racine = stub `bun init`** : entrée réelle dans `src/index.ts`. `README.md` est aussi le README générique `bun init` — stale.
- **`reflect-metadata`** : importé en tête de `src/index.ts` et `ScrapeResolver.ts`. Obligatoire avant tout décorateur Type-GraphQL (`experimentalDecorators` + `emitDecoratorMetadata` dans `tsconfig.json`).
- **`ScrapeResolver` instancie `new BunlightDB()` au chargement du module** → le fichier SQLite est créé dès l'import du resolver, pas au premier appel.
- **`generate:types`** nécessite le serveur up sur `:3000` — sinon `openapi-typescript` échoue à fetch `/swagger/json`.
- `tsconfig.json` : `strict: false` ici (contrairement au reste de bunlight qui est strict). Ne pas s'appuyer sur ça pour du nouveau code — typer proprement.
