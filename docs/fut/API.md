# 🔌 Bxc FUT API Reference

Bxc exposes REST endpoints for accessing scraped and unified FUT data.

---

## 🟢 1. Scrape FUT.gg Player
Fetches and parses player details from FUT.gg.

- **Endpoint**: `GET /api/v1/fut/player`
- **Query Parameters**:
  - `url` (required): The FUT.gg player page URL (e.g. `https://www.fut.gg/players/26-20801-cristiano-ronaldo/`).
  - `profile` (optional): `static` (default) | `http` | `ghost`.
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
  - `profile` (optional): `http` (default) | `ghost`.
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
