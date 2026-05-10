# SKILLS.md

Guide to Bunlight skills for AI agents. This file indexes all skills loaded via the Claude Code plugin (`/bunlight:*` namespace).

When Claude Code loads the Bunlight plugin, it auto-discovers a single skill `bunlight` whose body is `.claude/skills/bunlight/SKILL.md`. The skill loads progressive-disclosure references on demand:

- `references/browser-basics.md` — core `Browser` API
- `references/profiles.md` — when to use `static`, `fast`, `http`, `stealth`, `max`
- `references/detect.md` — framework detection and strategy suggestion
- `references/cookies.md` — cookie injection and session persistence
- `references/pool.md` — `PagePool`, `SessionPool`, `ProxyPool`
- `references/queue.md` — `RequestQueue` for massive crawls
- `references/storage.md` — `Dataset` (JSONL append-only)
- `references/cookbook.md` — 10 copy-paste examples
- `references/troubleshooting.md` — error codes and fixes
- `references/api.md` — full API reference

In addition, the plugin ships:

- 8 agents in `.claude/agents/` (scraper, crawler, debugger, cookie-extractor, test-runner, profile-router, bench-runner, publisher).
- 8 commands in `.claude/commands/` (`/bunlight-init`, `/bunlight-scrape`, `/bunlight-crawl`, `/bunlight-detect`, `/bunlight-test`, `/bunlight-bench`, `/bunlight-cookie-import`, `/bunlight-doctor`).
- 4 hooks in `.claude/hooks/` (PreToolUse, PostToolUse, Stop, SessionStart).
- 1 MCP server in `.claude/mcp/bunlight-mcp/` exposing 4 tools.

## Usage

When working on a Bunlight-related task:

1. **First time?** → Read `/bunlight:browser-basics` for the core API
2. **Choosing a profile?** → Load `/bunlight:profiles` (decision tree)
3. **Scraping a site?** → Load `/bunlight:cookbook` (10 recipes)
4. **Debugging an error?** → Load `/bunlight:troubleshooting`
5. **Need details on a class?** → Load `/bunlight:api-reference`
6. **Doing cookies/session/auth?** → Load `/bunlight:cookies`
7. **Running 1000s of URLs?** → Load `/bunlight:pool` and `/bunlight:queue`

All skills are in the `.claude/skills/bunlight/` directory.

## Skill structure

```
.claude/skills/bunlight/
  SKILL.md                   (entry point, discovery stub)
  references/
    api.md                   (Browser, Page class methods)
    profiles.md              (decision tree: static, fast, http, stealth, max)
    detect.md                (detectFrameworks, detectFromPage)
    cookies.md               (cookie format, injection, session reuse)
    pool.md                  (PagePool, SessionPool, ProxyPool)
    queue.md                 (RequestQueue, bun:sqlite backed)
    storage.md               (Dataset, JSONL append, export)
    cookbook.md              (10 complete examples)
    troubleshooting.md       (errors + fixes)
```

## Quick reference

### When the user says... → Load this skill

| User request | Skill | Reason |
|---|---|---|
| "How do I use Bunlight?" | `/bunlight:browser-basics` | Core API intro |
| "Scrape a URL" | `/bunlight:cookbook` | Recipe #1 |
| "Login with cookies" | `/bunlight:cookies` + `/bunlight:cookbook` | Recipe #4 |
| "Cloudflare bypass" | `/bunlight:profiles` + `/bunlight:cookbook` | Profiles explain trade-offs; recipes show code |
| "Crawl 1000 URLs" | `/bunlight:pool` + `/bunlight:queue` | Scale patterns |
| "Detect the framework" | `/bunlight:detect` | wappalyzergo integration |
| "What does this error mean?" | `/bunlight:troubleshooting` | Error codes |
| "Full API docs" | `/bunlight:api-reference` | All classes, methods, types |

## Notes for plugin developers

- **Plugin name**: `bunlight`
- **Skill name**: `bunlight` (loaded via `.claude/skills/bunlight/SKILL.md`)
- **Trigger keywords**: "bunlight", "browser automation", "scraping", "pool", "cookie", "cloudflare", "turnstile", "detect framework", "crawl"
- **Allowed tools**: `Read`, `Write`, `Edit`, `Bash(bun:*)`, `WebFetch`
- **Agents**: `bunlight-scraper`, `bunlight-crawler`, `bunlight-debugger`, `bunlight-cookie-extractor`, `bunlight-test-runner`, `bunlight-profile-router`, `bunlight-bench-runner`, `bunlight-publisher`
- **MCP tools**: `bunlight_scrape`, `bunlight_detect`, `bunlight_extract_cookies`, `bunlight_pool_run`

All skills are Bun + Lightpanda specific; they never suggest Node stdlib or external binaries.
