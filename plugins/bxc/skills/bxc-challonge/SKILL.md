---
name: bxc-challonge
description: This skill should be used for @aphrody/challonge — extracting tournament brackets, matches, standings and players from Challonge pages, including the React mount and window.gon state, plus the `bxc challonge` CLI and its saved-HTML fixture path.
metadata:
  short-description: Extract Challonge brackets, matches and standings.
---

# @aphrody/challonge

Extraction de tournois Challonge (`packages/challonge`).

## Surface

| Symbole | Rôle |
|---|---|
| `extractChallongeTournament` | Extrait un tournoi depuis du HTML |
| `extractChallongeTournamentFromFile` | Même chose depuis un fichier local |
| `ChallongeTournamentSnapshot` | Instantané complet (méta, rounds, matches, classement) |
| `ChallongePlayer`, `ChallongeMatch`, `ChallongeRoundInfo`, `ChallongeStandingEntry` | Formes publiques |
| `ChallongeReactMount`, `ChallongeGonState` | Les deux porteurs d'état de la page |
| `ExtractOptions` | Réglages d'extraction |

CLI : `bxc challonge`, profils `static|fast|http|stealth|max`.

## Deux sources d'état dans la page

Challonge expose ses données à deux endroits : le **mount React**
(`ChallongeReactMount`) et le global **`window.gon`** (`ChallongeGonState`).
Ils ne portent pas les mêmes champs et l'un peut manquer selon la page et le
format de tournoi. Lire les deux et fusionner, plutôt que de supposer l'un
présent — une extraction qui « marche » sur un bracket simple peut rendre un
classement vide sur un double-élimination sans lever la moindre erreur.

Les tests s'appuient sur un HTML enregistré et se sautent quand la fixture
manque (`describe.skipIf(!fixtureExists)`) : ne pas les faire dépendre du site
en ligne.
