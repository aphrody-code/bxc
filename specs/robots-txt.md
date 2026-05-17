# robots.txt — RFC 9309

> Source canonique: https://www.rfc-editor.org/rfc/rfc9309  
> Auteurs: Google (M. Koster, G. Illyes, H. Zeller, L. Sassman) — septembre 2022  
> Digest fixé: 2026-05-10

## 1. Emplacement

> The file MUST be accessible at `"scheme:[//authority]/robots.txt"`, encoded in UTF-8, with media type `"text/plain"`.

Pour `https://www.example.com`, c'est `https://www.example.com/robots.txt`. Un crawler doit faire un GET sur cette URL avant de visiter quoi que ce soit d'autre sur l'hôte.

## 2. Structure d'un groupe

Un fichier robots.txt est une suite de **groupes**. Chaque groupe contient:
- une ou plusieurs lignes `user-agent`
- une ou plusieurs `disallow` / `allow`

> One or more user-agent lines that are followed by one or more rules.

Format général:

```
user-agent: <product-token>
disallow: <path-pattern>
allow: <path-pattern>
```

Le product-token est case-insensitive et ne contient que lettres, underscores, hyphens. Le pattern de chemin, lui, est **case-sensitive**.

## 3. Règles de matching

> The most specific match found MUST be used. The most specific match is the match that has the most octets.

Algorithme:
1. Trouver tous les patterns `allow`/`disallow` qui matchent l'URL
2. Choisir celui dont la longueur en octets est la plus grande
3. Si égalité allow/disallow → **allow gagne** (clarification ajoutée par RFC 9309)

Le match commence au premier caractère du path. Caractères non-ASCII et réservés RFC 3986 doivent être percent-encodés avant comparaison.

## 4. Wildcards

Deux wildcards normalisés par RFC 9309:

| Symbole | Signification |
|---|---|
| `*` | 0 ou plus instances de n'importe quel caractère |
| `$` | fin du pattern (ancrage final) |

Exemples:
- `disallow: *.gif$` → bloque tout fichier `.gif`
- `allow: /this/*/exactly` → matche `/this/foo/exactly`, `/this/bar/exactly`...

## 5. Caching et freshness

> Crawlers SHOULD NOT use the cached version for more than 24 hours, unless the robots.txt file is unreachable.

Comportement attendu si robots.txt est unreachable (5xx) → considérer le site **interdit en totalité** par défaut, ou retomber sur la dernière copie cache si elle existe et qu'on la juge encore valable.

Bxc cache `robots.txt` par hôte avec TTL 1 h (sous le plafond de 24 h).

## 6. Directive `Sitemap`

Bien que non-core, supportée:

```
Sitemap: https://example.com/sitemap.xml
```

> Parsing of other records MUST NOT interfere with the parsing of explicitly defined records.

Les directives `Sitemap` peuvent apparaître n'importe où dans le fichier — pas liées à un groupe `user-agent`.

## 7. Tokens spéciaux

- `User-agent: *` — applicable à tout crawler qui n'est pas explicitement listé ailleurs
- `Disallow:` (vide) — autorise tout
- `Disallow: /` — interdit tout

## 8. Compliance checklist côté bxc

- [ ] Fetch `<origin>/robots.txt` avant de crawler quoi que ce soit
- [ ] Parser groupes `User-agent` / `Disallow` / `Allow`
- [ ] Match longest-octet avec tie-break allow > disallow
- [ ] Support wildcards `*` et `$`
- [ ] Cache TTL 1 h par hôte (sous le plafond 24 h)
- [ ] Fallback "tout interdit" si 5xx ou unreachable
- [ ] Lire la directive `Sitemap:` pour bootstrap du crawl
- [ ] Flag CLI `--respect-robots` (default off pour la doc owner-controlled, on pour crawls externes)

> Statut côté `scripts/url-to-docs.ts` au 2026-05-10: pas encore implémenté. Le script crawle uniquement le site qu'on possède ou dont on est autorisé à crawler la doc. Ajouter le check robots.txt avant de l'exposer comme outil générique.

## 9. Exemple parsé par bxc

```
User-agent: *
Disallow: /private/
Disallow: /tmp/
Allow: /private/public-leak/

User-agent: GoogleBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
```

Pour bxc (User-agent custom, fall-through `*`):
- `/foo` → autorisé (aucun pattern ne matche)
- `/private/secret` → interdit (Disallow `/private/` matche, 9 octets)
- `/private/public-leak/page` → autorisé (Allow `/private/public-leak/` est plus spécifique, 21 octets)
- `/tmp/xyz` → interdit
