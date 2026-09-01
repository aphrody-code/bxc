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
# Get episodes from a specific channel
bxc ietv channel inazumaelevenfrance1
bxc ietv channel inazumatvfr --profile fast

# Aggregate all episodes from canonical channels
bxc ietv all

# Discover additional Inazuma Eleven channels
bxc ietv discover

# List canonical channels
bxc ietv list
```

## Channels

The scraper aggregates from these official Inazuma Eleven French YouTube channels:

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
