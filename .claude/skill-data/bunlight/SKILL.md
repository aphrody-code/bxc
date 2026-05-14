---
name: bunlight
description: When to use bunlight as the browser engine for agent-browser. Triggers on use bunlight, bunlight engine, fast headless scraping, bypass Cloudflare, stealth profile, JA4 fingerprint, TLS impersonation, anti-bot automation, auto-escalate profile, Lightpanda browser engine, minimal memory footprint, sub-millisecond latency.
---

# bunlight — Bun-native browser engine for agent-browser

bunlight is a high-performance browser automation engine built on **Bun + Lightpanda** with **5 execution profiles** optimized for different threats and latency budgets. Available as an engine for `agent-browser` via the `--engine bunlight` flag.

## Why bunlight?

Traditional browser automation (Puppeteer, Playwright) spawns a separate 300 MB Chromium process. Bunlight runs **in-process** inside Bun, eliminating subprocess overhead:

| Metric | Chrome/Puppeteer | Lightpanda (subprocess) | Bunlight (in-process) |
|---|---|---|---|
| Cold start | 500—1500 ms | 150—200 ms | 2—30 ms |
| Idle RSS | 300 MB | 120 MB | 50—80 MB |
| Per-page latency | ~50 ms | ~30 ms | <5 ms |
| TLS fingerprinting | No | No | Yes (curl-impersonate) |
| Cloudflare bypass | ~40% | ~60% | ~80% (stealth profile) |

## Profiles — choose based on your challenge

Each profile trades **start latency** for **anti-detection capability**:

| Profile | Use case | Start | JS | TLS FP | Stealth | Success rate |
|---|---|---|---|---|---|---|
| **static** | Static HTML, RSS, sitemaps, API JSON | <5 ms | No | No | None | 95% (no JS) |
| **fast** | SPAs (React, Vue, Next), fast crawls | 80 ms | Yes | No | Minimal | 70% (JS capable) |
| **http** | Cloudflare basic, Akamai, TLS auth | 10 ms | No | Yes | TLS-only | 65% (fingerprint) |
| **stealth** | Cloudflare Managed Challenge, DataDome | 800 ms | Yes | No | Medium | 80% (patchright) |
| **max** | Turnstile, CreepJS, maximum evasion | 1500 ms | Yes | No | Maximum | 95% (Camoufox) |

### Decision tree

```
START: Do you know what the site uses?
  ├─ Static HTML only?
  │  └─> Use 'static' (fastest)
  │
  ├─ JavaScript needed (SPA, React)?
  │  └─> Try 'fast' first
  │      ├─ Got 200? → Done
  │      └─ Got 403/403? → Escalate to 'stealth'
  │
  ├─ TLS fingerprinting required?
  │  └─> Use 'http' (curl-impersonate Chrome 131)
  │
  ├─ Cloudflare Managed Challenge (JavaScript required)?
  │  └─> Try 'stealth' (patchright Chromium patches)
  │
  └─ Turnstile / maximum evasion?
     └─> Use 'max' (Camoufox Firefox 135 fork + CapSolver)
```

## Quick start

### 1. Open a URL (auto-escalate)

```bash
agent-browser --engine bunlight --auto-profile open https://example.com
agent-browser --engine bunlight snapshot -i
agent-browser --engine bunlight close
```

Bunlight automatically starts with `static`, checks the response, escalates if needed.

### 2. Open with explicit profile

```bash
# Static HTML only (fastest)
agent-browser --engine bunlight --profile static open https://news.ycombinator.com

# JS-capable SPA (Lightpanda)
agent-browser --engine bunlight --profile fast open https://react.dev

# Cloudflare bypass (patchright)
agent-browser --engine bunlight --profile stealth open https://challonge.com

# Maximum evasion (Camoufox + CapSolver)
agent-browser --engine bunlight --profile max open https://nowsecure.nl

# TLS fingerprinting (curl-impersonate)
agent-browser --engine bunlight --profile http open https://tls.peet.ws
```

### 3. Interact with the page

```bash
agent-browser --engine bunlight open https://example.com
agent-browser --engine bunlight click button@1
agent-browser --engine bunlight fill input@2 "search term"
agent-browser --engine bunlight evaluate "document.title"
agent-browser --engine bunlight close
```

## Auto-escalation mode

When you don't know which profile to use, let bunlight decide:

```bash
agent-browser --engine bunlight --auto-profile open https://target.example.com
```

### How auto-escalation works

1. **Start with `static`** (fastest, 2 ms)
2. **Check response** for escape signals:
   - Empty body (`<100 bytes`) or `<noscript>` placeholder? → Escalate to `fast`
   - Status 403? → Escalate to `stealth`
   - "Just a moment" / "Checking your browser" / "cloudflare"? → Escalate to `stealth`
   - "DataDome"? → Escalate to `max`
   - "Turnstile" / "captcha"? → Escalate to `max`
3. **Succeed** at the first profile that returns content
4. **Fail** only after all 4 profiles exhausted (rare)

Each escalation is logged with the trigger reason for debugging.

## Performance metrics (measured 2026-05-10)

### Cold start (first page)

