# HTTP request headers pour crawlers

> Source canonique: RFC 9110 (HTTP Semantics) — https://www.rfc-editor.org/rfc/rfc9110  
> RFC 9111 (Caching) — https://www.rfc-editor.org/rfc/rfc9111  
> Digest fixé: 2026-05-10

## 1. User-Agent — identification

Format recommandé:

```
User-Agent: <product-name>/<version> (<contact-or-info-url>)
```

Exemples du standard:

```
User-Agent: bunmium-url-to-docs/0.2 (+https://github.com/bunmium)
User-Agent: GoogleBot/2.1 (+https://www.google.com/bot.html)
User-Agent: ApifyCrawler/1.5 (+https://apify.com/abuse)
```

**Bonnes pratiques**:
- Toujours inclure une URL ou email de contact (préfixée `+`) pour qu'un opérateur puisse signaler du mauvais comportement.
- Ne pas se déguiser en `Mozilla/5.0 (...) Chrome/...` sauf si on automatise un browser réel ou si le site bloque tout ce qui n'est pas browser. Le déguisement complique les abuse reports.
- Une seule ligne, pas de saut de ligne, pas de quote.

Bunlight envoie:
```
User-Agent: bunmium-url-to-docs/0.2 (+https://github.com/bunmium)
```

## 2. Accept et Accept-Encoding

Pour récupérer du HTML lisible:

```
Accept: text/html,application/xhtml+xml
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en;q=0.9, fr;q=0.8
```

`fetch` global de Bun négocie automatiquement `Accept-Encoding` et décompresse en transparence. On peut quand même forcer un `Accept` strict pour éviter de recevoir du JSON/XML quand on attend du HTML.

## 3. Conditional GET — économiser de la bande passante

### `If-Modified-Since`

```
If-Modified-Since: Wed, 21 May 2026 07:28:00 GMT
```

Si le serveur supporte, il répond:
- `200 OK` + body si modifié depuis la date
- `304 Not Modified` (sans body) sinon

Format date obligatoire: **RFC 7231 / HTTP-date** (ex: `Wed, 21 May 2026 07:28:00 GMT`). Pas du W3C ISO. C'est `new Date(...).toUTCString()` côté JS.

### `If-None-Match` (ETag)

Plus robuste que les dates — le serveur fournit un opaque ETag, on le renvoie:

```
# 1er fetch
< ETag: "abc123def"

# 2e fetch
> If-None-Match: "abc123def"
< 304 Not Modified
```

Bunlight stocke `ETag` et `Last-Modified` dans `bun:sqlite` à côté du `content_hash` pour les recrawls incrémentaux.

## 4. Rate limiting — Retry-After

Quand un serveur renvoie `429 Too Many Requests` ou `503 Service Unavailable`, il peut joindre:

```
Retry-After: 120                  # secondes
Retry-After: Wed, 21 May 2026 07:28:00 GMT   # date absolue
```

Le crawler **doit** attendre au moins ce délai avant le prochain fetch. Bunlight implémente ça dans `src/throttling/RateLimiter.ts`.

## 5. Headers de protection anti-bot courants

À surveiller dans la réponse:

| Header | Signification |
|---|---|
| `Set-Cookie: cf_clearance=...` | Cloudflare a délivré un challenge token (bunlight: profile `stealth`) |
| `Server: cloudflare` | Cloudflare devant le site |
| `CF-Ray: ...` | request ID Cloudflare |
| `X-Robots-Tag: noindex, nofollow` | équivalent meta robots, mais en HTTP. Respecter au sens crawl-friendly. |
| `Link: <...>; rel="canonical"` | URL canonique alternative — collapse vers cette URL pour la dédup. |
| `Vary: User-Agent` | la réponse dépend du UA — si on change de UA, refetch obligatoire. |
| `Content-Type: text/html; charset=utf-8` | si charset ≠ utf-8, transcoder côté client. |

## 6. Méthodes HTTP côté crawler

- **GET** — par défaut.
- **HEAD** — utile pour vérifier qu'une URL existe et son content-type sans rapatrier le body. Bunlight pourrait l'utiliser avant un GET coûteux. `fetch(url, { method: "HEAD" })`.
- Jamais POST/PUT/DELETE depuis un crawler de docs.

## 7. Cookies — généralement off

Un crawler de docs publiques ne devrait pas envoyer de cookies. Bunlight ne le fait que si on passe explicitement un cookie jar (cas des sites paywallés ou auth interne, profile `stealth`).

## 8. Limits côté serveur

Conventions communes:

- **Concurrence par hôte**: 4–8 requêtes parallèles par défaut, descendre à 2 sur des hôtes lents
- **Délai entre requêtes**: 100–500 ms par hôte est poli ; respecter `Retry-After`
- **Timeout**: 15–30 s par requête. Bunlight: `AbortSignal.timeout(15000)`
- **Redirects**: max 10 (default `fetch`)
- **Body size cap**: stop à 10 MB pour des pages HTML, sinon on ramasse du PDF/binaire mal taggé

## 9. Compliance checklist côté `scripts/url-to-docs.ts`

- [x] `User-Agent: bunmium-url-to-docs/0.2 (+https://github.com/bunmium)`
- [x] `Accept: text/html,application/xhtml+xml`
- [x] Compression auto via Bun `fetch`
- [x] Timeout 15 s par requête (`AbortSignal.timeout(15000)`)
- [x] Redirects suivis (`redirect: "follow"`, max 20 par défaut Bun)
- [x] Drain explicite (`res.body?.cancel()`) sur les non-HTML pour libérer la connexion
- [ ] Cache `If-Modified-Since` / `If-None-Match` pour les recrawls (pas encore implémenté ; le hash sha256 sert de proxy actuellement)
- [ ] Respect de `Retry-After` (à wirer sur 429/503)
- [ ] Détection `<link rel="canonical">` pour collapse de doublons (à ajouter dans `extract`)
