# E2E Apify crawl report

Date: 2026-06-01
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 23 | 0 | 0 | 100.0% | 199 ms | 0 |
| http | 20 | 3 | 0 | 87.0% | 171 ms | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| landing-page | about | skip | pass (140ms 481KB) | pass (81ms 481KB) | skip | skip |
| landing-page | pricing | skip | pass (131ms 428KB) | pass (74ms 428KB) | skip | skip |
| landing-page | store | skip | pass (310ms 670KB) | pass (637ms 670KB) | skip | skip |
| about-page | about | skip | pass (131ms 470KB) | pass (74ms 470KB) | skip | skip |
| about-page | pricing | skip | pass (131ms 470KB) | pass (78ms 470KB) | skip | skip |
| about-page | store | skip | pass (135ms 470KB) | pass (75ms 470KB) | skip | skip |
| pricing-page | about | skip | pass (130ms 428KB) | pass (73ms 428KB) | skip | skip |
| pricing-page | pricing | skip | pass (132ms 428KB) | pass (82ms 428KB) | skip | skip |
| pricing-page | store | skip | pass (129ms 428KB) | pass (72ms 428KB) | skip | skip |
| partners-page | about | skip | pass (223ms 324KB) | pass (317ms 324KB) | skip | skip |
| partners-page | pricing | skip | pass (130ms 324KB) | pass (71ms 324KB) | skip | skip |
| partners-page | store | skip | pass (131ms 324KB) | pass (74ms 324KB) | skip | skip |
| store-page | about | skip | pass (399ms 671KB) | pass (309ms 674KB) | skip | skip |
| store-page | pricing | skip | pass (646ms 673KB) | pass (309ms 671KB) | skip | skip |
| store-page | store | skip | pass (364ms 669KB) | pass (674ms 671KB) | skip | skip |
| changelog-page | about | skip | pass (407ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | pricing | skip | pass (116ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | store | skip | pass (118ms 165KB) | fail: HTTP 404 | skip | skip |
| user-profile | pricing | skip | pass (140ms 428KB) | pass (71ms 428KB) | skip | skip |
| user-profile | about | skip | pass (132ms 470KB) | pass (75ms 470KB) | skip | skip |
| user-tournaments | pricing | skip | pass (134ms 428KB) | pass (76ms 428KB) | skip | skip |
| user-tournaments | about | skip | pass (132ms 470KB) | pass (78ms 470KB) | skip | skip |
| community-satr | sunafterthereign | skip | pass (136ms 481KB) | pass (104ms 481KB) | skip | skip |

## Cloudflare wall analysis

No CF walls detected across any profile.

## Recommendations for rpb-apify

The following table maps each rpb-apify transport to its recommended Bxc profile replacement.

| rpb-apify transport | Current implementation | Bxc replacement | Notes |
|---|---|---|---|
| scraper.ts (CF managed challenge) | puppeteer-extra + StealthPlugin | `stealth` (patchright Chromium) or `max` (Camoufox FF) | Requires Chromium/Firefox binary; skip cleanly when absent |
| curl-impersonate.ts (TLS bypass) | curl-impersonate Chrome 131 subprocess | `http` (curl-impersonate FFI, chrome131) | Same JA4 fingerprint, zero subprocess overhead via bun:ffi |
| htmlrewriter.ts (/module parsing) | Bun.HTMLRewriter streaming | `static` (zigquery) | HTMLRewriter already Bun-native; static profile adds CDP layer |

### Profile effectiveness (from this run)

- `static` profile: skipped (zigquery cdylib not built).
- `http` profile: 20 passes — curl-impersonate Chrome 131 TLS fingerprint effective. Recommended replacement for curl-impersonate.ts transport.
- `stealth` profile: skipped (Chromium not installed — run `bunx patchright install chromium`).

### Key finding

No CF walls detected in this run — either the profiles used are effective or Apify was not enforcing CF Managed Challenge at test time.

## Failures (non-CF)

| Pattern | Slug | Profile | Error |
|---|---|---|---|
| changelog-page | about | http | HTTP 404 |
| changelog-page | pricing | http | HTTP 404 |
| changelog-page | store | http | HTTP 404 |
