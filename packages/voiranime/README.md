# @aphrody/voiranime

voir-anime.to catalogue scraper and player resolver, built on bxc.

```bash
bxc voiranime search inazuma          # search the catalogue
bxc voiranime info dragon-ball-vf     # metadata + episode list
bxc voiranime resolve <embed-url>     # embed -> direct stream
```

```ts
import { VoiranimeScraper } from "@aphrody/bxc/scrapers/voiranime";

const va = new VoiranimeScraper();
const anime = await va.getAnime("dragon-ball-vf");
const episode = await va.getEpisode(anime.episodes.at(-1)!.url);
const source = await va.resolveSource(episode.players[0], { enumerateQualities: true });
await va.close();
```

Options: `profile` (`static` by default — zero spawn — up to `max`), `baseUrl`,
`timeoutMs`, `retries`.

## Player resolution

Host recognition, packed-script unpacking, media extraction and HLS playlist
parsing no longer live in this package: they sit in the **bxc media core**
(`@aphrody/bxc/media`), shared with `@aphrody/animesama`. Both sites serve the
same hosts, so a dead domain or a changed player page is fixed in one place.

What stays here is voir-anime's own knowledge (WordPress markup, episode lists,
player tabs) plus the translation of the core's result into this package's
vocabulary (`provider`, `headers`, `qualities`).

`resolveSource` therefore also returns the `Referer`/`Origin` headers to replay,
the poster, and HLS variants as **absolute** URLs — two variants of the same
height are told apart by their bitrate — with an explicit error for proprietary
or obfuscated players.
