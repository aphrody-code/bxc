---
name: bxc-frames
description: This skill should be used for @aphrody/frames — frame-by-frame anime episode indexing and search, MPEG-7 ColorLayout descriptors, the local SQLite frame index, ffmpeg argument building, and trace.moe fallback. Covers the `bxc frames index|search|vector|list|stats` CLI.
metadata:
  short-description: Index and search anime episodes frame by frame.
---

# @aphrody/frames

Index image par image d'épisodes (`packages/frames`) : descripteur MPEG-7
ColorLayout calculé localement, compatible trace.moe.

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `extractColorLayout`, `CL_DIMS` | `src/descriptor.ts` | Descripteur ColorLayout (Y/Cb/Cr sur DCT) |
| `encodeVector`, `decodeVector`, `packVector`, `unpackVector` | `src/descriptor.ts` | Sérialisation compacte pour SQLite |
| `colorLayoutDistance`, `similarityFromDistance` | `src/descriptor.ts` | Distance et score de similarité |
| `buildFrameArgs`, `buildProbeArgs`, `parseProbe`, `probeMedia`, `decodeStill` | `src/ffmpeg.ts` | Pilotage ffmpeg (arguments construits, jamais concaténés) |
| `FrameIndex`, `defaultIndexPath` | `src/store.ts` | Index SQLite |
| recherche | `src/search.ts` | Requête locale puis repli trace.moe |

CLI : `bxc frames index|search|vector|list|stats|quota`, mode `auto|local`.

## Points de vigilance

`defaultIndexPath()` lit `BXC_FRAMES_DB` puis retombe sur
`~/.cache/bxc/frames.db`, et passe le résultat par `resolve()` : la valeur
renvoyée porte le **séparateur natif**. Un test qui compare à `"/tmp/x.db"`
échoue sous Windows — comparer à `resolve("/tmp/x.db")`.

`FrameIndex` prépare ses requêtes une fois et les finalise dans `close()`, qui
est idempotent : sans cela le fichier `.db` reste verrouillé sous Windows et les
tests ne peuvent plus le supprimer.

Voir aussi : `bxc-ietv` pour la source des épisodes.
