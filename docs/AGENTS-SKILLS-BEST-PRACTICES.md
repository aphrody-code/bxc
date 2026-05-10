# Claude Code Plugins — Best Practices 2026

Research compiled from Anthropic's official repos and the live `claude-plugins-official` marketplace, used to grade Bunlight's `.claude/` setup.

Primary sources surveyed:
- `anthropics/claude-plugins-official` — internal plugins (example-plugin, plugin-dev, skill-creator, feature-dev, code-review, pr-review-toolkit). Canonical reference.
- `anthropics/skills` — Anthropic's `skills/` library and `template/SKILL.md`.
- `agentskills.io/specification` — the public Agent Skills spec (linked from Anthropic).
- 30+ real public repos surfaced via `gh search code path:.claude/skills` and `path:.claude/agents` (May 2026).

---

## 1. TL;DR — Top 10 rules

1. **Skills are now the preferred surface — even for slash commands.** Anthropic's `example-plugin/README.md` says it explicitly: "The `commands/*.md` layout is a legacy format. It is loaded identically to `skills/<name>/SKILL.md` — the only difference is file layout. For new plugins, prefer the `skills/` directory format." A user-invoked slash command is just a SKILL.md whose frontmatter includes `argument-hint` and `allowed-tools`.
2. **The `description` field is the only triggering signal.** It's loaded in context at all times. Anthropic's skill-creator says descriptions tend to **undertrigger** — make them slightly "pushy" with explicit phrases the user might say.
3. **Use third person + imperative for skill descriptions.** Anthropic's `skill-development` skill: "This skill should be used when the user asks to 'X', 'Y', 'Z'." Not "Use this when…".
4. **Keep SKILL.md body lean (≤500 lines / 1500–2000 words).** Push detail to `references/`, code to `scripts/`, output assets to `assets/`. This is the *progressive-disclosure* pattern — three loading levels (metadata → SKILL.md → bundled resources).
5. **Agent descriptions need worked examples.** Anthropic's production agents (`silent-failure-hunter`, `code-simplifier`) embed 2–4 `<example>…</example>` blocks directly in the description.
6. **`tools:` is principle of least privilege.** Read-only review agents = `["Read", "Grep", "Glob"]`. Code generators add `Write`. Don't grant `Bash` unless required.
7. **Use `model: inherit` by default.** Override only when a specific tradeoff is intentional (haiku for cheap eligibility checks, sonnet for analysis, opus for hard reasoning). `inherit` is what Anthropic uses in `skill-reviewer`, `agent-creator`.
8. **`color:` is required on agents.** Anthropic always sets one — `blue/cyan` for analysis, `green` for success-oriented, `yellow` for caution/validation, `red` for critical/security, `magenta` for creative/generation.
9. **`plugin.json` is metadata only — don't enumerate components.** Anthropic's official plugin manifests have only `name`, `description`, `author`. Components are auto-discovered from `agents/`, `commands/`, `skills/<name>/`, `hooks/`, `.mcp.json`. Listing them in `plugin.json` is wrong — those keys are reserved for *custom paths*, not a registry.
10. **Use `${CLAUDE_PLUGIN_ROOT}` for every intra-plugin path.** Never hardcode absolute paths. Plugins install in different locations depending on marketplace vs. local vs. npm.

---

## 2. Frontmatter canonical templates

Copy/paste-ready, drawn directly from `anthropics/claude-plugins-official/plugins/example-plugin/` and `plugins/plugin-dev/skills/agent-development/SKILL.md`.

### 2a. Sub-agent (`.claude/agents/<name>.md`)

```yaml
---
name: kebab-case-name              # required, 3-50 chars, ^[a-z0-9][a-z0-9-]*[a-z0-9]$
description: |                     # required, 200-1000 chars sweet spot
  Use this agent when [conditions]. Trigger proactively after [scenario]. Examples:

  <example>
  Context: User just finished writing X.
  user: "[verbatim user prompt]"
  assistant: "I'll use the <name> agent to [action]."
  <commentary>[why this triggers]</commentary>
  </example>

  <example>
  Context: [different scenario]
  user: "[verbatim user prompt]"
  assistant: "[response]"
  <commentary>[why]</commentary>
  </example>
model: inherit                     # required: inherit | sonnet | opus | haiku
color: blue                        # required: blue|cyan|green|yellow|magenta|red
tools: ["Read", "Grep", "Glob"]    # optional, omit = all tools, prefer least-privilege
---

You are an [expert role] specializing in [domain].

**Your Core Responsibilities:**
1. [Primary]
2. [Secondary]

**Process:**
1. [Step 1]
2. [Step 2]

**Output Format:**
[Exactly what to return]

**Edge Cases:**
- [Case]: [Handling]
```

