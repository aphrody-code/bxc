# Rate Limiting

Bunlight provides a per-domain rate limiter that enforces politeness rules when
crawling at scale. It combines a sliding-window algorithm with automatic
robots.txt Crawl-delay support.

## Overview

The `RateLimiter` class lives in `src/throttling/RateLimiter.ts`. It is
completely standalone (no npm dependencies, pure Bun-native) and operates
per-hostname independently, so crawling `host-a.example.com` does not affect
the rate limit of `host-b.example.com`.

The companion `src/throttling/robots.ts` module provides a minimal RFC 9309
robots.txt parser that is used for Crawl-delay extraction and path
allow/disallow checking.

## Quick Start

```ts
import { RateLimiter } from "./src/throttling/RateLimiter.ts";

const limiter = new RateLimiter({
  maxRequestsPerSecond: 4,
  maxRequestsPerMinute: 100,
  respectRobotsTxt: true,
  userAgent: "MyBot/1.0",
});

// In your crawl loop:
for (const url of urls) {
  await limiter.acquire(url);   // blocks until safe to fetch
  const html = await fetch(url).then((r) => r.text());
}
```

## Configuration

```ts
interface RateLimitConfig {
  maxRequestsPerSecond?: number;    // default: 4
  maxRequestsPerMinute?: number;    // default: 100
  respectRobotsTxt?: boolean;       // default: true
  userAgent?: string;               // default: "Bunlight/1.0"
  robotsFetchTimeoutMs?: number;    // default: 8000
  robotsCacheTtlMs?: number;        // default: 3_600_000 (1 hour)
}
```

## Sliding Window Algorithm

Two independent sliding windows are maintained per hostname:

| Window | Duration | Default cap |
|--------|----------|-------------|
| Per-second | 1 second | 4 requests |
| Per-minute | 60 seconds | 100 requests |

On each call to `acquire(url)`:

1. Timestamps older than the window duration are evicted.
2. If either window is at capacity, the limiter sleeps until the earliest
   slot opens (oldest timestamp + window duration).
3. The current timestamp is recorded in both windows.

This approach provides:
- Burst absorption: up to `maxRequestsPerSecond` fast requests are allowed.
- Sustained rate cap: over any 60-second period, at most `maxRequestsPerMinute`
  requests are issued.

## robots.txt Integration

When `respectRobotsTxt: true` (the default), `acquire(url)` automatically:

1. Fetches `/robots.txt` for the URL's origin (first call only; cached for 1h).
2. Applies the matching rules for your `userAgent`.
3. Throws `RateLimitError` with `reason: "disallowed"` if the path is
   disallowed.
4. Waits for `Crawl-delay` seconds to have elapsed since the previous request
   to the same host.

The first request to a host is never delayed by Crawl-delay (there is no
prior request to measure from).

### Fetch failure handling

If the robots.txt fetch fails (404, 5xx, network error, timeout), the limiter
falls back to a permissive rule set (allow everything, no crawl-delay). This
follows RFC 9309 section 2.3.1.2.

## Error Handling

```ts
import { RateLimitError } from "./src/throttling/RateLimiter.ts";

try {
  await limiter.acquire("https://example.com/admin/secret");
} catch (err) {
  if (err instanceof RateLimitError && err.reason === "disallowed") {
    console.warn("URL is disallowed by robots.txt:", err.message);
  }
}
```

`RateLimitError.reason` is one of:
- `"disallowed"` — robots.txt forbids the path.

## API Reference

### `new RateLimiter(config?)`

Construct a new limiter. All config fields are optional.

### `acquire(url): Promise<void>`

Wait until it is safe to fetch `url`. Records the request in the host's
sliding windows. Throws `RateLimitError` if the URL is disallowed by
robots.txt.

### `getRobotsRules(host): Promise<{ crawlDelay?: number; allowed: (path) => boolean }>`

Fetch (and cache) robots.txt rules for a hostname. Concurrent calls for the
same host are coalesced into a single fetch.

### `setRobotsRules(host, rules)`

Inject robots rules manually, bypassing the network fetch. Useful for tests
and for pre-configuring known hosts.

### `getHostStats(host)`

Returns current sliding-window stats for a host, or `undefined` if no
requests have been made:

```ts
{
  requestsInLastSecond: number;
  requestsInLastMinute: number;
  lastRequestAt: number; // ms timestamp
}
```

### `resetHost(host)`

Clear the sliding-window state for one host. Does not affect the robots cache.

### `reset()`

Clear all internal state (windows, robots cache, in-flight fetches). Intended
for tests.

## robots.ts Standalone Parser

The parser module is also usable independently:

```ts
import { parseRobotsTxt, buildRobotRules, fetchRobotRules }
  from "./src/throttling/robots.ts";

// Parse from a string (no network):
const groups = parseRobotsTxt(rawText);
const rules = buildRobotRules(groups, "MyBot/1.0");
console.log(rules.crawlDelay);           // seconds | undefined
console.log(rules.allowed("/private/")); // boolean

// Fetch from the network:
const rules2 = await fetchRobotRules("https://example.com", "MyBot/1.0");
```

### Supported directives

| Directive | Support |
|-----------|---------|
| `User-agent` | Full (multi-agent groups) |
| `Disallow` | Full (empty = allow all) |
| `Allow` | Full |
| `Crawl-delay` | Full (float values) |
| `Sitemap` | Ignored (use `src/utils/robots.ts` for that) |

### Precedence rules (RFC 9309 section 2.2.2)

- Longest matching pattern wins.
- Ties are resolved in favour of `Allow`.
- Exact agent match takes precedence over wildcard `*`.

## Integration with AutoscaledPool

```ts
import { RequestQueue } from "./src/queue/RequestQueue.ts";
import { AutoscaledPool } from "./src/pool/AutoscaledPool.ts";
import { RateLimiter } from "./src/throttling/RateLimiter.ts";

const queue = RequestQueue.open(":memory:");
const limiter = new RateLimiter({ maxRequestsPerSecond: 4 });

queue.addRequests(["https://example.com/a", "https://example.com/b"]);

const pool = new AutoscaledPool({
  minConcurrency: 1,
  maxConcurrency: 10,
  isTaskReadyFunction: async () => queue.stats().pending > 0,
  isFinishedFunction: async () => {
    const s = queue.stats();
    return s.pending === 0 && s.locked === 0;
  },
  runTaskFunction: async () => {
    const [req] = queue.fetchBatch(1);
    if (!req) return;
    try {
      await limiter.acquire(req.url);
      const html = await fetch(req.url).then((r) => r.text());
      queue.markDone(req.id);
      void html;
    } catch (err) {
      queue.markFailed(req.id, String(err));
    }
  },
});

await pool.run();
queue.close();
```

## Performance Notes

- The sliding window uses a simple sorted timestamp array. For crawl rates
  below 1000 req/s this is negligible overhead (O(window_size) eviction).
- The robots cache is in-memory (Map). For very long-running crawlers with
  thousands of unique hosts, consider clearing the cache periodically or
  reducing `robotsCacheTtlMs`.
- `Bun.sleep()` is used for all waits, which is the Bun-native equivalent
  of `setTimeout` wrapped in a Promise, with no polling overhead.
