---
name: bxc Autopilot & Autonomy
description: This skill should be used for the autopilot loop (scripts/autopilot.sh), scoped verify + lint to avoid global noise, monitor feeding, subagent spawning, PLAN.md / MEGA-PLAN.md management, continuous "YOLO" operation without human in the loop, and log-based coordination.
version: 0.1.0
---

Key: always scope the verify/lint commands to the feature packages + relevant src (see the bxc-verify command and verify-enforcer agent).

The loop reads PLAN.md, runs scoped checks, appends to log, sleeps.

**Services for instant MCP + caching**: Reactivate via scripts/bxc-control.sh deploy (or sudo systemctl start bxc bxc-crawler). bxc-crawler.service runs the 24/7 AutonomousCrawler daemon (populates Redis bxc:cache:url:* + SQLite). bxc.service runs the API/CDP server. All crawlers (recursive, get_url_*, mirror background) now cache-first for instant MCP fetches (tools check Redis → SQLite → live only on miss). Use in agents for fresh-yet-cached web data alongside xai/x tools.

Use for any long-running autonomous development or maintenance of bxc-like projects.
