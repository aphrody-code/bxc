---
name: scraper-recipe
description: Génère un scraper Bxc complet (profile choisi + extraction Zod typée + Dataset JSONL append). À utiliser quand l'utilisateur demande "scrape X", "extract Y from URL Z", ou veut un nouveau scraper one-shot dans `examples/` ou `src/scrapers/`.
disable-model-invocation: true
---

# Bxc scraper recipe

Quand invoquée via `/scraper-recipe`, cette skill produit un fichier scraper complet à partir des inputs suivants :

- **URL ou pattern d'URL** (obligatoire)
- **Schéma cible** (description naturelle, ex : "titre + prix EUR + stock")
- **Profil souhaité** (optionnel, défaut = `static`)
- **Mode** (one-shot example dans `examples/<name>.ts`, ou production scraper dans `src/scrapers/<name>.ts`)

## Workflow

1. **Lis le contexte** :
   - `src/api/browser.ts` — API `Browser.fetch()` / `Browser.scrape()`
   - `src/profiles/*.ts` — profil cible (vérifier qu'il existe)
   - `src/storage/Dataset.ts` — API JSONL append
   - `packages/llm-extract/src/index.ts` — `extractStructured` quand le schéma est ambigu

2. **Décide static-first vs LLM-extract** :
   - Si selectors CSS suffisent (HTML structuré) → cheerio + Zod parse
   - Si le HTML est sémantique mais variable (fiches produit, articles) → `extractStructured` via Gemma 4

3. **Génère le fichier** avec ce template :

```typescript
import { z } from "zod";
import { Browser } from "@aphrody-code/bxc";
import { Dataset } from "@aphrody-code/bxc";
// Choisis UNE des deux lignes suivantes selon le mode :
// import { extractStructured } from "@aphrody-code/llm-extract";
// import * as cheerio from "cheerio";

const Schema = z.object({
  // ... champs selon la demande utilisateur
});
type Item = z.infer<typeof Schema>;

const dataset = new Dataset<Item>({ name: "<scraper-name>" });

async function scrape(url: string): Promise<Item> {
  const browser = new Browser({ profile: "<profile>" });
  try {
    const html = await browser.fetch(url);
    // Mode A (rule-based) :
    //   const $ = cheerio.load(html);
    //   const raw = { title: $("h1").text(), ... };
    //   return Schema.parse(raw);
    // Mode B (LLM-extract) :
    //   return await extractStructured(html, { schema: Schema });
  } finally {
    await browser.close();
  }
}

const urls = [/* ... */];
for (const url of urls) {
  try {
    const item = await scrape(url);
    await dataset.push(item);
    console.log(`OK ${url}`);
  } catch (err) {
    console.error(`FAIL ${url}`, err);
  }
}
```

4. **Conventions** :
   - Pas d'emoji, pas de commentaire "what" — seulement "why" si non-obvious
   - `Browser` toujours dans `try / finally` avec `close()`
   - Errors per-URL non-fatales : continue la boucle
   - Profil le moins coûteux d'abord (`static` < `fast` < `http` < `stealth` < `max`)

5. **Verify** : après génération, lance `bun typecheck` et propose `bun <fichier> <url-de-test>` pour smoke-test.

## Anti-patterns à refuser

- **Parallélisme naïf** sur `stealth` / `max` : 1 process Chromium par worker = OOM. Utiliser `PagePool` de `src/pool/` à la place.
- **Pas de Zod** : output non typé → bug downstream. Toujours `Schema.parse()`.
- **LLM pour HTML structuré** : si cheerio gagne, ne pas brûler des tokens Gemma.
