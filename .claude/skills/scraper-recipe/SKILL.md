---
name: scraper-recipe
description: Génère un scraper Bxc complet (profil choisi + extraction typée Zod + sortie JSONL). À utiliser quand l'utilisateur demande "scrape X", "extract Y from URL Z", ou veut un nouveau scraper one-shot dans `examples/` ou un sub-package dans `packages/`.
disable-model-invocation: true
---

# Bxc scraper recipe

Quand invoquée via `/scraper-recipe`, cette skill produit un fichier scraper complet à partir des inputs suivants :

- **URL ou pattern d'URL** (obligatoire)
- **Schéma cible** (description naturelle, ex : "titre + prix EUR + stock")
- **Profil souhaité** (optionnel, défaut = `static`)
- **Mode** (one-shot dans `examples/<name>.ts`, ou sub-package dans `packages/<name>/src/`)

## API réelle (0.4.0)

L'API publique est `Browser.newPage()` → `page.*` → `page.close()`. **Il n'existe
pas de `Browser.fetch()` ni `Browser.scrape()`.** La feature LLM-extract a été
supprimée — l'extraction se fait par sélecteurs CSS (`page.$$`) ou Markdown
(`page.markdown()`), puis `Zod.parse()`.

```ts
import { Browser } from "@aphrody/bxc";          // singleton
import { googleSearchRich } from "@aphrody/bxc/google"; // si recherche
```

Surface `page` utile : `goto(url,{timeoutMs})`, `content()` (HTML), `markdown()`
(GFM, fallback JS si cdylib absente), `$(sel)`/`$$(sel)` (handles → `.textContent()`
/`.getAttribute(name)`), `title()`, `screenshot()`, `evaluate(fn)` (profils JS),
`close()`.

## Workflow

1. **Lis le contexte** :
   - `src/api/browser.ts` — `Browser.newPage(opts)` + classe `Page` (API ci-dessus)
   - `src/api/browser.ts` (PageOptions) — profils valides : `static | http | fast | stealth | max`
   - `src/storage/Dataset.ts` — store JSONL interne (`Dataset` non exporté du package : import relatif ou JSONL manuel)

2. **Décide l'extraction** :
   - HTML structuré + sélecteurs CSS suffisent → `page.$$()` + `Zod.parse()`
   - Contenu prose / page entière → `page.markdown()`

3. **Génère le fichier** avec ce template :

```typescript
import { z } from "zod";
import { Browser } from "@aphrody/bxc";

const Schema = z.object({
  // ... champs selon la demande utilisateur
  title: z.string(),
});
type Item = z.infer<typeof Schema>;

async function scrape(url: string): Promise<Item> {
  const page = await Browser.newPage({ profile: "static" }); // static|http|fast|stealth|max
  try {
    await page.goto(url, { timeoutMs: 30_000 });
    const titleEl = await page.$("h1");
    const raw = {
      title: (await titleEl?.textContent()) ?? "",
      // ... autres champs via page.$$/$ ou page.markdown()
    };
    return Schema.parse(raw);
  } finally {
    await page.close();
  }
}

const urls = [/* ... */];
const out = Bun.file("dataset.jsonl").writer();
try {
  for (const url of urls) {
    try {
      const item = await scrape(url);
      out.write(JSON.stringify(item) + "\n");
      console.log(`OK ${url}`);
    } catch (err) {
      console.error(`FAIL ${url}`, err);
    }
  }
} finally {
  await out.end();
  await Browser.close();
}
```

4. **Conventions** :
   - Pas d'emoji, pas de commentaire "what" — seulement "why" si non-obvious
   - `page` toujours dans `try / finally` avec `close()` ; `Browser.close()` à la fin
   - Errors per-URL non-fatales : continue la boucle
   - Profil le moins coûteux d'abord (`static` < `http` < `fast` < `stealth` < `max`)
   - Auth Google : `Browser.newPage({ profile, cookies: "~/.bxc/cookies/google.json" })`

5. **Verify** : après génération, lance `bun run typecheck` et propose `bun <fichier>` pour smoke-test.

## Anti-patterns à refuser

- **Parallélisme naïf** sur `fast` / `stealth` / `max` : 1 process Lightpanda par worker = OOM. Utiliser `PagePool` / `AutoscaledPool` de `src/pool/`.
- **Pas de Zod** : output non typé → bug downstream. Toujours `Schema.parse()`.
- **`Browser.fetch()` / `extractStructured` / `@aphrody/llm-extract`** : n'existent plus. Ne pas les générer.
