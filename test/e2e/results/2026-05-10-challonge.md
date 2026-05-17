# E2E Challonge crawl report

Date: 2026-05-10
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 1 | 22 | 0 | 4.3% | 199 ms | 20 |
| fast | 0 | 23 | 0 | 0.0% | 107 ms | 20 |
| http | 20 | 3 | 0 | 87.0% | 1202 ms | 0 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| tournament-html | B_TS5 | CF-wall | CF-wall | pass (851ms 228KB) | skip | skip |
| tournament-html | T_SS1 | CF-wall | CF-wall | pass (774ms 356KB) | skip | skip |
| tournament-html | B_TS4 | CF-wall | CF-wall | pass (1118ms 285KB) | skip | skip |
| bracket-json | B_TS5 | CF-wall | CF-wall | pass (741ms 147KB) | skip | skip |
| bracket-json | T_SS1 | CF-wall | CF-wall | pass (1813ms 275KB) | skip | skip |
| bracket-json | B_TS4 | CF-wall | CF-wall | pass (928ms 204KB) | skip | skip |
| module | B_TS5 | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | skip | skip |
| module | T_SS1 | pass (1570ms 599KB) | fail: signal check failed (expected content ma | pass (364ms 599KB) | skip | skip |
| module | B_TS4 | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | skip | skip |
| match-log | B_TS5 | CF-wall | CF-wall | pass (441ms 66KB) | skip | skip |
| match-log | T_SS1 | CF-wall | CF-wall | pass (463ms 67KB) | skip | skip |
| match-log | B_TS4 | CF-wall | CF-wall | pass (407ms 66KB) | skip | skip |
| standings | B_TS5 | CF-wall | CF-wall | pass (680ms 168KB) | skip | skip |
| standings | T_SS1 | CF-wall | CF-wall | pass (851ms 183KB) | skip | skip |
| standings | B_TS4 | CF-wall | CF-wall | pass (4399ms 210KB) | skip | skip |
| participants | B_TS5 | CF-wall | CF-wall | pass (2469ms 39KB) | skip | skip |
| participants | T_SS1 | CF-wall | CF-wall | pass (3110ms 39KB) | skip | skip |
| participants | B_TS4 | CF-wall | CF-wall | pass (413ms 39KB) | skip | skip |
| user-profile | sunafterthereign | CF-wall | CF-wall | pass (1426ms 207KB) | skip | skip |
| user-profile | wild_breakers | CF-wall | CF-wall | pass (1489ms 60KB) | skip | skip |
| user-tournaments | sunafterthereign | CF-wall | CF-wall | fail: HTTP 404 | skip | skip |
| user-tournaments | wild_breakers | CF-wall | CF-wall | pass (2883ms 67KB) | skip | skip |
| community-satr | sunafterthereign | CF-wall | CF-wall | pass (517ms 181KB) | skip | skip |

## Cloudflare wall analysis

Cloudflare managed-challenge blocked requests. This is the expected behaviour for profiles without a real browser engine (static/fast/http) against CF-protected pages.

| Profile | CF wall hits |
|---|---|
| static | 20 |
| fast | 20 |

## Recommendations for rpb-challonge

The following table maps each rpb-challonge transport to its recommended Bxc profile replacement.

| rpb-challonge transport | Current implementation | Bxc replacement | Notes |
|---|---|---|---|
| scraper.ts (CF managed challenge) | puppeteer-extra + StealthPlugin | `stealth` (patchright Chromium) or `max` (Camoufox FF) | Requires Chromium/Firefox binary; skip cleanly when absent |
| curl-impersonate.ts (TLS bypass) | curl-impersonate Chrome 131 subprocess | `http` (curl-impersonate FFI, chrome131) | Same JA4 fingerprint, zero subprocess overhead via bun:ffi |
| htmlrewriter.ts (/module parsing) | Bun.HTMLRewriter streaming | `static` (zigquery) | HTMLRewriter already Bun-native; static profile adds CDP layer |

### Profile effectiveness (from this run)

- `static` profile: 1 passes.
- `http` profile: 20 passes — curl-impersonate Chrome 131 TLS fingerprint effective. Recommended replacement for curl-impersonate.ts transport.
- `stealth` profile: skipped (Chromium not installed — run `bunx patchright install chromium`).

### Key finding

Challonge.com is protected by Cloudflare Managed Challenge. 40 request(s) were blocked across all profiles. This confirms that rpb-challonge is correct to use puppeteer-extra-stealth for the scraper transport — only profiles with a real browser engine (stealth/max) can reliably bypass CF Managed Challenge.

## Failures (non-CF)

| Pattern | Slug | Profile | Error |
|---|---|---|---|
| module | B_TS5 | static | signal check failed (expected content markers absent) |
| module | B_TS4 | static | signal check failed (expected content markers absent) |
| module | B_TS5 | fast | signal check failed (expected content markers absent) |
| module | T_SS1 | fast | signal check failed (expected content markers absent) |
| module | B_TS4 | fast | signal check failed (expected content markers absent) |
| module | B_TS5 | http | signal check failed (expected content markers absent) |
| module | B_TS4 | http | signal check failed (expected content markers absent) |
| user-tournaments | sunafterthereign | http | HTTP 404 |
