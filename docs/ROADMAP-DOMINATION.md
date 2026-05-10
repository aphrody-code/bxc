# Roadmap — surpasser tous les concurrents

> Plan d'attaque pour passer Bunlight de **alpha 0.1.0** (compétitif sur 7 axes, dominé sur 6 axes) à **leader incontesté** browser automation 2026-2027.

---

## North Star

Devenir LE choix par défaut pour browser automation moderne, mesurément supérieur à **Playwright + Puppeteer + Crawlee + Browserbase + Stagehand + Apify SDK** sur les axes techniques mesurables — sans tomber dans le marketing.

**Critère de victoire à 12 mois** :
- Plus rapide que Playwright sur 4 benchmarks publics sur 5
- Plus de profils anti-bot à jour qu'undetected-chromedriver et patchright cumulés
- API plus simple que Crawlee, plus puissante que Puppeteer
- 10k+ stars GitHub, 100k+ downloads npm/mois
- 1000+ utilisateurs payants Bunlight Cloud

---

## Diagnostic point de départ (2026-05-10)

### Forts (à amplifier)
1. **Bun-native runtime** — cold start ~50ms, RSS ~42MB sur standalone
2. **zigquery cdylib in-process** — DOM parsing static <5ms, 1.7 MB lib
3. **5 profiles d'escalation** — static / fast / http / stealth / max
4. **curl-impersonate FFI direct** — 34 TLS profiles, JA4 validé, pas de spawn
5. **Plugin Claude inclus** — 8 agents + 8 commands + skill + MCP server
6. **License 0BSD** — la plus permissive du marché
7. **Standalone executable** — 96 MB, single binary deploy

### Faibles (à combler)
1. **Maturité** — alpha 0.1.0, vs Playwright/Puppeteer 5-10 ans stable
2. **Browser breadth API unifiée** — 5 profiles hétérogènes vs Playwright single API
3. **Ecosystem** — 0 contributeur externe, 0 stars, vs Crawlee 14k stars
4. **Doc** — 25 fichiers .md, vs Playwright 100+ pages structurées
5. **Cloud infra** — aucune, vs Browserbase / Apify Cloud
6. **Anti-bot prod-tested** — pas de battery sur 1000 sites top
7. **Communauté** — pas de Discord, pas de blog, pas de conférence

---

## Phase A — Combat la maturité (mois 1-2)

**Objectif** : passer de alpha à beta crédible, atteindre 1.0 stable.

- Freezer `src/api/browser.ts` — semver strict, deprecation warnings 6 mois
- Atteindre 800+ tests passing (de 344 à 800), 95% coverage core
- Battery prod : 1000 URLs réelles par profile, mesurer succès rate
- Fixer les 2 fails actuels (`forks/bun/test/js/bun/browser/browser.test.ts` harness)
- Audit sécurité externe (HackerOne ou équivalent)
- Beta release 0.5 — feedback 50 early adopters
- RC 0.9 — burn-in 30 jours
- 1.0 stable

**Livrables mesurables** :
- 800 tests passing, 0 fail
- 1.0.0 tag npm + GitHub release
- 50 issues fermées
- Changelog avec tous les breaking changes documentés

---

## Phase B — Battre Playwright sur browser breadth (mois 2-3)

**Objectif** : Playwright a 1 API unifiée chromium/firefox/webkit. Bunlight doit avoir 1 API unifiée pour 5 profiles + WebKit.

- Profile `webkit` — via patchright-webkit ou WebKitGTK direct
- Profile `firefox` séparé du `max` (Camoufox) — Firefox vanilla pour cas non-stealth
- Unified Page API — chaque profile expose EXACTEMENT le même type `Page`, pas de méthodes profile-specific
- Browser context isolation — cookies / storage / permissions per context
- Device emulation native — iOS/Android viewport, UA, touch events, geolocation
- Network interception unifiée — `page.route()` style Playwright sur tous profiles
- Tracing unifié — `context.tracing.start()` produit `.zip` compatible Playwright Trace Viewer

