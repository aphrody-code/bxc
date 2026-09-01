# 📺 IETV — Suite Complète de Streaming Inazuma Eleven

**Module Bun + SQLite intelligent** pour scraper et servir les épisodes Inazuma Eleven depuis 7 sources avec caching persistant.

## 🚀 Nouveau: Cache SQLite multi-layer

Remplace le cache en mémoire simple par une architecture **L1/L2/L3** :

```
Requête HTTP
    ↓
┌─ L1: RAM (60s) ─────┐  ← Requêtes fréquentes (1ms)
│  MemoryCache        │
└──────┬──────────────┘
       │ (miss)
┌─ L2: SQLite (persist) ─┐  ← Episodes stockés (10-50ms)
│ ~/.cache/ietv/  ✅    │
└──────┬────────────────┘
       │ (miss)
┌─ L3: Live Scrape ──────┐  ← Fallback YouTube+official (28s)
│ IETVScraper (parallel) │
└────────────────────────┘
```

### Améliorations de performance

| Opération | Avant | Après | Gain |
|-----------|-------|-------|------|
| **Search** | 150ms | 10ms | **15x** ⚡ |
| **Throughput** | 6.7 req/s | 83 req/s | **12.4x** 🔥 |
| **Memory** | 45MB | 0.5MB | **90x** 💾 |
| **Persistence** | ❌ Lost | ✅ Survit | — |

## 📋 Architecture complète

```
bxc (IETV) │
├─ packages/ietv/
│  ├─ src/index.ts          (IETVScraper class)
│  ├─ src/cache.ts          (IETVCache SQLite) ⭐ NEW
│  ├─ CACHE.md              (Documentation cache)
│  └─ BENCHMARKS.md         (Perf analysis)
│
├─ src/api/ietv-server.ts   (REST API Bun + SQLite)
│  └─ L1/L2 caching intelligente
│
├─ packages/ietv-client/
│  └─ IETVClient (npm @aphrody/ietv-client)
│
├─ examples/
│  ├─ ietv-discord-bot.ts
│  ├─ ietv-web-component.tsx
│  ├─ ietv-react-native.tsx
│  ├─ ietv-tauri-app.tsx
│  └─ ietv-cache-advanced.ts ⭐ NEW
│
└─ test/ietv/
   └─ ietv.test.ts (13 passing tests)
```

## 🗄️ Schema SQLite

```sql
-- Sources
channels (id, channel, title, description, totalEpisodes, lastScrape)

-- Hiérarchie
seasons (id, channel_id, season, totalEpisodes)
episodes (id, channel_id, season, episode, videoId, title, url, 
          thumbnail, language, duration, quality)

-- Métadonnées
metadata (key, value, expiresAt) -- TTL support

-- Indexes: channel_id, season, language, title
-- WAL mode: concurrent reads + writes
```

## 📡 Endpoints API REST

```bash
# Health check
curl http://localhost:3000/api/ietv/health

# Lister les sources
curl http://localhost:3000/api/ietv/channels

# Une source spécifique (SQLite L2 si dispo)
curl http://localhost:3000/api/ietv/channels/inazumaelevenfrance1

# Tous les épisodes (parallèle + persist)
curl http://localhost:3000/api/ietv/all

# Recherche SQL optimisée ⭐ NOUVEAU
curl "http://localhost:3000/api/ietv/search?q=power&season=2&lang=vf"

# Stats du cache
curl http://localhost:3000/api/ietv/stats
```

## 🎯 Cas d'usage par plateforme

### Discord Bot
```typescript
import IETVClient from "@aphrody/ietv-client";

const client = new IETVClient({ baseUrl: "http://localhost:3000" });

// Requêtes fréquentes → L1 cache (1ms)
// 100 utilisateurs → SQLite (83 req/s possible)
const results = await client.search({ q: "power", limit: 10 });
```

**Avantage**: 100 utilisateurs = 0 scrape live (tout depuis cache)

### Web App (React)
```typescript
<IETVBrowser />
// Requêtes initiales → L2 SQLite (50-100ms)
// Filtre saison/langue → SQL WHERE (5ms)
// Offline: localStorage sync + SQLite
```

**Avantage**: Responsive + offline-ready

### Mobile (React Native / Expo)
```typescript
// Premier lancement: sync cache depuis serveur (~5MB)
// Recherche offline: SQL queries locales (10ms)
// Auto-sync nightly si connectée
```

**Avantage**: Offline complet, sync intelligent

### Tauri Desktop
```typescript
// Cache SQLite local: persistent entre redémarrages
// Recherche locale: CPU = queries SQL
// Tray icon: stats cache en temps réel
```

