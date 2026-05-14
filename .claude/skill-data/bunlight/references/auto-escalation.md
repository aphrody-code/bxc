# Auto-escalation Reference

This document explains how `--auto-profile` works and how to integrate auto-escalation into custom code.

## What is auto-escalation?

Auto-escalation is a strategy for choosing the right profile automatically. Instead of you deciding which profile to use, bunlight starts with the fastest profile and escalates to slower, more evasion-capable profiles only if needed.

It's enabled with the `--auto-profile` flag:

```bash
agent-browser --engine bunlight --auto-profile open https://target.example.com
```

## How it works

### Flow diagram

```
START
  |
  v
TRY static (2 ms)
  |
  ├─ Success (content + status 200) → DONE with static
  |
  └─ Fail (empty/403/cloudflare/etc) → Escalate
       |
       v
     TRY fast (100 ms)
       |
       ├─ Success → DONE with fast
       |
       └─ Fail → Escalate
            |
            v
          TRY stealth (800 ms)
            |
            ├─ Success → DONE with stealth
            |
            └─ Fail → Escalate
                 |
                 v
               TRY max (1500 ms)
                 |
                 ├─ Success → DONE with max
                 |
                 └─ Fail → ERROR (all exhausted)
```

### Escalation signals (what triggers next profile)

1. **empty_body** (body.length < 100)
   - Likely a SPA placeholder or JS-rendered page
   - Escalate from `static` to `fast`

2. **spa_placeholder** (contains `<noscript>` tag)
   - JavaScript required
   - Escalate from `static` to `fast`

3. **status_403** (HTTP 403 Forbidden)
   - Could be Cloudflare, DataDome, or IP block
   - Escalate from `fast` to `stealth`

4. **cloudflare** (body contains "Just a moment", "Checking your browser", "cf-mitigated")
   - Cloudflare Managed Challenge detected
   - Escalate from `fast` to `stealth`

5. **datadome** (body contains "DataDome" + "Access Denied")
   - DataDome protection detected
   - Escalate from `fast` to `stealth` or `max`

6. **turnstile** (body contains "turnstile" + "captcha")
   - Cloudflare Turnstile detected
   - Escalate from `stealth` to `max`

7. **captcha** (body contains "recaptcha", "hcaptcha", or "challenge")
   - Generic CAPTCHA detected
   - Escalate from `stealth` to `max`

## Example escalation sequences

### Example 1: HN (static HTML)

```bash
$ agent-browser --engine bunlight --auto-profile open https://news.ycombinator.com
[escalation] Attempt 1/4: profile=static
[escalation] Success on static
→ Returns immediately with static profile
```

### Example 2: react.dev (SPA, needs JS)

```bash
$ agent-browser --engine bunlight --auto-profile open https://react.dev
[escalation] Attempt 1/4: profile=static
[escalation] Signal detected on static: spa_placeholder
[escalation] Attempt 2/4: profile=fast
[escalation] Success on fast
→ Escalates to fast, succeeds
```

### Example 3: challonge.com (Cloudflare, needs patchright)

```bash
$ agent-browser --engine bunlight --auto-profile open https://challonge.com
[escalation] Attempt 1/4: profile=static
[escalation] Signal detected on static: spa_placeholder
[escalation] Attempt 2/4: profile=fast
[escalation] Signal detected on fast: cloudflare
[escalation] Attempt 3/4: profile=stealth
[escalation] Success on stealth
→ Escalates through static, fast, succeeds on stealth
```

### Example 4: nowsecure.nl (Maximum evasion)

```bash
$ agent-browser --engine bunlight --auto-profile open https://nowsecure.nl
[escalation] Attempt 1/4: profile=static
[escalation] Signal detected on static: spa_placeholder
[escalation] Attempt 2/4: profile=fast
[escalation] Signal detected on fast: status_403
[escalation] Attempt 3/4: profile=stealth
[escalation] Signal detected on stealth: captcha
[escalation] Attempt 4/4: profile=max
[escalation] Success on max
→ Escalates through all profiles, succeeds on max
```