Field rules (from `plugin-dev/skills/agent-development/SKILL.md`):

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | yes | kebab-case | 3-50 chars, no `_`, must start/end alphanumeric |
| `description` | yes | string (often `\|`-block) | 10-5000 chars, 2-4 `<example>` blocks recommended |
| `model` | yes | `inherit\|sonnet\|opus\|haiku` | `inherit` is the default choice |
| `color` | yes | named color | Distinct per agent in same plugin |
| `tools` | no | array | Omit = all tools |

### 2b. Skill (`.claude/skills/<name>/SKILL.md`) — model-invoked

```yaml
---
name: skill-name                   # required, kebab-case
description: This skill should be used when the user asks to "phrase 1", "phrase 2", "phrase 3", or mentions [keywords]. Covers [scope]. Triggers on: [keywords list].
version: 0.1.0                     # optional but recommended (semver)
license: MIT                       # optional
---

# Skill Name

Brief overview (1-2 sentences).

## When to use

[Imperative form: "To accomplish X, do Y."]

## Workflow

1. [Step]
2. [Step]

## Additional Resources

For detailed guidance, consult:
- **`references/patterns.md`** — Common patterns
- **`references/api.md`** — Full API reference

Working examples in `examples/`:
- **`examples/basic.ts`** — Minimal scraper
```

Anthropic's `template/SKILL.md` is just two fields:

```yaml
---
name: template-skill
description: Replace with description of the skill and when Claude should use it.
---
```

That is the **absolute minimum**. Everything else (`version`, `license`, `allowed-tools`) is optional.

### 2c. User-invoked skill / slash command (`.claude/skills/<name>/SKILL.md` OR legacy `.claude/commands/<name>.md`)

```yaml
---
name: skill-name                   # required for skills/, optional for commands/
description: One-line shown in /help (≤60 chars)
argument-hint: <required> [optional]   # documents args for autocomplete
allowed-tools: ["Read", "Glob", "Grep", "Bash(git:*)"]
model: haiku                       # optional override
disable-model-invocation: false    # optional, true = manual-only
---

# Heading

Instructions written FOR Claude (imperative). The user invoked this with: $ARGUMENTS

Use $1, $2, $3 for positional arguments.
```

Field rules (from `plugin-dev/skills/command-development/SKILL.md`):

| Field | Required | Notes |
|---|---|---|
| `description` | yes | Shown in `/help` |
| `argument-hint` | recommended | E.g. `[pr-number] [priority]` |
| `allowed-tools` | recommended | Reduces permission prompts. Supports `Bash(git:*)` glob |
| `model` | optional | `haiku` for fast/simple, `sonnet` default, `opus` for analysis |
| `disable-model-invocation` | optional | `true` blocks the SlashCommand tool from auto-invoking |

### 2d. Plugin manifest (`.claude-plugin/plugin.json`)

Anthropic's actual plugins (skill-creator, plugin-dev, pr-review-toolkit, feature-dev, code-review):

```json
{
  "name": "plugin-name",
  "description": "Brief, action-oriented sentence describing what this plugin does.",
  "author": {
    "name": "Author Name",
    "email": "support@example.com"
  }
}
```

