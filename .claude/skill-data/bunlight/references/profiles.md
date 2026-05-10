# Profile Selection Reference

This document contains the detailed decision tree for choosing a bunlight profile.

## Profile Summary Table

| Profile | Cold Start | JS | TLS FP | Stealth | Use case | Success rate |
|---|---|---|---|---|---|---|
| static | <5 ms | No | No | None | Static HTML, RSS, APIs | 95% |
| fast | 100—150 ms | Yes | No | Minimal | SPAs, React, Vue, generic | 70% |
| http | 10 ms | No | Yes | TLS-only | Cloudflare basic, TLS auth | 65% |
| stealth | 800 ms | Yes | No | Medium | Cloudflare Challenge, DD | 80% |
| max | 1500 ms | Yes | No | Maximum | Turnstile, CreepJS | 95% |

## Decision Tree — which profile?

Start at the top, answer each question:

```
1. Do you know if the site is static HTML (server-rendered)?
   ├─ YES → Use 'static' (fastest, <5 ms)
   │        └─ [static profile best for: HN, news sites, API endpoints]
   │
   └─ NO → Go to Q2

2. Will the site render content with JavaScript?
   ├─ MAYBE (SPA, React, Vue, Next.js) → Try 'fast' first
   │  └─ Got 200 + content? → Done with 'fast'
   │  └─ Got 403 or empty? → Go to Q3
   │
   └─ NO (static only) → Use 'static'

3. Do you see Cloudflare error messages?
   ├─ "Just a moment" / "Checking your browser"?
   │  └─> Use 'stealth' (80% success on Managed Challenge)
   │
   ├─ No error, but status 403?
   │  └─> Could be Cloudflare or DataDome. Try 'stealth'
   │      └─ If still blocked → Try 'max'
   │
   └─ See "DataDome" or "Access Denied"?
      └─> Use 'max' (handles DataDome better)

4. Do you need TLS fingerprinting only (API testing)?
   ├─ YES → Use 'http' (10 ms, curl-impersonate)
   │
   └─ NO → Continue below

5. Do you see Turnstile or reCAPTCHA widgets?
   ├─ YES → Use 'max' (includes CapSolver auto-solver)
   │
   └─ NO → Go to Q6

6. Do you see CreepJS or other advanced fingerprinting checks?
   ├─ YES → Use 'max' (Camoufox is hardened against this)
   │
   └─ NO → Use 'stealth' (patchright is sufficient)

FALLBACK: If 'max' doesn't work, it's likely a captcha or custom challenge. Check the HTML for clues or upgrade to `--auto-profile`.
```

## Profile Details

### static

**Best for**: News sites, documentation, static blogs, RSS feeds, sitemaps, API JSON responses.

**Mechanism**: In-process DOM parsing via zigquery (Zig cdylib). No JavaScript execution. Super fast.

**Cold start**: 2—5 ms (just FFI dlopen)

**Per-page latency**: 1—3 ms

**Limitations**:
- No JavaScript execution
- No click/fill/interact
- No screenshots (use raw HTML snapshot)

**Example**:
```bash
agent-browser --engine bunlight --profile static open https://news.ycombinator.com
agent-browser --engine bunlight snapshot -i
```

### fast

**Best for**: SPAs (React, Vue, Next.js, Nuxt), generic sites with JavaScript, login flows.

**Mechanism**: Spawn Lightpanda as subprocess, reverse-proxy CDP calls. Lightpanda is a Rust browser engine (Chromium-like HTML parsing + V8 JavaScript).

**Cold start**: 100—150 ms (subprocess spawn + V8 init)

**Per-page latency**: 50—100 ms (navigate + layout)

**Limitations**:
- Slower than static
- Less stealth than stealth/max profiles
- May be blocked by sophisticated bot detection

**Example**:
```bash
agent-browser --engine bunlight --profile fast open https://react.dev
agent-browser --engine bunlight evaluate "document.querySelectorAll('h1')[0].textContent"
```

### http

**Best for**: Cloudflare basic auth (cookie-based), TLS fingerprinting validation, headless API testing.

**Mechanism**: HTTP client with curl-impersonate FFI. Sends requests with Chrome 131 TLS signature + headers. No browser rendering.

**Cold start**: 10 ms (just FFI dlopen)

**Per-page latency**: 2—5 ms (just HTTP request)

**Limitations**:
- No DOM interaction (snapshot is raw response body)
- No JavaScript
- No rendering (API testing only)

