# URL normalization

> Sources canoniques:  
> RFC 3986 (URI Generic Syntax) — https://www.rfc-editor.org/rfc/rfc3986  
> WHATWG URL Living Standard — https://url.spec.whatwg.org/  
> Digest fixé: 2026-05-10

## 1. Quel standard suivre ?

Bunlight suit la **WHATWG URL Living Standard**, parce que c'est ce que `new URL()` implémente dans Bun, Chrome, Firefox, Node, Deno. RFC 3986 reste la référence formelle mais WHATWG est strictement plus permissif et matche le comportement réel des navigateurs.

## 2. Anatomie d'une URL absolue

```
  https://user:pw@host.example.com:443/path/to/file.html?key=val#frag
  └─┬─┘   └────┬────┘ └─────┬───────┘ └─┬─┘     └─────┬────┘ └─┬─┘ └─┬─┘
   scheme    userinfo    host    port  path        query     fragment
            (rare)
```

Composants exposés par `new URL()`:

| Propriété | Valeur sur l'exemple |
|---|---|
| `protocol` | `"https:"` |
| `username` | `"user"` |
| `password` | `"pw"` |
| `hostname` | `"host.example.com"` |
| `port` | `"443"` (vide si default) |
| `host` | `"host.example.com:443"` |
| `pathname` | `"/path/to/file.html"` |
| `search` | `"?key=val"` |
| `hash` | `"#frag"` |
| `origin` | `"https://host.example.com:443"` |

## 3. Normalisation appliquée par bunlight

Pour qu'un crawler ne re-fetche pas la même page deux fois sous des URLs cosmétiquement différentes, on normalise:

1. **Scheme et host en lowercase** — `HTTPS://Example.COM/Foo` → `https://example.com/Foo`. WHATWG le fait automatiquement à la construction.
2. **Drop du fragment** — `#section` ne change jamais la réponse HTTP. Bunlight set `u.hash = ""`.
3. **Drop des query strings** — heuristique côté docs sites: la plupart des params sont du tracking (`utm_*`, `ref=...`). Optionnel via flag (bunlight les drop par défaut sur les sites de docs, pas sur les apps).
4. **Trailing slash** — `/foo/` → `/foo` sauf pour la racine `/`. Évite les doublons quand le serveur sert le même contenu pour les deux.
5. **Pas de port default** — `:443` sur HTTPS, `:80` sur HTTP sont supprimés (WHATWG le fait).
6. **Pas de userinfo** — on ne suit jamais des liens contenant `user:password@host`.
7. **Pas de pathname relatif** — résolution via `new URL(href, baseUrl)` qui résout `..`, `./`, `//` selon RFC 3986 §5.2.
8. **Percent-encoding stable** — caractères réservés RFC 3986 percent-encodés, unreserved décodés (sauf si déjà encodés ambiguïsement).

## 4. Same-origin check

```ts
function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
```

`origin` est `<scheme>://<host>:<port>` SANS path / query / fragment / userinfo. C'est ce qu'expose `URL.origin` directement. Les schemes "opaque" (`data:`, `blob:`, `javascript:`, `mailto:`) ont `origin === "null"` — on les drop côté crawl.

## 5. Schemes spéciaux et opaque

À filtrer côté crawler:

| Scheme | Comportement |
|---|---|
| `data:` | drop (inline content) |
| `blob:` | drop (browser-only) |
| `javascript:` | drop (XSS surface) |
| `mailto:` | drop (pas du HTTP) |
| `tel:` | drop |
| `file:` | drop sauf pour debug local |
| `chrome:` `about:` `view-source:` | drop |
| `http:` `https:` | crawl |
| `ws:` `wss:` | drop côté crawler statique |

## 6. IRIs (RFC 3987) et IDN

Les hosts non-ASCII (`http://例え.test/`) sont représentés en **Punycode** dans la `host` property (`xn--r8jz45g.test`). WHATWG fait la conversion automatique. Bunlight n'a rien à faire de spécial — on reçoit déjà le format wire.

Les paths non-ASCII sont **percent-encodés en UTF-8** par WHATWG: `/é` → `/%C3%A9`. Si le serveur fait de la résolution case/encoding différente, il faut suivre les redirects.

## 7. Pièges fréquents

| Cas | Ce qui passe | Ce qui ne passe pas |
|---|---|---|
| `new URL("/foo", "https://x.com")` | OK → `https://x.com/foo` | `new URL("foo")` → throws |
| `new URL("//other.com/p", "https://x.com")` | scheme-relative → `https://other.com/p` | considéré same-origin si origin diffère |
| Multiple slashes `///` | normalisés à `/` côté pathname | non — preservés (potentiel pour doublons) |
| Encodage UTF-8 vs Latin-1 dans le path | UTF-8 obligatoire en URL | sources HTML peuvent référencer Latin-1, à transcoder |
| Trailing whitespace dans `href="...  "` | strip nécessaire avant `new URL()` | sinon throws |

## 8. Compliance checklist côté `scripts/url-to-docs.ts`

- [x] `new URL()` pour parsing (WHATWG)
- [x] `u.hash = ""` avant store/compare
- [x] `u.search = ""` avant store/compare
- [x] Trailing slash strip sauf racine
- [x] Same-origin via `u.origin` (pas comparaison string brute du `origin` arg)
- [x] Filter `shouldSkipUrl` blacklist `data:`, `mailto:`, `tel:`, `javascript:` (via le scheme check qui n'apparaît pas en pathname extension)
- [x] Filter par extension de fichier (`pdf`, `zip`, `mp4`...) pour ne pas tenter de crawler des binaires
- [ ] Drop d'URLs avec `userinfo` (scenario rare)
