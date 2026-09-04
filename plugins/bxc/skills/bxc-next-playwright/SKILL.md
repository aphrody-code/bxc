---
name: bxc-next-playwright
description: This skill should be used for @aphrody/next-playwright — the Next.js instant() navigation-testing primitive ported to bxc's CDP-backed runner, the next-instant-navigation-testing cookie protocol over Network.setCookies/getCookies/deleteCookies, adapting a bxc page to a Playwright-like page, and step reporting.
metadata:
  short-description: Next.js instant() navigation testing over CDP, without Playwright.
---

# @aphrody/next-playwright

Portage de la primitive `instant()` de `@next/playwright` sur le runner CDP de
bxc (`packages/next-playwright`) — **sans dépendance runtime à
`@playwright/test`**.

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `instant`, `INSTANT_COOKIE` | `src/index.ts` | Primitive de test de navigation instantanée |
| `CdpCookieContext` | `src/context.ts` | Contexte de cookies parlant CDP |
| `adaptPage` | `src/index.ts` | Adapte une page bxc à la forme attendue |
| `step`, `setStepReporter`, `Step` | `src/step.ts` | Rapport d'étapes |
| `CdpSend`, `PwCookie`, `PwCookieParam`, `PlaywrightPage`, `PlaywrightBrowserContext`, `BxcPageLike` | Types de la frontière |

## Le protocole est un cookie

`instant()` communique avec Next via le cookie
`next-instant-navigation-testing`, posé et relu par
`Network.setCookies` / `Network.getCookies` / `Network.deleteCookies`. Tout
passe par `CdpSend` : aucune API Playwright n'est appelée à l'exécution, seules
les **formes** de Playwright sont reproduites pour que le code de test existant
compile. Ne pas réintroduire `@playwright/test` en dépendance runtime — c'est
tout l'intérêt du paquet.

Le cookie doit être supprimé en fin de test : un cookie oublié fait passer la
navigation suivante pour instantanée alors qu'elle ne l'est pas.
