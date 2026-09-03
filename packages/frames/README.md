# @aphrody/frames

Retrouver **d'où vient une image** : quel épisode, quelle seconde. Index local
image par image, avec trace.moe en recours.

```bash
bxc frames index ~/videos/inazuma-s1e01.mp4 --season 1 --episode 1
bxc frames search capture.jpg
#  96.1%  Inazuma Eleven S1E1  2:41.000 → 2:44.000
```

## Pourquoi un index local

Trois façons de répondre à la question existaient déjà. Mesurées sur Inazuma
Eleven le 3 septembre 2026 :

| | couverture Inazuma Eleven | quota | ce qui sort de la machine |
| --- | --- | --- | --- |
| [trace.moe](https://trace.moe) | partielle : 125 fichiers pour la série d'origine (AniList 5231), 47 pour GO, 51 Chrono Stone, 43 Galaxy, 25 Ares, 48 Orion — rien en VF | 100 recherches / 24 h, **1 requête à la fois** | l'image entière (ou 33 entiers, voir plus bas) |
| [fancaps.net](https://fancaps.net/anime/) | **aucune** — la lettre « I » du catalogue liste 95 séries, pas une seule Inazuma | pas d'API publique, seulement des scrapers tiers | l'URL consultée |
| index local (ce paquet) | ce qu'on lui donne — les 412 épisodes VF du catalogue IETV, par exemple | aucun | **rien** |

L'index public est excellent là où il est complet, et muet ailleurs : les VF,
les diffusions récentes, les films, les extraits — tout ce qu'il n'a jamais
indexé. Un index local coûte 32 Mo pour un catalogue entier et répond en une
demi-seconde ; il n'y a pas de raison de s'en priver.

### Ce que valent les deux, mesuré

- **Une vraie trame d'épisode → trace.moe la reconnaît parfaitement** :
  similarité **0,9919** en envoyant l'image, **0,9920** en n'envoyant que le
  descripteur, horodatage juste à 0,3 s près, 125 ms de latence.
- **Une vignette YouTube brandée ne marche pas** : sur 10 requêtes construites
  à partir des vignettes officielles de la chaîne IETV (bandeau de saison,
  drapeau, logo, numéro d'épisode), 4 seulement retrouvaient la bonne série et
  **une seule** dépassait le seuil de 0,90. Recadrer pour retirer les
  incrustations n'arrange rien : le descripteur est une grille 8×8 sur l'image
  entière, donc rogner déplace tout. Il faut une capture plein cadre.
- **L'index local**, sur les mêmes images : 0,966 pour la trame correspondante,
  et il trouve ce que l'index public n'a pas.

### Débits mesurés (VPS 2 cœurs, ffmpeg 8.0.1)

| | valeur |
| --- | --- |
| indexation d'un épisode de 24 min à 1 img/s | 10,7 s (**135× le temps réel**) |
| idem à 4 img/s | 9,4 s (154×, le décodage domine, pas l'extraction) |
| poids de l'index | 65 à 82 o par trame — **92 Ko** l'épisode à 1 img/s |
| catalogue complet simulé (412 épisodes, 593 280 trames) | **32,5 Mo** |
| recherche exhaustive dans ces 593 280 trames | **~500 ms** |

## Prérequis

`ffmpeg` et `ffprobe` dans le `PATH` (ou `FfmpegDeps.ffmpeg` / `.ffprobe`).
C'est la seule dépendance externe : le descripteur, la base et la recherche
sont en TypeScript pur.

## CLI

```bash
bxc frames index <video...>     # indexe (ffmpeg décode en flux, rien sur disque)
bxc frames search <image>       # local d'abord, trace.moe si le local ne sait pas
bxc frames vector <image>       # les 33 coefficients, en base64 — partageable sans l'image
bxc frames list                 # médias indexés
bxc frames stats                # taille et couverture de l'index
bxc frames quota                # quota trace.moe de cette machine
```

Options utiles : `--fps` (trames indexées par seconde, défaut 1), `--db`
(emplacement de l'index, défaut `~/.cache/bxc/frames.db`, ou `BXC_FRAMES_DB`),
`--local` / `--remote`, `--at 12:34` pour prendre la trame d'une vidéo comme
requête, `--json`.

```bash
# indexer une saison entière
for f in ~/videos/inazuma-s1e*.mp4; do bxc frames index "$f" --season 1 --fps 2; done

# d'où vient cette capture ?
bxc frames search capture.png --limit 3

# à quelle seconde de l'épisode 12 se trouve ce plan ?
bxc frames search plan.jpg --local --limit 1
```

## API

```ts
import { FrameSearch } from "@aphrody/frames";

const frames = new FrameSearch({ indexPath: "~/.cache/bxc/frames.db" });

await frames.indexVideo("ep01.mkv", { fps: 2, title: "Inazuma Eleven", season: 1, episode: 1 });

const found = await frames.search("capture.jpg");
// { origin: "local" | "remote", matches: [{ title, episode, fromMs, atMs, toMs, similarity }] }
```

Briques séparées si la façade ne convient pas :
`@aphrody/frames/descriptor` (extraction, distance), `/extract` (ffmpeg),
`/store` (index SQLite), `/search` (recherche + regroupement en scènes),
`/trace-moe` (client de l'API publique).

## Similarité

Le score suit l'échelle de trace.moe : **au-dessous de 0,90, le résultat est
probablement faux**, quelle que soit sa place au classement. Il est dérivé de
la distance MPEG-7 par `1 − d / 100`, où 100 vient de mesures sur des trames
d'anime décodées par ce module :

| distance | ce que c'est |
| --- | --- |
| 0 – 10 | la même image (ré-encodée, redimensionnée) |
| 10 – 30 | le même plan, à une seconde près |
| > 34 | deux images sans rapport |

La taille de vignette n'influe pas : sur une trame d'épisode, le descripteur
est **identique** entre 64 et 512 pixels de côté (il ne garde que la moyenne de
64 blocs). D'où le décodage en 128×128 par défaut — cent fois moins de pixels
que la pleine résolution, pour le même vecteur.

## Confidentialité

C'est la raison d'être du chemin local. Chercher une image, c'est révéler ce
qu'on regarde ; un service tiers qui reçoit la capture apprend l'image *et*
l'intention.

- **Index local** : rien ne quitte la machine.
- **Recours distant** : `searchByVector` n'envoie que les **33 entiers** du
  descripteur (28 caractères en base64), jamais l'image — et c'est aussi le
  chemin le plus rapide, le serveur n'ayant rien à télécharger ni décoder. Même
  précision mesurée : 0,9920 contre 0,9919 en téléversant le fichier.
- La clé d'API éventuelle part en en-tête `x-trace-key`, jamais dans l'URL.
- `bxc frames vector capture.jpg` donne de quoi faire chercher quelqu'un
  d'autre à votre place, sans lui montrer l'image.

## Limites connues

- **Le descripteur est global** : une incrustation, un bandeau, un recadrage ou
  une bordure changent le vecteur. Une capture plein cadre marche, une vignette
  brandée non (mesuré plus haut). `cutBorders` côté trace.moe ne retire que les
  bandes noires.
- **Deux plans quasi identiques** (un ciel, un fondu au noir, un écran blanc)
  se ressemblent forcément : le score sera élevé et le résultat arbitraire.
- **La recherche est exhaustive** : linéaire en nombre de trames. Une demi-
  seconde pour 600 000 trames ; au-delà de quelques millions, il faudra un
  index approché.
- **L'échantillonnage borne la précision** : à 1 img/s, l'horodatage est juste
  à la seconde. Monter à 4 img/s coûte 4× l'espace, pas le temps d'indexation.
- **trace.moe** : 100 recherches par 24 h sans clé, une seule à la fois (une
  deuxième requête simultanée est refusée avec le même code HTTP qu'un quota
  épuisé — le client distingue les deux avec le quota connu).

## Tests

```bash
bun test packages/frames    # 61 cas, sans ffmpeg, sans réseau
```

Le processus ffmpeg et le `fetch` sont injectables : les tests vérifient les
arguments de commande, rejouent un flux `rawvideo` factice (y compris coupé au
milieu d'une trame) et pilotent l'horloge pour les reprises et les budgets.
