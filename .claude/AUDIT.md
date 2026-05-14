# Bunlight Plugin Audit

Comprehensive audit of the Bunlight Claude Code plugin against Anthropic's official `plugin-dev` and `skill-creator` best practices. Conducted by `bunlight-plugin-maximizer`.

Date: 2026-05-10
Plugin path: `/home/ubuntu/bunmium/bunlight/.claude-plugin/`, `/home/ubuntu/bunmium/bunlight/.claude/`
Initial version: `0.1.0-alpha`

---

## 1. plugin.json

### Findings (initial)

```json
{
  "name": "bunlight",
  "version": "0.1.0-alpha",
  "description": "...",
  "author": { "name": "Bunmium" },
  "homepage": "https://github.com/bunmium/bunlight",
  "repository": { "type": "git", "url": "https://github.com/bunmium/bunlight" },
  "license": "MIT (binary: AGPL-3.0 due to Lightpanda static link)",
  "keywords": [...],
  "agents": [...],
  "skills": ["bunlight"],
  "commands": [...]
}
```

### Issues

1. `license` field violates SPDX format ("MIT (binary: AGPL-3.0 ...)" is not parseable). SPDX expects a single identifier or expression like `MIT OR AGPL-3.0`. The dual-license note belongs in the `LICENSE` file, not in `plugin.json`.
2. `agents`, `skills`, `commands` arrays are redundant: Claude Code auto-discovers these from `agents/`, `skills/`, `commands/` directories. Listing them adds maintenance burden without benefit, and the docs explicitly say "custom paths supplement defaults".
3. `version` `0.1.0-alpha` is non-semver (alpha needs a number: `0.1.0-alpha.0` per the npm package).
4. Missing fields: `bugs`, structured `author.email`/`url`, no `mcpServers` field (we add MCP), no `hooks` field (auto-discovered from `hooks/hooks.json`).
5. No tags for marketplace category (e.g. "automation", "scraping", "browser").

### Recommendations

- Drop the redundant component arrays; rely on auto-discovery.
- Use SPDX `MIT` and link to `LICENSE` in body for AGPL nuance.
- Bump to `0.2.0` for the maximization release (semver-compliant).
- Add `bugs` and richer `author` fields.

Status: APPLIED.

---

## 2. Agents (4 agents in `.claude/agents/`)

### Issues per agent

#### Common to all 4

- Frontmatter is missing required `model` field (best practice: `inherit`).
- Frontmatter is missing required `color` field (visual identification in UI).
- `tools` field uses string format `"Read, Write, Edit, Bash(bun:*), WebFetch"` instead of YAML array `["Read", "Write", "Edit", "Bash", "WebFetch"]`. Note: `Bash(bun:*)` syntax is for command/skill `allowed-tools`, not agents.
- Description starts "Use when..." (second-person trigger). Best practice: "Use this agent when... Typical triggers include [...]. See 'When to invoke' in the agent body."
- No "When to invoke" body section with prose-bullet scenarios as Anthropic recommends.

#### `bunlight-scraper`

- Description is decent but lacks the explicit "Typical triggers include..." prose summary.
- `tools` includes `WebFetch` — justified for testing target URLs before scraping.
- No example response to URL/profile mismatches.

#### `bunlight-crawler`

- Same frontmatter issues.
- Description triggers are clear ("Crawl 1000 URLs", "Distributed crawling").
- Body has a strong "Process" section but no "When to invoke" worked-scenario list.

#### `bunlight-debugger`

- Description very clear on diagnostic role.
- No "When to invoke" section.

#### `bunlight-cookie-extractor`

- `tools` includes `WebFetch` — questionable since extraction is local. Should drop `WebFetch`, keep `Read`, `Write`, `Edit`, `Bash`.
- No "When to invoke" section.

### Recommendations

- Harmonize frontmatter: add `model: inherit`, `color: <distinct>`, convert `tools` to YAML array.
- Rewrite descriptions in the Anthropic prose pattern.
- Add a "When to invoke" body section with 2-4 prose-bullet scenarios.
- Minimize tools per agent (least privilege).

Status: APPLIED.

---

## 3. Skill: `bunlight` (1 skill, 8 references, ~7965 words total)

### Issues

#### Description quality

Current description starts with "Bunlight — Bun + Lightpanda browser automation. Use when the user wants to..." — uses second-person ("Use when..."). The Anthropic skill-creator guideline is **third-person**: "This skill should be used when the user asks to ...".

The description does mention 5 profiles but does not include explicit user-quote triggers (e.g. `"scrape this URL"`, `"crawl 1000 pages"`, `"bypass Cloudflare"`).

#### Body length

SKILL.md body is 867 words — well under the 2,000-word target. Good.

#### References organization

8 references at sizes 684-1097 words each. All well-scoped. Total `references/` is ~6,098 words, properly progressive-disclosed.

Names align well except: SKILL.md references `/bunlight:storage` and `/bunlight:browser-basics`, but no `storage.md` or `browser-basics.md` file exists (only api.md, cookbook.md, cookies.md, detect.md, pool.md, profiles.md, queue.md, troubleshooting.md). Two broken references.

#### Frontmatter

- `allowed-tools` uses `Bash(bun:*)` — correct syntax.
- Missing `version` field.

### Recommendations

