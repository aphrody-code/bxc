# Anti-bot Stack 2026 — choix techniques de Bunlight

> Audit du paysage anti-bot effectué le 2026-05-10. Source : `tasks/ad8e5f2a17505d143.output` (sub-agent recon) + Scrapfly + ScrapeOps + CapTheCat.

## TL;DR

| Couche | Choix retenu | Raison |
|---|---|---|
| TLS fingerprint | `lexiforest/curl-impersonate-chrome` via `bun:ffi` | Fork actif (push 2026-05), couvre Chrome 99-133 + Firefox 144 + Safari 18 |
| HTTP/2 frame fingerprint | `bogdanfinn/tls-client` (sidecar Go gRPC) | Seul à couvrir Akamai HTTP/2 frame ordering |
| Stealth Playwright | `Kaliiiiiiiiii-Vinyzu/patchright` | 3.1k ⭐, push 2026-04, patches `Runtime.Enable` + isolated worlds |
| Stealth Firefox | `daijro/camoufox` v135 stable | Fork Firefox 135 avec patches C++, indistinguable côté JS |
| Fingerprint generation | `daijro/browserforge` | Génère UA + headers + WebGL + navigator cohérents |
| Captcha Turnstile | CapSolver `AntiTurnstileTaskProxyLess` | 85-90% success, $0.8/1k, plus rapide que 2captcha |
| Auto-routing pattern | inspiré de `D4Vinci/Scrapling` (48k ⭐) | Architecture Fetcher/StealthyFetcher |

## Outils écartés et pourquoi

| Outil | Raison du rejet |
|---|---|
| `puppeteer-extra-plugin-stealth` | **Abandonné juillet 2024**, patches détectés en 2026 |
| `lwthiker/curl-impersonate` | Fork original abandonné juillet 2024 (Chrome 116 max) |
| `cloudscraper` / `cloudflare-bypass` | Morts depuis 2023 (CF v3 challenge JS-VM les a tués) |
| `undetected-chromedriver` | Stale (push 2025-07), successeur officiel = `nodriver` |
| `2captcha` (sur Turnstile uniquement) | ~15s vs ~5s CapSolver, $1.45/1k vs $0.8/1k |
| `selenium-driverless` | Stale (push 2025-04) |

## Cloudflare 2026 checks (pour info)

Cloudflare Turnstile + Managed Challenge contrôle aujourd'hui :
1. **TLS JA4 + JA4_R** (JA3 deprecated)
2. **HTTP/2 fingerprint** (frame priority, settings frame, header order)
3. **`Runtime.Enable` CDP timing leak** (le tell #1 des bots)
4. **Canvas / WebGL / Audio fingerprint cohérence**
5. **Behavioral** : mouse entropy, keystroke timing, scroll patterns
6. **IP reputation** (datacenter ASN ≈ blocage immédiat)

## Win rapide identifié

Phase 2.5 (entre cdylib et builtin) : **binder `libcurl-impersonate-chrome.so` via `bun:ffi`**.
- ~12 MB de lib statique Linux x64/arm64 publiée par lexiforest
- Latence quasi-nulle (vs cycletls qui spawn Go)
- Débloque le profile `fast` qui passe **55% des Cloudflare basic** (IUAM, JS challenge)
- ~2 jours dev

C'est le quick-win qui rend Bunlight viable pour scraping de masse non-Turnstile dès l'alpha.

## Patterns à porter dans Bunlight (de Scrapling/Botasaurus)

1. **Auto-routing** : try `fast` → si 403/503/cf-mitigated → escalade `stealth` → si Turnstile → escalade `max`
2. **Cookie jar persistant par domaine** : réutiliser `cf_clearance` entre URLs (économise 80% des challenges)
3. **Mouse Bezier jitter** avant chaque click (humanize)
4. **Google referrer header** (les bots oublient souvent)
5. **Sticky session proxy par domaine** (un IP = une session = un cf_clearance)
6. **Headful-disguised-as-headless** : `headless=new` Chrome flag + visible viewport + audio context warming
7. **Delay variance** entre actions (uniform random 0.8-1.2 ms vs constant)
8. **Resource blocking** sélectif : block images/fonts mais PAS scripts/CSS (CF check les requêtes attendues)

## Roadmap d'intégration

- ✅ **Phase 0 audit** (fait)
- [ ] **Phase 1** zigquery cdylib (en cours)
- [ ] **Phase 2** API publique multi-profile
- [ ] **Phase 2.5** `bun:ffi` sur libcurl-impersonate-chrome → débloque profile `fast`
- [ ] **Phase 3** Lightpanda sub-process integration → finalise profile `fast`
- [ ] **Phase 4** patchright integration → débloque profile `stealth`
- [ ] **Phase 5** Camoufox + browserforge + CapSolver → profile `max`
- [ ] **Phase 6** Auto-routing + escalation + cookie jar persistant

## Références

- [`lexiforest/curl-impersonate`](https://github.com/lexiforest/curl-impersonate) (TLS Chrome 99-133)
- [`bogdanfinn/tls-client`](https://github.com/bogdanfinn/tls-client) (HTTP/2 + Akamai)
- [`Kaliiiiiiiiii-Vinyzu/patchright`](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (Playwright stealth)
- [`daijro/camoufox`](https://github.com/daijro/camoufox) (Firefox fork)
- [`daijro/browserforge`](https://github.com/daijro/browserforge) (fingerprint gen)
- [`D4Vinci/Scrapling`](https://github.com/D4Vinci/Scrapling) (auto-routing pattern)
- [`omkarcloud/botasaurus`](https://github.com/omkarcloud/botasaurus) (humanize patterns)
- [CapSolver Turnstile](https://www.capsolver.com/blog/Cloudflare/how-to-solve-turnstile-captcha)
- [ScrapeOps Cloudflare 2026](https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/)
