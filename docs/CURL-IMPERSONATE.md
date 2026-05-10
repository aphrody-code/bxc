# curl-impersonate Integration

Bunlight ships a thin `bun:ffi` wrapper around
[lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate).
This lets any request carry a spoofed TLS + HTTP/2 fingerprint that matches a
real browser, bypassing fingerprint-based bot-detection systems (Cloudflare,
Akamai, DataDome, etc.) without spawning a browser process.

## How it works

`curl_easy_impersonate()` configures the underlying BoringSSL/quiche TLS stack
to produce the exact same ClientHello and HTTP/2 SETTINGS frames as a given
browser version. The resulting JA3, JA4, and Akamai HTTP/2 fingerprints are
indistinguishable from a legitimate user agent.

Because the library runs in-process (loaded via `dlopen`) and performs all I/O
synchronously inside `curl_easy_perform`, there is no sub-process overhead.
Requests typically complete in 90–200 ms from a datacenter IP.

## Supported profiles (this build — lexiforest v1.5.6)

| Family | Profiles |
|---|---|
| **Chrome (desktop)** | `chrome99`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`, `chrome119`, `chrome120`, `chrome123`, `chrome124`, `chrome131`, `chrome133a`, `chrome136`, `chrome142`, `chrome145`, `chrome146` |
| **Chrome (Android)** | `chrome99_android`, `chrome131_android` |
| **Firefox** | `firefox133`, `firefox135`, `firefox144`, `firefox147` |
| **Safari (macOS)** | `safari15_3`, `safari15_5`, `safari17_0`, `safari18_0`, `safari18_4`, `safari26_0`, `safari26_0_1` |
| **Safari (iOS)** | `safari17_2_ios`, `safari18_0_ios`, `safari18_4_ios`, `safari26_0_ios` |
| **Edge** | `edge99`, `edge101` |

Default profile: `chrome131`.

## Usage

### Direct client

```ts
import { ImpersonatedClient } from "bunlight/ffi/curl-impersonate";

const client = new ImpersonatedClient({
  profile: "chrome131",
  timeoutMs: 30_000,
  followRedirects: true,
  sslVerify: true,
});

const res = await client.fetch("https://example.com");
console.log(res.status, await res.text());

client.close(); // or: await using client = new ImpersonatedClient()
```

### GET + JSON

```ts
const data = await client.fetchJSON<{ ip: string }>("https://api.ipify.org?format=json");
console.log(data.ip);
```

### POST JSON

```ts
const result = await client.postJSON("https://httpbin.org/post", {
  key: "value",
});
```

### Custom headers and cookies

```ts
const res = await client.fetch("https://example.com", {
  headers: {
    "accept-language": "en-US,en;q=0.9",
    referer: "https://www.google.com/",
  },
  cookies: "session_id=abc123; _ga=GA1.2.xyz",
});
```

### Per-request profile override

```ts
// Client defaults to chrome131, but this single request uses firefox135
const res = await client.fetch("https://tls.peet.ws/api/all", {
  profile: "firefox135",
});
```

### AsyncDisposable (`await using`)

```ts
await using client = new ImpersonatedClient({ profile: "chrome131" });
const res = await client.fetch("https://example.com");
// client.close() is called automatically at block exit
```

### One-shot helper

```ts
import { impersonateFetch } from "bunlight/ffi/curl-impersonate";

const res = await impersonateFetch("https://example.com");
```

### Browser API — `http` profile

Use the `Browser.newPage({ profile: "http" })` factory if you want to share
the Browser singleton lifecycle without importing the FFI module directly.
`HttpPage` wraps `ImpersonatedClient` with a Puppeteer-compatible surface
(minus DOM and JS execution).

```ts
import { Browser } from "bunlight/browser";
import type { HttpPage } from "bunlight/browser";

const page = (await Browser.newPage({
  profile: "http",
  httpOpts: { profile: "chrome131", timeoutMs: 20_000 },
})) as HttpPage;

