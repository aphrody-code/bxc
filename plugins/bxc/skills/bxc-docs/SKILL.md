---
name: bxc-docs
description: This skill should be used when writing or improving CLAUDE.md, MEGA-PLAN.md, package READMEs, SKILL.md (progressive disclosure, strong triggers, third-person), agent frontmatter, command docs, or making the bxc knowledge (or a port) complete, lisible, and reusable via the bxc Claude Code plugin.
metadata:
  short-description: Maintain bxc documentation and agent skills.
---

Follow plugin-dev patterns (see plugins/plugin-dev-reference/) and Codex skill
patterns. Keep both integration surfaces valid: Claude Code uses
`.claude-plugin/`, while Codex uses `.codex-plugin/plugin.json` and lowercase
hyphenated skill names.

Always keep docs in sync with code changes (especially new Chat methods, XTools, FFI symbols, CLI subcommands).

The bxc-core and this skill emphasize making everything generic so the plugin + docs can be dropped into other projects.
