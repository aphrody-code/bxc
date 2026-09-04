---
name: bxc-voiranime
description: This skill should be used for @aphrody/voiranime — the voiranime scraper (anime metadata, episode lists, embedded players, source resolution), the VF/VOSTFR dual-page rule, Kai mapping, and the `bxc voiranime search|info|resolve` CLI.
metadata:
  short-description: Scrape voiranime series, episodes and players.
---

# @aphrody/voiranime

Scraper voiranime (`packages/voiranime`).

## Surface

| Symbole | Rôle |
|---|---|
| `parseAnimeMeta`, `parseAnime` | Fiche série (titre, drapeau `isVF`, …) |
| `parseEpisodeList`, `parseEpisode` | Liste et fiche d'épisode |
| `parsePlayers`, `providerFromUrl` | Lecteurs embarqués et fournisseur d'une URL |
| `AnimeInfo`, `EpisodeInfo`, `PlayerEmbed`, `ResolvedSource`, `MediaQuality` | Formes publiques |

CLI : `bxc voiranime search|info|resolve`, `--profile static|fast|http|stealth|max`.

## La règle des deux pages

Une série a **deux pages distinctes**, VF et VOSTFR, et le titre porte le
drapeau (`"Dragon Ball (VF)"`, détecté via `manga-vf-flag` ou `(VF)` dans le
titre). Ne scraper que l'une des deux laisse un lecteur VF mort sans remplaçant
possible : le catalogue paraît complet et ne l'est pas. Les variantes « Kai »
demandent en plus une correspondance explicite — sans elle, les épisodes
atterrissent sous la mauvaise série.

C'est un cas d'école du piège documenté dans le CLAUDE.md racine : un filtre de
découverte plus strict que le filtre de correction ne lève aucune erreur, il
fait juste disparaître des résultats. Compter et journaliser ce qu'on écarte.

Le cœur de résolution des lecteurs est partagé avec animesama (`src/media/`).
