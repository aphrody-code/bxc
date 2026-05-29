# WBO Rankings & Beyblade X Metagame Analytics

Bxc integrates a dedicated scraping and analytics module for the **World Beyblade Organization (WBO)**. This module bypasses bot protection systems by utilizing Wayback Machine snapshots, parses player standings and tournament results, performs metagame analytics (Average Weighted Podium Scores and Bayesian synergies), and serves an interactive web dashboard.

---

## 🚀 Features

1. **Bot Bypass (Wayback-Backed)**: Bypasses strict Cloudflare Turnstile blocks by downloading pages through Wayback Machine snapshots.
2. **Standings Crawler**: Extracts player names, ranks, wins, losses, and rating points (BR, MR) across General/Top, Burst, and Metal Saga leaderboards.
3. **Metagame Analytics Engine**: Splits and parses tournament podium logs to compute:
   - **Average Weighted Podium Score**: Highlights parts that consistently take 1st place finishes rather than just raw volume.
   - **Combo Synergy**: Evaluates co-occurrence and performance rate of parts in combos using Bayesian-like shrinkage.
4. **Interactive Dashboard**: Sleek Vanilla CSS glassmorphic frontend with responsive tables, player filter search, and dynamic share distribution charts via Chart.js.
5. **Native MCP Tools**: Exposes the parsed standings and metagame stats directly to LLM agents through stdio MCP tools.

---

## 🛠️ Commands

### 1. Re-fetching Snapshot URLs
Queries Wayback CDX API for valid `/rankings` snapshots:
```bash
bun run scripts/fetch_rankings_cdx.ts
```

### 2. Downloading Rankings Pages
Downloads main, burst, and metal HTML archives:
```bash
bun run scripts/fetch_all_rankings.ts
```

### 3. Parsing Standings
Parses raw HTML and outputs to `data/wbo_rankings_parsed.json`:
```bash
bun run scripts/parse_rankings_all.ts
```

### 4. Running the Dashboard Server
Boots the Elysia API/static web server on port `3000`:
```bash
bun run server:start
```

---

## 🌐 API & Dashboard Endpoints

* **Dashboard**: [http://localhost:3000/](http://localhost:3000/)
* **Rankings API**: [http://localhost:3000/api/v1/rankings](http://localhost:3000/api/v1/rankings)
* **Metagame API**: [http://localhost:3000/api/v1/metagame](http://localhost:3000/api/v1/metagame)

---

## 🤖 Native MCP Tools Reference

Bxc natively registers these tools on its stdio MCP server for agentic interaction:

### `bxc_wbo_rankings`
Retrieves player standings by category with optional name filtering:
- `category` (enum): `General/Top`, `Burst`, `Metal`
- `search` (string, optional): Search by username

### `bxc_wbo_metagame`
Retrieves competitive parts ratings and top synergies:
- `type` (enum): `all`, `blade`, `ratchet`, `bit`, `synergies`
