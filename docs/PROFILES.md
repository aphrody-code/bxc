# Bunlight Profiles — multi-backend routing

> Bunlight n'est pas qu'un wrapper Lightpanda. C'est un **routeur** qui choisit
> le bon backend pour chaque cible. Tu donnes un profil, Bunlight gère les détails.

## Vue d'ensemble (audité 2026-05-10)

```ts
const profiles = {
  static:  { backend: "zigquery",                                      latency: "<5ms",   binary: "2 MB",   cf_success: "10%" },
  fast:    { backend: "Lightpanda + lexiforest/curl-impersonate-chrome", latency: "~50ms",  binary: "50 MB",  cf_success: "55%" },
  stealth: { backend: "Chromium + patchright + browserforge",          latency: "~800ms", binary: "180 MB", cf_success: "80%" },
  max:     { backend: "Camoufox v135 + browserforge + CapSolver + residential proxy", latency: "~1500ms", binary: "400 MB", cf_success: "95%" },
};
```

> **`puppeteer-extra-plugin-stealth` est abandonné** (push 2024-07, détecté en 2026). On l'a remplacé par `patchright` (Playwright-compat) et `rebrowser-patches` (Puppeteer-compat).

---

## Profile `static`

**Quand l'utiliser** : tu as déjà un HTML (de `Bun.fetch`, d'un cache, d'un fichier), tu veux juste extraire des données.

**Backend** : zigquery in-process (no V8, no Lightpanda).

**Avantages** :
- Latence µs (pas de spawn, pas de network)
- 0 RAM steady-state
- Compatible avec `Bun.fetch` upstream pour le réseau

**Limitations** :
- Pas d'exec JS in-page → ne marche pas pour les SPAs où le contenu n'est pas dans le HTML initial

**Exemple** :
```ts
import { parse } from "bun:browser/static";

const html = await fetch("https://example.com").then(r => r.text());
const doc = parse(html);
const titles = doc.findAll("h1, h2").map(el => el.text());
```

---

## Profile `fast`

**Quand l'utiliser** : SPAs simples (React/Vue/Next.js sans anti-bot fort), pages avec WAF basique. Cible le sweet spot **performance/couverture** : 55% des sites Cloudflare passent.

