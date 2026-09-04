---
name: bxc-animesama
description: This skill should be used for @aphrody/animesama — the anime-sama.to scraper (catalogue search, seasons, episodes, embedded players), its language variants (vostfr/vf/va/var/vkr), source resolution, and the `bxc animesama search|info|seasons|episodes|resolve` CLI.
metadata:
  short-description: Scrape the anime-sama.to catalogue and players.
---

# @aphrody/animesama

Scraper anime-sama.to (`packages/animesama`).

## Surface

`ResultatRecherche`, `FicheAnime`, `SaisonAnimesama`, `EpisodeAnimesama`,
`Lecteur`, `LecteurEpisode`, `SourceResolue`, `QualiteMedia` — plus
`LANGUES_ANIMESAMA` (`vostfr`, `vf`, `va`, `var`, `vkr`, …) et
`ProfilAnimesama` (les profils de transport communs au dépôt).

CLI : `bxc animesama search|info|seasons|episodes|resolve`, avec
`--profile static|fast|http|stealth|max`.

## Ce qui casse en pratique

Une série existe en **plusieurs langues sur des pages distinctes**. Ne scraper
qu'une page laisse le catalogue avec des lecteurs morts pour l'autre langue
sans que rien ne le signale — le même piège que celui corrigé sur voiranime
(voir `bxc-voiranime`). Vérifier chaque langue déclarée, et compter ce qu'on
écarte plutôt que de le laisser disparaître.

La résolution des lecteurs embarqués passe par le cœur partagé du dépôt
(`src/media/`), commun à animesama et voiranime : corriger un fournisseur
profite aux deux, ne pas le dupliquer.

Les requêtes passent par `RequeteHttp`/`ReponseHttp` injectables : les tests ne
doivent pas toucher le réseau (`SKIP_NETWORK_TESTS` est posée par défaut).
