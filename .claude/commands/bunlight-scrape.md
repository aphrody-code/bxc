---
description: Scrape a single URL with Bunlight, picking a profile automatically or using the one provided
argument-hint: <url> [profile]
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

# Scrape a URL with Bunlight

The user invoked this with: `$ARGUMENTS`

Treat `$1` as the target URL and `$2` as the optional profile (one of `static`, `fast`, `http`, `stealth`, `max`).

Steps:

1. Validate `$1` is a syntactically valid `http://` or `https://` URL. If not, ask the user to retry and stop.
2. Resolve the profile:
   - If `$2` is provided and is one of the 5 valid profiles, use it.
   - Otherwise, call `detectFromPage` (loading the page once with profile `static`) and use `suggestProfile(tech)` to pick.
   - Default to `fast` if detection fails.
3. Compute a slug from the URL host, e.g. `example-com`. Compute a timestamp `YYYYMMDD-HHMMSS`.
4. Generate a scraper at `./scripts/scrape-<slug>-<timestamp>.ts` using the `bunlight-scraper` agent's template:
   - Strict TypeScript, Bun-native APIs only.
   - `Browser.newPage({ profile: "<resolved>" })`.
   - `await page.goto($1, { waitUntil: "load", timeoutMs: 30000 })`.
   - Extract `title`, `url`, `content` (HTML body length).
   - Write `./output/scrape-<slug>-<timestamp>.json` containing `{ url, profile, title, contentLength, status: "ok" }`.
   - Always close the page in `finally`.
5. Run the script: `bun run ./scripts/scrape-<slug>-<timestamp>.ts`.
6. If the run fails with a Cloudflare challenge or 403 response, escalate the profile one tier (`fast` → `stealth` → `max`) and re-run. Report which profile finally succeeded.
7. Print a summary: URL, chosen profile, output path, page title, content length.

Use only Bun-native APIs. No `node:fs`, `node:child_process`, or `node:crypto`. No emojis in script or output.