That's it. Optional fields (per `plugin-structure` skill):

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "…",
  "author": { "name": "…", "email": "…", "url": "…" },
  "homepage": "https://…",
  "repository": "https://github.com/…",
  "license": "MIT",
  "keywords": ["testing", "automation"],
  "commands": "./custom-commands",
  "agents": ["./agents", "./specialized-agents"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

**Critical**: the `commands`/`agents`/`skills`/`hooks` fields are *custom path overrides* (which **supplement** defaults). They are **NOT a registry of component names**. Bunlight's current manifest violates this — see audit.

### 2e. Marketplace manifest (`.claude-plugin/marketplace.json` for distributing many plugins)

From `anthropics/claude-plugins-official/.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "marketplace-name",
  "description": "…",
  "owner": { "name": "…", "email": "…" },
  "plugins": [
    {
      "name": "plugin-x",
      "description": "…",
      "author": { "name": "…" },
      "category": "development",
      "source": "./plugins/plugin-x",
      "homepage": "https://…"
    },
    {
      "name": "external-plugin",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/org/repo.git",
        "path": "plugins/x",
        "ref": "v1.0.1",
        "sha": "abcdef…"
      }
    }
  ]
}
```

`category` values seen in the wild: `development`, `security`, `design`, `productivity`, `data`, `documentation`.

---

## 3. Sub-agent best practices

### 3a. Description must be a triggering contract

Anthropic's `agent-development` skill on the description field: **"This is the most critical field — it is loaded into context whenever the agent is registered, so the harness can decide when to dispatch."**

Two acceptable styles, both observed in Anthropic's production agents:

**Style A — prose summary + pointer (compact, used in newer agents):**
```yaml
description: Use this agent when [condition]. Typical triggers include
  [scenario 1 in prose], [scenario 2], and [scenario 3]. See "When to invoke"
  in the agent body for worked scenarios.
```
Source: `plugin-dev/skills/agent-development/SKILL.md` template.

**Style B — embedded `<example>` blocks (richer, used in pr-review-toolkit):**
```yaml
description: |
  Use this agent when… Examples:

  <example>
  Context: User just finished implementing X.
  user: "Please review my changes"
  assistant: "I'll use the silent-failure-hunter agent to thoroughly examine the error handling."
  </example>
```
Source: `pr-review-toolkit/agents/silent-failure-hunter.md`, `pr-review-toolkit/agents/code-simplifier.md` (3 worked examples each).

Both work. Style B is more expensive in tokens but improves trigger accuracy. Use Style B for proactive agents (those the assistant should self-invoke), Style A for narrowly-scoped tools.

### 3b. Body structure is consistent across Anthropic agents

Looking at `code-architect.md`, `code-explorer.md`, `code-reviewer.md`, `silent-failure-hunter.md`:

```
1. Role statement: "You are a [role] specializing in [domain]."
2. Core Responsibilities: numbered list (3-7 items)
3. Process / Analysis Approach: numbered phases (3-5 phases) with bullet sub-steps
4. Quality Standards / Confidence Scoring (when applicable)
5. Output Format / Output Guidance: exactly what to deliver
6. Edge cases / Examples (optional)
```

Length: 2000–4000 chars body. Longer than that and the agent feels rigid.

### 3c. Tools = least privilege, with explicit list

Observed tool sets in Anthropic agents:

| Agent purpose | Tools |
|---|---|
| Read-only analysis | `["Read", "Grep", "Glob"]` (skill-reviewer, code-explorer used this without tools field but conceptually) |
| Code review | `tools` line lists: `Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch, KillShell, BashOutput` (no Edit/Write — review only, no mutations) |
| Code generation | `["Write", "Read"]` (agent-creator) |
| Default / unrestricted | omit field |

Anthropic agents use a **comma-separated string** in `tools:` for review-style agents (`Glob, Grep, LS, Read, …`) and a **YAML array** in agent-creator (`tools: ["Write", "Read"]`). Both are valid; arrays are cleaner.

`Bash(git:*)` glob syntax restricts bash to a command prefix — use this in commands rather than agents.

### 3d. Color guidance (mostly visual but consistent in official plugins)

| Color | Convention | Anthropic example |
|---|---|---|
| `blue` | analysis, neutral | code-architect (actually green), agent-creator |
| `cyan` | review, exploration | skill-reviewer |
| `green` | success-oriented, builders | code-architect |
| `yellow` | validation, caution | code-explorer, silent-failure-hunter |
| `red` | critical, security | code-reviewer |
| `magenta` | creative, generation | agent-creator |

### 3e. Avoid agent cascades

`agent-development/SKILL.md` warns against agents launching agents recursively. The `feature-dev.md` command launches 2-3 `code-explorer` agents *in parallel* but the agents themselves don't spawn more agents — orchestration stays at the command level.

---

## 4. Skill best practices

### 4a. Description is the trigger contract — and it tends to undertrigger

Direct quote from `skills/skill-creator/SKILL.md`:

> Currently Claude has a tendency to "undertrigger" skills — to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit "pushy". So for instance, instead of "How to build a simple fast dashboard…", you might write "How to build a simple fast dashboard. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'"

**Pattern observed in `plugin-dev/skills/*/SKILL.md`** (every one of them):
```yaml
description: This skill should be used when the user asks to "phrase 1", "phrase 2", "phrase 3", or [keyword/context]. [What it covers].
```

Anthropic's plugin-dev describes itself with **5–10 quoted user phrases**. That's the gold standard.

### 4b. Three loading levels — progressive disclosure

From `skill-creator/SKILL.md`:

| Level | What | When loaded | Size budget |
|---|---|---|---|
| 1 | Metadata (`name` + `description`) | Always | ~100 words |
| 2 | SKILL.md body | When skill triggers | <500 lines / 1500-2000 words |
| 3 | Bundled resources (`scripts/`, `references/`, `assets/`) | On demand by Claude | Unlimited (scripts can run without loading) |

**Anti-pattern**: cramming everything into SKILL.md. **Pattern**: SKILL.md is a roadmap that tells Claude when to read which reference file.

### 4c. Bundled resources have specific roles

From `skill-development/SKILL.md` (Anthropic):

- `scripts/` — Executable code for tasks needing deterministic reliability or repeatedly-rewritten boilerplate. Token-efficient because they can be *executed without loading into context*.
- `references/` — Documentation Claude reads as needed (schemas, API docs, domain knowledge). Keeps SKILL.md lean.
- `assets/` — Files used in the *output* (templates, fonts, icons). Not loaded into context.

**Avoid duplication rule**: information lives in either SKILL.md or a reference — not both. Prefer reference files.

### 4d. Domain organization for multi-variant skills

From `skill-creator/SKILL.md`:

```
cloud-deploy/
├── SKILL.md              # workflow + selection logic
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

The skill itself reads only the relevant reference based on context. Bunlight's `references/profiles.md`, `cookies.md`, `pool.md`, `queue.md` follow this pattern — good.

### 4e. Writing style: imperative, not second person

`skill-development/SKILL.md` is explicit: **"Write the entire skill using imperative/infinitive form (verb-first instructions), not second person."**

Bad: "You should validate the URL first."
Good: "Validate the URL first."

Bunlight's current SKILL.md uses second-person sparingly — minor improvement available.

---

## 5. Command best practices

(Reminder: in 2026, commands are skills — `skills/<name>/SKILL.md` is the preferred layout, `commands/<name>.md` is legacy-but-supported.)

### 5a. Commands are instructions FOR Claude, not messages TO the user

From `command-development/SKILL.md`:

> When a user invokes `/command-name`, the command content becomes Claude's instructions. Write commands as directives TO Claude about what to do, not as messages TO the user.

**Wrong:**
```markdown
This command will scrape your URL and return JSON output with the page title.
```
**Right:**
```markdown
Scrape the URL `$ARGUMENTS` using the Bunlight `fast` profile.
Extract the page title and HTML body.
Save output as JSON to `./output/scrape-<timestamp>.json`.
```

Bunlight's current commands violate this — see audit (§ 8).

### 5b. Use `$ARGUMENTS`, `$1`, `$2` for arg expansion

```markdown
---
description: Fix issue by number
argument-hint: <issue-number>
---

Fix issue #$ARGUMENTS following coding standards.
```

For positional args:
```markdown
---
argument-hint: <pr-number> <priority> <assignee>
---

Review PR #$1 with priority $2. Assign to $3 after review.
```

### 5c. `allowed-tools` reduces permission prompts

```yaml
allowed-tools: ["Read", "Glob", "Grep", "Bash(git:*)"]
```
The `Bash(git:*)` glob restricts bash to git invocations — high-leverage pattern observed in `code-review/commands/code-review.md`:
```yaml
allowed-tools: Bash(gh issue view:*), Bash(gh search:*), Bash(gh issue list:*),
  Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*)
