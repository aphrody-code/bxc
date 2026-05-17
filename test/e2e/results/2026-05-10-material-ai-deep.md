# bxc × Material 3 deep crawl report

Date: 2026-05-10
Sitemap: https://m3.material.io/sitemap.xml (356 URLs total)
Sample: 30 URLs across 30 buckets
Profiles: static, fast, http
Total probes: 90

## Per-profile summary

| Profile | Pass | Fail | Pass rate | Avg goto | Avg bytes | Avg colors | Avg md.sys.* |
|---|---|---|---|---|---|---|---|
| static | 30 | 0 | 100% | 160 ms | 60 KB | 39 | 0 |
| fast | 30 | 0 | 100% | 229 ms | 60 KB | 39 | 0 |
| http | 30 | 0 | 100% | 178 ms | 60 KB | 39 | 0 |

## Per-bucket summary (pass rate per profile)

| Bucket | URLs | static | fast | http |
|---|---|---|---|---|
| components | 1 | 1/1 | 1/1 | 1/1 |
| components/all-buttons | 1 | 1/1 | 1/1 | 1/1 |
| components/app-bars | 1 | 1/1 | 1/1 | 1/1 |
| components/badges | 1 | 1/1 | 1/1 | 1/1 |
| components/bottom-sheets | 1 | 1/1 | 1/1 | 1/1 |
| components/button-groups | 1 | 1/1 | 1/1 | 1/1 |
| components/buttons | 1 | 1/1 | 1/1 | 1/1 |
| components/cards | 1 | 1/1 | 1/1 | 1/1 |
| components/carousel | 1 | 1/1 | 1/1 | 1/1 |
| components/checkbox | 1 | 1/1 | 1/1 | 1/1 |
| components/chips | 1 | 1/1 | 1/1 | 1/1 |
| components/date-pickers | 1 | 1/1 | 1/1 | 1/1 |
| components/dialogs | 1 | 1/1 | 1/1 | 1/1 |
| components/divider | 1 | 1/1 | 1/1 | 1/1 |
| components/extended-fab | 1 | 1/1 | 1/1 | 1/1 |
| components/fab-menu | 1 | 1/1 | 1/1 | 1/1 |
| components/floating-action-button | 1 | 1/1 | 1/1 | 1/1 |
| components/icon-buttons | 1 | 1/1 | 1/1 | 1/1 |
| components/lists | 1 | 1/1 | 1/1 | 1/1 |
| components/loading-indicator | 1 | 1/1 | 1/1 | 1/1 |
| components/menus | 1 | 1/1 | 1/1 | 1/1 |
| components/navigation-bar | 1 | 1/1 | 1/1 | 1/1 |
| components/navigation-drawer | 1 | 1/1 | 1/1 | 1/1 |
| components/navigation-rail | 1 | 1/1 | 1/1 | 1/1 |
| components/progress-indicators | 1 | 1/1 | 1/1 | 1/1 |
| components/radio-button | 1 | 1/1 | 1/1 | 1/1 |
| components/search | 1 | 1/1 | 1/1 | 1/1 |
| components/segmented-buttons | 1 | 1/1 | 1/1 | 1/1 |
| components/side-sheets | 1 | 1/1 | 1/1 | 1/1 |
| components/sliders | 1 | 1/1 | 1/1 | 1/1 |

## Inter-profile divergence

Detects pages where `fast` (Lightpanda) returns significantly less HTML than `static`/`http` — a signal that JS-driven content is missing.

| URL | static KB | fast KB | http KB | fast/static ratio |
|---|---|---|---|---|
| components | 61 | 61 | 61 | 1.00 |
| components-all-buttons | 60 | 60 | 60 | 1.00 |
| components-app-bars-accessibility | 60 | 60 | 60 | 1.00 |
| components-badges-accessibility | 60 | 60 | 60 | 1.00 |
| components-bottom-sheets-accessibility | 60 | 60 | 60 | 1.00 |
| components-button-groups-accessibility | 60 | 60 | 60 | 1.00 |
| components-buttons-accessibility | 60 | 60 | 60 | 1.00 |
| components-cards-accessibility | 60 | 60 | 60 | 1.00 |
| components-carousel-accessibility | 60 | 60 | 60 | 1.00 |
| components-checkbox-accessibility | 60 | 60 | 60 | 1.00 |
| components-chips-accessibility | 60 | 60 | 60 | 1.00 |
| components-date-pickers-accessibility | 60 | 60 | 60 | 1.00 |
| components-dialogs-accessibility | 60 | 60 | 60 | 1.00 |
| components-divider-accessibility | 60 | 60 | 60 | 1.00 |
| components-extended-fab-accessibility | 61 | 60 | 61 | 0.98 |
| components-fab-menu-accessibility | 60 | 60 | 60 | 1.00 |
| components-floating-action-button-accessibility | 60 | 60 | 60 | 1.00 |
| components-icon-buttons-accessibility | 60 | 60 | 60 | 1.00 |
| components-lists-accessibility | 60 | 60 | 60 | 1.00 |
| components-loading-indicator-accessibility | 60 | 60 | 60 | 1.00 |
| components-menus-accessibility | 60 | 60 | 60 | 1.00 |
| components-navigation-bar-accessibility | 60 | 60 | 60 | 1.00 |
| components-navigation-drawer-accessibility | 60 | 60 | 60 | 1.00 |
| components-navigation-rail-accessibility | 60 | 60 | 60 | 1.00 |
| components-progress-indicators-accessibility | 60 | 60 | 60 | 1.00 |
| components-radio-button-accessibility | 60 | 60 | 60 | 1.00 |
| components-search-accessibility | 60 | 60 | 60 | 1.00 |
| components-segmented-buttons-accessibility | 60 | 60 | 60 | 1.00 |
| components-side-sheets-accessibility | 60 | 60 | 60 | 1.00 |
| components-sliders-accessibility | 60 | 60 | 60 | 1.00 |

## Top design tokens (aggregated, static profile)

| Token | Pages mentioning |
|---|---|

## Top colors (hex, aggregated)

| Color | Pages |
|---|---|
| `#ffffff` | 30 |
| `#9f86ff` | 30 |
| `#1f1f1f` | 30 |
| `#1c1b1d` | 30 |
| `#fefbff` | 30 |
| `#4d4256` | 30 |
| `#e8e0e8` | 30 |
| `#303030` | 30 |
| `#f5eff1` | 30 |
| `#6442d6` | 30 |
| `#cbbeff` | 30 |
| `#4b21bd` | 30 |
| `#340098` | 30 |
| `#e6e1e3` | 30 |
| `#1e0060` | 30 |
| `#5d5d74` | 30 |
| `#dcdaf5` | 30 |
| `#21182b` | 30 |
| `#f1d3f9` | 30 |
| `#271430` | 30 |
| `#ff6240` | 30 |
| `#490909` | 30 |
| `#f9dedc` | 30 |
| `#787579` | 30 |
| `#f8f1f6` | 30 |

## Snapshots

30 HTML snapshots saved to `test/e2e/snapshots/material-3/` (static profile, canonical reference for regression diff).
