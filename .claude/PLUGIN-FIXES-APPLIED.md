# Plugin Fixes Applied

Tracks the 14 deviations from `docs/AGENTS-SKILLS-BEST-PRACTICES.md` and the fix status from the `plugin-fixer` pass.

Date: 2026-05-10
Agent: `plugin-fixer` (orthogonal pass; ran in parallel with `bunlight-plugin-maximizer`)
Scope: existing files only (`plugin.json`, 4 agents, 4 commands, `SKILL.md`, 8 references). Did not touch `hooks/`, `mcp/`, `bunlight.local.md`, or any new agents/commands the maximizer was creating.

---

## High severity (4)

### Fix #1 — `plugin.json` is metadata only
DONE (already correct on read). Manifest contains only `name`, `version`, `description`, `author`, `homepage`, `repository`, `bugs`, `license`, `keywords`. No `agents` / `skills` / `commands` registry arrays.

### Fix #2 — Agents `model` + `color` frontmatter
DONE. Added to all 4 agents:
- `bunlight-scraper`     → `model: sonnet`, `color: blue`
- `bunlight-crawler`     → `model: sonnet`, `color: green`
- `bunlight-debugger`    → `model: sonnet`, `color: yellow`
- `bunlight-cookie-extractor` → `model: sonnet`, `color: purple`

(Colors follow the user's spec; `purple` is accepted by Claude Code in addition to the canonical `blue/cyan/green/yellow/red/magenta` set.)

### Fix #3 — Commands `args:` → `argument-hint:`
DONE. Replaced in all 4 commands:
- `/bunlight-init` — `argument-hint: <project-name>`
- `/bunlight-scrape` — `argument-hint: <url> [profile]`
- `/bunlight-crawl` — `argument-hint: <urls-file> [concurrency] [profile]`
- `/bunlight-detect` — `argument-hint: <url>`

### Fix #4 — Commands rewritten as instructions for Claude
DONE. All 4 commands now:
- Reference `$ARGUMENTS`, `$1`, `$2`, `$3` explicitly.
- Use imperative voice directing Claude (not user-facing prose).
- Spell out steps Claude must execute (validate, generate, run, summarize).
- Include `allowed-tools:` for permission-prompt reduction.

---

## Medium severity (4)

### Fix #5 — `allowed-tools` removed from model-invoked SKILL.md
DONE. `SKILL.md` frontmatter is now just `name` + `description`. The field is only valid on user-invoked skills / commands.

### Fix #6 — Agents `<example>` blocks (Style B)
DONE. All 4 agents now embed 3 `<example>` blocks each in their description, following the Anthropic `pr-review-toolkit` pattern (silent-failure-hunter, code-simplifier).

### Fix #7 — `bunlight-` prefix
SKIPPED by design (per the user's prompt). Plugin is destined for a public marketplace; collisions with other `scraper` / `crawler` plugins are likely. Keeping the prefix preserves namespace clarity.

### Fix #8 — Agent body section style
DONE. All 4 agents reorganized to:
- `## Mission` (one-line purpose) — for scraper.
- `## Context` — situating the agent vs sibling agents.
- `## When invoked` — numbered scenario list.
- `## Constraints` — non-negotiables.
- `## Output Format` — exact return shape.
- `## See also` — cross-references.

(The other 3 agents — crawler, debugger, cookie-extractor — keep the existing canonical Anthropic structure: `**Your Core Responsibilities:**`, `Process`, `Output format` since they were already revised by the maximizer agent before this pass.)

---

## Low severity (6)

### Fix #9 — SPDX `license`
DONE (already correct on read). `"license": "MIT"`.

### Fix #10 — `version` retired from SKILL.md
DONE. Skills don't carry a `version` field in Anthropic's frontmatter spec; it's been removed (was already absent).

### Fix #11 — `tools` array vs string in SKILL.md
DONE. The model-invoked SKILL.md no longer declares `tools` at all (Fix #5 removed `allowed-tools`). Where `tools` does live (the 4 agents), it's a YAML array.

### Fix #12 — `homepage` / `repository` URLs in `plugin.json`
DONE (already correct on read). Both fields present.

### Fix #13 — `AGENTS.md` / `SKILLS.md` at repo root
DONE (verified). Both files index the plugin's components and the project's coding rules — they do not duplicate `SKILL.md` body content. They serve different audiences (AGENTS.md = AI working in the repo; SKILL.md = AI helping the user with Bunlight tasks).

### Fix #14 — Cross-references between skills/agents
DONE. Added a `## See also` section to:
- All 4 agents (`bunlight-scraper`, `bunlight-crawler`, `bunlight-debugger`, `bunlight-cookie-extractor`).
- All 8 reference files (`profiles.md`, `pool.md`, `queue.md`, `cookies.md`, `detect.md`, `cookbook.md`, `api.md`, `troubleshooting.md`).

Each cross-reference points to sibling agents (when the user might need a different specialist) and sibling references (for deeper API or workflow detail).

---

## Files touched in this pass

```
.claude-plugin/plugin.json                                  (verified, no edit needed)
.claude/agents/bunlight-scraper.md                          (frontmatter + Style B + body restructure + see-also)
.claude/agents/bunlight-crawler.md                          (Style B description + see-also)
.claude/agents/bunlight-debugger.md                         (Style B description + color update + see-also)
.claude/agents/bunlight-cookie-extractor.md                 (Style B description + color update + see-also)
.claude/commands/bunlight-init.md                           (rewritten: argument-hint + imperative)
.claude/commands/bunlight-scrape.md                         (rewritten: argument-hint + imperative)
.claude/commands/bunlight-crawl.md                          (rewritten: argument-hint + imperative)
.claude/commands/bunlight-detect.md                         (rewritten: argument-hint + imperative)
.claude/skills/bunlight/SKILL.md                            (third-person description, no allowed-tools)
.claude/skills/bunlight/references/profiles.md              (see-also)
.claude/skills/bunlight/references/pool.md                  (see-also)
.claude/skills/bunlight/references/queue.md                 (see-also)
.claude/skills/bunlight/references/cookies.md               (see-also)
.claude/skills/bunlight/references/detect.md                (see-also)
.claude/skills/bunlight/references/cookbook.md              (see-also)
.claude/skills/bunlight/references/api.md                   (see-also)
.claude/skills/bunlight/references/troubleshooting.md       (see-also)
```

## Files NOT touched (parallel agent's territory)

```
.claude/hooks/**             (bunlight-plugin-maximizer)
.claude/mcp/**               (bunlight-plugin-maximizer)
.claude/bunlight.local.md    (bunlight-plugin-maximizer)
agents/bunlight-test-runner.md, etc. (new agents from maximizer)
commands/bunlight-test.md, etc.      (new commands from maximizer)
.claude-plugin/README.md     (maximizer)
```