```

### 5d. Use `model: haiku` for cheap eligibility checks

`feature-dev`'s code-review command uses Haiku agents for eligibility checks ("is this PR closed?") and Sonnet agents for the actual review. Pattern: cheap-model for routing, expensive-model for substance.

---

## 6. Plugin packaging

### 6a. Manifest is metadata-only

```json
{
  "name": "plugin-name",
  "description": "Action-oriented sentence (≤200 chars).",
  "author": { "name": "…", "email": "…" }
}
```

That's it. Anthropic's official plugins (skill-creator, plugin-dev, pr-review-toolkit, feature-dev, code-review) all use this minimal form.

**Do NOT enumerate components** in `agents`/`commands`/`skills` keys — those keys are reserved for *custom paths*, and they *supplement* (not replace) the default `agents/`, `commands/`, `skills/` directories.

### 6b. Auto-discovery rules

| Component | Location | What's discovered |
|---|---|---|
| Commands | `commands/*.md` | Every `.md` file becomes a slash command (legacy) |
| Agents | `agents/*.md` | Every `.md` file becomes a sub-agent |
| Skills | `skills/<name>/SKILL.md` | Every subdirectory with a SKILL.md becomes a skill |
| Hooks | `hooks/hooks.json` | Inline JSON config |
| MCP servers | `.mcp.json` (root) | Inline JSON config |
| Plugin scripts | `scripts/` | Helper scripts |

### 6c. `${CLAUDE_PLUGIN_ROOT}` is mandatory for path references

```json
{
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/validate.sh"
}
```

Never use absolute paths — plugins install in different locations depending on marketplace, npm, or local install.

### 6d. Marketplace listing structure

For distributing on a marketplace:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "your-marketplace",
  "description": "…",
  "owner": { "name": "…", "email": "…" },
  "plugins": [
    { "name": "x", "description": "…", "category": "development",
      "source": "./plugins/x", "homepage": "…" }
  ]
}
```

`source` accepts a path string or a typed object (`{"source": "git-subdir", "url": …, "path": …, "ref": …, "sha": …}` for pinning).

---

## 7. Anti-patterns observed in the wild

Cross-referenced against Anthropic guidance and what real public repos got wrong.

1. **Vague descriptions.** `"description: Helps with code"` — gives the harness no signal. From `agent-development`: "Be specific about when NOT to use the agent." Repos like `ashrid/rfid-printer:gsd.md` document this exact failure mode (custom `subagent_type` values caused `InputValidationError`).

2. **Listing component names in `plugin.json`.** Bunlight does this. The `agents`, `commands`, `skills` keys are for *custom path overrides*, not a registry. Anthropic's official manifests never list component names.

3. **Skills > 500 lines / 2000 words in SKILL.md body.** Common in community plugins. The fix is move detail to `references/`. `skill-development/SKILL.md` itself: "Keep SKILL.md lean: Target 1,500-2,000 words for the body."

4. **Commands written for the human, not Claude.** Bunlight's commands all do this (`bunlight-init.md`: "Will create: TypeScript configuration…"). Should be imperative: "Create a TypeScript project at `./$ARGUMENTS` with Bunlight pre-configured. Write `tsconfig.json` with strict mode…"

5. **Granting `Bash` unconditionally to read-only review agents.** Code-reviewer-style agents should not have `Write`/`Edit`/unrestricted `Bash`. Anthropic's `code-reviewer.md` explicitly omits them.

6. **Missing `model:` and `color:` on agents.** `agent-development` lists both as **required**. Bunlight's agents have neither.

7. **No `argument-hint` on commands with arguments.** Loses autocomplete + makes the contract opaque. Bunlight has this only as a custom `args:` field which is *non-standard* — the spec key is `argument-hint`.

8. **Cascade-spawning agents from agents.** Causes runaway token use. Keep orchestration in commands; let agents do leaf work.

9. **Bundling secrets/credentials in the plugin tree.** Use `.gitignore` and runtime env vars (`${API_KEY}`). The `example-plugin/.mcp.json` shows the pattern.

10. **Naming agents/skills without the plugin prefix when they're generic.** If `bunlight-scraper` lived in a plugin called `bunlight`, the auto-namespacing would yield `bunlight:bunlight-scraper` — redundant. Either drop the prefix from the file (just `scraper.md`) or accept the redundancy. Anthropic's `plugin-dev` plugin names its skills `agent-development`, `skill-development`, etc. — short, no prefix.

---

## 8. Bunlight audit — what's good, what's not

Reviewed: `/home/ubuntu/bunmium/bunlight/.claude-plugin/plugin.json`, all four `.claude/agents/*.md`, all four `.claude/commands/*.md`, `.claude/skills/bunlight/SKILL.md`.

### 8a. What's right

- Plugin lives at correct paths: `.claude-plugin/plugin.json`, `.claude/agents/`, `.claude/commands/`, `.claude/skills/<name>/SKILL.md`.
- Skill structure has `references/` subdirectory with 8 topical files (`profiles.md`, `cookies.md`, `pool.md`, etc.) — textbook progressive disclosure.
- Agent descriptions all start with "Use when…" which is reasonable Style A.
- Skill description has good "pushy" trigger phrases ("scrape a website, crawl URLs, detect frameworks…").
- All filenames are kebab-case.
- Good cross-references inside SKILL.md (`/bunlight:profiles`, `/bunlight:cookbook`).

### 8b. Where Bunlight deviates from canonical patterns

| # | Issue | Severity | File(s) |
|---|---|---|---|
| 1 | `plugin.json` lists `agents`/`skills`/`commands` arrays of names — invalid (those keys are custom paths, not a registry) | high | `.claude-plugin/plugin.json` |
| 2 | `plugin.json` `license` field has invalid value (free-form prose, not SPDX) | low | same |
| 3 | Agents missing **required** `model` and `color` fields | high | all 4 agents |
| 4 | Agents use `tools: Read, Write, Edit, Bash(bun:*), WebFetch` as comma-string — works, but switching to YAML array is cleaner | low | all 4 agents |
| 5 | Skill uses `allowed-tools:` but YAML allows top-level `allowed-tools` only on user-invoked skills/commands; for model-invoked SKILL.md the field is generally omitted (the runtime decides) | medium | `.claude/skills/bunlight/SKILL.md` |
| 6 | Skill has no `version:` field — recommended for marketplace distribution | low | same |
| 7 | Commands use non-standard `args:` instead of canonical `argument-hint:` | high | all 4 commands |
| 8 | Commands are written as messages TO the human ("Will create: TypeScript configuration…") instead of instructions FOR Claude | high | all 4 commands |
| 9 | Commands don't reference `$ARGUMENTS` / `$1` / `$2` so the args never get into Claude's prompt | high | all 4 commands |
| 10 | Agent body sections use `## When to invoke`, `## Capabilities`, `## Process`, `## Code style`, `## Common patterns` — fine, but Anthropic's standard is `**Your Core Responsibilities:**`, `**Process:**`, `**Output Format:**` (bold-key style scans better in agent prompts) | low | all 4 agents |
| 11 | `bunlight-` prefix on every agent/command duplicates the plugin namespace (so users see `/bunlight:bunlight-scrape`) | medium | every file |
| 12 | Agent descriptions have no `<example>` blocks — fine for Style A, but Bunlight uses neither prose-summary-pointer nor examples consistently | medium | all 4 agents |
| 13 | `bunlight-debugger.md` instructs running raw bash commands like `bun pm list @bunmium/bunlight` — but `tools: Bash(bun:*)` only allows `bun:*`, not `bun pm` (the glob pattern needs verification — `bun pm list` matches but unclear) | low | `bunlight-debugger.md` |
| 14 | No `homepage`/`repository` in plugin.json author field structure — currently `"author": {"name": "Bunmium"}` is OK but the doc-recommended shape adds `email` and `url` | low | `.claude-plugin/plugin.json` |

### 8c. Concrete fix list

**Fix #1 — `plugin.json` rewrite:**

```json
{
  "name": "bunlight",
  "version": "0.1.0-alpha",
  "description": "Bun + Lightpanda fused — production-grade browser automation in 50 KB. In-process CDP, 4 profiles (static, fast, stealth, max), pool/queue/dataset storage, auto-routing for challenges.",
  "author": {
    "name": "Bunmium",
    "url": "https://github.com/bunmium"
  },
  "homepage": "https://github.com/bunmium/bunlight",
  "repository": "https://github.com/bunmium/bunlight",
  "license": "MIT",
  "keywords": ["bun", "lightpanda", "browser-automation", "scraping", "crawling", "ai-agents", "headless", "cdp"]
}
```
Drop the `agents`, `skills`, `commands` arrays — they auto-discover. Move the AGPL note for the binary into the plugin README, not the SPDX `license` field.

**Fix #2 — agent frontmatter additions** (apply to all four):

```yaml
---
name: bunlight-scraper
description: Use this agent when the user wants to write a Bunlight scraper for a specific URL or pattern. Specializes in single-page scraping, data extraction, profile selection, and producing production-ready scraper code. Trigger proactively after the user mentions a target URL or asks "how do I scrape X". Examples:

  <example>
  Context: User wants to scrape a product listing page.
  user: "Write a scraper for https://example.com/products"
  assistant: "I'll use the bunlight-scraper agent to choose the right profile and produce the script."
  </example>

  <example>
  Context: User shares a list of URLs and asks for extraction.
  user: "I need to grab titles and prices from these 50 URLs"
  assistant: "I'll use the bunlight-scraper agent to design a PagePool-based extractor."
  </example>
model: inherit
color: green
tools: ["Read", "Write", "Edit", "Bash", "WebFetch"]
---
```
(Note: `Bash(bun:*)` is more restrictive — keep that if you trust the glob, but verify it doesn't choke on `bun pm`, `bun add`, etc.)

Color suggestions:
- `bunlight-scraper` → `green` (builder)
- `bunlight-crawler` → `blue` (large-scale analysis)
- `bunlight-debugger` → `red` (problem-fixer / critical)
- `bunlight-cookie-extractor` → `magenta` (workflow)

**Fix #3 — command rewrites** (example for `bunlight-scrape.md`):

```markdown
---
description: Scrape a URL with Bunlight, choosing the profile automatically
argument-hint: <url> [profile]
allowed-tools: ["Read", "Write", "Bash"]
---

# Scrape a URL with Bunlight

The user invoked this with: $ARGUMENTS

Steps:
1. Parse `$1` as the URL and `$2` as the optional profile (default `fast`).
2. Validate that `$1` is a valid URL; if not, ask the user to retry.
3. If `$2` is empty, run `detectFromPage` to pick the best profile, otherwise use `$2`.
4. Generate a scraper script at `./scripts/scrape-<host>-<timestamp>.ts` using the bunlight-scraper agent's template.
5. Run the script: `bun run ./scripts/scrape-<host>-<timestamp>.ts`.
6. Print a summary: URL, profile, status, output file path, page title, content length.

If the chosen profile fails with a Cloudflare challenge, escalate to `stealth` then `max` and report which profile succeeded.
```

Same shape for `bunlight-init`, `bunlight-crawl`, `bunlight-detect`. Each must:
- Remove `args:` and replace with `argument-hint:`
- Reference `$ARGUMENTS` / `$1` / `$2`
- Read as instructions for Claude, not user docs
- Add `allowed-tools:` to reduce prompt noise

**Fix #4 — drop `bunlight-` prefix from filenames** (optional but cleaner):

`agents/bunlight-scraper.md` → `agents/scraper.md` (becomes `bunlight:scraper`).
Same for crawler, debugger, cookie-extractor; same for commands.

**Fix #5 — skill SKILL.md `allowed-tools`**: remove the `allowed-tools` from the model-invoked skill frontmatter (it's only enforced for user-invoked skills). The model-invoked skill should be lean:

```yaml
---
name: bunlight
description: Bunlight — Bun + Lightpanda browser automation. Use when the user wants to scrape a website, crawl URLs, detect frameworks, handle cookies/auth, bypass Cloudflare, or build browser automation workflows. Covers 5 profiles (static, fast, http, stealth, max), page pools, request queues, framework detection, cookie injection, and 10 complete examples.
version: 0.1.0
license: MIT
---
```

**Fix #6 — Add a `bunlight-scrape` user-invoked skill (`skills/bunlight-scrape/SKILL.md`)** to migrate off the legacy `commands/` layout. The `commands/` files can stay during transition, but new development should go in `skills/`.

---

## 9. Sources (curated examples)

All links checked May 2026.

### Anthropic-official (canonical reference)

1. `anthropics/skills` repo — https://github.com/anthropics/skills (the public skills library)
2. `anthropics/skills/template/SKILL.md` — minimal SKILL.md — https://github.com/anthropics/skills/blob/main/template/SKILL.md
3. `anthropics/skills/skills/skill-creator/SKILL.md` — the meta-skill for creating skills, with the "pushy description" guidance — https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
4. `anthropics/claude-plugins-official` — https://github.com/anthropics/claude-plugins-official
5. `plugins/example-plugin/README.md` — explicit "commands are legacy" statement — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/example-plugin/README.md
6. `plugins/example-plugin/skills/example-skill/SKILL.md` — canonical model-invoked skill template — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/example-plugin/skills/example-skill/SKILL.md
7. `plugins/example-plugin/skills/example-command/SKILL.md` — canonical user-invoked skill (slash command) — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/example-plugin/skills/example-command/SKILL.md
8. `plugins/plugin-dev/skills/agent-development/SKILL.md` — the canonical agent-writing guide — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md
9. `plugins/plugin-dev/skills/skill-development/SKILL.md` — canonical skill-writing guide — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/skill-development/SKILL.md
10. `plugins/plugin-dev/skills/command-development/SKILL.md` — slash-command guide (notes "legacy" status of `commands/`) — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/command-development/SKILL.md
11. `plugins/plugin-dev/skills/plugin-structure/SKILL.md` — manifest + directory layout — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/plugin-structure/SKILL.md
12. `plugins/feature-dev/agents/code-architect.md` — example agent with `model: sonnet`, `color: green`, full body structure — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/agents/code-architect.md
13. `plugins/feature-dev/agents/code-explorer.md` — analysis agent with `color: yellow` — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/agents/code-explorer.md
14. `plugins/feature-dev/agents/code-reviewer.md` — review agent with `color: red`, confidence scoring — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/agents/code-reviewer.md
15. `plugins/feature-dev/commands/feature-dev.md` — multi-phase command using `$ARGUMENTS` — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/commands/feature-dev.md
16. `plugins/code-review/commands/code-review.md` — commands with `Bash(gh ...:*)` glob and Haiku-then-Sonnet pattern — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/commands/code-review.md
17. `plugins/pr-review-toolkit/agents/silent-failure-hunter.md` — Style B description with embedded `<example>` blocks — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/silent-failure-hunter.md
18. `plugins/pr-review-toolkit/agents/code-simplifier.md` — three-example Style B agent with `model: opus` — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md
19. `plugins/plugin-dev/agents/agent-creator.md` — agent that *writes* agents — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/agents/agent-creator.md
20. `plugins/plugin-dev/agents/skill-reviewer.md` — read-only agent: `tools: ["Read", "Grep", "Glob"]`, `color: cyan` — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/agents/skill-reviewer.md
21. `plugins/plugin-dev/commands/create-plugin.md` — command using YAML-array `allowed-tools` and Skill/Task tools — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/commands/create-plugin.md
22. `.claude-plugin/marketplace.json` — canonical marketplace structure — https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json
23. Agent Skills public spec (linked from Anthropic) — https://agentskills.io/specification

### Community / 3rd-party (cross-validates patterns)

24. `notque/claude-code-starter-kit` — community starter with `.claude/`, `agents/`, `skills/`, `hooks/`, `scripts/` — https://github.com/notque/claude-code-starter-kit
25. `phileggel/claude-kit` — Tauri/React/Rust shared agents+skills — https://github.com/phileggel/claude-kit
26. `Lopettia/artifex` — structured agents+skills+commands toolkit — https://github.com/Lopettia/artifex
27. `g5c9vq2cyh-debug/everything-claude-code` — production-ready agents/skills/hooks/commands/MCP — https://github.com/g5c9vq2cyh-debug/everything-claude-code
28. `mirosing/resilient-server-ops` — `.claude/skills/` skill for SSH operations — https://github.com/mirosing/resilient-server-ops
29. `dvschultz/adobe-hut` — example community SKILL.md with frontmatter — https://github.com/dvschultz/adobe-hut/blob/main/.claude/skills/ae-edl.md
30. `loomi-labs/arco` — concise skill description style — https://github.com/loomi-labs/arco/blob/main/.claude/skills/linear.md
31. `cooneycw/claude-power-pack` — multi-skill pack — https://github.com/cooneycw/claude-power-pack
32. `evannagle/ludolph` — `pr` command example — https://github.com/evannagle/ludolph/blob/main/.claude/skills/pr.md
33. `niksacdev/engineering-team-agents` — engineering-team agent suite — https://github.com/niksacdev/engineering-team-agents
34. `HakAl/team_skills` — TEAM.md document on agent invocation patterns/anti-patterns — https://github.com/HakAl/team_skills
35. `ashrid/rfid-printer` — documents the `subagent_type` failure modes — https://github.com/ashrid/rfid-printer (anti-pattern reference)

---

## 10. Quick-grade scorecard for Bunlight

Out of the 14 deviations identified in §8, severity-weighted:

- **High-severity fixes** (change behavior or break specs): 4 issues — plugin.json schema, missing `model`/`color`, non-standard `args:`, commands written for human
- **Medium-severity fixes** (works but suboptimal): 4 issues — `allowed-tools` placement, no examples in agent descriptions, `bunlight-` prefix duplication, agent body section style
- **Low-severity fixes** (cosmetic / polish): 6 issues — license SPDX, `version` on skill, tools as array, `bun:*` glob coverage, command output format, author URL

**Estimated time to fix:** 30-45 minutes for an experienced developer. All fixes are surgical; no architectural changes needed.

**Strengths to preserve:** the `references/` decomposition, "pushy" skill description, kebab-case naming, complete code examples, decision-tree-style profile selection in the skill.
