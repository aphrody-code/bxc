# 🎬 Video Libraries Research — Best-in-Class 2024-2025

**Research completed** — 2026-09-01 21:31 UTC  
**Method**: npm registry API + GitHub API + README/docs scraping  
**Confidence**: Medium-High (chiffres vérifiés, ordres de magnitude conventionnels industrie)

---

## 🎯 Top Picks

### 1️⃣ Video Player: **media-chrome + hls.js** (RECOMMENDED)

**media-chrome** — `npm install media-chrome`
- v4.19.2 (2026-08-22), 2,735★, 11 open issues, **actively maintained** (push 2026-08-21)
- **41.9 KB gzipped**, 1 dependency, Web Components (pure, zero framework lock-in)
- UI layer for native `<video>` + HLS.js/DASH.js backends
- + Lightweight, accessible (ARIA), Bun-safe (no Node APIs), skinnable controls
- − Needs external HLS/DASH engine (not self-contained)

**hls.js** — `npm install hls.js`
- v1.7.1 (2026-08-19), 16.9k★, **pushed 2026-09-01 (today)** — most active of the lot
- **177 KB gzipped**, 0 dependencies, pure TypeScript
- HLS protocol reference implementation (Disney, Canal+, Twitch use it)
- + Mature buffer management, ubiquitous HLS support, no external binaries
- − HLS only (need dash.js for DASH; media-chrome handles this)

**Alternative**: `vidstack@next` (batteries-included, multi-framework)
- 3,667★, pushed 2026-08-21, successor to Plyr 3.x and Vime 5.x
- ⚠️ **Critical**: npm tag `latest` (0.6.15) is stale (April 2024). Use `vidstack@next` (1.15.6, June 2026). Default `latest` tag is misleading in CI.
- + Wraps HLS.js/DASH.js internally, works React/Vue/Svelte/Solid/Web Components
- − Heavier than media-chrome, tag confusion in npm

**Recommendation**: Use **media-chrome + hls.js** for IETV (lightweight, Bun-safe, discoverable). Switch to `vidstack@next` if multi-framework support needed.

---

### 2️⃣ Video Compression: **mediabunny + @mediabunny/server** (RECOMMENDED)

**mediabunny** — `npm install mediabunny`
- v1.55.5 (2026-08-31, **yesterday**), 7,071★, created Sept 2024, **MPL-2.0 license**
- **Zero dependencies**, pure TypeScript, explicitly supports "Node, Bun, and Deno"
- Encode/decode via WebCodecs API (AVC, HEVC, VP9, **AV1**, ProRes) with hardware acceleration
- CRF mode (constant quality) since v1.52.0 (July 2026) — exactly the quality/size tradeoff requested
- Bundle: 167 KB full (tree-shakable to 5 KB for targeted use)
- + **Bun officially supported**, modern TS API (`Conversion`, `Input`/`Output`), remux/transcode/resize/crop in one API
- − `@mediabunny/server` needs `node-av` bindings (native encoders, 368★, created Aug 2025, very active)

**@mediabunny/server** — `npm install @mediabunny/server`
- Polyfill server-side encoding via `node-av` (FFmpeg bindings, modern zero-copy)
- Adds native encoders/decoders + multithreading
- Call from same Bun process that writes to IETVCache (no subprocess management needed)

**Alternative**: FFmpeg CLI via `Bun.spawn`
- `ffmpeg-static` (npm, Nov 2025) provides prebuilt binary
- Call directly: `await Bun.spawn(["ffmpeg", ...args]).exited`
- **Avoid** `fluent-ffmpeg` (archived 2025-05-22, do not use for new code)
- **SVT-AV1** (`github.com/AOMediaCodec/SVT-AV1`) is the reference codec (Netflix/Intel/AOM)
  - 20-50% bitrate savings vs H.264 (at equal quality)
  - 20-30% savings vs HEVC/VP9
  - Encoding cost higher; compensated by SVT-AV1 fast presets

**Codec tradeoffs** (industry standard, not measured this session):
- AV1: 20-50% bitrate vs H.264
- VP9: ~10-20% vs H.264
- HEVC: ~15-25% vs H.264

**Recommendation**: Use **mediabunny + @mediabunny/server** for unified Bun-native pipeline (read metadata + transcode + save in same process). If prefer FFmpeg stability, use `ffmpeg-static + Bun.spawn`.

---

### 3️⃣ Video Search: **SQLite FTS5 (existing)** + Optional Enhancements

**Current** (already in `cache.ts`):
- SQLite FTS5 full-text search (built-in)
- Covers IETV scale (~1,200 episodes)
- Fuzzy matching already implemented (Levenshtein distance in `video-search.ts`)

**Metadata extraction** (optional, for local video files):
- `mediainfo.js` (v0.3.7, Jan 2026, 869★) — WASM port of MediaInfoLib (C++)
  - Extract codecs, tracks, HDR, chapters
  - + Richer than ffprobe raw JSON
  - − WASM overhead
  - Use for deep inspection (duration, codec info already in cache)