**Livrables mesurables** :
- 1 API, 7 profiles (static, fast, http, stealth, max, webkit, firefox)
- Compatibility shim `@bunmium/bunlight/playwright` — Playwright tests passent sur Bunlight (drop-in)
- Test suite : 50 tests Playwright cross-profile

---

## Phase C — Battre Crawlee sur l'ecosystem (mois 3-6)

**Objectif** : Crawlee a 14k stars, doc massive, Apify Cloud. Bunlight doit l'égaler en open source pur.

- Doc structurée en 6 sections (Getting Started, Guides, API Reference, Examples, Cookbook, Migration)
- 50 examples production-ready (e-commerce, social, news, gov, finance, real estate)
- LLM-driven scraper natif — `Page.askLLM("extract product price")` via Claude SDK
- Dataset cloud sync — adapters S3, R2, GCS, Supabase, Azure
- Marketplace community scrapers — `bunlight install scraper:reddit-top` (sandboxed)
- Templates `bunx create-bunlight-app` — 10 templates (basic, crawler, monitor, scraper, AI)
- Migration guides — depuis Puppeteer / Playwright / Crawlee / Scrapy / Selenium

**Livrables mesurables** :
- Doc 100+ pages, 5 langues (en/fr/zh/es/ja)
- 50 examples GitHub
- 10 templates `create-bunlight-app`
- 4 cloud adapters Dataset

---

## Phase D — Battre Browserbase sur le cloud (mois 6-12)

**Objectif** : Browserbase = cloud headless premium 39$/mois minimum. Bunlight Cloud = même service, 50% moins cher, free tier généreux.

- Bunlight Cloud — k8s + warm pool VMs, sub-second cold start
- API CDP hosted — `wss://cloud.bunlight.dev/v1/cdp/<sessionId>`
- Free tier 100 hours/mois (vs Browserbase 0)
- Pricing — 19$/mois unlimited (vs 39$ Browserbase) ou 0.05$/page-hour
- Multi-region — EU (Paris), US (Virginia), APAC (Singapore)
- Proxy pools intégrés — datacenter / residential / mobile, 50+ countries
- Live dashboard — sessions actives, replay HAR, CDP commands log
- Debugging UI inline — DevTools dans browser, pas besoin client

**Livrables mesurables** :
- 1000 utilisateurs Bunlight Cloud (free + paid)
- 100 paying customers à 19-50$/mois
- 99.9% uptime SLA
- Latency P50 cold start < 800ms

---

## Phase E — Surpasser sur anti-bot (continu)

**Objectif** : être LA reference anti-bot 2026, devant patchright et undetected-chromedriver.

- Test bench mensuel — Top 100 sites anti-bot (CF, Akamai, Imperva, DataDome, PerimeterX, Kasada, hCaptcha, reCAPTCHA, Turnstile, Arkose Labs)
- Update fingerprints — automation à chaque release Chrome / Firefox / Safari (cron job + bench)
- Captcha solving native — OCR Tesseract + ML local (pas dependent CapSolver) pour Turnstile/hCaptcha
- Behavioral biometrics avancés — Bezier mouse fits réels humains, typing patterns mesurés (1000+ users dataset)
- Browser fingerprint randomization — Canvas, WebGL, Audio, Fonts variations cohérentes
- TLS fingerprint dynamique — adapte JA4 selon le target (Cloudflare detect → chrome131, Akamai → safari17)

**Livrables mesurables** :
- 99% bypass CF basic, 95% CF Managed, 90% Turnstile, 85% DataDome
- Bench mensuel public — `https://bunlight.dev/anti-bot-status`
- 100+ targets testés mensuellement

---

## Phase F — DX inégalée (continu)

**Objectif** : être plus agréable à utiliser que Playwright, plus complet que Puppeteer, plus simple que Crawlee.

