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
bxc ietv channel inazumaelevenfrance1
bxc ietv channel inazumatvfr --profile fast
bxc ietv all
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

## Episode Parsing

Episode numbers are parsed from video titles using these patterns (in order of precedence):

1. `S##E##` format: "Season 1 Episode 5" → season 1, episode 5
2. `Saison/Season X Épisode/Episode Y`: "Saison 1 Épisode 5" → season 1, episode 5
3. `Ep. N` format: "Inazuma Eleven Ep. 5" → season 1, episode 5 (defaults to season 1)
4. Trailing numbers: last numeric sequence is treated as episode number

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

## Limitations

- YouTube's anti-bot measures may rate-limit or block requests in some profiles.
- Episode parsing relies on title conventions; inconsistently-named videos may not parse correctly.
- Video descriptions, durations, and view counts are extracted from HTML when available but may not be complete.
- For production use, consider using the official [YouTube Data API](https://developers.google.com/youtube/v3).

## License

Apache-2.0
