---
description: Detect technologies on a target URL and suggest the best Bunlight profile
argument-hint: <url>
allowed-tools: ["Read", "Bash", "WebFetch"]
---

# Detect technologies on a URL

The user invoked this with: `$ARGUMENTS`

Treat `$1` as the target URL.

Steps:

1. Validate `$1` is a syntactically valid `http://` or `https://` URL. If not, ask the user to retry and stop.
2. Open the page with profile `static` (cheapest):
   ```ts
   import { Browser } from "@bunmium/bunlight";
   import { detectFromPage } from "@bunmium/bunlight/detect";
   import { suggestProfile } from "@bunmium/bunlight/router/framework-strategy";

   const page = await Browser.newPage({ profile: "static" });
   await page.goto("$1", { timeoutMs: 30000 });
   const tech = await detectFromPage(page);
   await page.close();
   const profile = suggestProfile(tech);
   ```
3. If `static` fails (e.g. JS-only site), retry with profile `fast`.
4. Print:
   - The URL and HTTP status.
   - A table of detected technologies (name, version, categories) sorted by confidence.
   - The suggested profile with a one-sentence rationale (e.g. `"Detected Cloudflare + Next.js → suggest 'stealth' for IUAM bypass"`).
   - The exact `Browser.newPage({ profile: "<x>" })` snippet to copy-paste.
5. If detection finds nothing actionable, fall back to `fast` and explain why.

Use only Bun-native APIs and the `@bunmium/bunlight/detect` module (powered by wappalyzergo). No emojis. No Node stdlib.
