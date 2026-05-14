# YAML frontmatter

> Source canonique: aucune RFC, c'est une convention de facto.  
> Originellement Jekyll (https://jekyllrb.com/docs/front-matter/), reprise par Hugo, Astro, Eleventy, Gatsby, Pandoc, MDX, Obsidian, ChatGPT export, Notion export.  
> Spec YAML sous-jacente: YAML 1.2 — https://yaml.org/spec/1.2.2/  
> Digest fixé: 2026-05-10

## 1. Format

Un bloc YAML délimité par `---` au tout début du fichier:

```markdown
---
title: "Hello world"
date: 2026-05-10
tags: [intro, demo]
draft: false
---

# Body starts here
```

Règles:
- **Première ligne** doit être exactement `---` (3 tirets, rien d'autre, pas de BOM précédant).
- Ferme par une autre ligne `---`.
- Le bloc YAML entre les deux est parsé selon YAML 1.2.
- Tout ce qui suit le second `---` est traité comme markdown.

Variantes acceptées par certains parsers (mais à éviter en production):
- `+++` … `+++` → TOML frontmatter (Hugo)
- `;;;` … `;;;` → JSON frontmatter (Hugo)

Bunlight n'émet et ne consomme que la variante `---` YAML.

## 2. Champs conventionnels

Pas standardisés, mais largement adoptés:

| Champ | Type | Usage |
|---|---|---|
| `title` | string | titre de la page |
| `description` | string | résumé court (~150 chars) |
| `date` / `pubDate` | YYYY-MM-DD ou ISO 8601 | date de publication |
| `updated` / `modified` | date | dernière modif |
| `tags` | array of string | catégorisation |
| `categories` | array | similaire |
| `slug` | string | path alternatif |
| `author` | string ou object | auteur |
| `draft` | boolean | masque dans les listings |
| `layout` | string | template à utiliser |
| `permalink` | string | URL forcée |

## 3. Champs émis par bunlight

```yaml
---
source_url: https://agent-browser.dev/installation
fetched_at: 2026-05-10
content_hash: sha256:94f2d7d22cb1ca40
title: "Installation | agent-browser"
description: "Installs the native Rust binary for maximum performance:"
main_content_found: true
---
```

Sémantique:

| Champ | Sens |
|---|---|
| `source_url` | URL canonique d'où vient ce markdown |
| `fetched_at` | date du crawl, format `YYYY-MM-DD` |
| `content_hash` | sha256 16-chars du HTML source pour la dédup et le change detection |
| `title` | tag `<title>` extrait |
| `description` | premier paragraphe substantiel du body, fallback `<meta description>` |
| `main_content_found` | true si un `<main>`/`<article>`/`[role='main']` a été détecté |

## 4. Pièges YAML

| Cas | Problème |
|---|---|
| Valeur contenant `:` | doit être quotée: `title: "Foo: Bar"` |
| Valeur contenant `#` | quote: `description: "Tag #1"` (sinon comment) |
| Valeur "yes" / "no" / "on" / "off" | YAML 1.1 boolean. YAML 1.2 strict ne le fait plus, mais beaucoup de parsers Node/Python sont en 1.1. Quote pour être safe. |
| Strings multiline | `key: |` (literal) ou `key: >` (folded). Pour un seul paragraphe, `>` est plus lisible. |
| Tabulations | **interdites** dans l'indentation YAML — uniquement spaces. |
| BOM UTF-8 | doit absolument être absent avant le `---` initial. |

## 5. Parser bunlight

Bunlight n'utilise pas `js-yaml` ni un parser complet — un mini-parser ligne-à-ligne suffit pour ses propres outputs:

```ts
function readFrontmatter(text: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const fm: Record<string, string> = {};
  if (!text.startsWith("---\n")) return { frontmatter: fm, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: fm, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.slice(1, -1);
      }
    }
    fm[k] = v;
  }
  return { frontmatter: fm, body: text.slice(end + 5) };
}
```

Limites assumées: pas de support listes, pas d'imbrication, pas de multiline strings. Pour des frontmatters tiers riches, utiliser un vrai parser YAML.

## 6. Convention d'écriture côté bunlight

Toujours en JSON-encodage des string fields (pour gérer guillemets internes et caractères spéciaux):

```ts
`title: ${JSON.stringify(title)}`
`description: ${JSON.stringify(description)}`
```

`JSON.stringify` produit toujours du JSON valide qui est aussi du YAML valide pour les strings.
