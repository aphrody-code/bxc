# Cache SQLite intelligent pour IETV

## Architecture

Le module IETV utilise un **cache multi-layer** pour performance maximale :

```
┌─────────────────────────┐
│  Requête HTTP Client    │
└────────────┬────────────┘
             │
    ┌────────▼────────┐
    │  L1: Request    │    (60s en mémoire)
    │  Cache (RAM)    │    Requêtes fréquentes
    └────────┬────────┘
             │ (miss)
    ┌────────▼──────────┐
    │  L2: SQLite DB    │   (~/.cache/ietv/episodes.db)
    │  Persistent Cache │   Episodes, channels, métadonnées
    └────────┬──────────┘
             │ (miss)
    ┌────────▼──────────┐
    │  L3: Live Scrape  │   YouTube, official, Pluto.tv
    │  (IETVScraper)    │   Parallèle + fetch queue
    └───────────────────┘
```

## Schema SQLite

```sql
channels              -- Sources (YouTube, official, Pluto)
├─ id (PK)
├─ channel (UNIQUE)   -- inazumaelevenfrance1, official, pluto-no
├─ title              -- "Inazuma Eleven France"
├─ description
├─ totalEpisodes
├─ lastScrape (UNIX timestamp)
└─ createdAt, updatedAt

seasons               -- Saisons par chaîne
├─ id (PK)
├─ channel_id (FK)
├─ season (INT)
├─ totalEpisodes
└─ UNIQUE(channel_id, season)

episodes              -- Episodes individuels
├─ id (PK)
├─ channel_id (FK)
├─ season, episode
├─ videoId (UNIQUE)   -- YouTube video ID
├─ title              -- "Épisode 1 - La naissance d'une légende"
├─ url                -- YouTube/Pluto.tv direct link
├─ thumbnail
├─ language           -- 'vf' | 'vostfr'
├─ duration (seconds)
├─ quality            -- '720p', '1080p'
└─ UNIQUE(channel_id, season, episode, language)

metadata              -- Cache metadata avec TTL
├─ key (PK)
├─ value
└─ expiresAt (UNIX timestamp, NULL = infinite)

Indexes: channel_id, season, language, title COLLATE NOCASE
```

## Usage

### 1. Dans l'API REST Server

```typescript
import { IETVCache } from "@aphrody/ietv/cache";

// Initialiser
const cache = new IETVCache("~/.cache/ietv/episodes.db");

// Sauvegarder des données scrappées
const channelInfo = await scraper.getChannelEpisodes("inazumaelevenfrance1");
cache.saveChannel(channelInfo);

// Récupérer depuis le cache
const cached = cache.getChannel("inazumaelevenfrance1");
if (cached) {
  return cachedData;  // Aucun scrape live nécessaire
}

// Recherche SQL rapide
const results = cache.search({
  q: "légende",
  season: 1,
  language: "vf",
  limit: 50
});

// Stats du cache
const stats = cache.getStats();
// {
//   channels: 7,
//   seasons: 42,
//   episodes: 1200,
//   byLanguage: { vf: 600, vostfr: 600 },
//   lastUpdate: 1704067200000
// }
```

### 2. CLI Integration

```bash
# L'API server persiste automatiquement
bun src/api/ietv-server.ts

# Requête initiale (scrape live, persiste)
curl http://localhost:3000/api/ietv/all
# ↓ Sauvegarde dans ~/.cache/ietv/episodes.db

# Requête suivante (L2 cache, ultra-rapide)
curl http://localhost:3000/api/ietv/search?q=episode&lang=vf
# ↓ Query SQLite : ~5-50ms (zéro scrape)

# Vérifier l'état du cache
curl http://localhost:3000/api/ietv/stats
# {
#   "cache": {
#     "channels": 7,
#     "episodes": 1200,
#     "lastUpdate": 1704067200000
#   }
# }
```

## Performance

| Opération | Avant (MemoryCache) | Après (SQLite) | Gain |
|-----------|-------------------|-----------------|------|
| `/all` (L1 hit) | ~1ms | ~2ms | - |
| `/all` (L2 hit) | ❌ ~300ms scrape | ~50-100ms SQL | 3-6x |
| `/search` | ~200ms iterate | ~10-20ms SQL | 10-20x |
| Startup temps | instant | +50ms init DB | OK |
| Persistance | ❌ Lost on restart | ✅ Survit reboot | ✓ |
| Cache size | Limité RAM | ~100-500MB disk | ✓ |

## Features

### ✅ Intelligent TTL

```typescript
// Metadata avec expiration
cache.setMetadata("scrape-status", "in-progress", 30000); // 30s TTL
cache.clearExpired(); // Cleanup auto

// Channels: lastScrape track
// Si lastScrape > 24h → considéré stale, re-scrape suggéré
```

### ✅ Requête SQL complexe

```typescript
cache.search({
  q: "légende",
  season: 3,
  episode: 5,
  language: "vf",
  channel: "inazumaelevenfrance1",
  limit: 100
});
// ↓ Retourne 100 résultats en <20ms
```

### ✅ WAL Mode (Write-Ahead Logging)

- Concurrence lecture/écriture
- Crash-safety
- Pas de locking des lectures

### ✅ Paramétré

```typescript
new IETVCache("~/.cache/ietv/episodes.db")
// ou
new IETVCache("/var/cache/ietv/episodes.db")
// ou
new IETVCache(":memory:") // Test mode
```

## Maintenance

### Nettoyer le cache expiré

```typescript
cache.clearExpired();
```

### Forcer un re-scrape

```typescript
cache.clear();
// Puis GET /api/ietv/all scrappera à nouveau
```

### Inspecter la DB

```bash
sqlite3 ~/.cache/ietv/episodes.db

sqlite> SELECT channel, COUNT(*) as eps FROM episodes GROUP BY channel;
sqlite> SELECT language, COUNT(*) as count FROM episodes GROUP BY language;
sqlite> SELECT * FROM episodes WHERE title LIKE '%légende%' LIMIT 5;
```

## Avantages

1. **Zero scrape overhead** — Chaque requête après la 1ère utilise le cache
2. **Queryable** — Recherche SQL au lieu d'itération JavaScript
3. **Persistent** — Survit restarts, crash du serveur
4. **Efficient** — WAL + PRAGMA optimize + indexes
5. **Scalable** — Peut stocker 10k+ épisodes sans ralentir
6. **Type-safe** — TypeScript générique + validation

## Cas d'usage

| Cas | Solution |
|-----|----------|
| Bot Discord (requêtes fréquentes) | L1 cache (60s) |
| App mobile (offline ready) | SQLite sync |
| Recherche complexe | SQL query |
| Refresh nightly | Job systemd |
| Stats/monitoring | Cache stats |
