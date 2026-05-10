# Framework Detection

Bunlight ships with a fast, batteries-included framework / CMS / WAF detector
backed by the [`projectdiscovery/wappalyzergo`](https://github.com/projectdiscovery/wappalyzergo)
library (Go, MIT). The catalog is the [`enthec/webappanalyzer`](https://github.com/enthec/webappanalyzer)
fork of Wappalyzer's original dataset (~3000 technologies, daily updates).

The Go library is wrapped in a tiny CLI (`vendor/wappalyzergo/wappalyzergo-cli`)
which we drive from TypeScript via a `child_process.spawn`. This keeps the
runtime dependency-free for end users (everything is statically linked into a
~13 MB binary that is built once and committed to the repo).

## Architecture

```
┌──────────────────────────────────┐
│  bun (TypeScript)                │
│                                  │
│  src/detect.ts                   │
│    ├─ detectFrameworks(input)    │
│    └─ detectFromPage(page)       │
│           │                      │
│           ▼ stdin/argv           │
│  ┌──────────────────────────┐    │
│  │ vendor/wappalyzergo/     │    │
│  │   wappalyzergo-cli  (Go) │    │
│  │   ├─ Wappalyzer.New()    │    │
│  │   └─ FingerprintWithInfo │    │
│  └──────────────────────────┘    │
│           │                      │
│           ▼ JSON over stdout     │
│  src/router/framework-strategy.ts│
│    └─ suggestStrategy(detected)  │
└──────────────────────────────────┘
```

## API

### `detectFrameworks(input, opts?)`

```ts
import { detectFrameworks } from "bunlight/detect";

// URL mode — Go fetches with its own net/http client.
const tech = await detectFrameworks("https://nextjs.org");

// Pre-fetched mode — re-use HTML+headers you already have.
const tech2 = await detectFrameworks({
    url: "https://nextjs.org",
    html: "<!doctype html>...",
    headers: { "content-type": "text/html", "cf-ray": "..." },
});
```

Returns `DetectedTech[]`:

```ts
interface DetectedTech {
    name: string;              // "Next.js", "WordPress", ...
    version?: string;          // "14.0.4" if the fingerprint matched a version
    categories: string[];      // ["JavaScript frameworks"]
    description?: string;
    website?: string;
    cpe?: string;
    icon?: string;
}
```

### `detectFromPage(page, opts?)`

Convenience wrapper for any Bunlight `Page` (or any `{ url(), content() }`):

```ts
import { Browser } from "bunlight/browser";
import { detectFromPage } from "bunlight/detect";

const page = await Browser.newPage({ profile: "fast" });
await page.goto("https://example.com");
const tech = await detectFromPage(page);
```

This pattern is preferred for SPAs because it runs the detector against
**hydrated HTML**, where most JS-framework fingerprints live (e.g. `__NEXT_DATA__`,
`window.__NUXT__`, etc.).

### `suggestStrategy(detected)` — `bunlight/router/framework-strategy`

Maps a detection result onto a scraping plan:

```ts
import { suggestStrategy } from "bunlight/router/framework-strategy";

const plan = suggestStrategy(tech);
//   { profile: "stealth",
//     waitFor: "domcontentloaded",
//     blockResources: ["image", "media", "font"],
//     hints: { reDetectAfterHydration, isSPA, hasAntiBot, shape },
//     rationale: ["anti-bot WAF detected: cloudflare → profile=stealth"] }

const page = await Browser.newPage({ profile: plan.profile });
```

Mapping summary :

| Signal                                    | Profile   | Wait              |
|-------------------------------------------|-----------|-------------------|
| DataDome / Akamai BM / PerimeterX / Kasada| `max`     | `wait-hydration`  |
| Cloudflare / Imperva / generic anti-bot   | `stealth` | `domcontentloaded`|
| Plain SPA (React/Vue/Svelte/Angular only) | `fast`    | `wait-hydration`  |
| Next.js / Nuxt / SvelteKit / Astro / Gatsby| `fast`   | `domcontentloaded`|
| WordPress / Drupal / Ghost / Shopify      | `static`  | `load`            |
| Empty / unknown                           | `static`  | `load` + reDetect |

## Recommended workflow

For unknown sites, a *two-pass* detection works best :

```ts
import { Browser } from "bunlight/browser";
import { detectFrameworks, detectFromPage } from "bunlight/detect";
import { suggestStrategy } from "bunlight/router/framework-strategy";

// Pass 1 — cheap probe with no JS execution.
let tech = await detectFrameworks(url);
let plan = suggestStrategy(tech);

// Pass 2 — only if the first pass said the page is a SPA / unknown.
if (plan.hints.reDetectAfterHydration) {
    const page = await Browser.newPage({ profile: plan.profile });
    await page.goto(url);
    tech = await detectFromPage(page);
    plan = suggestStrategy(tech);
}
```

This minimises browser launches : ~95% of public sites can be classified in a
single 200 ms HTTP probe.

## Building the binary

The `wappalyzergo-cli` binary is committed at
`vendor/wappalyzergo/wappalyzergo-cli`. To rebuild:

```sh
cd vendor/wappalyzergo/cli
go build -o ../wappalyzergo-cli .
```

The binary embeds the entire fingerprint catalog at build time
(`fingerprints_data.json`). To pick up a newer catalog:

```sh
cd vendor/wappalyzergo/cli
go get -u github.com/projectdiscovery/wappalyzergo@latest
go build -o ../wappalyzergo-cli .
```

The `BUNLIGHT_WAPPALYZERGO_BIN` env var overrides the binary path for testing.

## Limitations

- **SPAs** : Wappalyzer's HTML/header fingerprints can miss frameworks that
  only manifest after JS hydration. Use `detectFromPage()` after navigation
  for those.
- **Header-only fingerprints** : `detectFromPage()` does *not* currently
  expose response headers (the `Page` API does not surface them). For WAF /
  CDN detection (which lives mostly in headers), prefer the URL form of
  `detectFrameworks()` or pass a `headers` map explicitly.
- **First-call latency** : ~50 ms cold for the subprocess + ~200 ms for the
  catalog. Consider amortising calls if you scrape many URLs.
- **Catalog drift** : the embedded catalog is frozen at build time. Rebuild
  the binary periodically to track upstream changes.

## Testing

```sh
# Pure / offline tests + all 4 network sites
bun test test/integration/detect.test.ts

# Skip network tests in CI
SKIP_NETWORK_TESTS=1 bun test test/integration/detect.test.ts
```

## Sources

- Wappalyzergo : <https://github.com/projectdiscovery/wappalyzergo>
- Catalog (enthec) : <https://github.com/enthec/webappanalyzer>
- Original Wappalyzer : <https://github.com/AliasIO/wappalyzer>
