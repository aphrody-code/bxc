# @aphrody/ietv

**Inazuma Eleven TV (IETV)** — YouTube channel scraper for Inazuma Eleven French streaming

Dedicated scraper for aggregating episodes across four official Inazuma Eleven French YouTube channels, resolving episodes by season and episode number.

## Installation

```bash
npm install @aphrody/ietv
# or
bun install @aphrody/ietv
```

## Usage

### Programmatic API

```ts
import IETVScraper from "@aphrody/ietv";

const scraper = new IETVScraper({ profile: "fast" });

// Get episodes from a single channel
const channelInfo = await scraper.getChannelEpisodes("inazumaelevenfrance1");
console.log(`${channelInfo.channel}: ${channelInfo.totalEpisodes} episodes`);

// Aggregate all 4 channels
const allChannels = await scraper.getAllChannelEpisodes();
for (const ch of allChannels) {
  console.log(`${ch.title}: ${ch.seasons.length} seasons`);
}

await scraper.close();
```

### CLI

```bash
# Get episodes from a specific YouTube channel
bxc ietv channel inazumaelevenfrance1
bxc ietv channel inazumatvfr --profile fast

# Scrape official inazuma-eleven.fr streaming site (most complete)
bxc ietv official

# Aggregate all episodes from all 4 YouTube channels + official site
bxc ietv all

# Discover additional Inazuma Eleven channels via Google Search
bxc ietv discover

# Verify YouTube API credentials
bxc ietv check-auth

# List canonical YouTube channels
bxc ietv list
```

## Channels & Sources

### Official Streaming Site
- **inazuma-eleven.fr** (most complete) — https://inazuma-eleven.fr/tv/watch?lang=fr
  - Official French streaming platform
  - Complete episode catalog with proper metadata

### YouTube Channels
- `@inazumaelevenfrance1` — https://www.youtube.com/@inazumaelevenfrance1
- `@inazumatvfr` — https://www.youtube.com/@inazumatvfr
- `@inazumaelevengofrance` — https://www.youtube.com/@inazumaelevengofrance
- `@InazumaTVFR__` — https://www.youtube.com/@InazumaTVFR__

## Output Format

### Channel Info

```json
{
  "channel": "inazumaelevenfrance1",
  "title": "Inazuma Eleven France officiel",
  "description": "Chaîne officielle française d'Inazuma Eleven",
  "avatar": "https://...",
  "seasons": [
    {
      "season": 1,
      "episodes": [
        {
          "title": "Inazuma Eleven - Saison 1 Episode 01",
          "videoId": "abc123def456",
          "url": "https://www.youtube.com/watch?v=abc123def456",
          "description": null,
          "thumbnail": null,
          "publishDate": null,
          "season": 1,
          "episode": 1,
          "duration": null,
          "viewCount": null
        }
        // ... more episodes
      ],
      "totalEpisodes": 51
    }
    // ... more seasons
  ],
  "totalEpisodes": 153
}
```

## Episode & Language Parsing

### Episode Numbers

Episode numbers are parsed from video titles using these patterns (in order of precedence):

1. `S##E##` format: "Season 1 Episode 5" → season 1, episode 5
2. `Saison/Season X Épisode/Episode Y`: "Saison 1 Épisode 5" → season 1, episode 5
3. `Ep. N` format: "Inazuma Eleven Ep. 5" → season 1, episode 5 (defaults to season 1)
4. Trailing numbers: last numeric sequence is treated as episode number

### Language Versions

Videos are automatically classified as:

- **VF** (Version Française) — dubbed in French
  - Detected from: "VF", "Version Française", "Doublage", "Dubbed"
  - Default when title contains "Saison"

- **VOSTFR** (Version Originale Sous-Titrée Française) — original audio + French subtitles
  - Detected from: "VOSTFR", "V.O.STFR", "VO Japonaise", "Japanese Original", "JP French Subs"
  - Takes precedence over VF markers when both found

- **Unknown** — unable to determine from title

This allows filtering episodes by preferred language version:

```ts
const vfOnly = episodes.filter(ep => ep.language === "vf");
const vostfrOnly = episodes.filter(ep => ep.language === "vostfr");
```

## Options

```ts
interface IETVOptions {
  /** Transport profile: "static" (fastest, no JS), "fast", "http", "stealth", "max" */
  profile?: "static" | "http" | "fast" | "stealth" | "max";
  
  /** Per-request timeout in ms (default 30000) */
  timeoutMs?: number;
  
  /** Retries per fetch on transient failure (default 2) */
  retries?: number;
}
```

**Note**: YouTube requires JavaScript execution to load dynamic content. Default profile is `"fast"` which executes JavaScript. Use `"static"` only if you know the page has server-rendered video lists.

## Exports

The module exports the following for advanced use:

```ts
// Types
export type LanguageVersion = "vf" | "vostfr" | "unknown";
export interface VideoRef { /* ... */ }
export interface SeasonInfo { /* ... */ }
export interface ChannelInfo { /* ... */ }
export interface IETVOptions { /* ... */ }

// Functions
export function parseSeasonEpisode(title: string): { season, episode }
export function detectLanguage(title: string): LanguageVersion
export class IETVScraper { /* ... */ }
```

Subpath exports: `./cache` (SQLite cache), `./video-player`, `./video-codec`,
`./video-search`, and `./video` (barrel over the three).

## Video: playback & transcoding

Two optional surfaces, published under their own subpaths so the scraper stays
dependency-free:

