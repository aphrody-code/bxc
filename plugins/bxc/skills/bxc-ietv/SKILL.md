---
name: bxc-ietv
description: This skill should be used for @aphrody/ietv and @aphrody/ietv-client — the Inazuma Eleven Victory Road episode catalogue (scraper, wiki parsing, YouTube feeds, SQLite cache), the mediabunny-backed VideoTranscoder, and the `bxc ietv` CLI. Includes the FilePathTarget file-descriptor trap.
metadata:
  short-description: Episode catalogue, transcoding and IETV client.
---

# @aphrody/ietv

Catalogue d'épisodes (`packages/ietv`) + client universel (`packages/ietv-client`).

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `IETVScraper` | `src/index.ts` | Découverte des épisodes, saisons, chaînes |
| `IETVCache`, `defaultCachePath` | `src/cache.ts` | Cache SQLite sous `~/.cache/ietv/episodes.db` |
| `parserEpisodes`, `extraireJsonLd`, `identifiantOfficiel` | `src/official.ts` | Parsing du site officiel |
| `parserListeEpisodes`, `indexerChronologie`, `arcDeSection` | `src/wiki.ts` | Parsing wiki + chronologie |
| `parserFluxYoutube`, `extraireChannelId`, `langueDeChaine` | `src/youtube-feed.ts` | Flux YouTube par chaîne |
| `VideoTranscoder`, `COMPRESSION_PROFILES` | `src/video-codec.ts` | Transcodage mediabunny |
| `IETVPlayer` | `src/video-player.ts` | Lecteur HLS côté navigateur |
| `IETVClient` | `packages/ietv-client/src/index.ts` | Client REST (Discord, web, mobile, Tauri) |

CLI : `bxc ietv list|channel|all|discover|check-auth`.

## Le piège du descripteur de sortie

`new Output({ target: new FilePathTarget(chemin) })` **ouvre le fichier dès la
construction** (mediabunny ouvre le handle dans le `start()` du WritableStream).
Ce descripteur n'est rendu que par le `close()` du flux, atteint via
`finalize()` — ce que fait `execute()` — ou via `cancel()` d'un output **déjà
démarré**. Annuler un output resté `pending` laisse donc le handle ouvert :
sous Bun le ramasse-miettes lève alors « FileHandle closed during garbage
collection », et sous Windows le fichier reste verrouillé.

`VideoTranscoder.transcode` libère donc entrée et sortie sous un `finally` qui
démarre l'output si besoin avant de l'annuler. Toute nouvelle construction
d'`Output` doit reprendre ce schéma — y compris quand `initConversion` échoue.

Le cache respecte `HOME`, puis `USERPROFILE`, puis `os.homedir()` : ne pas
composer un chemin depuis une chaîne vide, et ne jamais comparer un chemin à un
littéral POSIX dans un test (`join()` fixe le séparateur natif).

Voir aussi : `bxc-wonderbot` (consommateur du catalogue), `bxc-frames`
(indexation image par image des mêmes épisodes).