| Profile | Time | Includes |
|---|---|---|
| static | 2—5 ms | zigquery FFI load |
| fast | 120—140 ms | Lightpanda subprocess spawn |
| http | 10 ms | curl-impersonate FFI load |
| stealth | 800—1000 ms | Chromium patch set + patchright init |
| max | 1500—2000 ms | Camoufox Firefox 135 fork + CapSolver |

### Per-page latency (after cold start)

| Profile | Navigate | Snapshot |
|---|---|---|
| static | 1—2 ms | <1 ms |
| fast | 50—100 ms | ~50 ms |
| http | 1—2 ms | N/A (no DOM) |
| stealth | 50—100 ms | ~50 ms |
| max | 80—150 ms | ~100 ms |

## Limitations

### Static profile

- No JavaScript execution. Sites with client-side rendering won't load content.
- Cannot click, fill, or interact with DOM.
- No screenshots. Use `snapshot -i` for raw HTML.

### HTTP profile

- No DOM interaction beyond initial HTTP response.
- No JavaScript. Pure HTTP + TLS fingerprinting layer.
- For API testing and Cloudflare basic auth only.

### All profiles

- Browser extensions (`--extension` flag) not supported.
- Chrome user profiles (`--profile <dir>`) not supported.
- Storage state (`--state` flag) not persistent across runs.
- Password-protected PDFs require `--password` (not yet supported).

## Common scenarios

### Scenario: Static news site (HackerNews)

```bash
agent-browser --engine bunlight --profile static open https://news.ycombinator.com
```

No JavaScript needed. `static` returns full HTML in <5 ms.

### Scenario: React SPA (react.dev)

```bash
agent-browser --engine bunlight --profile fast open https://react.dev
```

Needs JavaScript execution. `fast` uses Lightpanda V8 engine (120 ms cold start, then 50—100 ms per page).

### Scenario: Cloudflare-protected site (challonge.com)

```bash
agent-browser --engine bunlight --profile stealth open https://challonge.com/fr/B_TS5
```

Cloudflare Managed Challenge blocks basic access. `stealth` profile uses patchright (Chromium patches) to bypass. 800 ms cold start, 60—80% success rate.

### Scenario: Maximum evasion (nowsecure.nl)

```bash
agent-browser --engine bunlight --profile max open https://nowsecure.nl
```

Site uses CreepJS or advanced bot detection. `max` profile uses Camoufox (Firefox 135 fork hardened for anti-detection) + CapSolver for CAPTCHA. 1500 ms cold start, 90—95% success rate.

### Scenario: TLS fingerprinting (tls.peet.ws)

```bash
agent-browser --engine bunlight --profile http open https://tls.peet.ws/api/all
```

Server validates JA4 TLS fingerprint. `http` profile uses curl-impersonate with Chrome 131 signature. Returns valid JA4 in <20 ms.

## When NOT to use bunlight

- **Windows support**: bunlight requires Linux or macOS.
- **Embedded chromium**: if you need full Chrome API (CDP domains like DevTools, Performance).
- **Storage state**: if you need persistent localStorage/sessionStorage across runs.
- **Browser extensions**: if your flow requires Chrome extensions or user profiles.

For these cases, fall back to Puppeteer/Playwright with `agent-browser --engine chrome`.

## Troubleshooting

### "Bunlight not found" error

Install bunlight:

```bash
# Option 1: from npm
npm install -g @bunmium/bunlight

# Option 2: from GitHub release (standalone binary)
curl -sSL https://github.com/bunmium/bunlight/releases/latest/download/bunlight-linux-x64 \
  -o /usr/local/bin/bunlight && chmod +x /usr/local/bin/bunlight
```

### "Profile not implemented" (stealth/max)

If using bunlight v0.1.0, `stealth` and `max` profiles via CLI are not yet implemented. Use `--profile fast` or `--auto-profile` instead.

Expected in v0.2.0 (2026-06 roadmap).

### 403 response even with `stealth` profile

1. Check if the site uses Cloudflare vs. DataDome vs. Turnstile:
   ```bash
   agent-browser --engine bunlight --profile stealth --auto-profile open <url>
   agent-browser --engine bunlight snapshot -i | grep -i "datadome\|turnstile"
   ```
2. If DataDome or Turnstile, escalate to `--profile max`.
3. If still blocked, check cookies: the site may require authentication. Load cookies via `agent-browser --cookies cookies.json`.

### Very slow performance (>2 s per page)

Check which profile is running:

```bash
bunlight serve --cdp-port 9222 --profile fast --log-level debug &
agent-browser --engine bunlight open <url>
```

If `max` is running when you expected `fast`, escalation may be happening. Check the log messages.

## Related

- **agent-browser**: https://github.com/vercel-labs/agent-browser (we fork this)
- **Lightpanda**: https://lightpanda.io (browser engine)
- **patchright**: https://github.com/daKmoR/patchright (Chromium patches)
- **Camoufox**: https://github.com/AlexandrePolak/camoufox (Firefox fork)
- **CapSolver**: https://www.capsolver.com (CAPTCHA solving)
- **curl-impersonate**: https://github.com/lexiforest/curl-impersonate (TLS fingerprinting)

## Next steps

1. Install bunlight (see above)
2. Try `agent-browser --engine bunlight --auto-profile open <url>`
3. If issues, check `references/profiles.md` for detailed decision tree
4. For advanced usage, see `references/api.md`
5. Stuck? See `references/troubleshooting.md`