await page.goto("https://example.com");
const html = await page.content();
const title = await page.title(); // parsed from <title>...</title>
await page.close();
```

`HttpPage` also exposes a raw `fetch()` method for full control:

```ts
const res = await (page as HttpPage).fetch("https://httpbin.org/post", {
  method: "POST",
  body: JSON.stringify({ hello: "world" }),
  headers: { "content-type": "application/json" },
});
```

Methods that require a DOM (`$`, `$$`, `evaluate`) throw a descriptive error
directing you to use the `static` or `fast` profile instead.

## Performance compared to native `fetch()`

Measured from a datacenter IP against `httpbin.org/get` (10 sequential requests):

| Client | avg | min | max |
|---|---|---|---|
| `ImpersonatedClient` (chrome131) | ~107 ms | ~90 ms | ~175 ms |
| Bun native `fetch()` | ~80 ms | ~65 ms | ~140 ms |

The overhead vs. native `fetch()` is roughly 25–40 ms per request, incurred
by the BoringSSL ClientHello construction and H2 SETTINGS frame spoofing.
For most scraping workloads the latency is dominated by the server's TTFB, so
the effective difference is negligible.

Connection pooling is **not** currently implemented (the CURL easy handle is
reset between requests). For high-throughput workloads, instantiate multiple
`ImpersonatedClient` instances or use the curl_multi API (future work).

## Limitations

| Limitation | Detail |
|---|---|
| **Synchronous I/O** | `curl_easy_perform` blocks the Bun event loop for the duration of the request. Wrap calls in `Bun.spawn` or a Worker if you need true concurrency. |
| **No streaming response** | The entire response body is buffered in memory before the `Promise` resolves. Streaming is possible via curl_multi but not exposed in this wrapper. |
| **No connection pool** | Each `fetch()` call resets the easy handle; TCP and TLS handshakes are repeated per request. |
| **Datacenter IPs** | Basic Cloudflare challenges are bypassed by the correct TLS fingerprint, but JS-challenge-required targets (Cloudflare "Under Attack" mode) still block datacenter IPs regardless of fingerprint. |
| **Linux x86_64 only** | The bundled `.so` (`libcurl-impersonate.so.4.8.0`) is compiled for Linux x86_64. macOS and ARM require a separate build. |
| **bun:ffi is experimental** | The `bun:ffi` API is marked experimental by Bun. JSCallback threading is not safe across Workers without JS isolation. |
| **Profile names changed** | The lexiforest v1.5.6 profile list differs from earlier curl-impersonate forks. Old names like `safari18`, `firefox91esr`, `chrome133` are not valid — see the table above. |

## Library path resolution

`ImpersonatedClient` resolves the `.so` in this order:

1. `process.env.LIBCURL_IMPERSONATE_PATH` (if set)
2. `vendor/curl-impersonate/libcurl-impersonate.so.4.8.0` (relative to the module)
3. `vendor/curl-impersonate/libcurl-impersonate.so.4`
4. `vendor/curl-impersonate/libcurl-impersonate.so`

To use a system-installed library:

```sh
LIBCURL_IMPERSONATE_PATH=/usr/local/lib/libcurl-impersonate.so bun run script.ts
```

## Verifying the TLS fingerprint

Hit `https://tls.peet.ws/api/all` to inspect the JA3/JA4 hash and compare it
against the expected browser value:

```ts
const client = new ImpersonatedClient({ profile: "chrome131" });
const data = await client.fetchJSON<{ tls: { ja4: string; ja3_hash: string }; http_version: string }>(
  "https://tls.peet.ws/api/all"
);
console.log(data.tls.ja4);        // t13d1516h2_8daaf6152771_02713d6af862
console.log(data.tls.ja3_hash);   // varies by negotiated ciphers
console.log(data.http_version);   // "h2"
client.close();
```

Chrome131 expected JA4: `t13d1516h2_8daaf6152771_02713d6af862`
Firefox135 expected JA4: `t13d1717h2_5b57614c22b0_3cbfd9057e0d`
Safari18_0 expected JA4: `t13d2014h2_a09f3c656075_7f0f34a4126d`