## Using auto-escalation in code

Import the auto-escalation function:

```ts
import { autoEscalate } from "@bunmium/bunlight/profiles/auto-escalation";

const { profile, page, attempts } = await autoEscalate(
  "https://target.example.com",
  {
    startProfile: "static",        // Start with static (default)
    maxAttempts: 4,                 // Max 4 attempts
    log: (msg) => console.log(msg) // Optional logging
  }
);

console.log(`Succeeded with profile: ${profile}`);
console.log(`Attempts: ${attempts.join(" → ")}`);

// Now use the page...
const title = await page.title();
console.log(`Page title: ${title}`);

// Don't forget to close
await page.close();
```

## Signal detection API

Detect whether a response needs escalation:

```ts
import { detectEscalationSignal } from "@bunmium/bunlight/profiles/auto-escalation";

const body = await fetch("https://example.com").then(r => r.text());
const signal = detectEscalationSignal(body, 200);

if (signal) {
  console.log(`Escalate: ${signal.reason}`);
  // signal.detectedFromBody gives the trigger string
  // signal.detectedFromStatus gives the HTTP status
} else {
  console.log("No escalation needed");
}
```

## Profile chain API

Get the next profile:

```ts
import { nextProfile, ESCALATION_ORDER } from "@bunmium/bunlight/profiles/auto-escalation";

console.log(ESCALATION_ORDER); // ["static", "fast", "stealth", "max"]

const next = nextProfile("static");
console.log(next); // "fast"

const last = nextProfile("max");
console.log(last); // null (end of chain)
```

## Configuration options

### startProfile

Which profile to start with (default: "static").

```ts
await autoEscalate(url, { startProfile: "fast" });
// Skip static, start with fast (useful if you know the site needs JS)
```

### maxAttempts

Maximum number of escalation steps (default: 4).

```ts
await autoEscalate(url, { maxAttempts: 2 });
// Try only static and fast, fail if both don't work
```

### log

Custom logging function (default: no logging).

```ts
await autoEscalate(url, {
  log: (msg) => console.log(`[bunlight] ${msg}`)
});
```

## CLI integration

The `--auto-profile` flag in `bunlight serve` wires auto-escalation into the CDP server:

```bash
bunlight serve --cdp-port 9222 --auto-profile
```

When a page navigation request arrives, the server:
1. Parses the URL
2. Calls `autoEscalate(url)`
3. Returns the successful page
4. Continues serving CDP requests on that page

## Performance implications

Auto-escalation trades **latency** for **reliability**. Each escalation step costs time:

| Profile | Cold start | Escalation overhead |
|---|---|---|
| static | 2 ms | 2 ms (detect + rollback) |
| fast | 100 ms | 102 ms total if escalate |
| stealth | 800 ms | 902 ms total if escalate |
| max | 1500 ms | 2402 ms total if all escalate |

**Best practice**: If you know the site type, specify `--profile` directly. Use `--auto-profile` only when you're uncertain.

## Troubleshooting auto-escalation

### "All profiles exhausted"

The site defeated all 4 profiles. Check:
1. Is the URL correct?
2. Does the site require authentication (cookies)?
3. Is there a custom CAPTCHA we don't recognize?
4. Is the site blocking your IP?

### Escalation seems stuck

If bunlight keeps escalating but not reaching success:
1. Check the logs: `bunlight serve --log-level debug --auto-profile`
2. Verify the signal detection is correct (e.g., check for typos in Cloudflare strings)
3. Try manually with `--profile max` to see if it works

### Want to see escalation steps?

Use debug logging:

```bash
bunlight serve --cdp-port 9222 --auto-profile --log-level debug
agent-browser --engine bunlight open https://target.example.com
```

Look for `[escalation]` log lines showing which profiles were tried.
