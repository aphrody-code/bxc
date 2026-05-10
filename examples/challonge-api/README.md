# challonge-api — bunlight bridge to Challonge

Local HTTP server that exposes Challonge tournament data as a JSON API
URL-compatible with the official Challonge REST surface
(https://challonge.apidog.io/getting-started-1726706m0). The data is
scraped via bunlight's `http` profile (curl-impersonate Chrome 131) using
your own logged-in browser cookies — no API key needed.

## Why this exists

The official Challonge API requires per-account API keys, rate-limits
aggressively, and exposes a different shape from what the Challonge web
UI displays. If you already have a logged-in browser session, exporting
its cookies and replaying them via bunlight gives you the exact same
data the web UI sees, including private tournaments, with no key.

Bunlight's `http` profile uses curl-impersonate to forge a Chrome 131
TLS / JA4 fingerprint, so Cloudflare's Managed Challenge does not
interfere with the cookie-authenticated requests.

## Cloudflare gate (audit 2026-05-10)

Every page on `challonge.com` is behind Cloudflare Managed Challenge —
including `sitemap.xml`, `robots.txt`-listed paths, and the
reverse-engineered `.json` endpoints :

```
GET https://challonge.com/sitemap.xml      → HTTP 403 cf-mitigated
GET https://challonge.com/T_SS1.json       → HTTP 403 cf-mitigated   (no cookies)
GET https://challonge.com/T_SS1.json       → HTTP 200                (with cf_clearance)
```

The official API host (`api.challonge.com`) is NOT behind the same
challenge bucket and works with HTTP Basic + `api_key`. So this server
runs in one of three modes :

| Mode | Trigger | Upstream | Cloudflare bypass |
|---|---|---|---|
| `official-api-key` | `CHALLONGE_API_KEY` env var set | `api.challonge.com/v1/*.json` + Basic auth | n/a (different host) |
| `session-cookies` | `cookies/private/challonge.json` exists | `challonge.com/{slug}.json` via curl-impersonate | yes (cf_clearance + session) |
| `no-auth` | nothing configured | none | impossible — every request returns 403 |

`GET /healthz` reports the active mode. `GET /v1/_diagnose/:slug` runs a
real upstream call and tells you exactly why it failed (stale cookies,
wrong slug, missing key, …).

## Reverse-engineered URL patterns

These are the routes the Challonge web UI uses internally. Each one is
public if you have an authenticated session. Use the corresponding
server endpoint to get the same payload through the local API.

### 1. Community tournaments index

```
https://challonge.com/fr/communities/{org}/tournaments?page=1&search=&zip=&proximity=
https://challonge.com/fr/communities/{org}/tournaments?page=1&search=&zip=&proximity=&past=1
```

- First URL → **current and upcoming** tournaments for the community.
- Second URL → **past** tournaments (archive). The `past=1` query
  parameter is the only difference.
- HTML response (no JSON variant). Bunlight parses with HTMLRewriter
  the `<a class="tournament">` cards : title, slug, date, type,
  participant count.
- Pagination via `page=N`. Iterate until an empty list.
- Local : `GET /v1/communities/:org/tournaments?past=0|1&page=N`

Example :
```bash
curl 'http://localhost:8090/v1/communities/RPB/tournaments?past=0&page=1' | jq .
curl 'http://localhost:8090/v1/communities/RPB/tournaments?past=1&page=1' | jq .
```

### 2. Tournament bracket / module (the tree)

```
view-source:https://challonge.com/fr/{slug}/module
https://challonge.com/fr/{slug}/module
```

- Returns the full bracket SVG + an embedded JSON store
  (`window._initialStoreState.TournamentStore`).
- Best for tree visualisation : every match has a
  `data-match-id`, `data-participant-id`, x/y coordinates that map
  directly to round + bracket-side (WB/LB/GF for double-elim).
- Used by `parseModuleToScrapedTournament()` upstream
  (`@rose-griffon/challonge`).
- Local : `GET /v1/tournaments/:slug/module` (raw HTML pass-through)
  or `GET /v1/tournaments/:slug/module.json` (parsed bracket payload).

### 3. Match log (every match in chronological order)

```
https://challonge.com/fr/{slug}/log
https://challonge.com/fr/{slug}/log?page=N
```

- HTML table : timestamp, who reported, which match, which result.
- Source of truth for re-playing the tournament chronologically.
- The store path is `LogStore.entries` or `ActivityStore.log`.
- Pagination via `page=N`.
- Local : `GET /v1/tournaments/:slug/log` (HTML)
  or `GET /v1/tournaments/:slug/log.json` (parsed entries).

### 4. Standings (final ranks + W/L)

```
https://challonge.com/fr/{slug}/standings
https://challonge.com/fr/{slug}/standings.json
```

- Returns rank, display name, **Challonge username**, wins, losses, set
  history.
- The display-name and username are not always identical : people pick
  display names that differ from their account handle. The standings
  page is the canonical source.
- Local : `GET /v1/tournaments/:slug/standings.json`

### 5. Participants (with profile pictures)

```
https://challonge.com/fr/{slug}/participants
https://challonge.com/fr/{slug}/participants.json
```

- Per-participant : seed, display name, Challonge username, **portrait
  URL** (Gravatar or custom upload, served from `assets.challonge.com`).
- Useful for building rich UI : combine standings (W/L) with
  participants (avatars) keyed by id.
- Local : `GET /v1/tournaments/:slug/participants.json`

### 6. Other useful page-level endpoints

| URL | Purpose | Local route |
|---|---|---|
| `https://challonge.com/{slug}.json` | full tournament metadata | `GET /v1/tournaments/:slug.json` |
| `https://challonge.com/{slug}/stations` | live station status (open / paused / current match) | `GET /v1/tournaments/:slug/stations.json` |
| `https://challonge.com/users/{username}.json` | user profile | `GET /v1/users/:username.json` |
| `https://challonge.com/fr/users/{username}/tournaments` | tournaments hosted/joined by a user | `GET /v1/users/:username/tournaments` |

The `/fr/` prefix can be replaced by `/en/`, `/de/`, etc. The locale only
changes UI strings — the underlying JSON payloads are identical.

## Quick start

```bash
# 1. Export your Challonge cookies from Chrome DevTools
#    Application > Cookies > select-all > copy
#    Save the tab-separated dump to a file, e.g. /tmp/cookies.tsv

# 2. Convert to the JSON jar bunlight expects
bun run examples/challonge-api/import-cookies.ts \
  /tmp/cookies.tsv \
  examples/challonge-api/cookies/private/challonge.json

# 3. Start the server
bun run examples/challonge-api/server.ts
# → challonge-api: listening on http://0.0.0.0:8090

# 4. Sanity-check upstream access
curl 'http://localhost:8090/healthz' | jq .
curl 'http://localhost:8090/v1/_diagnose/B_TS5' | jq .

# 5. Use it
curl 'http://localhost:8090/v1/tournaments/B_TS5.json' | jq .
curl 'http://localhost:8090/v1/communities/RPB/tournaments?past=1&page=1' | jq .
```

## Cookie jar format

`cookies/private/challonge.json` is a JSON array compatible with both
Playwright and CDP (`Network.setCookies`). Each entry :

```json
{
  "name": "cf_clearance",
  "value": "T_zobH_X...",
  "domain": ".challonge.com",
  "path": "/",
  "expires": 1778429330,
  "secure": true,
  "httpOnly": true,
  "sameSite": "None"
}
```

The minimum cookies needed to pass Cloudflare and authenticate to a
Challonge session :

| Cookie | Purpose | Lifetime |
|---|---|---|
| `cf_clearance` | Cloudflare bot-pass token | rotates every few hours |
| `_challonge_session_production` | server session | session (browser-bound) |
| `user_credentials` | auto-login on session expiry | 1 year |
| `__cf_bm` | Cloudflare bot management | 30 minutes |
| `locale` | UI language | 1 year |

When `cf_clearance` rotates, the local API will start returning 403 on
the reverse-engineered routes. Re-export from your browser and re-run
`import-cookies.ts` to refresh.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `CHALLONGE_API_PORT` | `8090` | Listen port |
| `CHALLONGE_API_HOST` | `0.0.0.0` | Listen address |
| `CHALLONGE_COOKIES` | `cookies/private/challonge.json` | Path to cookie jar JSON |
| `CHALLONGE_API_KEY` | unset | Use the official API host instead of cookies (no Cloudflare gate) |
| `CHALLONGE_API_AUTH` | unset | Optional `Bearer <TOKEN>` enforcement on every request |
| `CHALLONGE_CACHE_TTL_MS` | `60000` | Per-route LRU cache TTL |

## Endpoints reference

| Method | Path | Source upstream | Mode |
|---|---|---|---|
| GET | `/healthz` | local | n/a |
| GET | `/openapi.json` | local | n/a |
| GET | `/v1/_diagnose/:slug` | live upstream probe | both |
| GET | `/v1/tournaments/:slug.json` | `{slug}.json` or `api/v1/tournaments/{slug}.json` | both |
| GET | `/v1/tournaments/:slug/participants.json` | `{slug}/participants.json` | both |
| GET | `/v1/tournaments/:slug/matches.json` | `{slug}/matches.json` | both |
| GET | `/v1/tournaments/:slug/log.json` | `{slug}/log.json` | session-cookies |
| GET | `/v1/tournaments/:slug/standings.json` | `{slug}/standings.json` | both |
| GET | `/v1/tournaments/:slug/stations.json` | `{slug}/stations.json` | session-cookies |
| GET | `/v1/tournaments/:slug/module` | raw `{slug}/module` HTML | session-cookies |
| GET | `/v1/tournaments/:slug/module.json` | parsed bracket | session-cookies |
| GET | `/v1/tournaments/:slug/recon` | bunlight `recon` | both |
| GET | `/v1/communities/:org/tournaments?past=0\|1&page=N` | `communities/{org}/tournaments?past=…&page=…` | session-cookies |
| GET | `/v1/users/:username.json` | `users/{username}.json` | session-cookies |
| GET | `/v1/users/:username/tournaments` | `fr/users/{username}/tournaments` | session-cookies |

The `mode` column says which authentication path can serve the route.
The official API does NOT expose `/log`, `/module`, `/stations`,
`/communities`, `/users` — those routes are only reachable via session
cookies on the web origin.

## Typed client

```bash
# Generate typed paths from the OpenAPI spec
bunx openapi-typescript http://localhost:8090/openapi.json -o api.d.ts
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./api.d.ts";

const client = createClient<paths>({ baseUrl: "http://localhost:8090" });

const { data, error } = await client.GET("/v1/tournaments/{slug}.json", {
  params: { path: { slug: "B_TS5" } },
});
//        ^? Tournament resource, fully typed
```

## Security

- `cookies/private/` is gitignored — never commit the jar
- Default bind is `0.0.0.0` for container use; set `CHALLONGE_API_HOST=127.0.0.1`
  for laptops
- Set `CHALLONGE_API_AUTH=<random-token>` when the server is publicly
  reachable so casual probes get `401`
- `expires` fields in the cookie jar are honored by the loader — refresh
  `cf_clearance` regularly (Cloudflare rotates it every few hours)

## Why bunlight `http` profile, not `fast` or `ghost`

Challonge's `.json` reverse endpoints serve raw JSON without JS
execution. The `http` profile is the right pick :

- 10 ms cold start (no Lightpanda subprocess to spawn)
- TLS / JA4 / Sec-CH-UA fingerprint of real Chrome 131 — Cloudflare
  treats it as a regular browser
- `Cookie:` header injection from the loaded jar — RFC 6265 domain
  matching
- No DOM, no JS engine, lowest possible RAM (no rendering needed)

For pages that DO need rendering (e.g. `/module` SVG bracket extraction
when the SVG is JS-driven) fall back to `profile: "fast"` or the
Lightpanda-backed `ghost` helper — both are also Lightpanda-only per
workspace policy (Chrome / Chromium / Firefox / Edge / Safari and
derivatives are forbidden in bunlight).

## Alignment with `~/vps/docs/scraping.md`

The canonical Rose-Griffon scraping catalogue
(`/home/ubuntu/vps/docs/scraping.md`) lists `@rose-griffon/challonge` v2.0.0
(workspace `~/vps/packages/rpb-challonge`) as the production-grade Challonge
client : 4 orthogonal transports (api / scraper / curl-impersonate /
HTMLRewriter) consumed by `apps/rpb-bot`, `apps/rpbey`, and ~9 scripts.

This example serves a different niche : a **standalone HTTP bridge** anyone
can run without the Rose-Griffon monorepo. Both stay aligned on the same
patterns called out in §10 of that doc :

| Pattern (`scraping.md` §10) | Where in this template |
|---|---|
| `AbortSignal.timeout(15000)` on every fetch | `FETCH_TIMEOUT_MS = 15_000` (server.ts) |
| Retry x3 with exponential backoff on 429/502/503/504 | `fetchWithRetry()` (server.ts) |
| User-Agent `<service>/<version> (+<contact-url>)` | `UA = "challonge-api-bridge/0.1 (+https://github.com/aphrody-code/bunlight)"` |
| Cookies under gitignored `storage/cookies/` | `cookies/private/challonge.json` (gitignored via `.gitignore`) |
| Cloudflare-protected static HTML → `curl-impersonate` + `Bun.HTMLRewriter` | bunlight `http` profile (FFI) + HTMLRewriter in `dump-tournament.ts` |
| API key route preferred when available (avoid scraping) | `CHALLONGE_API_KEY` env triggers official mode |

Pitfalls flagged by `scraping.md` §11 also apply :

- **`apps/rpbey` (Vercel)** : the upstream Rose-Griffon canonical workflow
  routes Challonge calls through `apps/rpb-bot` because Vercel forbids FFI
  + browser spawn. This template **also requires Bun + FFI** (curl-impersonate
  via `bun:ffi`) — deploy on a VPS or container, not on Vercel.
- **Cloudflare durci → `Runtime.enable` leak** : addressed by using
  `curl-impersonate` (no browser → no leak) instead of patchright / Camoufox
  (forbidden in bunlight per workspace policy).
- **`cf_clearance` rotates every few hours** : refresh the cookie jar
  regularly. `GET /v1/_diagnose/:slug` reports stale cookies clearly.

If you are inside the Rose-Griffon workspace use `@rose-griffon/challonge`
directly — it has 4 transports, real fingerprint rotation, and live-tested
CapSolver fallback. This example is the lighter standalone path for users
who want a minimal local Challonge bridge without the full monorepo.

## License

0BSD — same as the workspace root.
