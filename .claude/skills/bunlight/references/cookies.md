---
description: Cookie formats, loading, and injection. Support for Playwright, Chrome DevTools, Netscape, and in-memory formats. Pre-auth workflows for session persistence.
---

# Cookies & Session Management

Load and inject cookies from various formats. Useful for session reuse, bypass of 2FA, and pre-auth workflows.

## Supported formats

Bunlight's `loadCookieJar()` auto-detects three formats:

### 1. Playwright/CDP format (JSON array)

```json
[
  {
    "name": "sessionid",
    "value": "abc123",
    "domain": ".example.com",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "Lax",
    "expires": 1735689600
  }
]
```

**Export from Chrome/Edge**:
1. DevTools → Application → Cookies → [domain]
2. Right-click any cookie → Export as JSON
3. Save as `cookies.json`

### 2. Netscape format (cookies.txt)

Used by curl, wget, etc.

```
.example.com	TRUE	/	TRUE	1735689600	sessionid	abc123
.example.com	TRUE	/	FALSE	0	preference	dark-mode
```

**Export from Chrome**: Use extension like "Get cookies.txt" or copy from DevTools manually.

### 3. In-memory array

```ts
const cookies = [
  {
    name: "session",
    value: "xyz789",
    domain: "example.com",
    path: "/"
  }
];
```

## Loading cookies

### loadCookieJar(path: string): Promise<Cookie[]>

Load from a file (auto-detects format).

```ts
import { loadCookieJar } from "@bunmium/bunlight/cookies";

const cookies = await loadCookieJar("./cookies/session.json");
console.log(cookies);
// [{ name: "...", value: "...", ... }]
```

### Parse manually

```ts
import { parseNetscapeCookies, parseCdpCookies } from "@bunmium/bunlight/cookies";

const netscape = await Bun.file("cookies.txt").text();
const cookies = parseNetscapeCookies(netscape);
```

## Injecting cookies

### Before navigation

```ts
import { Browser } from "@bunmium/bunlight";
import { loadCookieJar } from "@bunmium/bunlight/cookies";

const cookies = await loadCookieJar("./cookies/cloudflare.json");

const page = await Browser.newPage({
  profile: "fast",
  cookies  // inject before navigation
});

await page.goto("https://example.com");
// Cookies sent in the request
```

### After page creation

```ts
const page = await Browser.newPage();
await page.setCookie(...cookies);
await page.goto("https://example.com");
```

### Per-profile behavior

- **static / fast**: Cookies sent via `Network.setCookies` CDP command
- **http**: Cookies sent as `Cookie:` header (RFC 6265 domain/path matched)
- **stealth / max**: Cookies fed to patchright/Camoufox context

## Export cookies from a real browser

### Manual export (Chrome/Edge)

1. Navigate to the protected site in Chrome
2. Open DevTools (F12)
3. Go to Application → Cookies → [domain]
4. Right-click a cookie → Select all → Copy
5. Paste into `cookies.json`

Or export via DevTools console:

```javascript
// Run in DevTools console:
copy(
  JSON.stringify(
    document.cookie
      .split(";")
      .map(c => {
        const [name, value] = c.trim().split("=");
        return { name, value, domain: location.hostname, path: "/" };
      }),
    null,
    2
  )
);
```

### Browser extensions

- **Chrome**: "Get cookies.txt" extension (exports Netscape format)
- **Firefox**: "Export Cookies" extension

### Programmatic (Puppeteer)

```javascript
// In a Puppeteer script:
const cookies = await page.cookies();
const fs = require("fs");
fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
```

## Session reuse workflow

### 1. Manual: Export once, reuse

```bash
# Export cookies from real browser
# Save as ./cookies/private/my-session.json

# Never commit private cookies to git
echo "cookies/private/" >> .gitignore
```

```ts
import { loadCookieJar } from "@bunmium/bunlight/cookies";

const cookies = await loadCookieJar("./cookies/private/my-session.json");
const page = await Browser.newPage({ profile: "fast", cookies });
await page.goto("https://protected-site.com");
// Authenticated request!
```

### 2. Automated: Authenticate once per session

```ts
import { SessionPool } from "@bunmium/bunlight/pool/SessionPool";

const pool = new SessionPool({
  profile: "fast",
  authenticator: async (page) => {
    // Login once
    await page.goto("https://example.com/login");
    await page.type("input[name=email]", "user@example.com");
    await page.type("input[name=password]", process.env.PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForNavigation();
    // Cookies now stored in pool
  }
});

// All pages in pool have session cookies
const results = await pool.run(urls, async (page, url) => {
  await page.goto(url);
  return page.title();
});
```

### 3. 2FA / Cloudflare: Cookies + human verification

For sites with 2FA or Cloudflare:

```ts
import { loadCookieJar } from "@bunmium/bunlight/cookies";

// 1. Log in manually in Chrome with 2FA
// 2. Export cookies
const cookies = await loadCookieJar("./cookies/2fa-session.json");

// 3. Use with stealth profile (preserves CF bypass cookie)
const page = await Browser.newPage({
  profile: "stealth",
  cookies,
  stealthOpts: { fingerprint: { browser: "chrome" } }
});

await page.goto("https://2fa-protected.com");
```

## Cookie types

### Transient (session cookies)

Expire when browser closes. No `expires` field.

```ts
{
  name: "sessionid",
  value: "...",
  // No expires: expires when browser closes
}
```

### Persistent

Last beyond browser restart. Include `expires` (Unix timestamp in seconds).

```ts
{
  name: "remember-me",
  value: "...",
  expires: Math.floor(Date.now() / 1000) + 86400 * 30  // 30 days
}
```

### HttpOnly

Cannot be accessed from JavaScript (security feature). Sent by server automatically.

```ts
{
  name: "auth",
  value: "...",
  httpOnly: true,  // Browser controls; we can still set it
  secure: true     // Only over HTTPS
}
```

### SameSite

Controls when cookie is sent cross-site.

```ts
{
  name: "tracking",
  value: "...",
  sameSite: "Lax"  // "Strict", "Lax", "None"
}
```

## Security best practices

1. **Never commit to git**: Store cookies in `cookies/private/`, add to `.gitignore`
2. **Rotate regularly**: Invalidate old cookies monthly
3. **Use env vars**: For sensitive cookies, prefer env vars
4. **Scope narrowly**: Only export cookies needed for the task
5. **Clean up**: After crawl, archive cookies in secure storage

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 401 Unauthorized | Cookies expired | Re-export from browser |
| Stuck on login page | Cookies not injected | Check path: does cookie domain match? |
| Mixed content warning | HTTPS cookie on HTTP | Check `secure` flag matches URL scheme |
| Cookie jar is empty | Wrong format | Try other parsers or re-export |

## API reference

```ts
import {
  loadCookieJar,
  parseNetscapeCookies,
  parseCdpCookies,
  injectCookies,
  buildCookieHeader
} from "@bunmium/bunlight/cookies";

interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;  // Unix timestamp (seconds)
}
```

## See also

- `references/profiles.md` — `http` and `stealth` profiles paired with cookie injection.
- `references/pool.md` — `SessionPool` for jar reuse across concurrent pages.
- `references/cookbook.md` — recipe #3 (login with cookies) and #6 (Cloudflare bypass).
- Agent `bunlight-cookie-extractor` — extracts, converts, and stores cookie jars.
- Agent `bunlight-debugger` — when an authenticated scrape returns a login page.
