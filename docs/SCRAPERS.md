# 🕷️ Bxc Dedicated Scrapers & Verticals

Bxc provides dedicated, highly specialized scrapers designed to handle complex site structures, Cloudflare Turnstile bypass, or direct iframe video resolutions in-process.

---

## ⚽ FIFA Ultimate Team Scraper (`bxc fut`)

Handles extraction from major FIFA/EA Sports FC Ultimate Team directories (FUTBin and FUTGG).

### Features
* **FUTBin Price Scraper**: Fetches live console/PC player prices. Because FUTBin uses aggressive Cloudflare Turnstile checks, `bxc fut price` defaults to in-process fallback pipelines or launches a `ghost` browser instance for stealth bypass.
* **FUTGG Player Stats Scraper**: Pulls detailed stats, attributes, playstyles, and traits of players.

### Usage
```bash
# Get player price
bxc fut price "https://www.futbin.com/26/player/1042/cristiano-ronaldo" --profile stealth

# Get player statistics
bxc fut player "https://www.fut.gg/players/20801-cristiano-ronaldo/" --profile static
```

---

## 📺 VoirAnime French Streaming Directory (`bxc voiranime`)

Specifically reverse-engineered to target WordPress installations running the Madara / `wp-manga` theme.

### Features
* **Zero JS Metadata Scraper**: Parses the server-rendered HTML payload to extract anime names, studios, genres, rating scores, and full episode listings.
* **Embed Link Resolver**: Automatically grabs player iframe targets embedded in episodes and resolves them to direct video media URLs for streaming engines. Supporting providers:
  - **Vidmoly** (HLS streams via tokenized URLs)
  - **Filemoon / MOON**
  - **Streamhide / Streamvid**
  - **Yourupload**
  - Dean-Edwards packed JS payloads.

### Usage
```bash
# Search catalog
bxc voiranime search "Inazuma Eleven"

# Get anime info & episode listing
bxc voiranime info "inazuma-eleven-go-chrono-stone-vostfr"

# Resolve embed to direct streaming URL
bxc voiranime resolve "https://vidmoly.to/embed-xyz"
```

---

## 🐦 X.com Profile Scraper (`bxc xcom`)

Extracts public user timeline and profile details from Twitter without relying on developer API limits or browser automation processes.

### Features
* **Stealth Ingestion**: Runs inside Bxc's `ghost` browser with resource blockers enabled (images, videos, and fonts blocked by default to maximize speed and minimize VPS bandwidth).
* **AI-Ready Markdown**: Emits clean GFM markdown representing the user's public info (bio, followers count, recent pinned tweets).
* **Screenshot Support**: Optional visual layout captures in PNG format.
* **AI Extraction**: Feeds the profile to a local LLM parser to extract structured JSON properties.

### Usage
```bash
# Scrape profile to markdown
bxc xcom profile elonmusk

# Scrape profile with visual verification & structured AI info
bxc xcom profile elonmusk --screenshot --ai-extract
```

---

## 🛡️ Google Ecosystem Client & Auditor (`bxc google`)

Integrates with the Google Ecosystem Atlas (5000+ mapped subdomains and frameworks) to route browser requests safely under strict compliance rules.

### Features
* **Mandate Guard Compliance**: Ensures navigational targets follow smart routing, avoiding traps and Honeypots.
* **Framework Audit**: Identifies Wiz, Angular, and Lit properties.
* **Massive Concurrency**: Audits dozens of endpoints in parallel.

### Usage
```bash
# Mandate compliant open/visit
bxc google open "https://accounts.google.com" --profile stealth

# Audit massive list of Google subdomains
bxc google audit "https://mail.google.com" "https://docs.google.com" "https://drive.google.com"
```

---

## 🏆 World Beyblade Organization (`bxc worldbeyblade` / `bxc challonge`)

Waypoint-backed parser to track player standings, Beyblade X competitive parts metagame metrics (Average Weighted Podium Scores), and tournament snapshots.

### Usage
```bash
# Print a player profile
bxc worldbeyblade profile aphrody --pretty

# Scrape tournament brackets
bxc challonge https://challonge.com/tournament-slug --summary
```
