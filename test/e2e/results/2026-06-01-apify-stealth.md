# E2E Apify crawl report

Date: 2026-06-01
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 23 | 0 | 0 | 100.0% | 275 ms | 0 |
| http | 20 | 3 | 0 | 87.0% | 590 ms | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| landing-page | about | skip | pass (232ms 481KB) | pass (173ms 484KB) | skip | skip |
| landing-page | pricing | skip | pass (218ms 429KB) | pass (166ms 429KB) | skip | skip |
| landing-page | store | skip | pass (487ms 671KB) | pass (8155ms 670KB) | skip | skip |
| about-page | about | skip | pass (218ms 470KB) | pass (168ms 470KB) | skip | skip |
| about-page | pricing | skip | pass (229ms 470KB) | pass (169ms 470KB) | skip | skip |
| about-page | store | skip | pass (227ms 470KB) | pass (180ms 470KB) | skip | skip |
| pricing-page | about | skip | pass (215ms 429KB) | pass (165ms 429KB) | skip | skip |
| pricing-page | pricing | skip | pass (225ms 429KB) | pass (157ms 429KB) | skip | skip |
| pricing-page | store | skip | pass (220ms 429KB) | pass (156ms 429KB) | skip | skip |
| partners-page | about | skip | pass (210ms 324KB) | pass (155ms 324KB) | skip | skip |
| partners-page | pricing | skip | pass (218ms 324KB) | pass (161ms 324KB) | skip | skip |
| partners-page | store | skip | pass (219ms 324KB) | pass (163ms 324KB) | skip | skip |
| store-page | about | skip | pass (671ms 674KB) | pass (497ms 670KB) | skip | skip |
| store-page | pricing | skip | pass (491ms 674KB) | pass (531ms 670KB) | skip | skip |
| store-page | store | skip | pass (560ms 670KB) | pass (1010ms 671KB) | skip | skip |
| changelog-page | about | skip | pass (188ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | pricing | skip | pass (185ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | store | skip | pass (190ms 165KB) | fail: HTTP 404 | skip | skip |
| user-profile | pricing | skip | pass (222ms 429KB) | pass (179ms 429KB) | skip | skip |
| user-profile | about | skip | pass (225ms 470KB) | pass (316ms 470KB) | skip | skip |
| user-tournaments | pricing | skip | pass (225ms 429KB) | pass (189ms 429KB) | skip | skip |
| user-tournaments | about | skip | pass (225ms 470KB) | pass (174ms 470KB) | skip | skip |
| community-satr | sunafterthereign | skip | pass (223ms 481KB) | pass (262ms 484KB) | skip | skip |

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