| Subpath | Purpose | Runtime deps |
| --- | --- | --- |
| `@aphrody/ietv/video-player` | HLS/MP4 playback with a skinnable UI | `media-chrome`, `hls.js` (optional peers) |
| `@aphrody/ietv/video-codec` | Transcoding & compression profiles | `mediabunny` (bundled), `@mediabunny/server` (optional peer) |
| `@aphrody/ietv/video` | Barrel re-exporting both plus the search layer | — |

### Player (browser)

`media-chrome` provides the controls, `hls.js` the HLS protocol. Both are
loaded lazily at mount time, so importing the module server-side is free.

```bash
npm install media-chrome hls.js
```

```ts
import { IETVPlayer } from "@aphrody/ietv/video-player";

const player = new IETVPlayer({ autoplay: false, startQuality: "auto" });
await player.mount(document.querySelector("#player")!);
await player.load("https://cdn.example/ep1.m3u8"); // format inferred from the URL

player.getQualities();     // [{ index: -1, label: "auto" }, { index: 0, label: "360p" }, …]
player.setQuality(1);      // pin a variant, or "auto" to hand back to the ABR
player.getStats();         // resolution, bitrate, measured fps, buffer health, bandwidth
player.destroy();
```

Native HLS (Safari) is preferred when available. Fatal `hls.js` errors are
recovered per the upstream playbook — reload on network errors, buffer flush on
media errors — and only surface to `onError` when unrecoverable. Without
`media-chrome` installed the player falls back to the browser's native
controls instead of failing.

### Transcoding (server)

[mediabunny](https://mediabunny.dev) encodes through WebCodecs. Bun and Node
don't implement it, so install `@mediabunny/server` (FFmpeg bindings) to get
encoders; `ensureNativeCodecs()` registers them on first use.

```bash
npm install @mediabunny/server
```

```ts
import {
  COMPRESSION_PROFILES,
  VideoTranscoder,
} from "@aphrody/ietv/video-codec";

const transcoder = new VideoTranscoder();

await transcoder.probe("ep1.mkv");
// { durationSeconds, video: { codec, width, height, rotation }, audio: {…} }

const result = await transcoder.transcode("ep1.mkv", "ep1.mp4", {
  profile: COMPRESSION_PROFILES.web_720,
  onProgress: (p) => process.stdout.write(`\r${(p * 100).toFixed(0)} %`),
});
// { sizeBytes, elapsedMs, videoCodec: "h265", discarded: [] }
```

Profiles carry both a target `bitrate` (bits/s) and a `quantizer` (FFmpeg's CRF
equivalent) so the encoder can hold quality constant when it supports it:

| Profile | Codec | Resolution | Bitrate | Quantizer |
| --- | --- | --- | --- | --- |
| `mobile_360` | H.264 / AAC | 360p | 500 kbps | 28 |
| `mobile_480` | H.264 / AAC | 480p | 1 Mbps | 26 |
| `web_720` | H.265 / AAC | 720p | 2 Mbps | 26 |
| `desktop_1080` | H.265 / AAC | 1080p | 4 Mbps | 24 |
| `av1_1080` | AV1 / Opus | 1080p | 1.5 Mbps | 32 |

`VideoCodec.recommendProfile(device, bandwidthMbps)` picks one, and
`VideoCodec.estimateFileSize(durationSeconds, profile)` sizes the output before
running the job. Without an available encoder, `transcode()` fails up front with
the install hint rather than an opaque WebCodecs error.

## Authentication & Credentials

The scraper automatically loads YouTube API credentials from secure sources (in order):

1. **YOUTUBE_API_KEY** environment variable
2. **~/.ietv/auth.json** (JSON file with `key` field)
3. **~/.aphrody/ietv-credentials.json** (JSON file with `youtube_api_key` field)
4. **gcloud** (requires `gcloud auth application-default login`)

### Setup via Aphrody

```bash
# Create credentials directory
mkdir -p ~/.aphrody

# Store YouTube API key securely
echo '{"youtube_api_key": "YOUR_API_KEY"}' > ~/.aphrody/ietv-credentials.json
chmod 600 ~/.aphrody/ietv-credentials.json
```

### Setup via gcloud

```bash
# Authenticate with Google Cloud
gcloud auth application-default login

# Or set service account credentials
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/service-account.json
```

## Channel Discovery

The scraper can discover additional Inazuma Eleven channels beyond the canonical four:

```ts
const scraper = new IETVScraper();
// Credentials are auto-loaded from ~/.aphrody/ or environment
const discoveredChannels = await scraper.discoverChannels(
  "Inazuma Eleven français replay"
);
```

Discovery methods (in order of preference):

1. **YouTube Data API** (automatic if credentials found) — most accurate, ~50 results
2. **Google Search** (fallback) — finds YouTube channels via Google results, slower but free

```bash
# Discover with auto-loaded credentials
bxc ietv discover

# Or override with explicit API key
bxc ietv discover --youtube-api-key "YOUR_API_KEY"

# List credentials status
bxc ietv --check-auth
```

## Limitations

- YouTube's anti-bot measures may rate-limit or block requests in some profiles.
- Episode parsing relies on title conventions; inconsistently-named videos may not parse correctly.
- Video descriptions, durations, and view counts are extracted from HTML when available but may not be complete.
- Discovery via Google Search is slower and may miss some channels.
- For production use, consider using the official [YouTube Data API](https://developers.google.com/youtube/v3) with authentication.

## License

Apache-2.0
