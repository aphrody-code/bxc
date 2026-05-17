# Open Graph + meta description

> Sources canoniques:  
> Open Graph protocol — https://ogp.me/  
> HTML Living Standard, `<meta>` element — https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element  
> Twitter Cards — https://developer.x.com/en/docs/twitter-for-websites/cards/overview/abouts-cards  
> Schema.org — https://schema.org/  
> Digest fixé: 2026-05-10

## 1. Pourquoi extraire ces métas

Les métadonnées de page utiles pour un crawler de docs:
- **`<title>`** — titre humain
- **`<meta name="description">`** — résumé court (souvent partagé entre pages, donc fallback heuristique nécessaire)
- **Open Graph** (`og:*`) — résumé enrichi pour partage social, plus souvent par-page
- **Twitter Cards** (`twitter:*`) — souvent dupliqué d'OG
- **JSON-LD** (`<script type="application/ld+json">`) — Schema.org structuré (BlogPosting, Article, BreadcrumbList...)
- **`<link rel="canonical">`** — URL canonique pour la dédup
- **`<meta name="robots">`** — `noindex`/`nofollow` à respecter

## 2. Open Graph — properties les plus utiles

```html
<meta property="og:title"       content="Installation | agent-browser">
<meta property="og:description" content="Install the native Rust binary for maximum performance">
<meta property="og:url"         content="https://agent-browser.dev/installation">
<meta property="og:type"        content="article">
<meta property="og:site_name"   content="agent-browser">
<meta property="og:locale"      content="en_US">
<meta property="og:image"       content="https://agent-browser.dev/og.png">
```

Convention OG:
- Préfixe `property="og:..."` (avec `property`, pas `name`)
- 4 properties **obligatoires** côté spec OG: `og:title`, `og:type`, `og:image`, `og:url` — en pratique, `og:description` est aussi quasi-toujours là.

## 3. Twitter Cards

```html
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="Installation | agent-browser">
<meta name="twitter:description" content="Install the native Rust binary...">
<meta name="twitter:image"       content="https://agent-browser.dev/og.png">
```

Twitter utilise `name=` (pas `property=`). Si `og:*` existe, Twitter retombe dessus → en pratique, fetcher Twitter OU OG, pas les deux.

## 4. JSON-LD structured data

Le format le plus riche, embarqué dans `<script>`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Installation",
  "description": "Install the native Rust binary...",
  "author": { "@type": "Organization", "name": "Vercel Labs" },
  "datePublished": "2026-05-10",
  "url": "https://agent-browser.dev/installation"
}
</script>
```

C'est ce que Google et Bing préfèrent. Bxc peut le parser pour des `description`, `headline`, `datePublished`, `breadcrumb` plus précis que ce que les `<meta>` exposent. Pour l'instant le crawler extrait seulement `<title>` et `<meta name|property=description>`.

## 5. Cascade de fallback côté bxc

Pour le champ `description` du frontmatter:

1. Premier paragraphe substantiel du body markdown (`>= 40 chars, <= 280 chars, alphabétique`)
2. `<meta property="og:description">` si trouvé en pass HTMLRewriter
3. `<meta name="description">` sinon
4. Vide

Cette priorité inverse le réflexe naïf "lis la meta d'abord" parce que sur les sites de docs le `<meta description>` est très souvent dupliqué entre toutes les pages (un seul layout commun Next.js/Astro/etc.). Le 1er paragraphe extrait est presque toujours plus discriminant.

## 6. `<link rel="canonical">` — collapse de doublons

```html
<link rel="canonical" href="https://example.com/foo">
```

Si le crawler arrive sur `/foo?utm_source=twitter` mais le canonical pointe vers `/foo`, on stocke sous `/foo` et on évite de re-fetch. C'est aussi le bon endroit pour dé-dupliquer les `?lang=fr` et autres paramètres.

> Statut côté `scripts/url-to-docs.ts` au 2026-05-10: pas implémenté. À ajouter dans `extract()` via une 4e pass HTMLRewriter `link[rel='canonical']`.

## 7. `<meta name="robots">` — directives par-page

```html
<meta name="robots" content="noindex, nofollow">
<meta name="robots" content="noindex">
<meta name="robots" content="noarchive, noimageindex">
```

Valeurs courantes:
- `noindex` — n'indexe pas la page
- `nofollow` — ne suis pas les liens
- `noarchive` — pas de cache public
- `nosnippet` — pas d'extrait dans les SERPs
- `none` — équivalent `noindex, nofollow`

L'équivalent en HTTP header: `X-Robots-Tag: noindex, nofollow`.

> Statut côté bxc: à respecter pour les crawls externes (`--respect-robots`), peut être ignoré pour la doc qu'on possède.

## 8. `hreflang` — pages multilingues

```html
<link rel="alternate" hreflang="fr" href="https://example.com/fr/foo">
<link rel="alternate" hreflang="en" href="https://example.com/en/foo">
<link rel="alternate" hreflang="x-default" href="https://example.com/foo">
```

À utiliser pour ne pas crawler 5 fois la même page traduite. Bxc peut filtrer via `--include="/en/**"` côté CLI.

## 9. Compliance checklist côté `scripts/url-to-docs.ts`

- [x] Extract `<title>` via HTMLRewriter
- [x] Extract `<meta name="description">` via HTMLRewriter
- [x] Extract `<meta property="og:description">` via HTMLRewriter (fallback si meta description absent)
- [x] Heuristique 1er paragraphe substantiel pour override les descriptions dupliquées
- [ ] Extract `<link rel="canonical">` pour dédup
- [ ] Respect `<meta name="robots">` `noindex` (skip page) et `nofollow` (ne pas suivre les liens)
- [ ] Parse `<script type="application/ld+json">` pour `headline`, `description`, `datePublished`
- [ ] `hreflang` détection pour filtrer les langues