**Thumbnail generation** (optional, for self-hosted videos):
- `mediabunny CanvasSink` — extract frames at multiple timestamps in one pass
- Currently: YouTube thumbnails free via `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg`
- No lib needed for external sources

**Full-text search engines** (future, if 10k+ episodes):
- `meilisearch` (v0.60.0, July 2026, very active) — Rust backend, typo-tolerant, faceting
- `typesense` (v3.0.6, pushed 2026-08-31) — similar, Rust/C++ based
- **Both require self-hosting** (no SaaS, privacy-first)

**Recommendation**: Keep SQLite FTS5 for now. Add `mediainfo.js` only if implementing self-hosted/local video mode. Upgrade to meilisearch only if IETV grows beyond 10k episodes.

---

## 📊 Integration Plan

| Phase | Component | Library | Priority | Status |
|-------|-----------|---------|----------|--------|
| **1** | Player | media-chrome + hls.js | High | ✅ Done — `src/video-player.ts` |
| **1** | Search | SQLite FTS5 (existing) | Immediate | ✅ Done — `src/cache.ts` + `src/video-search.ts` |
| **2** | Compression | mediabunny + @mediabunny/server | High | ✅ Done — `src/video-codec.ts` |
| **2** | Thumbnails | YouTube free URLs | Medium | Ready (no lib needed) |
| **3** | Metadata | mediainfo.js | Medium | Planned |
| **3** | Advanced search | meilisearch | Future | Planned |

### Ce qui a été implémenté (2026-09-01)

- **`src/video-player.ts`** — `IETVPlayer` : montage media-chrome autour d'une
  balise `<video>`, HLS via hls.js avec préférence pour le décodage natif
  (Safari), sélection de variante, statistiques réelles (fps mesurés, santé du
  tampon, bande passante) et reprise sur erreur fatale. `media-chrome` et
  `hls.js` sont des `peerDependencies` **optionnelles** chargées au montage :
  importer le module côté serveur ne coûte rien, et sans media-chrome le player
  retombe sur les contrôles natifs.
- **`src/video-codec.ts`** — `VideoTranscoder` (probe + transcode mediabunny,
  progression, annulation par `AbortSignal`) et profils portant à la fois un
  débit cible et un quantizer (l'équivalent CRF). Bun n'implémente pas
  WebCodecs : `ensureNativeCodecs()` charge paresseusement
  `@mediabunny/server` (optionnel) et, à défaut d'encodeur, `transcode()`
  échoue d'emblée avec le paquet à installer.
- **Tests** : `src/video.test.ts` (62 cas) — doublures hls.js et `<video>`,
  moteur de conversion et horloge injectés, aucun encodage ni réseau réel.
- **Retiré** : `src/video-libs.ts`, catalogue de bibliothèques qui doublonnait
  ce document sans code exécutable.

**NPM additions**: `mediabunny` en dépendance (167 KB, tree-shakable) ; `media-chrome` (42 KB), `hls.js` (177 KB) et `@mediabunny/server` en peers optionnels — rien n'entre dans le binaire `bxc`, qui n'importe que le scraper.

---

## 🎯 Recommended Stack for IETV v1.2

```typescript
// Player
import MediaChromePlayer from 'media-chrome/player'
import HLS from 'hls.js'
// OR
import { Player } from 'vidstack/react' // if multi-framework

// Compression (self-hosted mode)
import { Conversion } from 'mediabunny'
import { FFmpegTranscoder } from '@mediabunny/server'

// Search (current)
cache.search({ q, season, language }) // SQLite FTS5

// Metadata (optional)
import mediainfo from 'mediainfo.js'

// Deployment
// FROM oven/bun:latest (no FFmpeg binary needed if using WebCodecs)
```

---

## ⚠️ Important Notes

1. **vidstack tag confusion**: `vidstack@latest` (0.6.15) is old; use `vidstack@next` (1.15.6)
2. **fluent-ffmpeg archived**: Don't use; spawn FFmpeg directly via `Bun.spawn`
3. **YouTube thumbnails free**: `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg` requires no lib/auth
4. **mediabunny young ecosystem**: Published 2026-08-31 (very recent), watch for breaking changes in minor versions
5. **Privacy-first**: Self-host meilisearch/typesense if implementing full-text search at scale

---

## 📚 Sources

- npm registry API: vidstack, media-chrome, hls.js, video.js, shaka-player, plyr, mediainfo.js, mediabunny, node-av, ffmpeg-static, @ffmpeg/ffmpeg, meilisearch, typesense
- GitHub API: Vanilagy/mediabunny, vidstack/player, video-dev/hls.js, mux-inc/media-chrome, seydx/node-av, AOMediaCodec/SVT-AV1
- Project READMEs: mediabunny.dev, vidstack.io, hls.js docs, media-chrome docs
- Related files: `packages/ietv/src/cache.ts`, `packages/ietv/src/video-search.ts`, `packages/ietv/src/index.ts`

**Research date**: 2026-09-01 21:31 UTC
