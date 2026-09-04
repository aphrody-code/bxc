---
name: bxc-worldbeyblade
description: This skill should be used for @aphrody/worldbeyblade — the World Beyblade Organization forum scraper and metagame analytics: combo parsing, blade/bit normalisation, podium extraction, tournament threads, rankings, and the `bxc worldbeyblade` CLI (status, profile, thread, forum, search, inbox, sendpm).
metadata:
  short-description: Scrape WBO tournaments and compute metagame analytics.
---

# @aphrody/worldbeyblade

Scraper du forum World Beyblade Organization + analyse du métagame
(`packages/worldbeyblade`).

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `parseTournamentsFromHtml`, `parseTournamentsFromThread` | `src/scraper.ts` | Tournois depuis une page ou un fil |
| `parsePodiumFromPostHtml`, `isPlacement` | `src/scraper.ts` | Podium d'un message |
| `cleanComboLine`, `cleanStageComments`, `parseComboSplit` | `src/scraper.ts` | Nettoyage des combos écrits à la main |
| `normalizeBlade`, `normalizeBit`, `BLADE_MAP`, `BIT_MAP`, `BLADE_KEYWORDS` | `src/scraper.ts` | Normalisation des pièces |
| `calculateMetagameAnalytics`, `runFullMetagameAnalysis` | `src/analytics.ts` | Taux de présence, classements |
| rankings | `src/rankings.ts` | Classements joueurs |

CLI : `bxc worldbeyblade status|profile|thread|forum|search|inbox|sendpm`.

## Normaliser sans manger du vrai texte

Les combos sont saisis à la main : abréviations, fautes, commentaires de stage
mêlés à la ligne. `normalizeBlade`/`normalizeBit` s'appuient sur des tables
explicites (`BLADE_MAP`, `BIT_MAP`) plutôt que sur des heuristiques floues,
parce qu'une règle à 50 % de faux positifs est pire que le défaut : le défaut se
voit, la fausse normalisation non.

Toute nouvelle règle de nettoyage vient avec son comptage mesuré et son
contre-exemple cherché. Un détecteur **annote**, il ne filtre pas : écarter un
candidat avant de l'avoir compté fait disparaître des résultats en silence.

`sendpm` écrit sur le forum : action sortante, à ne déclencher que sur demande
explicite.
