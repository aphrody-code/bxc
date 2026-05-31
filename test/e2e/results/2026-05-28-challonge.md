# E2E Challonge crawl report

Date: 2026-05-28
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 0 | 23 | 0 | 0.0% | 151 ms | 0 |
| http | 0 | 0 | 23 | n/a | — | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| tournament-html | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| tournament-html | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| tournament-html | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| bracket-json | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| bracket-json | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| bracket-json | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| module | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| module | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| module | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| match-log | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| match-log | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| match-log | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| standings | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| standings | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| standings | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| participants | B_TS5 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| participants | T_SS1 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| participants | B_TS4 | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| user-profile | sunafterthereign | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| user-profile | wild_breakers | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| user-tournaments | sunafterthereign | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| user-tournaments | wild_breakers | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |
| community-satr | sunafterthereign | skip | fail: Failed to resolve chrome path: error: no | skip | skip | skip |

## Cloudflare wall analysis

No CF walls detected across any profile.

## Recommendations for rpb-challonge

The following table maps each rpb-challonge transport to its recommended Bxc profile replacement.

| rpb-challonge transport | Current implementation | Bxc replacement | Notes |
|---|---|---|---|
| scraper.ts (CF managed challenge) | puppeteer-extra + StealthPlugin | `stealth` (patchright Chromium) or `max` (Camoufox FF) | Requires Chromium/Firefox binary; skip cleanly when absent |
| curl-impersonate.ts (TLS bypass) | curl-impersonate Chrome 131 subprocess | `http` (curl-impersonate FFI, chrome131) | Same JA4 fingerprint, zero subprocess overhead via bun:ffi |
| htmlrewriter.ts (/module parsing) | Bun.HTMLRewriter streaming | `static` (zigquery) | HTMLRewriter already Bun-native; static profile adds CDP layer |

### Profile effectiveness (from this run)

- `static` profile: skipped (zigquery cdylib not built).
- `http` profile: skipped (curl-impersonate .so absent).
- `stealth` profile: skipped (Chromium not installed — run `bunx patchright install chromium`).

### Key finding

No CF walls detected in this run — either the profiles used are effective or Challonge was not enforcing CF Managed Challenge at test time.

## Failures (non-CF)

| Pattern | Slug | Profile | Error |
|---|---|---|---|
| tournament-html | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| tournament-html | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| tournament-html | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| bracket-json | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| bracket-json | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| bracket-json | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| module | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| module | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| module | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| match-log | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| match-log | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| match-log | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| standings | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| standings | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| standings | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| participants | B_TS5 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| participants | T_SS1 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| participants | B_TS4 | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| user-profile | sunafterthereign | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| user-profile | wild_breakers | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| user-tournaments | sunafterthereign | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| user-tournaments | wild_breakers | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
| community-satr | sunafterthereign | fast | Failed to resolve chrome path: error: no bin target named `bxc-engine` in defaul |
