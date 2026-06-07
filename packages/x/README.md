# @aphrody/x

Headless **X (Twitter)** client in pure TypeScript for Bun. Cookie-auth GraphQL + REST, no official API key required. Stealth, local state (SQLite store + FTS), catalog sync, and deep integration with `@aphrody/xai` for agentic Grok flows.

**Zero keys, fully native**: Uses real browser cookies (`auth_token` + `ct0`), query ID catalog synced from live X bundles, and the production stealth profiles from bxc.

**Table of Contents**

- [Key Features](#key-features)
- [Auth (cookie-based, no X API key)](#auth-cookie-based-no-x-api-key)
- [Usage](#usage)
  - [Basic](#basic)
  - [Ranking with local For You algo (no ML model needed)](#ranking-with-local-for-you-algo-no-ml-model-needed)
  - [With X + Grok (agentic, via @aphrody/xai)](#with-x--grok-agentic-via-aphrodyxai)
- [CLI (`bxc x`)](#cli-bxc-x)
- [Advanced / Internal](#advanced--internal)
- [MCP](#mcp)
- [Installation & Build](#installation--build)
- [Relation to bxc + xai](#relation-to-bxc--xai)
- [License](#license)

## Key Features

- **Core operations**: `whoami`, `profile` (userByScreenName), `tweets` (user timeline), `search` (Latest/Top), `news` (Explore tabs / trending).
- **Advanced**: X Pro / Gryphon decks (radar, columns, sync), Radar keyword search, premium upsells, media upload, archive import/export, local SQLite store with edges/FTS search/digest.
- **Algo (For You ranking)**: Local X For You style re-ranking (`rankPosts`, `rankTweets`, `toPostCandidate`/`tweetToPostCandidate`) ported/adapted from [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm). Filters (dupe, self, blocked, muted, age), weighted scoring (engagement proxy + in-network/history/freshness bonuses), author diversity attenuation. Mirrors the Rust `x-algorithm` crate.
- **X + Grok synergy** (with `@aphrody/xai`): Use native `XTools` + tool defs (`x_search`, `x_profile`, `x_whoami`, `x_tweets`, `x_news`) to fulfill Grok tool calls locally with the real XClient (stealth + store). See [packages/xai/README.md](../xai/README.md) for agentic examples.
- **Recon & tools**: Surface recon, catalog sync from JS bundles, crawler/RAG for Beyblade X metagame, etc.
- **Stealth & perf**: Integrates bxc profiles (static/http/fast/stealth/max), cookie injection, HAR, etc. Pure TS (parallel Rust FFI in bxc for speed).

See `src/core/client.ts`, `src/algo.ts`, `src/tools` (in xai), `src/services/*`, `src/db/*`.

## Auth (cookie-based, no X API key)

Uses `auth_token=...; ct0=...` (from logged-in X web session).

Resolution (via `XSession`):

1. Explicit cookie string.
2. Session file (`~/.config/x-cli/session.json` or env).
3. `X_AUTH_TOKEN` / `X_CT0` env.

```ts
import { XClient, XSession } from "@aphrody/x";

const session = XSession.loadOrEnv(); // or fromCookieString("auth_token=...; ct0=...")
const client = new XClient(session);
```

**Cookie management**: Use bxc CLI `bxc cookies ...` or the tools in `src/cookies` (in root bxc).

### Optional Hermes Tweet / Xquik Read Backend

Cookie auth remains the default. Public read operations can optionally use
[Hermes Tweet](https://github.com/Xquik-dev/hermes-tweet) through Xquik when an
X session is not available, or when you explicitly select that backend:

```bash
export APHRODY_X_READ_BACKEND=hermes
export HERMES_TWEET_API_KEY="xq_..."
```

Supported aliases:

| Variable | Purpose |
| --- | --- |
| `APHRODY_X_READ_BACKEND=auto` | Default. Use cookies when present, Hermes Tweet only for supported public reads without a cookie session. |
| `APHRODY_X_READ_BACKEND=x` | Force the original cookie-auth X client. |
| `APHRODY_X_READ_BACKEND=hermes` or `xquik` | Force Hermes Tweet/Xquik for supported public reads. |
| `HERMES_TWEET_API_KEY` or `XQUIK_API_KEY` | API key for the Hermes Tweet/Xquik read backend. |
| `HERMES_TWEET_BASE_URL` or `XQUIK_BASE_URL` | Optional base URL. Defaults to `https://xquik.com`. |
| `HERMES_TWEET_TIMEOUT_MS` | Optional fetch timeout. Defaults to `30000`. |

The backend supports `profile`, `tweets`, `search`, tweet lookup, and thread
reads. Private reads, writes, media upload, X Pro, Radar, and `whoami` still
require the original cookie session.

## Usage

### Basic

```ts
import { XClient, XSession } from "@aphrody/x";

const session = XSession.loadOrEnv();
const client = new XClient(session);

const user = await client.whoami();
console.log(user);

const profile = await client.userByScreenName("aphrody_code");
const tweets = await client.userTweets(profile.id, 20);

const search = await client.search("bun runtime", 10); // Latest by default
const news = await client.getNews(5);
```

### Ranking with local For You algo (no ML model needed)

```ts
import { rankTweets, tweetToPostCandidate } from "@aphrody/x";

const results = await client.search("bxc browser engine");
const candidates = results.tweets.map(t => tweetToPostCandidate(t, /* inNetwork? */ false));
const ranked = rankTweets(results.tweets, {
  viewer_id: user.id,
  followed_author_ids: [...],
  recent_engagement_author_ids: [...],
  muted_keywords: ["spam"],
  now_unix: Math.floor(Date.now()/1000),
}, 10);

console.log(ranked[0].post.text, ranked[0].score, ranked[0].reasons);
```

See `src/algo.ts` for `rankPosts`, filters, scoring (engagement + in_network + diversity), and conversions.

### With X + Grok (agentic, via @aphrody/xai)

See the full examples and `XTools` in [packages/xai/README.md](../xai/README.md). Grok can decide to call native X tools; fulfillment uses this package's XClient (no extra keys).

Runnable end-to-end example: [packages/xai/examples/grok-x-agent.ts](../xai/examples/grok-x-agent.ts).

Example pattern (in Grok tool handler):

```ts
const xTools = new XTools(session); // or injected mock in tests
if (tool.name === "x_search") {
  const res = await xTools.search(args);
  chat.append({ role: "tool", tool_call_id: tool.id, content: JSON.stringify(res) });
}
```

`XTools` exposes: `search`, `profile`, `whoami`, `tweets`, `news` + corresponding tool defs for easy inclusion in `createChat({ tools: [...] })`.

## CLI (`bxc x`)

```bash
bxc x whoami
bxc x profile elonmusk
bxc x tweets elonmusk --count 20
bxc x search "bun runtime" --count 10
bxc x news --count 5
bxc x rank "query"   # or foryou (uses local algo + X data)
```

See root CLI for `bxc x rank` / `foryou` (local X For You re-ranking).

## Advanced / Internal

- **Store & state**: SQLite with tweet/user/community edges, FTS5 search, digest, archive import.
- **Catalog & recon**: Dynamic query IDs from X JS bundles (`sync-x-catalog.ts`), surface recon, premium graph.
- **X Pro / Radar**: Decks, columns, radar search (see `src/services/x-pro-deck.ts`, `src/config/radar-surface.ts` and `packages/x/docs/X_PRO.md`).
- **Beyblade X metagame**: Ingest, RAG, crawler for communities (see `src/services/rag.ts`, `src/db/ingest.ts`).

## MCP

- `bxc_x_client` (profile, tweets, search, news, whoami, rank/foryou via algo)
- `bxc_xpro_deck` (decks + radar)
- Plus synergy via `bxc_grok_*` tools (Grok can trigger native X fulfillment).

## Installation & Build

```bash
bun add @aphrody/x
# or in workspace: bun install (monorepo)
```

Main entry: `src/index.ts` (re-exports core, services, algo, etc.).

## Relation to bxc + xai

This is the pure-TS headless X client powering bxc's `bxc x` CLI, recon, and MCP. Pairs with `@aphrody/xai` for Grok + native X agent loops (keyless SuperGrok OIDC + cookie X = zero external keys, fully local/stealth).

See:
- Root `README.md` and `CLAUDE.md`
- `packages/xai/README.md` (high-level Grok Chat + XTools)
- `src/cli/x.ts`, `src/mcp/server.ts`
- `packages/x/docs/` (X_PRO.md, COVERAGE.md, etc.)
- Examples in `examples/`

**Production notes**: Cookie sessions expire/rotate; use stealth profiles; prefer local algo + store over repeated live calls. All verified in unit tests (no live required for core + algo).

## Testing

See `index.test.ts` for units (catalog, store, archive, algo/ranking, ingest/RAG, synergy with xai via mocks). Integration tests skip without session.

Run: `bun test packages/x`

For cross with xai (Grok + native X tools), see `packages/xai/index.test.ts` (e.g., full tool loop tests).

## License

Apache-2.0 (see root).

Contribute via the bxc monorepo (catalog sync, new surfaces, more algo features, etc.).
