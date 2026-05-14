---
description: Framework detection with wappalyzergo. Identify technologies on a target, suggest optimal Bunlight profile, and route accordingly.
---

# Framework Detection

Bunlight includes automatic technology detection via wappalyzergo, a vendored Go binary from projectdiscovery.

## API

### detectFrameworks(input: DetectInput, options?: DetectOptions): Promise<DetectedTech[]>

Detect technologies on a target.

```ts
import { detectFrameworks } from "@bunmium/bunlight/detect";

// Direct URL fetch
const tech = await detectFrameworks("https://nextjs.org");
console.log(tech);
// [
//   { name: "Next.js", version: "14.1.0", categories: ["JS Framework"] },
//   { name: "React", categories: ["JS Framework"] },
//   { name: "Node.js", categories: ["Languages"] }
// ]

// Or pass raw HTML + headers
const tech2 = await detectFrameworks({
  html: "<html>...</html>",
  headers: { "x-powered-by": "Express" }
});
```

**DetectInput**: `string | { url?: string; html: string; headers?: AnyHeaders }`

**DetectedTech**:
```ts
interface DetectedTech {
  name: string;              // "Next.js", "WordPress", "Cloudflare"
  version?: string;          // "14.1.0"
  categories: string[];      // ["JS Framework"]
  description?: string;
  website?: string;
  cpe?: string;              // CVE identifier
  icon?: string;
}
```

### detectFromPage(page: Page, options?: DetectOptions): Promise<DetectedTech[]>

Convenience wrapper that works with any Bunlight page.

```ts
import { detectFromPage } from "@bunmium/bunlight/detect";
import { Browser } from "@bunmium/bunlight";

const page = await Browser.newPage({ profile: "fast" });
await page.goto("https://example.com");
const tech = await detectFromPage(page);
```

Works across all profiles (`static`, `fast`, `stealth`, `max`) because it only needs the rendered HTML + headers.

## Common detections

Bunlight recognizes 1000+ technologies. Common categories:

### JavaScript Frameworks
- React, Vue, Angular, Svelte, Next.js, Nuxt, SvelteKit, Remix, Astro, Qwik

### Backend Frameworks
- Express, Django, Flask, Rails, Laravel, Spring, ASP.NET, Fastify, Hono

### CMS
- WordPress, Shopify, Drupal, Magento, Strapi, Contentful

### Frontend Frameworks
- Tailwind CSS, Bootstrap, Material-UI, Chakra UI

### Hosting / WAF / CDN
- Cloudflare, AWS, Azure, Vercel, Netlify, Akamai, Fastly

### Analytics / Tracking
- Google Analytics, Segment, Mixpanel, Hotjar

### Servers
- Apache, Nginx, IIS, Node.js, Python

## Routing with suggestProfile

### suggestProfile(tech: DetectedTech[]): Profile

Suggest a Bunlight profile based on detected technologies.

```ts
import { suggestProfile } from "@bunmium/bunlight/router/framework-strategy";

const tech = await detectFrameworks("https://example.com");
const profile = suggestProfile(tech);

console.log(`Suggested: profile "${profile}"`);
// Output: "fast" (if React detected), "stealth" (if Cloudflare), etc.
```

**Rules**:
- React, Vue, Angular, Svelte, SPA → suggest `"fast"`
- Cloudflare, Akamai, DataDome → suggest `"stealth"` (or `"max"` if high-value target)
- No JS detected + Cloudflare → suggest `"http"` with cookies
- Pure HTML → suggest `"static"`

## Challenge detection

### detectChallenge(html: string): ChallengeType | null

Detect if the HTML is a Cloudflare, Akamai, or other WAF challenge page.

```ts
import { detectChallenge } from "@bunmium/bunlight/router/challenge-detect";

const page = await Browser.newPage({ profile: "fast" });
await page.goto(url);
const html = await page.content();

const challenge = detectChallenge(html);
if (challenge === "cloudflare-iuam") {
  console.log("Cloudflare IUAM challenge detected → escalate to stealth/max");
}
```

**ChallengeType**: `"cloudflare-iuam"`, `"cloudflare-basic"`, `"akamai"`, `"datadome"`, `"turnstile"`, `null`

## Example: Auto-routing

Detect and automatically choose the best profile:

```ts
import { detectFrameworks, detectChallenge } from "@bunmium/bunlight/detect";
import { suggestProfile } from "@bunmium/bunlight/router/framework-strategy";
import { Browser } from "@bunmium/bunlight";

async function scrapeWithAutoRouting(url: string) {
  // First attempt: static (fast)
  let page = await Browser.newPage({ profile: "static" });
  await page.goto(url);

  // Check what we got
  const html = await page.content();
  const challenge = detectChallenge(html);

  if (challenge) {
    console.log(`Challenge detected: ${challenge}`);
    // Re-open with better profile
    await page.close();
    page = await Browser.newPage({ profile: "stealth" });
    await page.goto(url);
  }

  // Detect tech
  const tech = await detectFromPage(page);
  console.log(tech.map(t => t.name).join(", "));

  // Extract data...
  await page.close();
}
```

## Example: Build a technology profile report

```ts
import { detectFrameworks } from "@bunmium/bunlight/detect";
import { Bun } from "bun";

const urls = [
  "https://nextjs.org",
  "https://react.dev",
  "https://example.com"
];

const report = await Promise.all(
  urls.map(async url => ({
    url,
    tech: await detectFrameworks(url)
  }))
);

// Export as JSON
await Bun.write(
  "tech-report.json",
  JSON.stringify(report, null, 2)
);
```

## Performance notes

- **Direct URL mode**: Binary fetches the page itself (~1-5 sec depending on network)
- **HTML mode**: Instant detection on pre-rendered HTML
- **detectFromPage**: Best for SPAs already rendered by Bunlight

For massive crawls, prefer `detectFromPage()` after rendering:

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";
import { detectFromPage } from "@bunmium/bunlight/detect";

const pool = new PagePool({ profile: "fast", concurrency: 10 });
const results = await pool.run(urls, async (page, url) => {
  await page.goto(url);
  const tech = await detectFromPage(page);
  return { url, tech };
});
```

## Offline detection

The wappalyzergo binary requires internet access to download the fingerprint catalog on first run (once cached, offline works). To avoid network access in production:

```bash
# Pre-download the catalog in CI
bun scripts/cache-wappalyzer.ts
```

Then pass the cached path:

```ts
const tech = await detectFrameworks(url, {
  binaryPath: "/opt/wappalyzergo-cli"
});
```

## See also

- `references/profiles.md` — `suggestProfile(tech)` mapping per detected stack.
- `references/cookbook.md` — recipe #5 (detect framework → choose profile).
- Agent `bunlight-scraper` — uses detection to pick the cheapest viable profile.
- Command `/bunlight-detect` — one-shot detection for an arbitrary URL.