**Example**:
```bash
# Validate TLS fingerprint
agent-browser --engine bunlight --profile http open https://tls.peet.ws/api/all
agent-browser --engine bunlight snapshot -i
```

### stealth

**Best for**: Cloudflare Managed Challenge, DataDome, Akamai, Imperva, bot detection that checks browser fingerprint.

**Mechanism**: Spawn patchright (Chromium patches), execute with modified navigator, screen, webgl objects. Medium-level evasion.

**Cold start**: 800—1000 ms (Chromium launch + patch set)

**Per-page latency**: 50—100 ms (navigate + layout)

**Success rate**: 60—80% on Cloudflare Managed Challenge

**Limitations**:
- Slow cold start
- May still be detected by CreepJS-level checks
- Requires Chromium binary installed

**Example**:
```bash
agent-browser --engine bunlight --profile stealth open https://challonge.com
```

### max

**Best for**: Turnstile, CreepJS, maximum anti-bot evasion, custom fingerprinting checks.

**Mechanism**: Spawn Camoufox (Firefox 135 fork hardened for anti-detection), use CapSolver for CAPTCHA auto-solving.

**Cold start**: 1500—2000 ms (Camoufox + CapSolver init)

**Per-page latency**: 80—150 ms (navigate + layout)

**Success rate**: 90—95% on maximum evasion scenarios

**Limitations**:
- Very slow cold start
- Requires Firefox binary + CapSolver API key (or mock mode)
- Highest resource usage

**Example**:
```bash
agent-browser --engine bunlight --profile max open https://nowsecure.nl
```

## Choosing for Real-World Sites

### news.ycombinator.com

Static news aggregator, no JavaScript rendering needed.

```
Decision:
  Q1: Static HTML? → YES → Use 'static'
Result: static profile, <5 ms cold start
```

### react.dev

React documentation site (obviously React SPA).

```
Decision:
  Q1: Static HTML? → NO
  Q2: JavaScript needed? → YES (React SPA)
  Try 'fast' first → Success
Result: fast profile, 100 ms cold start
```

### challonge.com

Tournament bracket site, protected by Cloudflare Managed Challenge.

```
Decision:
  Q1: Static HTML? → NO
  Q2: JavaScript needed? → YES
  Try 'fast' → 403 "Just a moment"
  Q3: Cloudflare error? → YES → Use 'stealth'
Result: stealth profile, 800 ms cold start, 70% success
```

### nowsecure.nl

Bot detection with CreepJS + fingerprinting checks.

```
Decision:
  Q1: Static HTML? → NO
  Q2: JavaScript needed? → YES
  Try 'fast' → Blocked (fingerprint check)
  Q3: Cloudflare? → NO
  Q6: CreepJS? → YES → Use 'max'
Result: max profile, 1500 ms cold start, 95% success
```

### tls.peet.ws/api/all

JA4 TLS fingerprint validation endpoint.

```
Decision:
  Q4: TLS fingerprinting only? → YES → Use 'http'
Result: http profile, 10 ms cold start
```

## Auto-escalation flow

When using `--auto-profile`, bunlight internally executes this sequence:

1. **Try static**: Load URL with in-process DOM parser
   - If response body empty or <100 bytes → Escalate
   - If response contains `<noscript>` → Escalate
   - Else → SUCCESS with static
2. **Try fast**: Spawn Lightpanda, load URL
   - If response status 200—299 → SUCCESS with fast
   - Else → Escalate
3. **Try stealth**: Spawn patchright Chromium, load URL
   - If response status 200—299 → SUCCESS with stealth
   - Else → Escalate
4. **Try max**: Spawn Camoufox, load URL
   - If response status 200—299 → SUCCESS with max
   - Else → FAIL with error
5. **Fallback**: Throw error "All profiles exhausted"

Each escalation is logged with the trigger (e.g., "empty_body", "403", "cloudflare", "turnstile").

## Tips

- **Cold start matters?** Use `static` or `http`.
- **Need interaction (click, fill)?** Need at least `fast`.
- **Getting 403 errors?** Check the response body for "cloudflare" or "datadome", escalate accordingly.
- **Very fast site?** `static` + `fast` should cover 90% of cases.
- **Slow sites OK?** Go straight to `stealth` or `max` to avoid escalation overhead.
- **Don't know?** Use `--auto-profile` and let bunlight decide.
