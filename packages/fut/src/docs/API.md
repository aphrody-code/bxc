# 🔌 Bxc FUT API Reference

Bxc exposes REST endpoints for accessing scraped and unified FUT data.

---

## 🟢 1. Scrape FUT.gg Player
Fetches and parses player details from FUT.gg.

- **Endpoint**: `GET /api/v1/fut/player`
- **Query Parameters**:
  - `url` (required): The FUT.gg player page URL (e.g. `https://www.fut.gg/players/26-20801-cristiano-ronaldo/`).
  - `profile` (optional): `static` (default) | `http` | `stealth`.
- **Response**:
```json
{
  "success": true,
  "data": {
    "name": "Cristiano Ronaldo",
    "rating": 86,
    "position": "ST",
    "club": "Al Nassr",
    "nation": "Portugal",
    "league": "ROSHN Saudi League",
    "price": "15,000",
    "playstyles": ["Power Header", "Rapid"]
  }
}
```

---

## 🟢 2. Scrape FUTBin Price
Fetches the current player price from FUTBin.

- **Endpoint**: `GET /api/v1/fut/price`
- **Query Parameters**:
  - `url` (required): The FUTBin player page URL.
  - `profile` (optional): `http` (default) | `stealth`.
- **Response**:
```json
{
  "success": true,
  "data": {
    "url": "https://www.futbin.com/26/player/20801/cristiano-ronaldo",
    "price": "14,500",
    "lastUpdated": "2026-05-31T14:26:00Z"
  }
}
```

---

## 🟢 3. Query Crawled Players (REST)
Retrieves players stored in the database with custom filters, pagination, and sorting.

- **Endpoint**: `GET /api/v1/fut/players`
- **Query Parameters**:
  - `rating_min` (optional): Filter by minimum rating (e.g. `80`).
  - `rating_max` (optional): Filter by maximum rating.
  - `position` (optional): Filter by position (e.g. `CM`).
  - `club` (optional): Filter by club name.
  - `nation` (optional): Filter by nation.
  - `league` (optional): Filter by league.
  - `rarity` (optional): Filter by rarity.
  - `gender` (optional): Filter by gender (`Men` | `Women`).
  - `foot` (optional): Filter by preferred foot (`Left` | `Right`).
  - `sort_by` (optional): Field to sort by (`rating`, `overall_rating`, `pac`, `sho`, `pas`, `dri`, `def`, `phy`). Default: `rating`.
  - `sort_order` (optional): Sort direction (`asc` | `desc`). Default: `desc`.
  - `limit` (optional): Max results to return. Default: `50`.
  - `offset` (optional): Pagination offset. Default: `0`.
- **Response**:
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "170890-blaise-matuidi",
      "name": "Blaise Matuidi - Ultimate Scream Hero 87 OVR",
      "rating": 85,
      "position": "CM",
      "club": null,
      "nation": "France",
      "league": "Ligue 1 McDonald's",
      "playstyles": "[\"Pinged Pass\",\"Intercept\",\"Anticipate\",\"Press Proven\",\"Quick Step\",\"Relentless\"]",
      "playstyles_plus": "[\"Jockey\"]",
      "pac": 84,
      "classifications": ["Fast", "Playstyles+ Star"]
    }
  ]
}
```

---

## 🟢 4. Get Statistics Summary (REST)
Retrieves global database metrics and grouped player counts.

- **Endpoint**: `GET /api/v1/fut/stats/summary`
- **Response**:
```json
{
  "success": true,
  "summary": {
    "total_players_crawled": 460,
    "total_prices_tracked": 12,
    "average_overall_rating": 89.2,
    "positions": [
      { "position": "CM", "count": 120 }
    ],
    "rarities": [
      { "rarity": "Rare", "count": 200 }
    ],
    "genders": [
      { "gender": "Men", "count": 410 }
    ]
  }
}
```

---

## 🟣 5. GraphQL API (`/graphql`)
Bxc exposes Type-GraphQL queries with identical filtering capabilities at `POST /graphql`.

### A. Query `futPlayers`
Retrieves a list of players with detailed nested stats.
```graphql
query {
  futPlayers(limit: 5, ratingMin: 80, sortBy: "pac") {
    id
    name
    rating
    position
    playstyles
    playstylesPlus
    classifications
    pac
    sho
  }
}
```

### B. Query `futStatsSummary`
Retrieves statistical aggregates across all crawled players.
```graphql
query {
  futStatsSummary {
    totalPlayersCrawled
    totalPricesTracked
    averageOverallRating
    positions {
      name
      count
    }
  }
}
```