**Backend** : Lightpanda sub-process (V8) via socketpair Unix + **[lexiforest/curl-impersonate-chrome](https://github.com/lexiforest/curl-impersonate)** chargé via `bun:ffi` pour les fetches HTTP (TLS fingerprint Chrome 130+, JA4 + JA4_R imités).

**Avantages** :
- TLS fingerprint Chrome (passe IUAM/JS challenge basique de Cloudflare)
- 10× plus rapide que Chromium headless sur le cold start (50ms vs 800ms)
- 50 MB binary (Lightpanda + libcurl-impersonate)
- Lightpanda V8 partiel mais suffisant pour 70% des SPAs

**Limitations** :
- **Fail Turnstile** (managed challenge requiert vrai navigateur)
- HTTP/2 frame ordering pas couvert par curl-impersonate (use tls-client si Akamai)
- Service Workers, WebRTC, certains observers absents
- Pas de canvas/audio fingerprint cohérence (V8 limité)

**Exemple** :
```ts
await using page = await Browser.newPage({
  profile: "fast",
  impersonate: "chrome131",       // bypass Cloudflare basic via TLS spoof
  blockResources: ["image", "font", "media"],
});
await page.goto("https://my-react-app.com");
const data = await page.evaluate(() => window.__INITIAL_STATE__);
```

---

## Profile `stealth`

**Quand l'utiliser** : sites avec Cloudflare Turnstile non-interactive, anti-bot moyen, SPAs avec WAF (Next.js + middleware), e-commerce protégé.

**Backend** : Chromium réel via **[patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)** (Playwright-compat) ou **[rebrowser-patches](https://github.com/rebrowser/rebrowser-patches)** sur Puppeteer + **[browserforge](https://github.com/daijro/browserforge)** pour fingerprints cohérents + cookie jar persistant + mouse Bezier jitter.

**Avantages** :
- Patchright patche `Runtime.Enable` (le tell #1 de l'automation)
- Patches isolated worlds, Console API leak
- Browserforge génère des fingerprints (UA + headers + WebGL + navigator) **cohérents** (pas juste UA spoof)
- ~80% bypass Cloudflare Turnstile non-interactive

**Limitations** :
- Turnstile interactive ou managed challenge intensif → use `max`
- IP datacenter → besoin de residential proxy pour passer

**Exemple** :
```ts
await using page = await Browser.newPage({
  profile: "stealth",
  fingerprint: { source: "browserforge", os: "linux", browser: "chrome", version: 130 },
  proxy: process.env.PROXY_URL,
  blockResources: ["image", "font", "media"],
  cookieJar: "./cookies.json",  // persistant pour réutiliser cf_clearance
});
await page.goto("https://protected-site.com");
```

---

## Profile `max`

**Quand l'utiliser** : Cloudflare Turnstile interactive / managed challenge, Akamai Bot Manager, DataDome, PerimeterX, Kasada. Sites de billetterie, e-commerce protégé, scraping LinkedIn/Amazon/Walmart.

**Backend** : **[Camoufox v135 stable](https://github.com/daijro/camoufox)** (Fork Firefox 135 avec patches C++ : navigator, WebGL, Canvas, Audio, fonts) + **browserforge** + **[CapSolver](https://www.capsolver.com)** pour Turnstile + residential proxy.

**Pourquoi Camoufox vs Chromium+patchright** : les patches au niveau C++ de Camoufox (fork Firefox) sont indétectables par les checks JS-based, alors que les patches CDP de patchright (sur Chromium) restent identifiables sur Akamai/Kasada. Camoufox v146 est en beta, **on pin v135 stable**.

**Avantages** :
- ~95% bypass Cloudflare Turnstile (incluant interactive)
- Indistinguable d'un Firefox real user
- CapSolver fallback automatique pour les défis qui passent
- Toutes les Web APIs (Service Workers, WebRTC, observers)

**Limitations** :
- Lourd : 300-400 MB binaire (auto-DL au premier usage)
- Cold start ~1.5 s
- Coût : CapSolver ~$0.8/1k Turnstile, residential proxies $5-15/GB

**Exemple** :
```ts
await using page = await Browser.newPage({
  profile: "max",
  captcha: { provider: "capsolver", token: process.env.CAPSOLVER_TOKEN },
  fingerprint: { source: "browserforge", os: "linux", browser: "firefox", version: 135 },
  proxy: { rotation: "per-session", pool: "smartproxy.com:..." },
  humanize: { mouse: "bezier", scroll: "human", typing: "natural" },
  cookieJar: `./profiles/${domain}.json`,
});
await page.goto("https://ticketmaster.com");
```

---

## Profile `auto` (smart routing)

**Heuristique** :
1. Try `static` si l'URL est dans la blocklist `js-required-domains` (curated)
2. Try `fast` par défaut
3. Si réponse 403/503/challenge HTML détecté → escalade `stealth`
4. Si toujours bloqué après stealth → escalade `max`

```ts
await using page = await Browser.newPage({
  profile: "auto",
  escalate: true,        // upgrade automatique
  budget: { time: 60_000, money: 0.10 }, // limite escalation
});
await page.goto("https://unknown-site.com");
```

Bunlight détecte les patterns Cloudflare/Akamai/DataDome dans le HTML/headers et choisit le bon profil. Permet de scraper 1000 URLs hétérogènes sans tuner manuellement.

---

## Auto-detection des challenges

Cf. `src/api/challenge-detect.ts` :

| Indice | Provider | Action |
|---|---|---|
| `cf-mitigated: challenge` header | Cloudflare | escalade `max` |
| HTML contient `__cf_chl_opt` | Cloudflare turnstile | escalade `max` + captcha |
| Status 429 + `Retry-After` | rate limit | wait + retry même profil |
| HTML contient `<meta name="bm-* ">` | Akamai Bot Manager | escalade `max` |
| HTML contient `_pxhd` cookie | PerimeterX | escalade `max` |
| HTML contient `<script id="datadome">` | DataDome | escalade `max` + capsolver |
| Status 403 + Server: cloudflare | CF block | escalade `stealth` puis `max` |

---

## Décision : quel backend pour Bunlight v0.1 ?

Ordre d'implémentation :
1. **`static`** (Phase 1) — zigquery in-process, le plus simple, 0 anti-bot
2. **`fast`** (Phase 4) — Lightpanda sub-process, déjà 90% du code dans `bun-lightpanda/`
3. **`stealth`** (Phase 5) — Lightpanda + curl-impersonate, custom evasions
4. **`max`** (Phase 6) — Chromium + patchright, le plus impactant pour les vrais sites

Chaque profil est un module séparé sous `src/profiles/{static,fast,stealth,max}.ts`, exposé via `Browser.newPage({ profile })`. Le routing auto vit dans `src/api/router.ts`.
