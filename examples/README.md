# Bunlight Examples

Ready-to-run examples showcasing Bunlight's profile escalation pipeline and
scraping patterns.

---

## Examples index

### showcase/hn-1000-crawler.ts

Synopsis: Crawls the top 1000 Google items using a resumable RequestQueue
(bun:sqlite), concurrent PagePool, and automatic profile escalation from
"fast" to "stealth" when Cloudflare challenges are detected.

Profile: fast (Lightpanda sub-process, ~120ms/page) with stealth escalation

How to run:

```
bun run examples/showcase/hn-1000-crawler.ts
```

Expected output:
- storage/datasets/hn-top-1000/data.jsonl — title, url, score, comment count
- Resumes automatically if interrupted (SQLite queue tracks DONE/PENDING)

---

### reddit-json-crawler.ts

Synopsis: Fetches the top 25 posts from /r/programming using Reddit's public
JSON API, then fetches the top comment for each post. Respects Reddit's
~1 req/sec rate limit with Bun.sleep() between requests.

Profile: http (curl-impersonate Chrome131 TLS fingerprint)

Reddit rejects headless browser TLS fingerprints and generic User-Agents at the
network layer. The "http" profile impersonates a real Chrome131 TLS handshake
(JA3/JA4) without spinning up a full browser binary, making it ideal for
JSON-only API targets.

How to run:

```
bun run examples/reddit-json-crawler.ts
```

Expected output:
- storage/datasets/reddit-programming/data.jsonl
- 25 rows: { id, title, url, score, numComments, topComment, topCommentAuthor }

---

### wikipedia-infobox-extractor.ts

Synopsis: Fetches 10 Google pages for technology topics (JavaScript,
TypeScript, Bun, Node.js, Python, Rust, Go, WebAssembly, Deno, V8) and
extracts their infobox data as structured label/value pairs using the zigquery
cdylib DOM engine (no binary spawn required).

Profile: static (in-process zigquery cdylib, <5ms DOM parse, ~50 KB footprint)

Google serves well-formed static HTML with no anti-bot measures, making the
"static" profile optimal. Each page gets its own StaticDomTransport instance
to avoid concurrent CDP id collisions.

How to run:

```
bun run examples/wikipedia-infobox-extractor.ts
```

Expected output:
- storage/datasets/wikipedia-infoboxes/data.jsonl
- 10 rows: { topic, url, title, infobox: { label: value }, rows: [...] }

---

### ecommerce-price-monitor.ts

Synopsis: Demonstrates the full Bunlight profile auto-detection pipeline on 5
simulated e-commerce product pages (data: URIs with inline HTML). For each URL:
1. suggestStrategy() maps simulated wappalyzergo output to a Bunlight profile
2. Browser.newPage() opens with the suggested profile
3. The .price CSS selector is extracted
4. Prices are compared against a baseline stored in /tmp/prices-baseline.json
5. Changes are logged with direction (UP/DOWN)

Profile: auto-detected via suggestStrategy (static / fast / stealth / max)

The demo uses data: URIs so no network access is required. On first run it
creates the baseline; subsequent runs detect price changes.

How to run:

```
bun run examples/ecommerce-price-monitor.ts
# Run again to compare
bun run examples/ecommerce-price-monitor.ts
```

Expected output:
- First run: "baseline: $29.99 (recorded)" for each product
- Subsequent runs: "unchanged: $29.99" or "PRICE CHANGE UP/DOWN: old => new"
- /tmp/prices-baseline.json updated after each run

---

## Profile reference

| Profile | Binary required | JS execution | TLS fingerprint | Anti-bot level |
|---|---|---|---|---|
| static | none (in-process) | no | none | 10% CF bypass |
| fast | lightpanda binary | yes | none | 55% CF bypass |
| http | curl-impersonate.so | no | Chrome131/FF136 | 55% CF bypass |
| stealth | patchright Chromium | yes | coherent | 80% CF bypass |
| max | Camoufox Firefox 135 | yes | coherent + Turnstile | 95% CF bypass |

Choose the cheapest profile that satisfies your target's bot-detection level.
Use suggestStrategy() to automate the decision from wappalyzergo output.