- TypeScript types perfection — inference complète, generics intelligents, JSDoc inline
- VSCode extension — autocomplete profiles, debug CDP, replay HAR inline, snippets
- Cursor / Claude IDE intégration — agents `bunlight-*` publiés sur marketplaces
- CLI interactive — `bunlight init`, `bunlight scrape <url>`, `bunlight doctor`, `bunlight bench`
- Onboarding 60 secondes — `bunx create-bunlight-app` → exemple HN crawler working
- Error messages actionables — chaque erreur a un lien doc + suggestion fix
- Hot reload tests — `bun test --watch` détecte changes, ré-run tests affectés uniquement

**Livrables mesurables** :
- Score DX 5/5 sur survey 100 devs
- VSCode extension 10k+ installs
- Onboarding moyen 90 secondes mesuré

---

## Phase G — Performance brute (continu)

**Objectif** : être 2× plus rapide que Playwright sur tous benchmarks publics.

- WASM port profile static — browser-side scraping (zigquery compilé en wasm)
- HTTP/3 native — via Bun quand exposé, sinon impit cdylib en fallback
- Page parallelism — 1000+ pages stable sur 8GB RAM (mesurer overhead par page)
- Cold start cible — < 10ms (vs 50ms actuel) via lazy imports + bytecode cache Bun
- Memory budget — < 30 MB RSS par page idle
- Standalone executable — < 50 MB (vs 96 MB actuel) via tree-shaking aggressive
- Benchmarks publics — `https://bunlight.dev/benchmarks` mis à jour quotidien, comparé aux concurrents

**Livrables mesurables** :
- 2× faster que Playwright sur HN scrape, React doc scrape, e-commerce scrape
- 1000 pages parallèles stable sur 8GB
- Standalone < 50 MB

---

## Phase H — Communauté (continu)

**Objectif** : passer de 0 à 100 contributeurs externes en 12 mois.

- Bug bounty — 100$ par CVE, 500$ par perf regression > 10%
- Discord serveur — 5 channels (general, help, contrib, showcase, anti-bot-research)
- Twitter / Bluesky — daily tips, weekly recap, monthly bench
- Blog mensuel — releases, tutorials, postmortems incidents
- Conférences — JSConf, BunConf, NodeConf EU, Web Scraping Summit, OSCON
- Office hours — 1h/semaine open call sur Discord
- Hacktoberfest 2026 — 50 issues "good first issue" préparées
- Commercial support — SLA 24h, 5k$/an pour entreprises

**Livrables mesurables** :
- 100+ contributeurs externes (au moins 1 commit merged)
- 5000 Discord members
- 50+ talks conférence
- 10 entreprises payant le support

---

## Métriques de victoire (12 mois)

| Axe | Cible 12 mois | Concurrent référence |
|---|---|---|
| GitHub stars | 10 000 | Playwright 65k, Crawlee 14k |
| npm downloads/mois | 100 000 | Playwright 8M, Puppeteer 8M, Crawlee 100k |
| Tests passing | 1 500+ | Playwright 5000+ |
| Coverage core | 95% | Playwright 90% |
| Perf bench public | 2× faster Playwright | — |
| Anti-bot bypass top 100 | 99% CF, 90% DataDome | undetected-chromedriver 80% |
| Bunlight Cloud users | 1 000 (100 paying) | Browserbase 5000 |
| Contributeurs externes | 100+ | Crawlee 200+ |
| Doc pages | 100+ | Playwright 200+ |
| Languages doc | 5 (en/fr/zh/es/ja) | Playwright 1 |

---

