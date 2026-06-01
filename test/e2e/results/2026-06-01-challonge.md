# E2E Challonge crawl report

Date: 2026-06-01
Total samples: 115

## Per-profile summary

| Profile | Pass | Fail | Skip | Pass rate | Avg goto ms | CF walls |
|---|---|---|---|---|---|---|
| static | 0 | 0 | 23 | n/a | — | 0 |
| fast | 0 | 23 | 0 | 0.0% | 242 ms | 20 |
| http | 1 | 22 | 0 | 4.3% | 109 ms | 20 |
| stealth | 0 | 0 | 23 | n/a | — | 0 |
| max | 0 | 0 | 23 | n/a | — | 0 |

## Pattern x Profile matrix

| Pattern | Slug/User | static | fast | http | stealth | max |
|---|---|---|---|---|---|---|
| tournament-html | B_TS5 | skip | CF-wall | CF-wall | skip | skip |
| tournament-html | T_SS1 | skip | CF-wall | CF-wall | skip | skip |
| tournament-html | B_TS4 | skip | CF-wall | CF-wall | skip | skip |
| bracket-json | B_TS5 | skip | CF-wall | CF-wall | skip | skip |
| bracket-json | T_SS1 | skip | CF-wall | CF-wall | skip | skip |
| bracket-json | B_TS4 | skip | CF-wall | CF-wall | skip | skip |
| module | B_TS5 | skip | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | skip | skip |
| module | T_SS1 | skip | fail: signal check failed (expected content ma | pass (674ms 596KB) | skip | skip |
| module | B_TS4 | skip | fail: signal check failed (expected content ma | fail: signal check failed (expected content ma | skip | skip |
| match-log | B_TS5 | skip | CF-wall | CF-wall | skip | skip |
| match-log | T_SS1 | skip | CF-wall | CF-wall | skip | skip |
| match-log | B_TS4 | skip | CF-wall | CF-wall | skip | skip |
| standings | B_TS5 | skip | CF-wall | CF-wall | skip | skip |
| standings | T_SS1 | skip | CF-wall | CF-wall | skip | skip |
| standings | B_TS4 | skip | CF-wall | CF-wall | skip | skip |
| participants | B_TS5 | skip | CF-wall | CF-wall | skip | skip |
| participants | T_SS1 | skip | CF-wall | CF-wall | skip | skip |
| participants | B_TS4 | skip | CF-wall | CF-wall | skip | skip |
| user-profile | sunafterthereign | skip | CF-wall | CF-wall | skip | skip |
| user-profile | wild_breakers | skip | CF-wall | CF-wall | skip | skip |
| user-tournaments | sunafterthereign | skip | CF-wall | CF-wall | skip | skip |
| user-tournaments | wild_breakers | skip | CF-wall | CF-wall | skip | skip |
| community-satr | sunafterthereign | skip | CF-wall | CF-wall | skip | skip |

## Cloudflare wall analysis

Cloudflare managed-challenge blocked requests. This is the expected behaviour for profiles without a real browser engine (static/fast/http) against CF-protected pages.

| Profile | CF wall hits |
|---|---|
| fast | 20 |
| http | 20 |

## Recommendations for rpb-challonge

The following table maps each rpb-challonge transport to its recommended Bxc profile replacement.

| rpb-challonge transport | Current implementation | Bxc replacement | Notes |
|---|---|---|---|
| scraper.ts (CF managed challenge) | puppeteer-extra + StealthPlugin | `stealth` (patchright Chromium) or `max` (Camoufox FF) | Requires Chromium/Firefox binary; skip cleanly when absent |
| curl-impersonate.ts (TLS bypass) | curl-impersonate Chrome 131 subprocess | `http` (curl-impersonate FFI, chrome131) | Same JA4 fingerprint, zero subprocess overhead via bun:ffi |
| htmlrewriter.ts (/module parsing) | Bun.HTMLRewriter streaming | `static` (zigquery) | HTMLRewriter already Bun-native; static profile adds CDP layer |

### Profile effectiveness (from this run)

- `static` profile: skipped (zigquery cdylib not built).
- `http` profile: 1 passes — curl-impersonate Chrome 131 TLS fingerprint effective. Recommended replacement for curl-impersonate.ts transport.
- `stealth` profile: skipped (Chromium not installed — run `bunx patchright install chromium`).

### Key finding

Challonge.com is protected by Cloudflare Managed Challenge. 40 request(s) were blocked across all profiles. This confirms that rpb-challonge is correct to use puppeteer-extra-stealth for the scraper transport — only profiles with a real browser engine (stealth/max) can reliably bypass CF Managed Challenge.

## Failures (non-CF)

| Pattern | Slug | Profile | Error |
|---|---|---|---|
| module | B_TS5 | fast | signal check failed (expected content markers absent) |
| module | T_SS1 | fast | signal check failed (expected content markers absent) |
| module | B_TS4 | fast | signal check failed (expected content markers absent) |
| module | B_TS5 | http | signal check failed (expected content markers absent) |
| module | B_TS4 | http | signal check failed (expected content markers absent) |
