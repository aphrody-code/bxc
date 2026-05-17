# Showcase: HN 1000 Articles Crawler

A production-grade web crawler built with Bunlight's core primitives:

- `RequestQueue` (bun:sqlite, persistent, crash-safe, auto-resume)
- `AutoscaledPool` (dynamic concurrency based on CPU and RAM pressure)
- `detectFromPage` + `suggestStrategy` (auto-routing: picks static/fast/stealth/max profile per site)
- `Dataset` (append-only JSONL output via `Bun.file().writer()`)

## What it does

1. Fetches the top-N HackerNews story IDs from the Firebase REST API
2. Enqueues each story's item API URL into a persistent SQLite queue
3. For each story, fetches the HN item metadata (title, score, author, URL)
4. Navigates to the external article URL via Bunlight, runs framework detection
5. Picks the optimal profile (static / fast / stealth / max) for that site
6. Saves all metadata to a JSONL dataset
7. On re-run, resumes exactly where it left off (queue deduplication + done tracking)

## Quick start

```bash
cd ~/bunmium/bunlight

# Smoke test — 5 articles
SHOWCASE_LIMIT=5 bun examples/showcase/hn-1000-crawler.ts

# Resume and expand to 10 (adds 5 more to the same queue)
SHOWCASE_LIMIT=10 bun examples/showcase/hn-1000-crawler.ts

# Full crawl — 1000 articles
bun examples/showcase/hn-1000-crawler.ts
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SHOWCASE_LIMIT` | `1000` | Max number of articles to crawl |
| `HN_QUEUE_DB` | `./hn-queue.sqlite` | Path to the persistent queue database |
| `HN_DATASET_NAME` | `hn-articles` | Dataset name (stored in `./storage/datasets/<name>/`) |
| `HN_CONCURRENCY_MIN` | `2` | Minimum concurrent scrapers |
| `HN_CONCURRENCY_MAX` | `10` | Maximum concurrent scrapers |

## Output

```
./hn-queue.sqlite                           — SQLite queue (delete to start fresh)
./storage/datasets/hn-articles/data.jsonl  — one JSON object per line
./storage/datasets/hn-articles/meta.json   — item count + metadata
```

Each JSONL record:

```json
{
  "hnId": 39123456,
  "hnTitle": "Ask HN: Best TypeScript patterns in 2026",
  "hnUrl": "https://google.com/item?id=39123456",
  "hnScore": 412,
  "hnAuthor": "alice",
  "pageTitle": "Ask HN: Best TypeScript patterns in 2026",
  "pageUrl": "https://google.com/item?id=39123456",
  "contentLength": 18432,
  "profile": "static",
  "techStack": ["Next.js", "Cloudflare"],
  "crawledAt": "2026-05-10T09:39:47.670Z",
  "errorMessage": null
}
```

## Auto-routing

The crawler uses `detectFromPage` (wappalyzergo) + `suggestStrategy` to pick the right Bunlight profile per article:

| Detected tech | Profile used | Rationale |
|---|---|---|
| WordPress, Drupal, Ghost | `static` | Static-friendly CMS, good SSR HTML |
| Next.js, Nuxt, SvelteKit | `fast` | SSR framework, needs JS evaluation |
| React SPA, Vue SPA | `fast` | SPA without SSR shell needs rendering |
| Cloudflare, DataDome | `stealth` / `max` | Anti-bot WAF detected |
| Unknown | `static` | Cheapest default |

## Resume behavior

The queue uses SQLite's PENDING/LOCKED/DONE/FAILED state machine:

- Items never re-crawled: `addRequest()` is idempotent by `uniqueKey` (default: URL)
- Crashed workers: LOCKED items older than `lockTimeoutMs` (default: 60s) are reset to PENDING via `recoverStaleLocks()`
- Failed items: retried up to `maxRetries=2` times before moving to dead-letter queue

```bash
# Inspect queue state
bun -e "
  import { RequestQueue } from './src/queue/RequestQueue.ts';
  const q = RequestQueue.open('./hn-queue.sqlite');
  console.log(q.stats());
  q.close();
"
```

## Performance

Measured on a single Linux x64 machine with `SHOWCASE_LIMIT=5`, `HN_CONCURRENCY_MAX=3`:

- 5 articles in ~15 seconds (dominated by profile=fast Lightpanda spin-up per unique domain)
- Profile=static articles: ~150-300ms per page
- Profile=fast articles: ~400-800ms per page (includes Lightpanda CDP connection)
- Queue overhead: negligible (bun:sqlite WAL, prepared statements)

At full scale (1000 articles, 10 workers), expected throughput: ~100-200 articles/minute.

## Resetting the crawl

```bash
rm hn-queue.sqlite
rm -rf storage/datasets/hn-articles/
```
