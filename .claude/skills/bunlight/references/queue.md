---
description: Request queue for resumable massive crawls. SQLite-backed, supports deduplication, retry logic, and crash recovery.
---

# RequestQueue: Resumable Crawling

Bunlight includes a SQLite-backed request queue for crawling 1000s of URLs with automatic crash recovery.

## API

### new RequestQueue(dbPath: string)

Create or open a queue database.

```ts
import { RequestQueue } from "@bunmium/bunlight/queue/RequestQueue";

const queue = new RequestQueue("crawl.db");
```

Each request tracks:
- `url`: The target URL
- `retries`: Retry counter
- `status`: "pending", "active", "done", "failed"
- `error`: Last error message
- `result`: Optional result data
- `createdAt`: Timestamp

### Methods

#### queue.add(request: QueueRequest): Promise<void>

Add a request to the queue.

```ts
await queue.add({
  url: "https://example.com/page1",
  retries: 0,
  metadata: { category: "blog" }
});
```

#### queue.has(url: string): Promise<boolean>

Check if URL already in queue.

```ts
const urls = [/* list */];
for (const url of urls) {
  if (!await queue.has(url)) {
    await queue.add({ url, retries: 0 });
  }
}
```

#### queue.shift(): Promise<QueueRequest | null>

Get next pending request (marks as active).

```ts
while (const req = await queue.shift()) {
  console.log(`Processing ${req.url}`);
  const page = await Browser.newPage();
  try {
    await page.goto(req.url);
    await queue.markDone(req.url);
  } catch (err) {
    await queue.markFailed(req.url, req.retries + 1);
  }
}
```

#### queue.markDone(url: string, result?: any): Promise<void>

Mark request as successfully processed.

```ts
await page.goto(url);
const title = await page.title();
await queue.markDone(url, { title });
```

#### queue.markFailed(url: string, retries: number): Promise<void>

Mark request as failed. Auto re-queues if retries < limit (default 3).

```ts
try {
  await page.goto(url);
} catch (err) {
  await queue.markFailed(url, req.retries + 1);
}
```

#### queue.stats(): Promise<QueueStats>

Get queue statistics.

```ts
const stats = await queue.stats();
console.log(`Total: ${stats.total}, Done: ${stats.done}, Failed: ${stats.failed}, Pending: ${stats.pending}`);
```

#### queue.close(): Promise<void>

Close the database connection.

```ts
await queue.close();
```

## Example: Resumable sitemap crawl

```ts
import { RequestQueue } from "@bunmium/bunlight/queue/RequestQueue";
import { Browser } from "@bunmium/bunlight";
import { Bun } from "bun";

const queue = new RequestQueue("sitemap.db");

// 1. Load URLs from sitemap (once)
const sitemapUrl = "https://example.com/sitemap.xml";
const page = await Browser.newPage({ profile: "static" });
await page.goto(sitemapUrl);
const sitemapXml = await page.content();

const urls = sitemapXml.match(/https?:\/\/[^\s<]+/g) || [];

for (const url of urls) {
  if (!await queue.has(url)) {
    await queue.add({ url, retries: 0 });
  }
}

await page.close();

// 2. Process queue (can be interrupted and resumed)
const processQueue = async () => {
  while (const req = await queue.shift()) {
    const page = await Browser.newPage({ profile: "fast" });
    try {
      await page.goto(req.url, { timeoutMs: 30000 });
      const title = await page.title();
      const wordCount = (await page.content()).split(/\s+/).length;
      await queue.markDone(req.url, { title, wordCount });
      console.log(`OK: ${req.url}`);
    } catch (err) {
      await queue.markFailed(req.url, req.retries + 1);
      console.error(`FAIL: ${req.url} (${err.message})`);
    } finally {
      await page.close();
    }

    // Periodic stats
    if (req.retries === 0) {
      const stats = await queue.stats();
      console.log(`Stats: ${stats.done}/${stats.total} done`);
    }
  }
};

// 3. Run (interrupt with Ctrl+C to pause)
await processQueue();

// 4. Export results
const results = await queue.getAll();
await Bun.write(
  "results.jsonl",
  results.map(r => JSON.stringify(r)).join("\n")
);

await queue.close();
```

To resume later:

```bash
# First run: loads sitemap, starts crawling
bun scripts/crawl-sitemap.ts

# Interrupt with Ctrl+C, resume later:
bun scripts/crawl-sitemap.ts
# Queue auto-resumes from where it left off
```

## Retry strategy

By default, failed requests re-queue with `retries + 1`. Max retries: 3.

Custom retry logic:

```ts
const maxRetries = 5;

while (const req = await queue.shift()) {
  const page = await Browser.newPage();
  try {
    // exponential backoff
    const delay = 1000 * Math.pow(2, req.retries);
    await new Promise(r => setTimeout(r, delay));

    await page.goto(req.url);
    await queue.markDone(req.url);
  } catch (err) {
    if (req.retries < maxRetries) {
      await queue.markFailed(req.url, req.retries + 1);
    } else {
      await queue.markFailed(req.url, req.retries);
      console.error(`Gave up on ${req.url} after ${maxRetries} retries`);
    }
  }
}
```

## Performance

- **Insert**: ~1 ms per URL
- **Shift**: ~5-10 ms (SQLite query)
- **Mark done**: ~2 ms per URL

For 10k URLs: ~100 ms overhead total. Scales linearly.

## Cleanup

To reset and start fresh:

```ts
import fs from "fs";

// Delete queue database
fs.unlinkSync("crawl.db");

// Create new queue
const queue = new RequestQueue("crawl.db");
```

Or query the database directly:

```bash
sqlite3 crawl.db "SELECT COUNT(*) FROM requests WHERE status='done';"
```

## See also

- `references/pool.md` — `PagePool`/`SessionPool` to consume queue work in parallel.
- `references/profiles.md` — concurrency tuning per profile.
- `references/troubleshooting.md` — queue corruption and resume edge cases.
- Agent `bunlight-crawler` — designs queue + pool crawls for 100+ URLs.
- Agent `bunlight-debugger` — diagnoses dead-letter buildup.
