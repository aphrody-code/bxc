---
name: bxc-xcom
description: This skill should be used for @aphrody/xcom — the x.com profile page scraper (XComScraper, XComProfileData), its screenshot and AI-extraction flags, and the `bxc xcom profile` CLI. Distinct from the cookie-based native X client.
metadata:
  short-description: Scrape public x.com profile pages.
---

# @aphrody/xcom

Scraper de pages de profil x.com (`packages/xcom`).

## Surface

`XComScraper` → `XComProfileData`. CLI : `bxc xcom profile <handle>`, options
`--screenshot`, `--ai-extract`.

## À ne pas confondre avec @aphrody/x

| | `@aphrody/xcom` (cette skill) | `@aphrody/x` (skill `bxc-x-client`) |
|---|---|---|
| Voie d'accès | Page publique rendue | GraphQL + REST authentifiés par cookies |
| Besoin de session | Non | Oui |
| Portée | Un profil, tel qu'un visiteur le voit | Timeline, recherche, ranking local, decks |

Pour tout ce qui demande une session (publier, lire un fil complet, classer),
c'est `@aphrody/x` qu'il faut, pas ce scraper. `bxc-x-client` couvre ce cas.

`--ai-extract` envoie le contenu de la page à un modèle : le signaler quand on
l'active, et ne pas le poser par défaut dans un script.
