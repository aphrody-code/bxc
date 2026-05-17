# Markdown — CommonMark + GFM

> Sources canoniques:  
> CommonMark 0.31.2 — https://spec.commonmark.org/  
> GitHub Flavored Markdown — https://github.github.com/gfm/  
> Digest fixé: 2026-05-10

## 1. Pourquoi GFM

CommonMark fixe le sous-ensemble syntaxique standard. GFM ajoute, par dessus:
- Tables
- Strikethrough `~~text~~`
- Task list items `- [ ]` / `- [x]`
- Tag filter (drop d'éléments HTML dangereux dans le rendu)
- Autolinks (URLs et emails sans `<...>`)

C'est ce que GitHub, Bun (`Bun.markdown`), htmd, et la majorité des renderers modernes implémentent. Bxc cible GFM partout.

## 2. Bloc structurel

| Élément | Syntaxe |
|---|---|
| H1–H6 ATX | `#` à `######` (espace après obligatoire en CommonMark strict) |
| H1–H2 setext | underline `===` ou `---` |
| Paragraphe | texte séparé par lignes vides |
| Blockquote | `> text` |
| Liste UL | `-`, `*`, `+` + espace |
| Liste OL | `1. ` (n'importe quel chiffre) |
| Liste tasks (GFM) | `- [ ]` ou `- [x]` |
| HR | `---`, `***`, `___` (3+) |
| Fenced code | ``` ``` ```` ou `~~~` avec info-string |
| Indented code | 4 espaces |
| Table (GFM) | `| col | col |` + ligne séparateur `| --- | --- |` |
| HTML bloc | tags HTML directement |

## 3. Inline

| Élément | Syntaxe |
|---|---|
| Strong | `**text**` ou `__text__` |
| Emphasis | `*text*` ou `_text_` |
| Strikethrough (GFM) | `~~text~~` |
| Code | `` `code` `` |
| Link | `[text](url "title")` |
| Image | `![alt](url "title")` |
| Autolink | `<https://x.com>` (CommonMark) ou `https://x.com` (GFM) |
| Hard break | 2 espaces fin de ligne, ou `\` fin de ligne |

## 4. Frontmatter — pas dans la spec

CommonMark/GFM **ne définit pas** YAML frontmatter. C'est une convention de facto Jekyll/Hugo/Astro/Pandoc. Bxc le produit et le parse manuellement (voir [yaml-frontmatter.md](yaml-frontmatter.md)).

Format reconnu par les renderers tolérants:

```markdown
---
title: "Foo"
date: 2026-05-10
---

# Body starts here
```

Si le markdown est rendu par un parser strict (Bun.markdown.html par exemple), le frontmatter peut être interprété comme une thematic break + heading setext bizarre. À strip avant le rendu si pertinent.

## 5. `Bun.markdown` — options pertinentes

`Bun.markdown.html(md, options)` accepte ces flags GFM:

| Option | Défaut | Usage |
|---|---|---|
| `tables` | false | tables GFM |
| `strikethrough` | false | `~~text~~` |
| `tasklists` | false | `- [x] item` |
| `tagFilter` | false | drop tags HTML dangereux (style, iframe, ...) |
| `autolinks` | false | URLs/emails/www sans `< >` |
| `headings` | false | génère `id` et autolinks sur H1–H6 |
| `latexMath` | false | `$inline$` et `$$display$$` |
| `wikiLinks` | false | `[[wiki link]]` |
| `noHtmlBlocks` / `noHtmlSpans` | false | filtres HTML stricts |

Pour une équivalence GitHub: `{ tables: true, strikethrough: true, tasklists: true, autolinks: true, tagFilter: true }`.

## 6. `Bun.markdown.render` — callbacks par élément

Pattern central pour transformer markdown → autre chose (text, ANSI, HTML custom, JSX...). Bxc utilise les callbacks qui retournent juste `children` pour produire le miroir plaintext (pattern "Stripping all formatting" du doc Bun).

Callbacks disponibles côté blocs: `heading`, `paragraph`, `blockquote`, `code`, `list`, `listItem`, `hr`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `html`.

Côté inline: `strong`, `emphasis`, `link`, `image`, `codespan`, `strikethrough`, `text`.

Retourner `null` ou `undefined` → l'élément est omis.

## 7. Différences GFM vs CommonMark à retenir

| Cas | CommonMark | GFM |
|---|---|---|
| `~~strike~~` | texte littéral | strikethrough |
| URL nue `https://x.com` | texte littéral | autolink |
| Tables | non | oui |
| `- [x] task` | liste avec `[x]` literal | task item checkable |
| HTML dangereux (iframe, script) | passe | filtré si `tagFilter` on |

## 8. Fenced code blocks — info string

```markdown
```js
console.log("hi")
``\`
```

(la 2e backtick est échappée pour le rendu de cette doc)

L'info string `js` est stockée dans `meta.language` côté `Bun.markdown.render`, et devient `class="language-js"` côté HTML par convention. Conventions: `js`, `ts`, `bash`, `sh`, `python`, `rust`, `zig`, `json`, `yaml`, `html`, `css`, `sql`, `diff`, `text` (no highlight).

GFM tolère 3+ backticks ou 3+ tildes ; le bloc se ferme avec le même nombre minimum (utile quand le code interne contient des backticks).

## 9. Liens images — alt + title

```markdown
![alt-text](https://example.com/img.png "optional title")
```

`alt` est requis côté accessibilité. `title` apparaît au survol. Bxc strip systématiquement les images dans `plaintext/` (l'alt est gardé optionnellement selon le contexte LLM).

## 10. Compliance checklist côté pipeline

- [x] htmd produit du GFM par défaut (tables, strikethrough, fenced code, autolinks)
- [x] `Bun.markdown.render` configuré `tables: true, strikethrough: true, tasklists: true`
- [x] Frontmatter YAML émis en tête de chaque `pages/*.md`
- [x] Code fences ` ``` ` (backticks, pas tildes)
- [x] Sortie `--wrap=preserve` côté pandoc fallback (pas de hard-wrap à 80 col)
- [x] Strip des `<head>` et HTML dangereux côté htmd via `--ignored-tags`
