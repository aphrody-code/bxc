# enqueueLinks helper

Bunlight helper that automatically extracts and enqueues hyperlinks from a page.

## Overview

`enqueueLinks` mirrors the Crawlee `enqueueLinks` utility: it finds all anchor elements
on a page, resolves their hrefs to absolute URLs, applies filtering rules, and feeds
the accepted URLs into a `RequestQueue`.

Key properties:
- Bun-native: glob matching via `Bun.Glob`, no external packages.
- URL resolution via the global `URL` constructor (handles relative, absolute, and
  protocol-relative hrefs).
- Session-level deduplication (in-memory `Set`) prevents redundant SQLite writes.
- Cross-session deduplication via `RequestQueue`'s `UNIQUE` constraint on `unique_key`.
- Discards non-navigable schemes: `mailto:`, `javascript:`, `data:`, `tel:`, `#` anchors.
- Strips URL fragments before enqueueing.

## Import

```typescript
import { enqueueLinks } from "bunlight/helpers/enqueueLinks";
import type { EnqueueLinksOptions, EnqueueLinksResult } from "bunlight/helpers/enqueueLinks";
```

## API

### `enqueueLinks(opts: EnqueueLinksOptions): Promise<EnqueueLinksResult>`

#### Options

| Field | Type | Default | Description |
|---|---|---|---|
| `page` | `Page` | required | The Bunlight page to extract links from. |
| `queue` | `RequestQueue` | required | The destination request queue. |
| `selector` | `string` | `"a[href]"` | CSS selector for link elements. |
| `baseUrl` | `string` | `page.url()` | Override for resolving relative hrefs. |
| `globs` | `string[]` | `[]` | Glob patterns; link must match at least one (uses `Bun.Glob`). Ignored when `regexps` is non-empty. |
| `regexps` | `RegExp[]` | `[]` | Regexp patterns; link must match at least one. Takes precedence over `globs`. |
| `limit` | `number` | `Infinity` | Maximum links to enqueue per call. |
| `transform` | `(url: string) => string \| null` | none | Rewrite or discard individual URLs. Return `null` to skip. |
| `strategy` | `"same-hostname" \| "same-domain" \| "all"` | `"same-hostname"` | Domain filtering strategy. |

#### Strategy values

- `"same-hostname"` (default) — only links whose hostname exactly matches the base page's hostname. Subdomains are rejected (`sub.example.com` != `example.com`).
- `"same-domain"` — relaxed: allows any hostname sharing the same registrable domain (last two labels). `sub.example.com` is accepted when the base is `example.com`.
- `"all"` — no domain restriction; any valid `http:` or `https:` URL is accepted.

#### Return value

```typescript
interface EnqueueLinksResult {
  added: number;   // URLs newly inserted into the queue
  skipped: number; // URLs filtered out or already present
}
```

## Examples

### Basic crawl

```typescript
import { Browser } from "bunlight/api/browser";
import { RequestQueue } from "bunlight/queue/RequestQueue";
import { enqueueLinks } from "bunlight/helpers/enqueueLinks";

const queue = RequestQueue.open("./crawl.db");
const page = await Browser.newPage({ profile: "fast" });

await page.goto("https://example.com");
const { added, skipped } = await enqueueLinks({ page, queue });
console.log(`Enqueued ${added} links (${skipped} skipped)`);

await page.close();
```

### Restrict to a URL path prefix with globs

```typescript
const { added } = await enqueueLinks({
  page,
  queue,
  strategy: "all",
  globs: ["https://example.com/blog/**", "https://example.com/docs/**"],
});
```

### Filter with a regexp

```typescript
const { added } = await enqueueLinks({
  page,
  queue,
  strategy: "all",
  regexps: [/\/products\/\d+/],
});
```

### Remove tracking parameters before enqueueing

```typescript
const { added } = await enqueueLinks({
  page,
  queue,
  strategy: "same-domain",
  transform: (url) => {
    const u = new URL(url);
    // Strip common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "ref", "fbclid"].forEach((p) =>
      u.searchParams.delete(p),
    );
    return u.href;
  },
});
```

### Limit discovery depth per page

```typescript
// Enqueue at most 10 links per page to control crawl width
const { added } = await enqueueLinks({ page, queue, limit: 10 });
```

### Breadth-first crawler loop

```typescript
import { Browser } from "bunlight/api/browser";
import { RequestQueue } from "bunlight/queue/RequestQueue";
import { enqueueLinks } from "bunlight/helpers/enqueueLinks";

const queue = RequestQueue.open(":memory:");
queue.addRequest("https://example.com");

for await (const batch of queue.drain(1)) {
  for (const req of batch) {
    const page = await Browser.newPage({ profile: "fast" });
    try {
      await page.goto(req.url);
      await enqueueLinks({ page, queue, limit: 20 });
    } finally {
      queue.markDone(req.id);
      await page.close();
    }
  }
}
```

## Filtering order

When evaluating each candidate link, `enqueueLinks` applies filters in this order:

1. Scheme check — discard `mailto:`, `javascript:`, `data:`, `tel:`, `#`, etc.
2. URL resolution — reject malformed hrefs.
3. Strategy filter (`same-hostname`, `same-domain`, or `all`).
4. Pattern filter: regexps (if provided) OR globs (if provided, and no regexps).
5. User `transform` function.
6. Session dedup (in-memory `Set`).
7. Queue dedup (SQLite `UNIQUE` constraint on `unique_key`).

## Side effects on StaticDomTransport

To support `enqueueLinks` on the `"static"` profile, a bug was fixed in
`StaticDomTransport.ts`: `querySelectorAll` and `querySelector` now correctly
populate the `attributes` field of parsed nodes when the zigquery FFI backend is
active. Previously, attributes were left empty, causing `getAttribute("href")` to
always return `null` for pages loaded into the static transport.

This fix also benefits any other caller of `page.$$(selector)` + `element.getAttribute(...)`.
