# 🏗️ Bxc FUT Engine Architecture

The Bxc FUT Engine is a specialized sub-module designed to scrape, clean, and serve FIFA/EA FC Ultimate Team data from protected targets like **FUT.gg**, **FUTBin**, and the **EA Sports FC Web App**.

```
             ┌────────────────────────────────────────────────────────┐
             │                      Bxc FUT API                       │
             └───────────────────────────┬────────────────────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
         [ FUT.gg Scraper ]      [ FUTBin Scraper ]       [ EA Web App Client ]
                 │                       │                        │
                 ▼                       ▼                        ▼
           Profile: static         Profile: stealth         Profile: http
```

---

## 🛡️ Target Anti-Bot Profiling

To ensure high reliability on resource-constrained servers, Bxc uses a dynamic routing mechanism that chooses the lowest-overhead profile capable of bypassing target protections:

1. **FUT.gg (Low-Medium Challenge)**
   - **Profile**: `static` or `http` for fast data collection.
   - **Strategy**: Can be read using static DOM query selectors without executing heavy JavaScript.

2. **FUTBin (High Challenge)**
   - **Profile**: `stealth`
   - **Strategy**: Uses Lightpanda/Bxc-Engine backed by a custom stealth injection suite (`navigator.webdriver` removal, realistic screen dimensions, and locale overrides) to pass Cloudflare Turnstile verification.

3. **EA Sports FC Web App (Medium Challenge / SPA)**
   - **Profile**: `http` (with pre-authenticated cookies) or `stealth`
   - **Strategy**: Bypasses Akamai Edge filtering and uses pre-auth cookie injection for API calls.

---

## 📊 Data Flow & Storage

All scraped elements are validated against strict TypeScript definitions before being exposed via REST endpoints in the Bxc Elysia server.
- **In-Memory Cache**: Uses temporary caches for quick lookups of player prices.
- **SQLite Persistence**: Can write results directly to a local Drizzle-backed database.
