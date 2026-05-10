---
description: 10 production-ready recipes for common Bunlight tasks. Copy-paste code for scraping, crawling, auth, detection, and more.
---

# Cookbook: 10 Production Recipes

Copy-paste recipes for common Bunlight tasks.

## Recipe 1: Scrape a static HTML page

```ts
import { Browser } from "@bunmium/bunlight";

const page = await Browser.newPage({ profile: "static" });
await page.goto("https://example.com/blog");

const title = await page.title();
const posts = await page.$$(".post");

const data = [];
for (const post of posts) {
  const titleEl = await post.$("h2");
  const dateEl = await post.$(".date");
  data.push({
    title: await titleEl?.textContent(),
    date: await dateEl?.textContent()
  });
}

await page.close();
console.log(data);
```

## Recipe 2: Crawl 100 URLs in parallel

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const urls = [/* 100 URLs */];

const pool = new PagePool({
  profile: "fast",
  concurrency: 20,
  maxPages: 10
});

const results = await pool.run(urls, async (page, url) => {
  try {
    await page.goto(url, { timeoutMs: 30000 });
    return {
      url,
      title: await page.title(),
      status: "ok"
    };
  } catch (err) {
    return {
      url,
      error: err.message,
      status: "error"
    };
  }
});

await pool.close();
console.log(results);
```

## Recipe 3: Login with session cookies

```ts
import { Browser } from "@bunmium/bunlight";
import { loadCookieJar } from "@bunmium/bunlight/cookies";

// Export cookies from Chrome after logging in manually
// Save as ./cookies/private/my-account.json

const cookies = await loadCookieJar("./cookies/private/my-account.json");

const page = await Browser.newPage({
  profile: "fast",
  cookies
});

await page.goto("https://example.com/account");
const accountName = await page.$eval(".account-name", el => el.textContent);
console.log("Logged in as:", accountName);

await page.close();
```

## Recipe 4: Crawl a sitemap with resumable queue

```ts
import { RequestQueue } from "@bunmium/bunlight/queue/RequestQueue";
import { Browser } from "@bunmium/bunlight";

const queue = new RequestQueue("sitemap-crawl.db");

// Load URLs from sitemap (once)
const sitemapPage = await Browser.newPage({ profile: "static" });
await sitemapPage.goto("https://example.com/sitemap.xml");
const sitemapXml = await sitemapPage.content();
const urls = sitemapXml.match(/https?:\/\/[^\s<]+/g) || [];

for (const url of urls) {
  if (!await queue.has(url)) {
    await queue.add({ url, retries: 0 });
  }
}

// Process queue (can be interrupted and resumed)
while (const req = await queue.shift()) {
  const page = await Browser.newPage({ profile: "fast" });
  try {
    await page.goto(req.url, { timeoutMs: 20000 });
    const title = await page.title();
    await queue.markDone(req.url, { title });
  } catch (err) {
    await queue.markFailed(req.url, req.retries + 1);
  }
  await page.close();
}

await queue.close();
```

## Recipe 5: Detect framework and suggest profile

```ts
import { detectFrameworks } from "@bunmium/bunlight/detect";
import { suggestProfile } from "@bunmium/bunlight/router/framework-strategy";
import { Browser } from "@bunmium/bunlight";

const url = "https://example.com";

const page = await Browser.newPage({ profile: "static" });
await page.goto(url);
const tech = await detectFromPage(page);
await page.close();

console.log("Detected:", tech.map(t => `${t.name}${t.version ? ` ${t.version}` : ""}`).join(", "));

const profile = suggestProfile(tech);
console.log("Suggested profile:", profile);

// Re-open with better profile if needed
if (profile !== "static") {
  const newPage = await Browser.newPage({ profile });
  await newPage.goto(url);
  // ...
}
```

## Recipe 6: Bypass Cloudflare IUAM with stealth

```ts
import { Browser } from "@bunmium/bunlight";

const page = await Browser.newPage({
  profile: "stealth",
  stealthOpts: {
    fingerprint: {
      source: "browserforge",
      os: "linux",
      browser: "chrome",
      version: 131
    }
  }
});