**Avantage**: Native performance + offline

## ⚙️ Configuration et déploiement

### Démarrer l'API server

```bash
# Avec env vars
PORT=3000 HOST=0.0.0.0 CACHE_PATH=~/.cache/ietv/episodes.db \
  bun src/api/ietv-server.ts

# Ou dans le code
const server = new IETVRestServer({
  port: 3000,
  cachePath: "~/.cache/ietv/episodes.db",
  cacheEnabled: true
});
await server.start();
```

### Cache management

```typescript
import { IETVCache } from "@aphrody/ietv/cache";

const cache = new IETVCache();

// Populate on startup
const scraper = new IETVScraper();
const channels = await scraper.getAllChannelEpisodes();
for (const ch of channels) {
  cache.saveChannel(ch);
}

// Nightly refresh (cron)
// cache.clear(); + re-populate

// Stats check
cache.getStats();
// { channels: 7, episodes: 1200, lastUpdate: ... }
```

## 📊 Exemples avancés

### Population du cache
```bash
bun examples/ietv-cache-advanced.ts populate
# Scrape + persist ~1200 episodes
```

### Recherches sophistiquées
```bash
bun examples/ietv-cache-advanced.ts search
# Exemples: season=1+vf, titre+episode, multi-critère
```

### Analytics
```bash
bun examples/ietv-cache-advanced.ts analytics
# Stats: channels, episodes, VF/VOSTFR breakdown
```

### Offline mode
```bash
bun examples/ietv-cache-advanced.ts offline
# Démo: recherches sans internet (SQLite local)
```

### Monitoring
```bash
bun examples/ietv-cache-advanced.ts monitor
# Real-time cache stats (loop)
```

## 🔒 Privacy & PII

Intégration `@aphrody/bxc/privacy` :
- Détection automatique de données perso dans les titres
- Caviardage optionnel avant stockage
- Pseudonymisation HMAC

## 📦 Installation

```bash
# Package principal
npm install @aphrody/ietv

# Client universel
npm install @aphrody/ietv-client

# CLI
bun src/cli/index.ts ietv <cmd>
```

## 🧪 Tests

```bash
# Tests unitaires (parsing, language detection, etc.)
bun test packages/ietv/

# API server
timeout 5 bun src/api/ietv-server.ts  # Vérifier démarrage

# Examples
bun examples/ietv-cache-advanced.ts populate
```

## 📈 Benchmarks

- **Recherche**: 150ms → 10ms (15x)
- **Throughput**: 6.7 → 83 req/s (12.4x)
- **Memory**: 45MB → 0.5MB (90x)
- **Persistence**: ✅ (SQLite)
- **Offline**: ✅ (local cache)

Voir `packages/ietv/BENCHMARKS.md` pour détails complets.

## 🌐 Sources supportées

| Source | Type | Episodes | VF/VOSTFR |
|--------|------|----------|-----------|
| @inazumaelevenfrance1 | YouTube | ~400 | Both |
| @inazumatvfr | YouTube | ~200 | Both |
| @inazumaelevengofrance | YouTube | ~150 | VF |
| @InazumaTVFR__ | YouTube | ~100 | VF |
| inazuma-eleven.fr | Official | ~50 | VF |
| Pluto.tv (Norway) | Streaming | ~200 | VOSTFR |
| Pluto.tv (France) | Streaming | ~200 | VF |

**Total**: ~1200 épisodes, 7 sources, 42 saisons

## 🚀 Production checklist

- [x] Cache SQLite persistant
- [x] Multi-layer (L1/L2/L3)
- [x] WAL mode (concurrence)
- [x] TTL support (expiration)
- [x] REST API (Bun native)
- [x] Client npm (@aphrody/ietv-client)
- [x] 4 exemples d'intégration (Discord, Web, Mobile, Desktop)
- [x] Benchmarks (15x+ speedup)
- [x] Offline support
- [x] Privacy/PII integration
- [x] Systemd service ready

## 📝 Documentation

- `packages/ietv/README.md` — Vue d'ensemble
- `packages/ietv/CACHE.md` — Architecture cache SQLite
- `packages/ietv/BENCHMARKS.md` — Analyse performance
- `examples/ietv-cache-advanced.ts` — Exemples runnable

## 📄 Licence

Apache-2.0 — Voir LICENSE

---

**v1.1.0** (avec SQLite cache) — Production ready ✅

Pour commencer: `bun src/api/ietv-server.ts` → curl `http://localhost:3000/api/ietv/all`
