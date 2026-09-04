---
name: bxc-wonderbot
description: This skill should be used for @aphrody/wonderbot — the Discord bot serving the IETV episode catalogue: slash-command registration scope, announcement journal, gap detection, scheduler, Discord embeds, and the `bxc wonderbot start|doctor|refresh|register` CLI.
metadata:
  short-description: Discord bot over the IETV episode catalogue.
---

# @aphrody/wonderbot

Bot Discord d'un catalogue d'épisodes (`packages/wonderbot`), assis sur
`@aphrody/ietv`.

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `Wonderbot` | `src/bot.ts` | Client Discord, routage des interactions |
| `lireConfig`, `resumerConfig`, `cheminCacheParDefaut` | `src/config.ts` | Configuration depuis l'environnement |
| `Catalogue`, `catalogueReel` | `src/catalogue.ts` | Vue du catalogue, rafraîchissement |
| `JournalAnnonces`, `diffNouveaux`, `analyserJournal` | `src/annonces.ts` | Nouveautés annoncées une seule fois |
| `estStaff`, `estAdministrateur`, `rolesDeLInteraction` | `src/bot.ts` | Droits |
| planificateur, lacunes, forum | `src/planificateur.ts`, `src/lacunes.ts`, `src/forum.ts` | Tâches périodiques, trous du catalogue, fils |

CLI : `bxc wonderbot start|doctor|refresh|register`.

## Portée des commandes : le choix qui rend le bot muet

`portee` vaut `"guildes"` ou `"globale"`. En `"guildes"`, la publication est
immédiate **mais un serveur absent de la liste voit un bot en ligne et sans
aucune commande** — panne silencieuse classique, et la config refuse d'ailleurs
de démarrer en portée « guildes » sans guilde déclarée. En `"globale"`, tout
serveur qui invite le bot obtient les commandes, au prix du délai de
propagation Discord.

`lireConfig` lève avec un message actionnable dès qu'une valeur indispensable
manque : mieux vaut un service qui refuse de démarrer en disant pourquoi qu'un
bot en ligne et muet. Garder cette propriété.

## Cache

`cheminCacheParDefaut` suit `IETV_CACHE_PATH`/`WONDERBOT_CACHE_PATH`, sinon
`HOME` → `USERPROFILE` → `os.homedir()`, et compose avec `join` : le chemin
porte le séparateur natif, ne pas le comparer à un littéral POSIX dans un test.
En service durci (`ProtectHome=read-only`), ouvrir ce chemin via
`ReadWritePaths=` ou pointer un répertoire d'état — SQLite en WAL écrit des
fichiers voisins (`-wal`, `-shm`), une base « lue seulement » ne suffit pas.

Voir aussi : `bxc-ietv`.
