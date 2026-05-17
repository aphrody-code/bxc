# bxc/specs

Specs canoniques que bxc et `scripts/url-to-docs.ts` respectent ou produisent. Chaque fichier est un digest condensé de la source officielle, avec quotes exactes, et une checklist de conformité côté bxc.

| Fichier | Sujet | Source canonique |
|---|---|---|
| [llms-txt.md](llms-txt.md) | format `/llms.txt` pour LLMs | https://llmstxt.org/ |
| [sitemap-xml.md](sitemap-xml.md) | sitemaps protocol 0.9 | https://www.sitemaps.org/protocol.html |
| [robots-txt.md](robots-txt.md) | robots exclusion RFC 9309 | https://www.rfc-editor.org/rfc/rfc9309 |
| [url-normalization.md](url-normalization.md) | RFC 3986 + WHATWG URL | https://url.spec.whatwg.org/ |
| [http-crawl-headers.md](http-crawl-headers.md) | User-Agent, conditional GET, Retry-After | https://www.rfc-editor.org/rfc/rfc9110 |
| [markdown-gfm.md](markdown-gfm.md) | CommonMark + GFM tables/strikethrough/tasklists | https://github.github.com/gfm/ |
| [yaml-frontmatter.md](yaml-frontmatter.md) | conventions YAML en tête de fichier | de facto Jekyll/Hugo/Astro |
| [opengraph-meta.md](opengraph-meta.md) | métadonnées Open Graph + meta description | https://ogp.me/ |

## Pourquoi un dossier specs ?

Les crawlers et générateurs de docs touchent à beaucoup de standards. Sans repère central, les agents codent au hasard, hallucinent les noms de balises ou les formats de date, et rebrisent la conformité à chaque refactor. Ce dossier fixe la vérité.

## Règle d'usage pour les agents

> Avant d'écrire/modifier du code qui produit ou consomme un format listé ici, lis le fichier correspondant. Si la source officielle a évolué depuis 2026-05-10, fetche-la et update le digest plus le code en même temps.
