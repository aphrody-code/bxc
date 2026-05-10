# 05a — Agent `e2e-prod-sites`

**Phase** : 3
**Subagent type** : `general-purpose`
**Durée estimée** : 3-4h (élargi : crawl complet de 2 sites)

## Mission

E2E suite qui lance `agent-browser --engine bunlight --profile X` sur **TOUTES les pages** de :
- https://rosegriffon.fr/
- https://azalee.rosegriffon.fr/

Vérifie que chaque page se charge correctement, snapshot non-vide, login state préservé si applicable, et que les 5 profiles bunlight (static, fast, http, stealth, max) tiennent la charge sur ces 2 sites.

C'est le golden path de validation end-to-end : si rosegriffon + azalee passent toutes pages × tous profiles, bunlight est production-ready pour les sites Next.js custom CDN avec auth.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `~/bunmium/agent-browser/cli/src/native/cdp/bunlight.rs` (engine Rust déjà OK)
3. `bunlight/src/utils/sitemap.ts` + `bunlight/src/utils/robots.ts` (parsers existants)
4. `bunlight/test/integration/spa-fast.test.ts` (tests rosegriffon/azalee existants — 2 cas seulement)
5. `bunlight/cookies/private/rosegriffon.fr.json` et `azalee.rosegriffon.fr.json` si présents (login state pour test connecté)

## Scope strict

**Touche** :
- `bunlight/test/e2e/rosegriffon-full-crawl.e2e.test.ts` (à créer — TOUTES pages × 5 profiles)
- `bunlight/test/e2e/azalee-full-crawl.e2e.test.ts` (à créer — idem)
- `bunlight/test/e2e/fixtures/sitemaps/` (caches sitemap.xml pour CI hors-ligne)
- `bunlight/test/e2e/results/<date>-rosegriffon.md` (output table)
- `bunlight/test/e2e/results/<date>-azalee.md` (output table)

**NE TOUCHE PAS** : code source, autres tests integration.

## Pré-requis

1. agent-browser binary installé : `which agent-browser` → si absent, build via `cd ~/bunmium/agent-browser/cli && cargo build --release` puis copier `target/release/agent-browser` dans `~/.local/bin/`.
2. bunlight serve fonctionnel sur les 5 profiles (Phase 1.5 done).
3. Internet access pour hit rosegriffon.fr + azalee.rosegriffon.fr.
4. Sitemaps des 2 sites téléchargeables (si offline, fallback sur cache `test/e2e/fixtures/sitemaps/<host>-<date>.xml`).

## Step 1 — Découvrir TOUTES les pages des 2 sites

Pour chaque site (rosegriffon.fr et azalee.rosegriffon.fr) :

