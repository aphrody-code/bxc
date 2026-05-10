# Recon report — https://design.google/

Date: 2026-05-10

## HTTP response headers

- **HTTP status**: 200
- **Server**: `Google Frontend`
- **X-Powered-By**: `Next.js`
- **CDN fingerprint**: Google Frontend
- **Trace/Ray ID header**: `6717a8b9db01cc21839f064b66da669d`
- **Cache-Control**: `private, no-cache, no-store, max-age=0, must-revalidate`

### CSP-allowed hosts (4)

- `cms-dot-gd-wagtail-staging.uc.r.appspot.com`
- `cms-dot-gweb-design-prod.uc.r.appspot.com`
- `feedback-pa.clients6.google.com`
- `scone-pa.clients6.google.com`

## Detected frameworks (wappalyzergo)

| Name | Categories | Version |
|---|---|---|
| Google Tag Manager | Tag managers | n/a |

## Per-profile recon

| Profile | Status | HTTP | Bytes | goto ms | Assets | CSS selectors | Screenshot |
|---|---|---|---|---|---|---|---|
| static | pass | 200 | 90 KB | 268 | 20 | 1215 | n/a (no rendering) |
| fast | pass | 200 | 90 KB | 306 | 20 | 1215 | 10 KB |
| http | pass | 200 | 90 KB | 266 | 20 | 1215 | n/a (no rendering) |

## Asset hosts (canonical profile)

| Host | Asset count |
|---|---|
| `design.google` | 16 |
| `www.gstatic.com` | 3 |
| `www.googletagmanager.com` | 1 |

### stylesheet (6)

- https://www.gstatic.com/glue/cookienotificationbar/cookienotificationbar.min.css
- https://www.gstatic.com/glue/cookienotificationbar/cookienotificationbar.min.css
- https://design.google/_next/static/css/59118db8e300751e.css
- https://design.google/_next/static/css/59118db8e300751e.css
- https://design.google/_next/static/css/8bdafa48ef70fc93.css
- https://design.google/_next/static/css/8bdafa48ef70fc93.css

### script (10)

- https://design.google/_next/static/chunks/polyfills-42372ed130431b0a.js
- https://design.google/_next/static/chunks/webpack-60d328ea1049e7c2.js
- https://design.google/_next/static/chunks/framework-64ad27b21261a9ce.js
- https://design.google/_next/static/chunks/main-f61269d13771de46.js
- https://design.google/_next/static/chunks/pages/_app-843147edcc887e3b.js
- https://design.google/_next/static/chunks/94726e6d-b7bd6f49c069c060.js
- https://design.google/_next/static/chunks/442-4f65c057f41d8fa3.js
- https://design.google/_next/static/chunks/pages/%5B%5B...page%5D%5D-ba4b4a30ecc970f0.js
- https://design.google/_next/static/20du0q_bxI1Ar8a-qkQqU/_buildManifest.js
- https://design.google/_next/static/20du0q_bxI1Ar8a-qkQqU/_ssgManifest.js

### font (3)

- https://www.gstatic.com/glue/cookienotificationbar/cookienotificationbar.min.css
- https://design.google/_next/static/css/59118db8e300751e.css
- https://design.google/_next/static/css/8bdafa48ef70fc93.css

### iframe (1)

- https://www.googletagmanager.com/ns.html?id=GTM-TXGTPC

## CSS selectors (1215 total) — sample top 50

```css
* {}
.--center {}
.--justify {}
.--left {}
.--right {}
.--right .TickerBlock_ticker__play-button__weIOV {}
.-active .Navigation_nav__button-container__WAro6 {}
.-active .Navigation_nav__button-menu__wRYbl {}
.-active .Navigation_nav__button-search__zkwJb {}
.-active .Navigation_nav__drawer__d7rAx {}
.-active .Navigation_nav__menu__mJQgQ {}
.-active .Navigation_nav__skim__nGmHh {}
.-hidden {}
.-loading .LoadingIndicator_dot__tvHNR {}
.-loading .LoadingIndicator_dot__tvHNR:first-child {}
.-loading .LoadingIndicator_dot__tvHNR:nth-child(2) {}
.-loading .LoadingIndicator_dot__tvHNR:nth-child(3) {}
.-offscreen {}
.-visually-hidden {}
.AudioBlock_audio__xa8UU {}
.AudioCard_audio__card--compact__akonq {}
.AudioPlayer_audio_drawer--expanded__oL83U {}
.AudioPlayer_audio_drawer__8WAm2 {}
.AudioPlayer_audio_drawer__8WAm2 p {}
.AudioPlayer_audio_drawer__links__D0pDU {}
.AudioPlayer_audio_drawer__links__D0pDU a {}
.AudioPlayer_audio_drawer__links__D0pDU a:visited {}
.AudioPlayer_audio_drawer__links__D0pDU li {}
.AudioPlayer_audio_drawer_button--expanded__cQncf svg {}
.AudioPlayer_audio_drawer_button__5k39_ {}
.AudioPlayer_audio_drawer_button__5k39_ svg {}
.AudioPlayer_audio_drawer_button__5k39_ svg path {}
.AudioPlayer_audio_player--compact__fAP5_ {}
.AudioPlayer_audio_player__FTtq3 {}
.AudioPlayer_audio_player__contain__Uv_I_ {}
.AudioPlayer_audio_player__sub_title__mbeqO {}
.AudioPlayer_audio_player__title__yEVYC {}
.AudioPlayer_audio_player__title_stack__Qj1OR {}
.AudioPlayer_overflow-ellipsis__lXcwc {}
.AudioVisualizer_audio_visualizer__qssu1 {}
.AudioVisualizer_g10__AH07G {}
.AudioVisualizer_g11__o_tld {}
.AudioVisualizer_g12__GnFpU {}
.AudioVisualizer_g1__hAIZc {}
.AudioVisualizer_g2__sXOPf {}
.AudioVisualizer_g3__Rsalv {}
.AudioVisualizer_g4__zbiKX {}
.AudioVisualizer_g5__ukvaJ {}
.AudioVisualizer_g6__0FfNS {}
.AudioVisualizer_g7__TCRXM {}
/* ... 1165 more selectors in css-selectors.txt */
```

## Artifacts written

- `test/e2e/snapshots/design-google/css-selectors.txt`
- `test/e2e/snapshots/design-google/fast.html`
- `test/e2e/snapshots/design-google/headers.json`
- `test/e2e/snapshots/design-google/http.html`
- `test/e2e/snapshots/design-google/screenshot-fast.png`
- `test/e2e/snapshots/design-google/static.html`