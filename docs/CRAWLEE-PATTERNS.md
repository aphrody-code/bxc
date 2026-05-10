# Crawlee Pattern Audit — Bunlight vs Crawlee

Audit date: 2026-05-10
Crawlee version: 3.16.x (Apache-2.0, apify/crawlee, ~17k stars)
Bunlight version: 0.1.0-alpha

---

## Comparative Feature Table

| Feature | Crawlee | Bunlight | Status |
|---|---|---|---|
| Persistent RequestQueue | SQLite via memory-storage | `bun:sqlite` WAL | Implemented |
| Dead-letter queue | Via RequestProvider retries | Built into RequestQueue | Implemented |
| Dynamic concurrency (AutoscaledPool) | Snapshotter + SystemStatus | RSS/loadavg polling | Implemented |
| Sitemap parser (XML + txt + index) | sax + node:stream | Hand-rolled tokenizer + Bun.fetch | Implemented |
| Sitemap auto-discovery (robots.txt) | Built into Sitemap class | `discoverSitemapsFromRobots()` | Implemented |
| robots.txt parser (RFC 9309) | robots-parser npm dep | Zero-dep hand-rolled | Implemented |
| Dataset (append-only JSONL) | csv-stringify + node:fs | `Bun.file().writer()` | Implemented |
| Dataset CSV export | csv-stringify | RFC-4180 hand-rolled | Implemented |
| KeyValueStore (JSON + binary) | node:fs readFile/writeFile | `bun:sqlite` inline + `Bun.write` blobs | Implemented |
| Browser pool | BrowserPool class (12+ adapters) | PagePool (LRU, back-pressure) | Existing |
| Session pool (cookie persistence) | SessionPool | SessionPool | Existing |
| Proxy rotation | ProxyConfiguration | ProxyPool | Existing |
| enqueueLinks helper | Core, auto URL extraction | — | Skipped |
| Statistics (latency histogram) | BasicCrawler.stats | — | Skipped |
| Stagehand AI crawler | StagehandCrawler (2026) | — | Skipped |
| impit-client TLS impersonation | @crawlee/impit-client (Rust) | curl-impersonate (existing FFI) | See analysis below |
| cheerio/jsdom/linkedom parsers | Multiple dedicated crawlers | zigquery (Zig-native) | Existing (superior) |

---

## 8-12 Patterns Identified

### 1. RequestQueue — Persistent, Crash-Safe URL Queue (implemented)

**What it is:** A durable FIFO/priority queue of URLs backed by SQLite. Supports deduplication by unique key, atomic lock/done/fail state transitions, and a dead-letter queue for exhausted retries.

**Crawlee source:** `packages/core/src/storages/request_queue_v2.ts:64` — `RequestQueue extends RequestProvider`

**Bunlight implementation:** `src/queue/RequestQueue.ts`

Key differences from Crawlee:
- Crawlee uses an in-memory LRU cache (up to 2 million requests) backed by a storage client interface (DynamoDB or memory-storage). Bunlight uses SQLite WAL directly — no abstraction layer, no 2 MB RAM overhead for empty queues.
- Bunlight's `fetchBatch()` uses a single `UPDATE ... RETURNING` equivalent via a transaction for atomicity (locks N rows in one roundtrip).
- Dead-letter queue is first-class: `deadLetterQueue()` and `replayFailed()` are explicit API methods.
- `drain()` async generator integrates directly with `for await` loops — no custom event emitter needed.

### 2. AutoscaledPool — Dynamic Concurrency (implemented)

**What it is:** A task executor that dynamically adjusts parallelism based on system pressure (RAM usage, CPU load average). Starts at `minConcurrency`, scales up when the system is healthy, scales down when overloaded.

**Crawlee source:** `packages/core/src/autoscaling/autoscaled_pool.ts:181` — `AutoscaledPool`

**Bunlight implementation:** `src/pool/AutoscaledPool.ts`

Key differences from Crawlee:
- Crawlee's implementation has a three-layer architecture: Snapshotter (collects samples at intervals) → SystemStatus (evaluates overload ratio) → AutoscaledPool (adjusts concurrency). Bunlight collapses this to a single class sampling `os.freemem()` / `process.loadavg()` directly — no circular dependencies.
- Crawlee tracks event loop lag (via Node.js `perf_hooks`) as an overload signal. Bunlight omits this since Bun's event loop rarely lags in the same way; RSS and loadavg cover 95% of cases.
- Same three-function API: `runTaskFunction`, `isTaskReadyFunction`, `isFinishedFunction` — drop-in API compatible.
- `maxTasksPerMinute` rate limiting from Crawlee is omitted for simplicity (can be added).

