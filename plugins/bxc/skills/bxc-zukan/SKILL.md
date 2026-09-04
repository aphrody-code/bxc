---
name: bxc-zukan
description: This skill should be used for @aphrody/zukan — the zukan.inazuma.jp character encyclopedia scraper (ZukanScraper, character list and detail pages), and how its live tests are gated.
metadata:
  short-description: Scrape the zukan.inazuma.jp character encyclopedia.
---

# @aphrody/zukan

Scraper de l'encyclopédie de personnages zukan.inazuma.jp (`packages/zukan`).

## Surface

`ZukanScraper` → `ZukanCharacterRef` (entrée de liste) et
`ZukanCharacterDetail` (fiche complète). Pas de sous-commande CLI dédiée : le
paquet se consomme depuis le code ou depuis les tests d'intégration.

## Tests

Le bloc « Zukan Inazuma — Live Site Tests » vit dans
`test/integration/google-specialization.test.ts`. Il tape le vrai site avec un
navigateur et est gardé par `SKIP_NETWORK_TESTS`, posée par défaut dans
`bun run test`. Sans ce garde, une simple exécution de la suite ouvrait un
navigateur et saturait la mémoire — c'est la raison du garde, ne pas le retirer.
Pour l'exercer réellement : `bun run test:live`.

Le site est en japonais : ne pas normaliser les noms avec une règle
approximative. Un crible appliqué avant la lecture des fiches masque ce qu'il
rejette — annoter plutôt que filtrer, et compter ce qu'on écarte.
