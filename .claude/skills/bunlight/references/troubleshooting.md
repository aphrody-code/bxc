---
description: Common Bunlight errors, their causes, and solutions. Debugging guide for profiles, profiles, timeouts, network issues, and crashes.
---

# Troubleshooting

Common errors and solutions.

## Module & Setup

### Module not found: `bun:browser`

**Cause**: Phase 3 (builtin) not yet released.

**Fix**: Use `@bunmium/bunlight` from npm:
```bash
bun add @bunmium/bunlight
```

```ts
import { Browser } from "@bunmium/bunlight";
```

### Cannot find module `lightpanda`

**Cause**: `profile: "fast"` requires lightpanda binary but it's not on `$PATH`.

**Fix**:
```bash
# Install lightpanda
git clone https://github.com/lightpanda-io/browser
cd browser && bun install && bun run build:release

# Or set environment variable
export LIGHTPANDA_BIN=/path/to/lightpanda
```

### FFI symbol not found: `zigquery_*`

**Cause**: Phase 1 cdylib not built.

**Fix**:
```bash
bun scripts/build-lightpanda-static.ts
```

## Navigation & Timeouts

### page.goto() timeout

**Cause**: Network slow, site doesn't load, or JavaScript hangs.

**Fix**:
```ts
// Increase timeout
await page.goto(url, { timeoutMs: 60000 });  // 60s instead of 30s

// Or change waitUntil
await page.goto(url, { waitUntil: "domcontentloaded" });  // faster
```

### page.goto() returns skeleton only (SPA)

**Cause**: Using `profile: "static"` on a React/Vue site.

**Fix**: Switch to `fast` profile:
```ts
const page = await Browser.newPage({ profile: "fast" });  // not "static"
```

### Challenge page returned instead of content

**Cause**: Cloudflare / Akamai / WAF blocking.

**Fix**: Escalate profile:
```ts
// Try stealth
const page = await Browser.newPage({ profile: "stealth" });

// If stealth fails, try max
const page = await Browser.newPage({ profile: "max" });
```

## Cookies & Auth

### 401 Unauthorized even with cookies

**Cause**: Cookies expired or wrong domain.

**Fix**:
```ts
// Re-export cookies from browser
// Check domain/path/expiry in devtools

// Or manually re-authenticate
const page = await Browser.newPage();
await page.goto("https://example.com/login");
await page.type("input[name=email]", "...");
await page.type("input[name=password]", "...");
await page.click("button");
```

### Cookie jar is empty

**Cause**: Wrong format or parsing failed.

**Fix**: Verify format in DevTools:
```ts
import { Bun } from "bun";

const content = await Bun.file("cookies.json").text();
console.log("Raw content:", content);

// Try parsing manually
const parsed = JSON.parse(content);
console.log("Parsed:", parsed);
```

## Profiles & Stealth

### profile: "static" — no JavaScript execution

**Error**: `page.evaluate()` throws "Method not supported"

**Fix**: Use `profile: "fast"` or higher:
```ts
const page = await Browser.newPage({ profile: "fast" });
const result = await page.evaluate(() => document.title);
```

### profile: "http" — raw HTML only

**Error**: Cannot click, type, or take screenshots

**Fix**: Use `profile: "fast"` for full browser features:
```ts
const page = await Browser.newPage({ profile: "fast" });
await page.click("button");
```

### Cloudflare bypass still fails with stealth

**Cause**: Site uses advanced fingerprinting (DataDome, Imperva).

**Fix**: Try `profile: "max"`:
```ts
const page = await Browser.newPage({ profile: "max" });
```

### CapSolver token invalid

**Cause**: Expired token or wrong API key.

**Fix**: Check your CapSolver account and re-generate token:
```ts
const page = await Browser.newPage({
  profile: "max",
  maxOpts: {
    capsolverApiKey: process.env.CAPSOLVER_TOKEN  // must be valid
  }
});
```

## Pools & Concurrency

### "Too many open files" error

**Cause**: Concurrency too high; exceeding OS file descriptor limit.

**Fix**: Lower concurrency:
```ts
const pool = new PagePool({
  concurrency: 20,    // was 100, too high
  maxPages: 10
});

// Or increase system limit
// Linux: ulimit -n 4096
```

### Memory keeps growing

**Cause**: Pages not being closed or pooled.

**Fix**: Ensure pages are closed:
```ts
await pool.close();  // must call this

// Or check maxPages is set
const pool = new PagePool({
  concurrency: 50,
  maxPages: 25  // limit reused pages
});
```

### Task hangs forever

**Cause**: Page stuck waiting or no timeout.

**Fix**: Add timeout:
```ts
await Promise.race([
  page.goto(url),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Timeout")), 30000)
  )
]);
```

## Crashes & Recovery

### Process crashes: "Segmentation fault"

**Cause**: Lightpanda bug (rare) or FFI issue.

**Fix**: 
1. Update Lightpanda
2. Report the URL to bunmium/bunlight issue tracker
3. Use RequestQueue to resume

### Database locked: "SQLITE_BUSY"

**Cause**: Multiple processes accessing same queue db.

**Fix**: Only one process should access queue.db at a time:
```bash
# Bad: running two crawl processes
bun crawl.ts &
bun crawl.ts    # SQLITE_BUSY

# Good: one process, queue resumes on restart
bun crawl.ts
# Ctrl+C to pause
bun crawl.ts    # resume
```

## Detection & Routing

### detectFrameworks() returns empty array

**Cause**: wappalyzergo binary not found or network issue.

**Fix**:
```bash
# Ensure binary exists
ls vendor/wappalyzergo/wappalyzergo-cli

# Or pass HTML explicitly
const tech = await detectFrameworks({
  html: await page.content(),
  headers: { "content-type": "text/html" }
});
```

### suggestProfile() suggests wrong profile

**Cause**: Missing tech detection or partial fingerprinting.

**Fix**: Check detected technologies:
```ts
const tech = await detectFromPage(page);
console.log("Detected:", tech);

// Manually choose profile based on tech
if (tech.some(t => t.name.includes("React"))) {
  profile = "fast";
}
```

## Performance

### Crawl is slow (< 10 URLs/sec)

**Cause**: Profile overhead or network.

**Fix**:
1. Check actual bottleneck:
   ```ts
   console.time("goto");
   await page.goto(url);
   console.timeEnd("goto");  // see actual time
   ```
2. If page.goto slow: site is slow, use faster profile
3. If overhead slow: increase concurrency
4. Use smaller viewport: `viewport: { width: 800, height: 600 }`

### RAM usage > 1 GB

**Cause**: Too many pages open or large pages.

**Fix**:
```ts
const pool = new PagePool({
  concurrency: 100,
  maxPages: 10   // reuse aggressively
});

// Or block large resources
await page.blockResources(["image", "stylesheet", "font"]);
```

## Getting help

If you hit an error not listed here:

1. Check the GitHub issues: https://github.com/bunmium/bunlight/issues
2. Run with `DEBUG=bunlight:*` env var for verbose output
3. Try simpler profile (e.g., `static` instead of `stealth`)
4. Check Bunlight version: `bun add @bunmium/bunlight@latest`

## See also

- `references/profiles.md` — escalation order when one profile fails.
- `references/pool.md` and `references/queue.md` — pool stalls and queue dead-letter recovery.
- `references/cookies.md` — login-page-instead-of-data symptoms.
- Agent `bunlight-debugger` — guided diagnosis with the multi-profile test harness.
