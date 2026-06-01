# E2E Apify crawl report

Date: 2026-06-01
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 23 | 0 | 0 | 100.0% | 273 ms | 0 |
| http | 20 | 3 | 0 | 87.0% | 274 ms | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| landing-page | about | skip | pass (215ms 481KB) | pass (165ms 481KB) | skip | skip |
| landing-page | pricing | skip | pass (225ms 428KB) | pass (177ms 428KB) | skip | skip |
| landing-page | store | skip | pass (459ms 670KB) | pass (895ms 671KB) | skip | skip |
| about-page | about | skip | pass (227ms 470KB) | pass (187ms 470KB) | skip | skip |
| about-page | pricing | skip | pass (229ms 470KB) | pass (163ms 470KB) | skip | skip |
| about-page | store | skip | pass (233ms 470KB) | pass (187ms 470KB) | skip | skip |
| pricing-page | about | skip | pass (239ms 428KB) | pass (175ms 428KB) | skip | skip |
| pricing-page | pricing | skip | pass (219ms 428KB) | pass (169ms 428KB) | skip | skip |
| pricing-page | store | skip | pass (430ms 428KB) | pass (167ms 428KB) | skip | skip |
| partners-page | about | skip | pass (211ms 324KB) | pass (151ms 324KB) | skip | skip |
| partners-page | pricing | skip | pass (216ms 324KB) | pass (163ms 324KB) | skip | skip |
| partners-page | store | skip | pass (219ms 324KB) | pass (160ms 324KB) | skip | skip |
| store-page | about | skip | pass (468ms 671KB) | pass (461ms 670KB) | skip | skip |
| store-page | pricing | skip | pass (484ms 670KB) | pass (793ms 670KB) | skip | skip |
| store-page | store | skip | pass (533ms 671KB) | pass (886ms 670KB) | skip | skip |
| changelog-page | about | skip | pass (197ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | pricing | skip | pass (185ms 165KB) | fail: HTTP 404 | skip | skip |
| changelog-page | store | skip | pass (180ms 165KB) | fail: HTTP 404 | skip | skip |
| user-profile | pricing | skip | pass (220ms 428KB) | pass (177ms 428KB) | skip | skip |
| user-profile | about | skip | pass (213ms 470KB) | pass (305ms 470KB) | skip | skip |
| user-tournaments | pricing | skip | pass (216ms 428KB) | pass (152ms 428KB) | skip | skip |
| user-tournaments | about | skip | pass (231ms 470KB) | pass (162ms 470KB) | skip | skip |
| community-satr | sunafterthereign | skip | pass (233ms 481KB) | pass (191ms 481KB) | skip | skip |

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