await page.goto("https://cloudflare-protected.com");
const title = await page.title();
console.log("Bypassed Cloudflare! Title:", title);

await page.close();
```

## Recipe 7: Solve Turnstile captcha with max profile

```ts
import { Browser } from "@bunmium/bunlight";

const page = await Browser.newPage({
  profile: "max",
  maxOpts: {
    capsolverApiKey: process.env.CAPSOLVER_TOKEN
  }
});

await page.goto("https://site-with-turnstile.com");

// Wait for captcha to solve automatically
await page.waitForFunction(
  () => !document.querySelector('[data-callback="___rcb"]'),
  { timeoutMs: 30000 }
);

const result = await page.evaluate(() => document.body.innerText);
console.log("Form submitted successfully!");

await page.close();
```

## Recipe 8: Resume after crash using RequestQueue

```ts
import { RequestQueue } from "@bunmium/bunlight/queue/RequestQueue";
import { Browser } from "@bunmium/bunlight";

const queue = new RequestQueue("crawl.db");

// First run: add URLs
if (await queue.stats().total === 0) {
  const urls = [/* list */];
  for (const url of urls) {
    await queue.add({ url, retries: 0 });
  }
  console.log(`Added ${urls.length} URLs to queue`);
}

// Second run (resume): process queue
const stats = await queue.stats();
console.log(`Resuming: ${stats.pending} pending, ${stats.done} done`);

while (const req = await queue.shift()) {
  const page = await Browser.newPage();
  try {
    await page.goto(req.url);
    await queue.markDone(req.url);
  } catch (err) {
    await queue.markFailed(req.url, req.retries + 1);
  }
  await page.close();
}

await queue.close();
```

## Recipe 9: Export to CSV/JSON

```ts
import { PagePool } from "@bunmium/bunlight/pool/PagePool";
import { Bun } from "bun";

const urls = [/* list */];

const pool = new PagePool({ profile: "fast", concurrency: 20 });

const results = await pool.run(urls, async (page, url) => {
  await page.goto(url);
  return {
    url,
    title: await page.title(),
    h1: await page.$eval("h1", el => el.textContent).catch(() => null)
  };
});

await pool.close();

// Export as JSONL (one JSON per line, streamable)
await Bun.write(
  "results.jsonl",
  results.map(r => JSON.stringify(r)).join("\n")
);

// Export as CSV
const csv = [
  ["url", "title", "h1"],
  ...results.map(r => [r.url, r.title, r.h1])
].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");

await Bun.write("results.csv", csv);

console.log(`Exported ${results.length} rows`);
```

## Recipe 10: Puppeteer-compatible zero-spawn

```ts
import puppeteer from "puppeteer-core";
import { Browser } from "@bunmium/bunlight";

// Get the in-process transport (no external process)
const transport = Browser.transport();

// Connect puppeteer to it
const browser = await puppeteer.connect({ transport });

// Use puppeteer API normally
const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());

// All puppeteer features work with Bunlight
const text = await page.$eval("h1", el => el.textContent);
console.log(text);

await browser.disconnect();
```

## Quick reference

| Task | Recipe | Profile |
|------|--------|---------|
| Scrape HTML | #1 | static |
| Crawl many URLs | #2 | fast |
| Login with cookies | #3 | fast |
| Resume after crash | #4, #8 | fast + queue |
| Detect tech | #5 | any |
| Cloudflare bypass | #6 | stealth |
| Turnstile solve | #7 | max |
| Export data | #9 | any |
| Puppeteer compat | #10 | any |

## See also

- `references/profiles.md` — full decision tree behind every recipe's profile choice.
- `references/pool.md` and `references/queue.md` — primitives behind recipes #2, #4, #8.
- `references/cookies.md` — cookie format reference for recipes #3 and #6.
- `references/api.md` — full `Browser` and `Page` API used throughout.
- Agents `bunlight-scraper` and `bunlight-crawler` — code-generation companions.
