# HAR Recorder and Replayer

Bunlight ships a built-in network recorder that captures HTTP traffic in the
HAR 1.2 format (HTTP Archive) and a companion replayer that serves recorded
responses from a local Bun.serve server, enabling fully deterministic offline
tests.

---

## Overview

| Class | Purpose |
|---|---|
| `HarRecorder` | Taps into a Bunlight `Page` CDP stream and builds a HAR 1.2 log |
| `HarReplayer` | Loads a `.har` file and serves responses via Bun.serve |
| `types.ts` | Complete HAR 1.2 TypeScript type definitions |

**HAR version supported**: 1.2 (spec: http://www.softwareishard.com/blog/har-12-spec/)

---

## HarRecorder

### Construction

```ts
import { HarRecorder } from "bunlight/src/recorder/HarRecorder.ts";
import { Browser } from "bunlight/src/api/browser.ts";

const page = await Browser.newPage({ profile: "fast" });
const recorder = new HarRecorder(page);
```

### API

```ts
recorder.start(): void
recorder.stop(): HarLog
await recorder.save(path: string): Promise<void>
```

`start()` hooks into the page's CDP transport message stream and registers listeners
for `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`,
and `Network.loadingFailed`.

`stop()` detaches listeners, flushes any in-flight requests as incomplete entries,
resets internal state, and returns a `HarLog` object conforming to HAR 1.2.

`save(path)` calls `stop()` and writes the HAR to disk as indented JSON using `Bun.write`.

### Usage example

```ts
import { HarRecorder } from "./src/recorder/HarRecorder.ts";
import { Browser } from "./src/api/browser.ts";

const page = await Browser.newPage({ profile: "fast" });
const recorder = new HarRecorder(page);

recorder.start();
await page.goto("https://example.com");
const har = recorder.stop();

// Save to disk
await recorder.save("/tmp/example.har");

// Or work with the in-memory log
console.log(har.entries.length, "requests captured");
console.log(har.entries[0].request.url);
console.log(har.entries[0].response.status);

await page.close();
```

### Profile support

| Profile | Network events available | HarRecorder behavior |
|---|---|---|
| `static` | None (in-process, no real network) | Empty entries list |
| `fast` | Full CDP Network domain | All requests captured |
| `http` | curl-impersonate (no CDP) | Not applicable; use HarRecorder with fast/stealth/max |
| `stealth` | Full CDP Network domain | All requests captured |
| `max` | Full CDP Network domain | All requests captured |

### HAR entry structure

Each captured network request produces a `HarEntry`:

```ts
{
  startedDateTime: "2026-05-10T07:30:00.123Z",  // ISO 8601
  time: 234,                                      // total ms
  request: {
    method: "GET",
    url: "https://example.com/api/data",
    httpVersion: "HTTP/1.1",
    cookies: [{ name: "session", value: "abc" }],
    headers: [{ name: "accept", value: "application/json" }],
    queryString: [{ name: "page", value: "1" }],
    headersSize: -1,
    bodySize: -1,
  },
  response: {
    status: 200,
    statusText: "OK",
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: [{ name: "content-type", value: "application/json" }],
    content: { size: 1024, mimeType: "application/json", text: "{...}" },
    redirectURL: "",
    headersSize: -1,
    bodySize: 1024,
  },
  cache: {},
  timings: {
    blocked: -1,
    dns: 5,
    connect: 10,
    send: 2,
    wait: 200,
    receive: 17,
    ssl: -1,
  },
}
```

---

## HarReplayer

### Construction

Two factory methods are available:

```ts
// Load from disk (async)
const replayer = await HarReplayer.load("/tmp/example.har");

// Build from in-memory entries (sync, useful in tests)
const replayer = HarReplayer.fromEntries(entries);
```

### API

```ts
replayer.size: number                              // entry count
replayer.lookup(method, url): HarEntry | undefined // direct index lookup
await replayer.serve(port?: number): Promise<ReplayServer>
```

`serve(port?)` starts a `Bun.serve` HTTP server. Port 0 (default) lets the OS
assign an ephemeral port.

The returned `ReplayServer` has:
- `port: number` — actual port in use
- `stop(): Promise<void>` — shuts down the server

### Request routing

The replay server accepts two URL formats:

**Path-prefixed** (default):
```
GET http://localhost:PORT/https://example.com/page
GET http://localhost:PORT/https%3A%2F%2Fexample.com%2Fpage
```

**Query-parameter** (for POST or parameterised lookups):
```
GET http://localhost:PORT/?url=https%3A%2F%2Fexample.com%2Fapi&method=POST
```

Matching strategy:
1. Exact `METHOD::URL` key lookup
2. URL-only fallback with GET method
3. 404 JSON response if no match found

### Usage example

```ts
import { HarReplayer } from "./src/recorder/HarReplayer.ts";

const replayer = await HarReplayer.load("/tmp/example.har");
const { stop, port } = await replayer.serve();

// Fetch the recorded response
const res = await fetch(`http://localhost:${port}/${encodeURIComponent("https://example.com/")}`);
console.log(await res.text()); // replayed body

await stop();
```

### Use in tests

```ts
import { test, expect, afterEach } from "bun:test";
import { HarReplayer } from "./src/recorder/HarReplayer.ts";
import type { HarEntry } from "./src/recorder/types.ts";

const servers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const s of servers) await s.stop();
  servers.length = 0;
});

test("my feature works offline", async () => {
  const replayer = HarReplayer.fromEntries([
    {
      startedDateTime: new Date().toISOString(),
      time: 50,
      request: {
        method: "GET",
        url: "https://api.example.com/data",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 200,
        statusText: "OK",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [{ name: "content-type", value: "application/json" }],
        content: { size: 15, mimeType: "application/json", text: '{"ok":true}' },
        redirectURL: "",
        headersSize: -1,
        bodySize: 15,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, send: 2, wait: 40, receive: 8 },
    } satisfies HarEntry,
  ]);

  const server = await replayer.serve();
  servers.push(server);

  const res = await fetch(
    `http://localhost:${server.port}/${encodeURIComponent("https://api.example.com/data")}`
  );
  const data = await res.json() as { ok: boolean };
  expect(data.ok).toBe(true);
});
```

---

## Types (HAR 1.2)

All types are exported from `src/recorder/types.ts`:

| Type | Description |
|---|---|
| `HarFile` | Top-level HAR file `{ log: HarLog }` |
| `HarLog` | Log object with `version`, `creator`, `pages`, `entries` |
| `HarEntry` | Single request/response pair |
| `HarRequest` | HTTP request details |
| `HarResponse` | HTTP response details |
| `HarTimings` | Timing breakdown in ms |
| `HarPage` | Page-level metadata |
| `HarContent` | Response body content |
| `HarCookie` | Cookie name/value/attributes |
| `HarNameValue` | Generic name/value pair (headers, query strings) |
| `HarPostData` | POST body data |
| `HarCache` | Cache state before/after request |
| `HarCreatorBrowser` | Creator/browser identification |

---

## Implementation notes

- All I/O uses `Bun.file` (read) and `Bun.write` (write) — no `node:fs`.
- The replay server uses `Bun.serve` — no `node:http`.
- `HarReplayer.fromEntries()` is synchronous and allocates no file handles.
- First-occurrence-wins deduplication ensures replay is deterministic even
  when a HAR file contains multiple entries for the same URL+method.
- `transfer-encoding` and `connection` headers are stripped from replay
  responses to avoid conflicts with Bun.serve's own framing.
- Binary response bodies (encoding: "base64") are decoded to `ArrayBuffer`
  before being passed to `Response`.