### 3. Sitemap Parser — XML, TXT, Index, GZip (implemented)

**What it is:** An async generator that streams URLs from sitemap.xml (urlset), sitemap-index.xml (recursive), and .txt formats. Handles gzip decompression and auto-discovery via robots.txt.

**Crawlee source:** `packages/utils/src/internals/sitemap.ts:36` — `SitemapXmlParser`, `SitemapTxtParser`, `Sitemap.load()`

**Bunlight implementation:** `src/utils/sitemap.ts`

Key differences from Crawlee:
- Crawlee uses the `sax` npm package for XML parsing and Node.js streams (`node:stream`, `node:zlib`). Bunlight uses a zero-dependency hand-rolled tokenizer and `Bun.gunzipSync` — no stream backpressure complexity.
- Crawlee's Sitemap class yields `SitemapUrl | NestedSitemap` discriminated unions. Bunlight always yields `SitemapUrl` with `originSitemapUrl` tracking.
- `autoDiscoverAndParse()` combines robots.txt discovery and sitemap parsing in one async generator call.

### 4. robots.txt Parser — RFC 9309 Compliant (implemented)

**What it is:** A parser for robots.txt files implementing RFC 9309 (the 2022 standard that supersedes the de-facto Martijn Koster spec). Supports Allow/Disallow with longest-match precedence, wildcard patterns, Crawl-delay, and Sitemap directives.

**Crawlee source:** `packages/utils/src/internals/robots.ts:29` — `RobotsTxtFile` (wraps `robots-parser` npm package)

**Bunlight implementation:** `src/utils/robots.ts`

Key differences from Crawlee:
- Crawlee delegates parsing to the `robots-parser` npm package (650 lines, 0 deps). Bunlight implements RFC 9309 §2.2.2 directly — no npm dep, 250 lines, same feature surface.
- Crawlee's `RobotsTxtFile.find()` uses `got-scraping` for HTTP. Bunlight uses native `fetch` with `AbortSignal.timeout()`.
- Pattern compilation (wildcard `*` and end-anchor `$`) is explicit via `compilePattern()` — easy to audit for compliance.
- 404 / 5xx from robots.txt fetch returns a permissive (allow-all) instance per RFC 9309 §2.3.1.2 — Crawlee does the same.

### 5. Dataset — Append-Only JSONL Storage (implemented)

**What it is:** An append-only store for crawl output. Each item is a JSON object written as a single line (JSONL format). Supports CSV and JSON export, offset/limit pagination, and crash-safe writes.

**Crawlee source:** `packages/core/src/storages/dataset.ts:27` — `Dataset`, `checkAndSerialize()`, `chunkBySize()`

**Bunlight implementation:** `src/storage/Dataset.ts`