## Stack des risques majeurs

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Lightpanda AGPL contamine binaire | élevée | bloque adoption commerciale | fork MIT ou écrire notre browser engine léger |
| Bun stabilité 1.x breaking | moyenne | refacto majeur | contribuer upstream, pin version, tests CI Bun nightly |
| Course aux armements anti-bot | continue | perte avantage compétitif | bench mensuel automation, alertes regression |
| Burnout maintainer solo | élevée | projet meurt | recruter 2-3 co-maintainers en mois 1-3 |
| Concurrent (Apify / Browserbase) copie nos features | moyenne | perte différenciation | innover en continu, garder 6 mois d'avance |
| Bun écosystème reste niche | moyenne | adoption limitée | shim Node-compat pour les Node-onlys |

---

## Décisions architecturales clés (à trancher mois 1)

1. **Lightpanda AGPL** — fork MIT (3 mois work) vs écrire engine maison (6-12 mois) vs accepter la contrainte AGPL (gratuit mais limite adoption commerciale)
2. **Bunlight Cloud** — k8s self-hosted vs Cloudflare Workers vs Fly.io vs Vercel
3. **Captcha solving** — local ML (Tesseract + custom model) vs partenariat CapSolver / 2Captcha
4. **Pricing model** — usage-based (per page-hour) vs flat subscription vs hybrid
5. **Monorepo structure** — actuel `~/bunmium/` vs split en orgs `@bunmium/` séparés

---

## Plan d'action immédiat (semaine 1-2)

1. Créer `~/bunmium/bunlight/.github/ROADMAP-PROJECT.md` — Kanban GitHub Projects avec les 8 phases
2. Recruter 2 co-maintainers (poster sur Bun Discord, Reddit r/bun, Twitter)
3. Setup `bunlight.dev` — site marketing minimal (Bun.serve hosted Cloudflare Workers)
4. Lancer Discord serveur + Twitter @bunlight_dev
5. Premier blog post — "Why Bunlight, why now" (positionnement vs Playwright)
6. Audit Lightpanda AGPL — décision fork ou pas
7. Setup CI nightly bench public (GitHub Actions + commit results dans `bench-results/`)
8. Premier RFC ouvert — "Bunlight 1.0 stable API freeze" (community feedback 30 jours)

---

## Vérification : ce plan rend-il Bunlight supérieur ?

À 12 mois, si toutes les phases sont exécutées :

| Concurrent | Axes battus par Bunlight |
|---|---|
| Puppeteer | runtime, profiles, anti-bot, cloud, plugin Claude, license |
| Playwright | runtime, profiles, anti-bot, cloud, license, perf cold start |
| Crawlee | runtime, profiles, anti-bot, perf, plugin Claude |
| Apify SDK | runtime, license (open vs SaaS), prix |
| Browserbase | prix, free tier, license, self-hosted option |
| Stagehand | maturité, perf, profiles, license |
| Selenium | tout (legacy) |
| undetected-chromedriver | runtime, ecosystem, profiles, browser breadth |
| patchright | profiles, cloud, plugin Claude |
| Camoufox | profiles, runtime, écosystem (Camoufox = Firefox seul) |
| agent-browser | feature breadth, anti-bot, profiles |

**Verdict honnête** : Bunlight ne sera probablement JAMAIS supérieur sur tous les axes (Playwright restera + mature, Crawlee restera + ecosystem cloud-native). Mais il peut être supérieur sur **au moins 8 axes mesurables sur 13** à 12 mois — ce qui est la définition pragmatique de "leader".

**Cas où Bunlight reste imbattable même en alpha** :
- Scraping Bun-native — aucun concurrent ne fait ça
- Static + zigquery — aucun concurrent n'a un cdylib DOM in-process
- 5 profiles escalation auto — aucun concurrent n'unifie ça
- Plugin Claude inclus — aucun concurrent

**Cas où Bunlight perd encore en mois 12** :
- Adoption enterprise stable (Playwright reste le défaut chez Microsoft)
- Browser breadth WebKit / Safari ecosystem
- SaaS managed cloud à grande échelle (Apify / Browserbase ont 5+ ans d'avance ops)
