---
defaultProfile: fast
lightpandaPath: /usr/local/bin/lightpanda
capsolverApiKey: ""
cookieJarDir: ./cookies/private
concurrency: 50
maxPages: 25
proxyUrl: ""
verbose: false
---

# Bunlight project settings

This is a template. To activate, copy it to `.claude/bunlight.local.md`:

```bash
cp .claude/bunlight.local.example.md .claude/bunlight.local.md
```

`.claude/bunlight.local.md` is gitignored by the Bunlight `.gitignore` template.

## Fields

- **defaultProfile** (`static` | `fast` | `http` | `stealth` | `max`): used when no profile is supplied to `Browser.newPage()` or to a `/bunlight-*` command.
- **lightpandaPath**: absolute path to the `lightpanda` binary. Falls back to `$LIGHTPANDA_BIN` env var, then to `lightpanda` on `$PATH`.
- **capsolverApiKey**: required only for the `max` profile when the target has Turnstile or hCaptcha. Empty disables solving.
- **cookieJarDir**: where the cookie-extractor agent and the `bunlight_extract_cookies` MCP tool look for jars. Default `./cookies/private`.
- **concurrency**: starting concurrency for the `/bunlight-crawl` command and the `bunlight_pool_run` MCP tool.
- **maxPages**: cap on reused pages inside `PagePool`.
- **proxyUrl**: optional default proxy used by all profiles. Format `http://user:pass@host:port`.
- **verbose**: if true, the SessionStart hook prints extra status detail.

## How agents use these fields

- `bunlight-scraper`, `bunlight-crawler`, `bunlight-profile-router`: read `defaultProfile` if the user did not specify one.
- `bunlight-cookie-extractor`: writes jars under `cookieJarDir`.
- `bunlight-bench-runner`: uses `concurrency` and `maxPages` as default sweep values.
- Hook `session-start-status.sh`: parses this file at session start and surfaces the active profile.

## Restart required

After editing this file, restart Claude Code (`exit` then `claude`) for hooks to pick up the new values. SKILL and agent instructions read it on each invocation.