1. Tenter `GET https://<site>/sitemap.xml` puis `sitemap_index.xml` (récursif).
2. Si pas de sitemap, fallback : crawl BFS depuis `/` via `bunlight/src/helpers/enqueueLinks.ts` avec `sameOrigin: true`, profondeur max 3, max 200 pages.
3. Lire `robots.txt` pour exclure les paths disallowed.
4. Cache la liste finale dans `test/e2e/fixtures/sitemaps/<host>-2026-05-10.json` (array d'URLs).

Helper attendu : `bunlight/test/e2e/discover-pages.ts` qui fait Step 1 et écrit le cache.

```ts
// test/e2e/discover-pages.ts
import { fetchSitemap } from "../../src/utils/sitemap.ts";
import { parseRobots, isAllowed } from "../../src/utils/robots.ts";

export async function discoverPages(origin: string): Promise<string[]> {
  const robots = await parseRobots(origin);
  let urls: string[] = [];

  // Try sitemap.xml
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/sitemaps.xml"]) {
    try {
      urls = await fetchSitemap(`${origin}${path}`);
      if (urls.length > 0) break;
    } catch {}
  }

  // Fallback: BFS from /
  if (urls.length === 0) {
    urls = await crawlBFS(origin, { maxDepth: 3, maxPages: 200, sameOrigin: true });
  }

  return urls.filter(u => isAllowed(robots, "*", u));
}
```

## Step 2 — Test matrix

Pour chaque site × chaque profile × chaque page :

```ts
// test/e2e/rosegriffon-full-crawl.e2e.test.ts
import { test, expect, beforeAll } from "bun:test";
import { spawn } from "bun";
import { discoverPages } from "./discover-pages.ts";

const PROFILES = ["static", "fast", "http", "stealth", "max"] as const;
const ORIGIN = "https://rosegriffon.fr";

let pages: string[] = [];

beforeAll(async () => {
  pages = await discoverPages(ORIGIN);
  console.log(`Discovered ${pages.length} pages on ${ORIGIN}`);
});

for (const profile of PROFILES) {
  test.each(pages)(`[${profile}] ${ORIGIN}/%s`, async (url) => {
    // Skip si binaire profile-spécifique absent
    if (profile === "stealth" && !await chromiumAvailable()) {
      console.log(`SKIP [${profile}] ${url}: Chromium absent`);
      return;
    }
    if (profile === "max" && !await camoufoxAvailable()) {
      console.log(`SKIP [${profile}] ${url}: Camoufox absent`);
      return;
    }

    const r = await runAgentBrowser(["--profile", profile, "open", url]);
    expect(r.exitCode).toBe(0);

    const snap = await runAgentBrowser(["--profile", profile, "snapshot", "-i"]);
    expect(snap.exitCode).toBe(0);
    expect(snap.stdout.length).toBeGreaterThan(50);

    // Verify pas de page d'erreur Cloudflare/CDN
    expect(snap.stdout).not.toMatch(/Just a moment|Checking your browser|403 Forbidden|Cloudflare/i);

    await runAgentBrowser(["close"]);
  }, 30_000);
}
```

Helper `runAgentBrowser` même que avant (spawn `agent-browser --engine bunlight ...`).

## Step 3 — Tests login persistant (cookies/private)

Si `bunlight/cookies/private/rosegriffon.fr.json` existe (cookies login Next.js session) :

```ts
test(`[fast] ${ORIGIN} avec login state`, async () => {
  await runAgentBrowser([
    "--profile", "fast",
    "--cookies", "/home/ubuntu/bunmium/bunlight/cookies/private/rosegriffon.fr.json",
    "open", `${ORIGIN}/dashboard`,  // ou path qui requiert auth
  ]);
  const snap = await runAgentBrowser(["--profile", "fast", "snapshot", "-i"]);
  expect(snap.stdout).toContain("dashboard"); // adapte selon contenu connecté
});
```

Idem pour azalee.

## Step 4 — Output report

À la fin, écrire `test/e2e/results/2026-05-10-rosegriffon.md` :

```markdown
# E2E Crawl Report — rosegriffon.fr

**Date** : 2026-05-10
**Pages discovered** : N
**Total tests** : N × 5 profiles = 5N

## Per-profile summary

| Profile | Pass | Fail | Skip | Avg goto (ms) | Peak RSS (MB) |
|---|---|---|---|---|---|
| static | ... | ... | ... | ... | ... |
| fast | ... | ... | ... | ... | ... |
| http | ... | ... | ... | ... | ... |
| stealth | ... | ... | ... | ... | ... |
| max | ... | ... | ... | ... | ... |

## Failures

| Page | Profile | Error | Snapshot length |
|---|---|---|---|

## Pages list

(toutes les URLs crawled)
```

Idem `test/e2e/results/2026-05-10-azalee.md`.

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/e2e/rosegriffon-full-crawl.e2e.test.ts test/e2e/azalee-full-crawl.e2e.test.ts
```

Pass condition :
- ≥95% des pages pass en profile=fast (Lightpanda) — c'est la cible primaire
- ≥80% des pages pass en profile=static (zigquery, certaines pages SPA dynamiques peuvent fail)
- profile=http : ≥90% pages servent du HTML (curl-impersonate)
- profiles stealth/max : skip si binaires absents, sinon ≥80%

## Done condition

- 2 fichiers test E2E créés (rosegriffon + azalee)
- discover-pages.ts helper créé
- 2 reports markdown produits dans `test/e2e/results/`
- ≥95% pages pass en profile=fast (cible primaire)
- state.md §4
- status.json 05a → `completed`

## Note importante

C'est un test E2E "lourd" — peut prendre 30-60 minutes wall-clock selon le nb de pages × nb profiles. Si > 50 pages par site, sample-down à 30 pages représentatives (home, listing, détail produit, blog, page CGU/contact) plutôt que crawler tout. L'agent décide selon ce qu'il découvre.