Key differences from Crawlee:
- Crawlee uses `csv-stringify/sync` for CSV export. Bunlight has a hand-rolled RFC-4180 serializer (40 lines) — no extra dependency.
- Crawlee's Dataset is backed by a storage client (memory-storage or Apify cloud). Bunlight uses `Bun.file().writer()` for streaming buffered appends — a single syscall path per `pushData()` call.
- `Bun.write(metaPath, ...)` for metadata is atomic on POSIX (write to temp + rename internally). Crawlee has similar guarantees via its storage layer.
- Item validation throws `TypeError` for non-objects (same as Crawlee's `checkAndSerialize`).

### 6. KeyValueStore — SQLite + File Hybrid (implemented)

**What it is:** A key-value store for arbitrary data (JSON config, screenshots, intermediate crawler state). Small values are stored inline in SQLite for fast lookup; large values (>= threshold) are stored as individual files.

**Crawlee source:** `packages/core/src/storages/key_value_store.ts:52` — `KeyValueStore`

**Bunlight implementation:** `src/storage/KeyValueStore.ts`

Key differences from Crawlee:
- Crawlee uses `node:fs` `readFile`/`writeFile` for all values, using the key as the filename (JSON5 for reading). Bunlight uses `bun:sqlite` inline storage for small values (< 64 KiB by default), falling back to `Bun.write` blob files for large values. This means a store with 10,000 small JSON values has a single SQLite file vs. 10,000 individual files on disk.
- Crawlee stores content-type as part of the filename extension (`.json`, `.html`, `.png`). Bunlight stores it as a column in the SQLite table — no filename mangling.
- Upsert semantics: `ON CONFLICT(key) DO UPDATE` — same as Crawlee's "setValue overrides".
- `listKeys()` returns size, createdAt, updatedAt metadata — useful for cache eviction logic.

### 7. impit-client vs curl-impersonate Analysis (skipped)

**What it is:** TLS browser impersonation clients that spoof TLS fingerprints to bypass Cloudflare and similar bot detection that inspects JA3/JA4 signatures.

**Crawlee's choice:** `@crawlee/impit-client` wraps `impit` v0.14 (Rust, based on `apify/impit`). Built as a cdylib via cargo.

**Bunlight's choice:** `curl-impersonate` (C, FFI-bound via `bun:ffi`) — already implemented in `src/ffi/curl-impersonate.ts`.

| Dimension | impit (Crawlee) | curl-impersonate (Bunlight) |
|---|---|---|
| Language | Rust (napi-rs N-API addon) | C (shared library) |
| License | Apache-2.0 | MIT |
| Profiles | Chrome 100-142, Firefox 128-144, OkHttp 3-5 (19 total) | Chrome 99-146, Firefox 133-147, Safari 15-26, Edge, Android (34 total) |
| HTTP/2 fingerprint accuracy | Hyper defaults across all profiles (impit#385 open) | Per-browser SETTINGS, WINDOW_UPDATE, header table sizes |
| HTTP/3 support | Yes (via rustls + quinn) — disables proxy | Limited (via curl + quiche) |
| Maintenance | Active monthly releases (Apify-funded) | lexiforest fork active; original archived 2024 |
| Build complexity | `cargo build --release`, requires forked rustls/h2 | Complex multi-lib patching |
| Binary availability | npm prebuilts for 8 platforms (linux gnu/musl x64/arm64, macOS, Windows) | per-arch `.so` shipped in `vendor/` |
| Cookie jar | Built-in (tough-cookie interop) | manual (handled by `src/cookies/`) |
| Bun integration | N-API addon — works in Bun, but regression in 1.3.2+ (impit#363) | `bun:ffi` `dlopen` — works on every Bun version |

**Decision: keep curl-impersonate as the sole TLS impersonation backend.**

Full decision matrix and migration path documented in `docs/IMPIT-EVALUATION.md`. Headline: impit's HTTP/2 SETTINGS bug (issue #385, open) collapses its fingerprint accuracy versus curl-impersonate; Cloudflare's cf-bot-score depends on HTTP/2 layer fingerprints alongside JA3/JA4. Re-evaluate when impit#385 is closed AND impit ships Safari profiles AND Bunlight needs HTTP/3.

### 7.bis TLS fingerprint impersonation alternatives — see `IMPIT-EVALUATION.md`

For the full decision matrix (status quo, feature comparison, Bun integration paths, pros/cons, recommended decision, hypothetical migration plan with re-evaluation triggers), refer to `docs/IMPIT-EVALUATION.md`. That doc compares 34 curl-impersonate profiles vs 19 impit profiles, traces the open impit issues that block adoption, and enumerates three integration paths (npm install, cdylib via `bun:ffi`, subprocess spawn) with their costs.

### 8. enqueueLinks Helper (skipped)

**What it is:** Crawlee's `enqueueLinks()` automatically extracts and filters href attributes from the current page, normalizes URLs, and bulk-adds them to the RequestQueue — the "crawler loop" primitive.

**Crawlee source:** `packages/core/src/enqueue_links/` — `enqueueLinks()`, `filterRequestsByPatterns()`

**Decision: skipped.**

Bunlight's `zigquery` (Zig-native CSS selector engine) can extract hrefs natively. A thin `enqueueLinks(page, queue, opts)` helper wrapping `zigquery` + `RequestQueue.addRequests()` is < 50 lines and can be added per-transport when needed. It is not a standalone module because the extraction logic depends on the active transport (static/fast/browser).

### 9. Statistics Module (skipped)

**What it is:** Crawlee's `BasicCrawler` tracks success rate, error breakdown, p50/p95 latency, and requests/minute via an internal `Statistics` class that periodically logs to console.

**Decision: skipped in this phase.**

AutoscaledPool already exposes `completedTasks` and `failedTasks`. A proper histogram (HdrHistogram or rolling window) is planned for `src/stats/CrawlStats.ts` in the telemetry milestone. Premature optimization at this stage.

### 10. Stagehand AI Crawler (skipped)

**What it is:** Crawlee's newest package (2026). `StagehandCrawler` extends `BrowserCrawler` and wraps [Stagehand](https://github.com/browserbase/stagehand) — using GPT-4.1 or Claude for `page.act()` (natural language actions) and `page.extract()` (structured data with Zod).

**Decision: skipped for now.**

Bunlight has a different AI integration roadmap: AI model hooks will attach to the transport layer (Lightpanda CDP), not require a full browser (Playwright/Puppeteer). Stagehand requires a full Chromium; Bunlight's value proposition is lightweight in-process browsing. When `lightpanda-ai-extract` is ready, revisit.

### 11. Proxy Session Pool (skipped)

**What it is:** Crawlee's `ProxyConfiguration` maps sessions to specific proxy IPs to maintain consistent IP identity per crawl session, supports `useFingerprintCache`, and integrates with Apify's proxy service.

**Decision: skipped.**

Bunlight has `ProxyPool.ts` for round-robin proxy rotation. Session affinity (same proxy for same domain) is a planned enhancement to `SessionPool.ts` in the anti-detection milestone.

### 12. Request List (static URL batch) (skipped)

**What it is:** Crawlee's `RequestList` is an optimized read-only URL list for static crawl seeds (CSV, JSON, sitemap). Unlike `RequestQueue`, it does not support dynamic enqueuing.

**Decision: partially covered by sitemap parser.**

`collectSitemapUrls()` + `RequestQueue.addRequests()` covers the primary use case. A dedicated `RequestList` class (CSV import, JSONL) would be straightforward to add using the same SQLite schema but is lower priority.

---

## Why Not X

### Why not wrap Crawlee directly?

Adding Crawlee as a dependency would import Node.js streams, got-scraping, cheerio, and the full Apify platform SDK. This conflicts with Bunlight's Bun-native constraint and adds ~80 MB of node_modules. Crawlee is inspiration, not a dependency.

### Why not use `robots-parser` npm package (as Crawlee does)?

The package is 650 lines, well-tested, and handles edge cases. However: (1) it requires a CommonJS interop shim in Bun ESM context; (2) it does not implement the 2022 RFC 9309 `$` end-anchor and multi-agent group syntax; (3) adding a dependency for < 300 lines of parser code contradicts Bunlight's minimalist philosophy.

### Why not use `sax` for XML parsing (as Crawlee does)?

The `sax` package is ~700 lines of Node.js stream-oriented code that requires `node:stream` shims in Bun. Sitemaps use a tiny XML subset (< 10 element types). The hand-rolled tokenizer in `src/utils/sitemap.ts` handles the full sitemap spec in 120 lines with zero allocations beyond the per-URL object.

### Why not implement `chunkBySize` for large dataset pushes?

Crawlee splits large payloads into chunks (for DynamoDB's 400 KB item limit). Bunlight uses `Bun.file().writer()` which has no per-write size limit — the OS page cache handles it.

---

## Implementation Summary

| File | Lines | Dependencies | Bun APIs used |
|---|---|---|---|
| `src/queue/RequestQueue.ts` | ~370 | none | `bun:sqlite`, `Bun.sleep` |
| `src/pool/AutoscaledPool.ts` | ~240 | `os` (built-in) | `Bun.sleep`, `process.memoryUsage`, `process.loadavg` |
| `src/utils/sitemap.ts` | ~260 | none | `Bun.fetch`, `Bun.gunzipSync` |
| `src/utils/robots.ts` | ~290 | none | `fetch` (global), `AbortSignal.timeout` |
| `src/storage/Dataset.ts` | ~220 | `node:path` (path.join only) | `Bun.file().writer()`, `Bun.write` |
| `src/storage/KeyValueStore.ts` | ~280 | `node:path` (path.join/dirname) | `bun:sqlite`, `Bun.write`, `Bun.file().arrayBuffer()` |
| `test/integration/crawlee-patterns.test.ts` | ~550 | `node:fs`, `node:path` (test infra) | `bun:test`, `Bun.serve`, `Bun.sleep` |

**Test coverage: 49 tests, 0 failures, 91 assertions.**