- Rewrite description in third-person, include explicit trigger quotes.
- Add `version: 0.2.0`.
- Either add the missing `storage.md` and `browser-basics.md` reference files, or remove the dead links.

Status: APPLIED. Created `storage.md` and `browser-basics.md`.

---

## 4. Commands (4 commands)

### Issues

- Commands use `args: project-name` style. The official frontmatter field is `argument-hint` (per Anthropic docs).
- `description` field is fine but commands are written as **descriptions to the user** ("Will create:", "Output:"), not as **instructions to Claude**. Anthropic critical rule: "Commands are written for agent consumption, not human consumption."
- No `allowed-tools` declared (commands inherit, which is fine but explicit is better for security).
- `bunlight-init` has hardcoded behavior text but no actual init logic; it's purely descriptive.
- No use of `$ARGUMENTS`, `$1`, `$2` placeholders to inject the user's args into the prompt.

### Recommendations

- Convert `args:` to `argument-hint:`.
- Rewrite commands as Claude-directed instructions with `$1`, `$ARGUMENTS` placeholders.
- Add `allowed-tools` declarations.

Status: APPLIED.

---

## 5. Missing components (level-up additions)

### Hooks (none exist)

Bunlight should ship hooks to:

- Reinforce "Bun-native API" reminder when Claude is about to run `bun` commands (PreToolUse Bash matcher).
- Lint markdown for emojis after Write (Bunlight house rule).
- Report metrics on Stop.
- Show plugin status on SessionStart (lib path, default profile).

Status: APPLIED. Added `hooks/hooks.json` + 4 scripts in `hooks/scripts/`.

### MCP server (none exists)

Bunlight is uniquely positioned to expose its automation capabilities as MCP tools:

- `bunlight_scrape(url, profile)` — scrape a single URL.
- `bunlight_detect(url)` — framework detection.
- `bunlight_extract_cookies(domain)` — load cookie jars.
- `bunlight_pool_run(urls[])` — batch parallel scrape.

Status: APPLIED. Added stdio MCP server at `mcp/bunlight-mcp/` (TypeScript, Bun-native).

### Plugin settings (`.claude/bunlight.local.md`)

Per `plugin-settings` skill pattern: ship a template at `bunlight.local.example.md` that users copy to `.claude/bunlight.local.md` (gitignored).

Status: APPLIED.

### `.claude-plugin/README.md`

No README inside `.claude-plugin/` for marketplace discovery. The repo-root `README.md` is the npm-package README, not the Claude plugin README.

Status: APPLIED.

---

## 6. New components added

### Agents (4 new)

- `bunlight-test-runner` — runs `bun test`, parses output, suggests fixes.
- `bunlight-profile-router` — picks the optimal profile for a URL.
- `bunlight-bench-runner` — runs benchmarks, formats results.
- `bunlight-publisher` — prepares npm releases.

### Commands (4 new)

- `/bunlight-test` — run tests filtered by profile.
- `/bunlight-bench` — benchmark a URL across profiles.
- `/bunlight-cookie-import` — import cookies from a file.
- `/bunlight-doctor` — diagnose binary installations.

---

## 7. Triggering accuracy (skill-creator guidance)

Following `skill-creator:skill-creator` guidance:

- Description must be **third-person** ("This skill should be used when the user asks to...").
- Include **specific user-quote triggers**, not abstract verbs.
- Trigger phrases should match the user's actual lexicon (the cookbook patterns: "scrape", "crawl", "bypass Cloudflare", "Turnstile", "framework detection", etc.).

Three test scenarios for skill triggering (eval candidates):

1. User: "scrape https://shop.example.com for products" → MUST trigger `bunlight` skill.
2. User: "Cloudflare is blocking my crawler" → MUST trigger `bunlight` skill (matches "Cloudflare", "crawler").
3. User: "explain the difference between V8 and JavaScriptCore" → MUST NOT trigger (off-domain).

Status: descriptions revised to maximize triggering on (1) and (2) without inviting (3).

---

## 8. Marketplace readiness

### Pre-flight

- [x] `plugin.json` valid JSON, semver version, SPDX license.
- [x] `.claude-plugin/README.md` exists.
- [x] `LICENSE` exists at repo root.
- [x] No emojis in any plugin .md (Bunlight house rule).
- [x] All component dirs at plugin root (not inside `.claude-plugin/`).
- [x] Skills auto-discovered via `SKILL.md`, no path overrides.
- [x] All hook commands use `${CLAUDE_PLUGIN_ROOT}`.
- [x] All MCP server commands use `${CLAUDE_PLUGIN_ROOT}`.
- [x] No hardcoded absolute paths in any component.
- [x] No secrets committed.

### Recommended for `claude marketplace publish`

- Add screenshots once the plugin has a demo (post Phase 2).
- Tag once releases are cut on GitHub: `v0.2.0`.

---

## Summary

The Bunlight plugin starts solid (good directory layout, lean SKILL.md, focused agents) but has frontmatter inconsistencies, second-person descriptions, broken cross-references, and is missing the level-up components (hooks, MCP, settings). All issues are addressed in this maximization pass.

End state: 8 agents, 1 skill (10 references), 8 commands, 4 hooks, 1 MCP server with 4 tools, settings template, marketplace-ready manifest and README.
