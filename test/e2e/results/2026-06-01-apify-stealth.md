# E2E Apify crawl report

Date: 2026-06-01
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 23 | 0 | 0 | 100.0% | 287 ms | 0 |
| http | 20 | 3 | 0 | 87.0% | 251 ms | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| landing-page | about | skip | pass (233ms 481KB) | pass (176ms 484KB) | skip | skip |
| landing-page | pricing | skip | pass (221ms 429KB) | pass (164ms 429KB) | skip | skip |
| landing-page | store | skip | pass (526ms 670KB) | pass (463ms 671KB) | skip | skip |
| about-page | about | skip | pass (225ms 470KB) | pass (184ms 470KB) | skip | skip |
| about-page | pricing | skip | pass (227ms 470KB) | pass (160ms 470KB) | skip | skip |
| about-page | store | skip | pass (230ms 470KB) | pass (167ms 470KB) | skip | skip |
| pricing-page | about | skip | pass (217ms 429KB) | pass (167ms 429KB) | skip | skip |
| pricing-page | pricing | skip | pass (222ms 429KB) | pass (180ms 429KB) | skip | skip |
| pricing-page | store | skip | pass (223ms 429KB) | pass (166ms 429KB) | skip | skip |
| partners-page | about | skip | pass (519ms 324KB) | pass (301ms 324KB) | skip | skip |
| partners-page | pricing | skip | pass (211ms 324KB) | pass (160ms 324KB) | skip | skip |
| partners-page | store | skip | pass (211ms 324KB) | pass (164ms 324KB) | skip | skip |
| store-page | about | skip | pass (480ms 670KB) | pass (966ms 670KB) | skip | skip |
| store-page | pricing | skip | pass (485ms 671KB) | pass (478ms 673KB) | skip | skip |
| store-page | store | skip | pass (478ms 671KB) | pass (410ms 670KB) | skip | skip |
| changelog-page | about | skip | pass (414ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | pricing | skip | pass (184ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | store | skip | pass (187ms 165KB) | fail: HTTP 404 | skip | skip |
| user-profile | pricing | skip | pass (217ms 429KB) | pass (167ms 429KB) | skip | skip |
| user-profile | about | skip | pass (217ms 470KB) | pass (168ms 470KB) | skip | skip |
| user-tournaments | pricing | skip | pass (222ms 429KB) | pass (160ms 429KB) | skip | skip |
| user-tournaments | about | skip | pass (229ms 470KB) | pass (167ms 470KB) | skip | skip |
| community-satr | sunafterthereign | skip | pass (228ms 481KB) | pass (188ms 484KB) | skip | skip |

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
