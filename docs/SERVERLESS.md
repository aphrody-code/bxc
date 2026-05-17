# Bxc — Serverless

Bxc ships a single-file fetch handler designed for short-lived,
sub-second serverless invocations. Cold-start budget is dominated by the
Bun runtime itself plus lazy-loaded modules — typically 100–250 ms on
warm Vercel/AWS Bun functions.

## Compatibility matrix

| Target                             | Profile      | Cold-start | Notes                                    |
| ---------------------------------- | ------------ | ---------- | ---------------------------------------- |
| Vercel Functions (`runtime: "bun"`)| `http`       | ~150 ms    | Best fit — full Bun + FFI                |
| AWS Lambda (Bun layer)             | `http`       | ~200 ms    | Provided runtime / Bun layer required    |
| Cloudflare Containers              | `http`       | ~250 ms    | One-shot containers, FFI works           |
| fly.io machines                    | any          | ~100 ms    | Always-on or on-demand                   |
| `bun build --compile` standalone   | any          | <50 ms     | Single binary, no runtime dependency     |
| Cloudflare Workers (V8 isolates)   | not supported| n/a        | No Bun, no FFI                           |

The default profile is `http` (curl-impersonate via FFI) — there is no
sub-process fork (Lightpanda) and no Chromium / Firefox download, which
keeps the deployable artifact small (`liblightpanda_dom.so` 1.7 MB +
`libcurl-impersonate-chrome.so` 2.5 MB).

## Routes

The handler exposes 5 routes on whatever path you mount it under.

| Route             | Method   | Query / Body                                              | Description                              |
| ----------------- | -------- | --------------------------------------------------------- | ---------------------------------------- |
| `/`               | GET      | —                                                         | Health check                             |
| `/scrape`         | GET/POST | `url`, `profile?`, `extract?`, `httpProfile?`             | Fetch a URL, return html/text/structured |
| `/detect`         | GET      | `url`                                                     | Wappalyzer + Google detection            |
| `/search`         | GET      | `q`, `hl?`, `gl?`, `cacheTtlMs?`                          | Google rich SERP (cached)                |
| `/autocomplete`   | GET      | `q`, `hl?`, `gl?`                                         | Google Suggest API                       |

## Vercel example

`app/api/scrape/route.ts`:

```ts
export const runtime = "bun";
export { handler as GET, handler as POST } from "@bunmium/bxc/serverless";
```

`vercel.json`:

```json
{
	"functions": {
		"app/api/scrape/route.ts": { "runtime": "bun" }
	}
}
```

## Standalone binary

```sh
bun run build:serverless
./dist/bxc-serverless --port 3000
```

Or programmatically:

```ts
import { handler } from "@bunmium/bxc/serverless";

Bun.serve({ port: 3000, fetch: handler });
```

## AWS Lambda (Bun layer)

```ts
import { handler as bxcHandler } from "@bunmium/bxc/serverless";

export const handler = async (event: { rawPath: string; queryStringParameters?: Record<string, string> }) => {
	const url = new URL(`https://lambda${event.rawPath}`);
	for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) {
		url.searchParams.set(k, v);
	}
	const res = await bxcHandler(new Request(url, { method: "GET" }));
	return {
		statusCode: res.status,
		headers: Object.fromEntries(res.headers),
		body: await res.text(),
	};
};
```

## Cold-start optimisation

- All heavy modules (`browser.ts`, `google/index.ts`, `detect.ts`) are
  imported lazily on the first matching request.
- The handler reuses one HTTP page per request and closes it in `finally`.
- The Google rich-search route uses a 5-min in-memory cache by default —
  warm invocations within the same instance return in <5 ms.

## Limits

- `stealth` and `max` profiles are intentionally rejected — they spawn
  Chromium / Firefox sub-processes that exceed serverless time and
  filesystem budgets. Use a long-running fly.io machine or a self-hosted
  worker for those.
- The handler does not persist cookies between invocations. For
  authenticated scraping in serverless, pass the cookie jar in the
  request body (POST `/scrape`) and use the `httpProfile` field.
