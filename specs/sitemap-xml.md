# sitemap.xml — Sitemaps Protocol 0.9

> Source canonique: https://www.sitemaps.org/protocol.html  
> Co-rédigé par Google, Yahoo!, Microsoft (2008+)  
> Digest fixé: 2026-05-10

## 1. Emplacement

À la racine du site: `/sitemap.xml`. La présence est annoncée:
- Dans `robots.txt` via une directive `Sitemap: https://example.com/sitemap.xml`
- Soumise manuellement via Search Console / Bing Webmaster

Encoding: **UTF-8 obligatoire**. Les caractères réservés XML doivent être échappés (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`).

## 2. Namespace + élément racine

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ...
</urlset>
```

Le namespace `http://www.sitemaps.org/schemas/sitemap/0.9` est obligatoire sur `<urlset>`.

## 3. Élément `<url>`

| Élément | Statut | Format / valeurs |
|---|---|---|
| `<loc>` | requis | URL absolue, < 2048 caractères, commence par le scheme (http/https) |
| `<lastmod>` | optionnel | W3C Datetime — `YYYY-MM-DD` ou date+time complet |
| `<changefreq>` | optionnel | `always` `hourly` `daily` `weekly` `monthly` `yearly` `never` |
| `<priority>` | optionnel | `0.0` à `1.0`, défaut `0.5` |

Quote du spec sur priority:
> the priority you assign to a page is not likely to influence the position of your URLs in a search engine's result pages.

C'est un hint, pas un signal de ranking.

### Exemple minimal

```xml
<url>
  <loc>https://example.com/foo</loc>
  <lastmod>2026-05-10</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.7</priority>
</url>
```

## 4. Limites

> Each Sitemap file ... must have no more than 50,000 URLs and must be no larger than 50MB (52,428,800 bytes). Compressed files must decompress under 50MB.

Au-delà, on bascule en sitemap index.

## 5. Sitemap index (>50,000 URLs)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-001.xml</loc>
    <lastmod>2026-05-10</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-002.xml</loc>
    <lastmod>2026-05-10</lastmod>
  </sitemap>
</sitemapindex>
```

> Sitemap index files may not list more than 50,000 Sitemaps and must be no larger than 50MB.

Effet net: capacité max théorique = 50_000 × 50_000 = **2.5 milliards** d'URLs par hôte.

## 6. Variantes de format autorisées

- `sitemap.xml` (canonique)
- `sitemap.xml.gz` (gzip)
- `sitemap.txt` — un URL par ligne, encoding UTF-8, BOM optionnel (sans lastmod/priority)
- RSS 2.0 / Atom 1.0 — chaque item devient un URL

Bxc produit la forme XML canonique.

## 7. W3C Datetime pour `<lastmod>`

Source: https://www.w3.org/TR/NOTE-datetime

Formats acceptés (du moins précis au plus précis):
- `YYYY` — `2026`
- `YYYY-MM` — `2026-05`
- `YYYY-MM-DD` — `2026-05-10`
- `YYYY-MM-DDThh:mmTZD` — `2026-05-10T15:30+00:00`
- `YYYY-MM-DDThh:mm:ssTZD` — `2026-05-10T15:30:42Z`
- `YYYY-MM-DDThh:mm:ss.sTZD` — fraction de seconde

`TZD` = `Z` (UTC) ou `+hh:mm` / `-hh:mm`. Bxc émet `YYYY-MM-DD` (suffisant + le plus court).

## 8. Compliance checklist côté `scripts/url-to-docs.ts`

- [x] Déclaration XML `<?xml version="1.0" encoding="UTF-8"?>`
- [x] `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
- [x] `<loc>` requis avec URL absolue, échappement des entités XML
- [x] `<lastmod>` au format `YYYY-MM-DD` (extrait du frontmatter `fetched_at`)
- [x] `<changefreq>` choisie selon heuristique (`monthly` pour pages "Optional", `weekly` sinon)
- [x] `<priority>` calculée (`1.0` racine, `0.7` page régulière, `0.3` page Optional)
- [x] Bascule automatique en `<sitemapindex>` au-delà de 50_000 URLs
- [x] Shards nommés `sitemap-001.xml`, `sitemap-002.xml`, etc.
- [ ] Compression `.gz` (non implémenté — peu utile localement)

## 9. Exemple produit par bxc

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://agent-browser.dev/</loc>
    <lastmod>2026-05-10</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://agent-browser.dev/changelog</loc>
    <lastmod>2026-05-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  ...
</urlset>
```
