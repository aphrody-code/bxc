---
description: Page pools, session pools, and proxy pools for concurrent browser automation. Scale from 10 to 1000s of concurrent pages with bounded memory and automatic retry.
---

# Pools: Concurrency & Resource Management

Scale Bunlight from single-page scrapes to massive crawls with built-in pooling.

## PagePool

Concurrent pages with LRU eviction and back-pressured task scheduling.

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const pool = new PagePool({
  profile: "fast",           // which profile to use
  concurrency: 50,           // max 50 parallel tasks
  maxPages: 25,              // reuse max 25 pages
  pageOptions: {
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 ..."
  }
});

const results = await pool.run(
  urls,  // input array
  async (page, url) => {
    await page.goto(url);
    return { url, title: await page.title() };
  }
);

await pool.close();
```

### API

#### new PagePool(options: PagePoolOptions)

**PagePoolOptions**:
```ts
interface PagePoolOptions {
  profile?: "static" | "fast" | "http" | "stealth" | "max";
  concurrency?: number;          // default: 16
  maxPages?: number;             // default: 50
  pageOptions?: Omit<PageOptions, "profile">;
}
```

#### pool.run<T>(items: T[], fn: (page: Page, item: T) => Promise<R>): Promise<R[]>

Run a function on each item. Results preserve order. If any task fails, throws after draining queue.

#### pool.close(): Promise<void>

Close all pages and clean up.

#### pool.stats(): PagePoolStats

Get current pool stats.

```ts
const stats = pool.stats();
console.log(`Active: ${stats.active}, Queued: ${stats.queued}, Idle: ${stats.idle}`);
```

### Example: Crawl 1000 URLs

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const urls = [...1000 urls...];

const pool = new PagePool({
  profile: "fast",
  concurrency: 50,    // 50 parallel pages
  maxPages: 25        // reuse 25 pages (save RAM)
});

const results = await pool.run(urls, async (page, url) => {
  try {
    await page.goto(url, { timeoutMs: 10000 });
    return {
      url,
      title: await page.title(),
      status: "ok"
    };
  } catch (err) {
    return {
      url,
      error: err.message,
      status: "failed"
    };
  }
});

await pool.close();

// Export results
await Bun.write(
  "results.jsonl",
  results.map(r => JSON.stringify(r)).join("\n")
);
```

### Tuning concurrency

- **Too low** (< 10): Underutilizes resources
- **Sweet spot** (10-50): Good throughput, stable
- **Too high** (> 100): Risk of memory exhaustion, rate limits, or OS fd limits

Check system limits:

```bash
ulimit -n           # max file descriptors (need ~20-50 per page)
free -h             # available RAM
```

For 1000s of URLs, use smaller `maxPages`:

```ts
const pool = new PagePool({
  profile: "fast",
  concurrency: 100,   // aggressive
  maxPages: 10        // small pool, higher turnover
});
```

## SessionPool

Like PagePool but shares cookies and session state across pages.

```ts
import { SessionPool } from "@bunmium/bunlight/pool/SessionPool";

const pool = new SessionPool({
  profile: "fast",
  authenticator: async (page) => {
    // Called once per session
    await page.goto("https://example.com/login");
    await page.type("input[name=email]", "user@example.com");
    await page.type("input[name=password]", process.env.PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForNavigation();
  }
});

// All pages have session cookies
const results = await pool.run(protectedUrls, async (page, url) => {
  await page.goto(url);
  return page.title();
});

await pool.close();
```

### API

#### new SessionPool(options: SessionPoolOptions)

```ts
interface SessionPoolOptions {
  profile?: string;
  concurrency?: number;
  maxPages?: number;
  pageOptions?: PageOptions;
  authenticator: (page: Page) => Promise<void>;  // called once
  sessionTimeout?: number;                        // re-auth after ms
}
```

#### pool.run<T>(items: T[], fn: ...): Promise<R[]>

Same as PagePool.

### Example: Scrape authenticated API

```ts
import { SessionPool } from "@bunmium/bunlight/pool/SessionPool";

const pool = new SessionPool({
  profile: "fast",
  concurrency: 20,
  authenticator: async (page) => {
    await page.goto("https://api.example.com/auth/login");
    await page.type("#email", "agent@example.com");
    await page.type("#password", process.env.API_PASSWORD);
    await page.click("button");
    await page.waitForNavigation();
  }
});

const results = await pool.run(endpoints, async (page, endpoint) => {
  await page.goto(`https://api.example.com${endpoint}`);
  const data = await page.evaluate(() => {
    // extract JSON from <pre> tag or script
    try {
      return JSON.parse(document.body.innerText);
    } catch {
      return document.body.innerText;
    }
  });
  return { endpoint, data };
});

await pool.close();
```

## ProxyPool

Rotate proxies across pages.

```ts
import { ProxyPool } from "@bunmium/bunlight/pool/ProxyPool";

const proxies = [
  "http://proxy1.example.com:8080",
  "http://proxy2.example.com:8080",
  "http://proxy3.example.com:8080"
];

const proxyPool = new ProxyPool({
  proxies,
  rotation: "per-session",    // rotate per page
  timeout: 10000
});

const page = await Browser.newPage({
  profile: "stealth",
  proxy: proxyPool.next()
});
```

Or integrate with PagePool:

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const page = await Browser.newPage({
  profile: "stealth",
  stealthOpts: {
    proxy: {
      rotation: "per-session",
      pool: proxies
    }
  }
});
```

## Error handling

By default, pool.run() throws if any task fails. To collect errors:

```ts
const results = await Promise.allSettled(
  urls.map(url =>
    pool.run([url], async (page, u) => {
      await page.goto(u);
      return page.title();
    })
  )
);

const successful = results.filter(r => r.status === "fulfilled");
const failed = results.filter(r => r.status === "rejected");
```

Or wrap tasks:

```ts
const results = await pool.run(urls, async (page, url) => {
  try {
    await page.goto(url);
    return { status: "ok", title: await page.title() };
  } catch (err) {
    return { status: "error", url, message: err.message };
  }
});
```

## Performance tips

1. **Profile choice**: `static` fastest, `fast` for most cases, `stealth`/`max` only when needed
2. **Viewport size**: Smaller viewport = faster rendering. Use `{ width: 800, height: 600 }` for speed
3. **Block resources**: Skip images/stylesheets to speed up load:
   ```ts
   await page.blockResources(["image", "stylesheet", "font"]);
   ```
4. **Timeouts**: Set reasonable `waitUntil` to avoid hanging
5. **Reuse pages**: maxPages should be 20-30% of concurrency

## Monitoring

```ts
const pool = new PagePool({ ... });

// Periodically log stats
const statsPoll = setInterval(() => {
  const stats = pool.stats();
  console.log(`Pool: active=${stats.active} queued=${stats.queued} idle=${stats.idle}`);
}, 5000);

try {
  await pool.run(urls, ...);
} finally {
  clearInterval(statsPoll);
  await pool.close();
}
```

## See also

- `references/queue.md` — pair `PagePool` with `RequestQueue` for resume-on-crash crawls.
- `references/cookies.md` — `SessionPool` jar reuse semantics.
- `references/profiles.md` — concurrency tuning per profile.
- Agent `bunlight-crawler` — designs pool architecture for 100+ URL crawls.
- Agent `bunlight-debugger` — diagnoses pool stalls and memory growth.
