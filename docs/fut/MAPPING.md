# 🗺️ Bxc FUT Data Mapping

This document maps out the specific CSS selectors, attributes, and structures used to extract player information, pricing, SBCs, and stats from target sites.

---

## ⚽ 1. FUT.gg Selector Maps

### Player Listing Page
- **Container**: `div.player-row` or `a.player-card-link`
- **Name**: `div.player-name` or `div.name`
- **Rating**: `div.player-rating` or `span.rating`
- **Position**: `div.player-position`
- **Club/Nation/League**: Selectors matching `img.club-badge`, `img.nation-flag`, `img.league-badge`

### Player Detail Page
- **Attributes**: `div.attribute-value`
- **Price (PS/Xbox/PC)**: `span.price` or `div.price-value`
- **PlayStyles**: `div.playstyle-item`

---

## 📊 2. FUTBin Selector Maps

### Player Price Endpoint
- **URL**: `https://www.futbin.com/26/player/<id>/<slug>`
- **Direct Price Elements**: `div#flat-prices div.price-val`
- **Daily Stats**: `div.player-stat-val`

---

## 🎮 3. EA FC Web App Structures

### Authentication
- Uses `token` and `session` headers injected via Cookie loader.
- **Main App Container**: `div#ea-app` or `#root`
- **Loader Indicator**: `div.loader` or `img[src*='loader']`
