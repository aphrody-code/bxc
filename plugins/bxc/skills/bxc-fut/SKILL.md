---
name: bxc-fut
description: This skill should be used when working on @aphrody/fut — the EA Sports FC Ultimate Team scraper (futbin.com, fut.gg), its Zod schemas, its type-graphql resolver, the extracted SQLite database, or the `bxc fut price|player` CLI. Also covers why FUT tests skip on a fresh clone.
metadata:
  short-description: Scrape and query EA FC Ultimate Team data.
---

# @aphrody/fut

Scraper Ultimate Team (`packages/fut`), publié comme `@aphrody/fut`.

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `scrapeFutBinPrice` | `src/futbin.ts` | Prix courant d'un joueur sur futbin.com |
| `scrapeFutGgPlayer` | `src/futgg.ts` | Fiche joueur complète sur fut.gg |
| `FutPlayerSchema`, `FutPriceSchema` | `src/types.ts` | Validation Zod des deux formes |
| `FutResolver` | `src/graphql/FutResolver.ts` | Requêtes `futPlayers` / `futStatsSummary` (type-graphql) |
| `futDatabaseExists` | `src/graphql/FutResolver.ts` | Dit si l'artefact de crawl est présent |

CLI : `bxc fut price <joueur>` et `bxc fut player <joueur>` (`src/cli/fut.ts`),
avec `--profile static|fast|http|stealth|max`.

## La base est un artefact, pas une fixture

`packages/fut/src/data/fut_extracted_database.sqlite` est **git-ignoré** : il
n'existe pas sur un clone frais. Il se produit avec
`bun packages/fut/src/scripts/recursive_fut_scraper.ts`.

Le resolver l'ouvre en **lecture seule et sans création** (`openFutDatabase`) :
un `new Database(path)` nu la créerait vide, et les requêtes échoueraient plus
tard sur « no such table: players » — un message qui accuse le schéma alors que
le vrai défaut est l'absence de données. Les tests GraphQL se sautent d'eux-mêmes
via `describe.skipIf(!futDatabaseExists())`. Ne pas « réparer » ce skip en
commitant une base : elle pèse et se périme à chaque patch du jeu.

Les connexions se prennent avec `using db = openFutDatabase()` — `using` ferme
sur tous les chemins de sortie, y compris les `throw` de GraphQL.

## Tests

`packages/fut/src/test/` : `api`, `futbin`, `futgg`, `ea-ut` tapent le vrai site
et sont gardés par `SKIP_NETWORK_TESTS` (posée par défaut dans `bun run test`).
Pour les exercer réellement : `bun run test:live`, en sachant qu'ils lancent un
navigateur. Leurs imports vers le cœur remontent **quatre** niveaux
(`../../../../src/api/browser.ts`) — trois est l'erreur classique.

Voir aussi : la skill `bxc-scraper` pour les conventions communes, `bxc-new-scraper`
pour en créer un nouveau.
