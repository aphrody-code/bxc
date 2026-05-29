---
name: bxc-wbo
description: Fetches and analyzes WBO rankings, player standings, and competitive metagame stats.
---

# Skill: Bxc WBO & Metagame Analytics (`bxc-wbo`)

Use this skill when you need to fetch WBO player profile/thread data, scrape leaderboards, or query WBO Beyblade X competitive metagame stats.

## When to use
- Querying player ratings (BR, MR), standings, wins, or losses.
- Running metagame checks on dominant blades/ratchets/bits.
- Initiating or stopping the Elysia dashboard server.

## Commands
- `bun run scripts/fetch_all_rankings.ts` — Fetches current archived listings of WBO player standings.
- `bun run scripts/parse_rankings_all.ts` — Parses HTML rankings into a structured JSON database.
- `bun run server:start` — Boots the API server and interactive dashboard at `localhost:3000`.

## API Endpoints
- Dashboard: `http://localhost:3000/`
- Rankings API: `http://localhost:3000/api/v1/rankings`
- Metagame API: `http://localhost:3000/api/v1/metagame`
